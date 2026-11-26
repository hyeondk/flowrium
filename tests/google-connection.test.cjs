const assert = require('node:assert/strict');
const {createCipheriv,createDecipheriv,createHash,randomBytes} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {desktopClient,registerGoogleConnection} = require('../electron/google-connection.cjs');

const desktop = {client_id:'flowrium-test.apps.googleusercontent.com',client_secret:'desktop-test-only'};
const mailScope = 'https://www.googleapis.com/auth/gmail.readonly';
const scopes = ['openid','email',mailScope,'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly'];

async function fixture(t, {grant = scopes, backend = 'test'} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-google-'));
  const directory = path.join(root,'profile'), file = path.join(root,'client.json');
  await fs.writeFile(file,JSON.stringify({installed:desktop}));
  const key = randomBytes(32);
  const secretStorage = {
    isEncryptionAvailable:()=>true,
    getSelectedStorageBackend:()=>backend,
    encryptString(value) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,nonce);
      const body = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([nonce,cipher.getAuthTag(),body]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
      decipher.setAuthTag(value.subarray(12,28));
      return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');
    },
  };
  const headers = [{name:'Subject',value:'일정 초안'},{name:'From',value:'발신자'}];
  const handlers = {}, browser = [], calls = [];
  const date = Date.parse('2026-11-26T00:00:00.000Z');
  let now = date, owner = 'owner-a';
  const json = (value,status = 200) => Response.json(value,{status});
  const runtime = registerGoogleConnection((name,handler)=>{handlers[name]=handler;},{
    directory,secretStorage,chooseClient:async()=>file,openExternal:async(url)=>{browser.push(new URL(url));},
    getContext:()=>owner,now:()=>now,loginTimeout:5000,
    async fetchImpl(url,options) {
      const target = new URL(url);
      calls.push({target,options});
      assert.equal(options.redirect,'error');
      if (target.href === 'https://oauth2.googleapis.com/token') {
        if (options.body.get('grant_type') === 'refresh_token') {
          return json({token_type:'Bearer',access_token:'access-renewed',expires_in:3600});
        }
        return json({token_type:'Bearer',access_token:'access-1',refresh_token:'refresh-1',expires_in:3600,scope:grant.join(' ')});
      }
      if (target.href === 'https://openidconnect.googleapis.com/v1/userinfo') return json({email:'user@example.invalid'});
      if (target.href === 'https://oauth2.googleapis.com/revoke') return json({});
      if (!['https://gmail.googleapis.com','https://www.googleapis.com'].includes(target.origin)) throw Error('unexpected URL');
      switch (target.pathname) {
        case '/gmail/v1/users/me/messages':
          return json({messages:[{id:'test1'}]});
        case '/gmail/v1/users/me/messages/test1': {
          const parts = [{mimeType:'text/plain',body:{data:Buffer.from('회의 자료입니다.\n시간을 확인해 주세요.').toString('base64url')}}];
          return json({id:'test1',internalDate:String(date),snippet:'일정 안내',payload:{headers,parts}});
        }
        case '/calendar/v3/users/me/calendarList':
          return json({items:[{id:'work@example.invalid',summary:'업무',primary:false}]});
        case '/calendar/v3/calendars/work%40example.invalid/events':
          return json({items:[{id:'event1',summary:'회의',start:{date:'2026-11-27'},end:{date:'2026-11-28'},
            description:'<script>숨김</script><p>자료 검토</p>'}]});
        default: throw Error('unexpected URL');
      }
    },
  });
  t.after(async()=>{runtime.invalidate();await fs.rm(root,{recursive:true,force:true});});
  return {directory,browser,calls,...handlers,
    advanceClock(milliseconds) { now+=milliseconds; },
    changeOwner(value) { owner=value;runtime.invalidate(); },
    async callback(state,code='test-code',init) {
      const target = new URL(browser.at(-1).searchParams.get('redirect_uri'));
      target.searchParams.set('state',state ?? browser.at(-1).searchParams.get('state'));
      target.searchParams.set('code',code);
      const response = await fetch(target,init);
      return {status:response.status,body:await response.text()};
    },
  };
}

test('Google 데스크톱 앱 OAuth 파일만 가져온다',()=>{
  assert.deepEqual(desktopClient({installed:desktop}),{clientId:desktop.client_id,clientSecret:desktop.client_secret});
  assert.throws(()=>desktopClient({web:desktop}),/데스크톱 앱/);
  assert.throws(()=>desktopClient({installed:{...desktop,refresh_token:'personal-credential'}}),/계정 인증 자료/);
  assert.throws(()=>desktopClient({installed:{...desktop,client_id:'fake.example.invalid'}}),/데스크톱 앱/);
});

test('브라우저에서 필요한 읽기 권한만 받아 Google 메일과 일정을 읽고 갱신·연결 해제한다',async t=>{
  const app = await fixture(t);
  assert.equal((await app.readGoogleConnection()).phase,'unconfigured');
  assert.equal((await app.googleConnectionAction({action:'configure'})).phase,'ready');
  const [entry] = await fs.readdir(app.directory);
  const record = path.join(app.directory,entry);
  assert.match(entry,/^oauth-google-\w{64}\.enc$/);
  assert.ok(!(await fs.readFile(record)).includes(desktop.client_secret));
  assert.equal((await app.googleConnectionAction({action:'connect'})).phase,'pending');
  const [authorization] = app.browser;
  assert.equal(authorization.origin,'https://accounts.google.com');
  const params = authorization.searchParams;
  assert.deepEqual(params.get('scope').split(' '),scopes);
  assert.match(params.get('redirect_uri'),/^http:\/\/127\.0\.0\.1:\d+\/oauth\/google$/);
  assert.equal(params.get('code_challenge_method'),'S256');
  assert.equal((await app.callback('invalid-state')).status,400);
  assert.equal((await app.callback(undefined,undefined,{method:'POST'})).status,400);
  assert.equal(app.calls.length,0);
  assert.equal((await app.callback()).status,200);
  assert.equal(createHash('sha256').update(app.calls[0].options.body.get('code_verifier')).digest('base64url'),params.get('code_challenge'));
  assert.equal(app.calls[0].options.body.get('code'),'test-code');
  assert.equal((await app.readGoogleConnection()).email,'user@example.invalid');
  assert.ok(!(await fs.readFile(record)).includes('refresh-1'));

  const [mail] = await app.readGoogleData({action:'mails',query:'  회의 안건  '});
  assert.equal(mail.title,'일정 초안');
  const search = app.calls.find(({target})=>target.pathname.endsWith('/messages')).target;
  assert.equal(search.searchParams.get('q'),'회의 안건');
  assert.equal((await app.readGoogleData({action:'mail',id:mail.id})).body,'회의 자료입니다.\n시간을 확인해 주세요.');
  const [calendar] = await app.readGoogleData({action:'calendars'});
  assert.equal(calendar.title,'업무');
  const [event] = await app.readGoogleData({action:'events',calendarId:calendar.id});
  assert.deepEqual([event.title,event.at,event.detail.trim()],['회의','2026-11-27','자료 검토']);
  await assert.rejects(app.readGoogleData({action:'mail',id:'../profile'}),/자료 식별자/);
  await assert.rejects(app.readGoogleData({action:'events',calendarId:'../profile'}),/자료 식별자/);

  app.advanceClock(3600000);
  await Promise.all([app.readGoogleData({action:'mails'}),app.readGoogleData({action:'calendars'})]);
  assert.equal(app.calls.filter(({options})=>options.body?.get('grant_type') === 'refresh_token').length,1);
  assert.equal(app.calls.at(-1).options.headers.authorization,'Bearer access-renewed');
  app.changeOwner('owner-b');
  assert.equal((await app.readGoogleConnection()).phase,'unconfigured');
  await assert.rejects(app.readGoogleData({action:'mails'}),/계정을 먼저 연결/);
  app.changeOwner(null);
  await assert.rejects(app.readGoogleConnection(),/잠금을 해제/);
  app.changeOwner('owner-a');
  assert.equal((await app.googleConnectionAction({action:'disconnect'})).phase,'ready');
  assert.equal(app.calls.at(-1).target.href,'https://oauth2.googleapis.com/revoke');
  assert.equal(app.calls.at(-1).options.body.get('token'),'refresh-1');
  await assert.rejects(app.readGoogleData({action:'mails'}),/계정을 먼저 연결/);
});

test('일부 읽기 권한을 거절한 Google 계정은 연결하지 않는다',async t=>{
  const app = await fixture(t,{grant:scopes.filter(scope=>scope!==mailScope)});
  await app.googleConnectionAction({action:'configure'});
  await app.googleConnectionAction({action:'connect'});
  assert.equal((await app.callback()).status,400);
  const state = await app.readGoogleConnection();
  assert.equal(state.phase,'ready');
  assert.match(state.notice,/읽기 권한/);
  assert.equal(app.calls.length,1);
  await assert.rejects(app.readGoogleData({action:'mails'}),/계정을 먼저 연결/);
});

test('보안 저장소가 암호화되지 않으면 OAuth 파일을 저장하지 않는다',async t=>{
  const app = await fixture(t,{backend:'basic_text'});
  await assert.rejects(app.googleConnectionAction({action:'configure'}),/보안 저장소/);
  assert.equal((await app.readGoogleConnection()).phase,'unconfigured');
  assert.equal(app.browser.length,0);
});
