const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash,createHmac,randomBytes} = require('node:crypto');
const {EventEmitter} = require('node:events');
const {MobileUpdater} = require('../electron/mobile-updater.cjs');
const {registerRemote} = require('../electron/remote.cjs');

const current = '261115_09', next = '261115_10';
const official = 'https://github.com/hyeondk/flowrium/releases/download/';
const api = 'https://api.github.com/repos/hyeondk/flowrium/releases/';
const marker = 'mobile-ui-cache.json';

test('휴대폰 마크다운 엔진은 설치한 공식 배포본과 MIT 고지가 일치한다', async () => {
  const dir=path.dirname(require.resolve('markdown-it/package.json'));
  const read=async name=>(await fs.readFile(name,'utf8')).replace(/\r\n/g,'\n');
  const license=await read(path.join(dir,'LICENSE'));
  const source=await read(path.join(dir,'dist/browser/markdown-it.esm.min.mjs'));
  const included=await read(path.resolve(__dirname,'../electron/mobile/markdown-engine.js'));
  assert.equal(included,'/*\n'+license+'*/\n'+source.split('//# sourceMappingURL=')[0].trimEnd()+'\n');
});

async function mockRelease() {
  const files = {};
  const root = path.resolve(__dirname,'../electron/mobile');
  for (const name of await fs.readdir(root)) {
    if (/\.(js|css|html|svg|webmanifest)$/.test(name)) files[name] = await fs.readFile(path.join(root,name),'utf8');
  }
  files['style.css'] += '\n/* 갱신한 화면 */';
  const bytes = Buffer.from(JSON.stringify({format:1,version:next,files}));
  const name = 'Flowrium-' + next + '-mobile-v1.json', url = official + next + '/' + name;
  const asset = {name,size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),browser_download_url:url};
  const data = {tag_name:next,draft:false,prerelease:false,assets:[asset]};
  const fixture = {bytes,data,asset,calls:[],fetches:0};
  fixture.fetchImpl = async (address,options) => {
    fixture.calls.push(new URL(address).pathname);
    assert(!Object.keys(options.headers).some(k=>k.toLowerCase()==='authorization'));
    if (address === api+'latest' || address === api+'tags/'+next) return Response.json(data);
    assert.equal(address,url);
    fixture.fetches++;
    await fixture.beforeFile?.();
    return new Response(fixture.bytes);
  };
  return fixture;
}

async function profile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-mobile-update-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}

test('모바일 파일은 검증 후 같은 연결에 적용되고 재실행할 때 정식 버전에서 복원된다',async t=>{
  const release = await mockRelease(), directory = await profile(t);
  const options = {version:current, directory, fetchImpl:release.fetchImpl};
  const updater = new MobileUpdater(options);
  assert.deepEqual(await updater.check(),{status:'available',version:current,latestVersion:next});
  await Promise.all([updater.apply(next,()=>{}),updater.apply(next,()=>{})]);
  assert.equal(release.fetches,1);
  assert(updater.contents('style.css').includes('갱신한 화면'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,marker),'utf8')),{version:next});
  const restored = new MobileUpdater(options);
  await restored.restore();
  assert.equal(restored.version,next);
  assert.deepEqual(await restored.check(),{status:'current',version:next,latestVersion:next});
  const upgradedComputer = new MobileUpdater({...options,version:'261115_11'});
  await upgradedComputer.restore();
  assert.equal(upgradedComputer.version,'261115_11');
});

test('운영체제가 보호한 파일 지문으로 오프라인 복원하고 손상된 묶음은 정식 릴리스에서 복구한다',async t=>{
  const release = await mockRelease(), directory = await profile(t);
  const key=randomBytes(32), sign=text=>createHmac('sha256',key).update(text).digest('hex');
  const storage={
    isEncryptionAvailable:()=>true,
    encryptString(text){return Buffer.from(JSON.stringify({text,hmac:sign(text)}));},
    decryptString(bytes){const {text,hmac}=JSON.parse(bytes.toString());assert.equal(sign(text),hmac);return text;},
  };
  const options={version:current,directory,storage,fetchImpl:release.fetchImpl};
  const first=new MobileUpdater(options);
  await first.check();await first.apply(next,()=>{});
  const offline=new MobileUpdater({...options,fetchImpl:()=>{throw Error('오프라인');}});
  await offline.restore();
  assert.equal(offline.version,next);
  assert(offline.contents('markdown-engine.js').includes('Permission is hereby granted'));
  assert(offline.contents('chat-reader.js').includes('groupMobileHistory'));
  const filename=path.join(directory,marker),saved=JSON.parse(await fs.readFile(filename,'utf8'));
  saved.bytes=Buffer.from('changed').toString('base64');await fs.writeFile(filename,JSON.stringify(saved));
  const damaged=new MobileUpdater({...options,fetchImpl:()=>{throw Error('오프라인');}});
  await damaged.restore();assert.equal(damaged.version,current);
  const repaired=new MobileUpdater(options);
  await repaired.restore();assert.equal(repaired.version,next);
  assert.equal(release.fetches,2);
  assert.notEqual(JSON.parse(await fs.readFile(filename,'utf8')).bytes,saved.bytes);
});

test('구버전 공개 릴리스, 호환되지 않는 새 버전, 무결성 실패, 연결 폐기를 구분한다',async t=>{
  const release = await mockRelease(), directory = await profile(t);
  const updater = new MobileUpdater({version:current,directory,fetchImpl:release.fetchImpl});
  release.data.assets = [];
  release.data.tag_name = '261115_08';
  assert.deepEqual(await updater.check(),{status:'current',version:current,latestVersion:current});
  release.data.tag_name = next;
  assert.equal((await updater.check()).status,'desktop-required');
  await assert.rejects(updater.apply(next,()=>{}),/다시 확인/);
  release.data.assets = [release.asset];
  release.data.draft = true;
  await assert.rejects(updater.check(),/정식/);
  release.data.draft = false;
  release.asset.browser_download_url = 'https://example.invalid/update';
  await assert.rejects(updater.check(),/파일 정보/);
  release.asset.browser_download_url = official + next + '/' + release.asset.name;
  await updater.check();
  const original = release.bytes;
  release.bytes = Buffer.from(original); release.bytes[release.bytes.length-4] ^= 1;
  await assert.rejects(updater.apply(next,()=>{}),/무결성/);
  release.bytes = original;
  let active = true;
  release.beforeFile = ()=>{active=false;};
  await assert.rejects(updater.apply(next,()=>{if(!active)throw Error('연결 종료');}),/연결 종료/);
  assert.equal(updater.version,current);
  assert.deepEqual(await fs.readdir(directory),[]);
});

function tunnel() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.exitCode = child.signalCode = null;
  child.kill = ()=>{child.exitCode=0;child.emit('exit',0);};
  setImmediate(()=>child.stderr.emit('data',Buffer.from('https://mobile-update-test.trycloudflare.com Registered tunnel connection')));
  return child;
}

async function desktop(t,release) {
  const handlers = new Map(), local = new Map(), controller = new EventEmitter();
  let locked = false;
  controller.runs = new Map(); controller.status = {authenticated:true}; controller.connectionStatus = async()=>controller.status;
  const runtime = registerRemote((name,fn)=>local.set(name,fn),{
    store:{state:{projects:[],sessions:[],settings:{}}},controller,handlers,
    isLocked:()=>locked, version:current, mobileUpdateFetch:release.fetchImpl, tunnelFactory:tunnel,
  });
  t.after(()=>runtime.shutdown());
  async function start() {
    const url = new URL((await local.get('startRemoteAccess')()).localUrl);
    return {base:url.origin,key:new URLSearchParams(url.hash.slice(1)).get('key')};
  }
  return {connection:await start(),start,stop:local.get('stopRemoteAccess'),lock:value=>{locked=value;}};
}

test('독립 데스크톱 두 개의 연결 키, 잠금, 주소 교체와 모바일 전용 갱신을 검사한다',async t=>{
  const release = await mockRelease(), a=await desktop(t,release), b=await desktop(t,release);
  const call = (base,key,method,args=[]) => fetch(base+'/api/mobile/call',{
    method:'POST',headers:{Origin:base,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({method,args}),
  });
  const {base,key}=a.connection;
  assert.equal((await call(base,b.connection.key,'checkMobileUpdate')).status,401);
  a.lock(true);
  assert.equal((await call(base,key,'applyMobileUpdate',[next])).status,403);
  a.lock(false);
  assert.equal((await call(base,key,'checkMobileUpdate')).status,200);
  assert.equal((await call(base,key,'applyMobileUpdate',[next])).status,200);
  assert.equal((await call(base,key,'installUpdate')).status,400);
  const html = await (await fetch(base)).text(), other = await (await fetch(b.connection.base)).text();
  assert(html.includes('flowrium-mobile-version" content="'+next));
  assert(other.includes('flowrium-mobile-version" content="'+current));
  assert((await (await fetch(base+'/style.css')).text()).includes('갱신한 화면'));
  await a.stop();
  const restarted=await a.start();
  assert.notEqual(restarted.key,key);
  assert.equal((await call(restarted.base,key,'applyMobileUpdate',[next])).status,401);
  assert.equal((await call(restarted.base,restarted.key,'checkMobileUpdate')).status,200);
});
