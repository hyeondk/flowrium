const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {registerLinkDelivery,sender}=require('../electron/link-delivery.cjs');
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-delivery-')),api={},urls=[],calls=[],sent=[],issued=[];let owner=1,now=Date.now(),mails=[],context={enabled:true,scopeId:'scope'};
 const runtime=registerLinkDelivery((n,f)=>api[n]=f,{directory:dir,callbackPort:0,accountRevision:()=>owner,now:()=>now,
  secretStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from('sealed:'+v),decryptString:v=>v.toString().slice(7)},
  openExternal:async u=>urls.push(u),getContext:()=>context,ensureRemote:async()=>{context.enabled=true},
  issueLink:async input=>{issued.push(input);return{url:'https://test-work.trycloudflare.com/#handoff='+('a'.repeat(40)),scopeId:context.scopeId,expiresAt:now+input.ttlMinutes*60000}},
  mailProvider:()=>({search:async()=>mails,send:async value=>sent.push(value)}),fetchImpl:async(url,options={})=>{
   calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/oauth/token')?{access_token:'private-access',refresh_token:'private-refresh',expires_in:3600}:{result_code:0}),{status:200});
  }});
 t.after(async()=>{await runtime.shutdown();await fs.rm(dir,{recursive:true,force:true})});
 return{api,runtime,urls,calls,sent,issued,dir,setMails:v=>mails=v,setOwner:v=>owner=v,advance:v=>now+=v,get now(){return now}};
}
test('카카오 로그인은 상태·PKCE를 검증하고 비밀을 화면에 노출하지 않으며 본인에게만 단회 주소를 전달',async t=>{
 const f=await fixture(t);await f.api.configureLinkDelivery({restKey:'test-rest-key-value',clientSecret:'private-secret',ttlMinutes:5});
 await f.api.connectKakao();const auth=new URL(f.urls[0]),redirect=auth.searchParams.get('redirect_uri');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 assert.equal((await fetch(redirect+'?state=wrong&code=code')).status,400);assert.equal(f.calls.length,0);
 const callback=await fetch(redirect+'?state='+auth.searchParams.get('state')+'&code=code');assert.equal(callback.status,200);
 const form=f.calls[0].options.body;assert.equal(form.get('code_verifier').length,64);assert.equal(form.get('client_secret'),'private-secret');
 const state=await f.api.linkDeliveryState();assert.equal(state.connected,true);assert(!JSON.stringify(state).includes('private-'));
 await f.api.sendKakaoLink();const call=f.calls.find(c=>c.url.includes('memo/default/send'));assert(call);const payload=JSON.parse(call.options.body.get('template_object'));assert.equal(payload.object_type,'text');
 assert(payload.link.web_url.startsWith('https://hyeondk.github.io/flowrium/connect/#u='));assert(!payload.link.web_url.includes('private-access'));assert.deepEqual(f.issued,[{ttlMinutes:5}]);
 assert((await fs.readFile(path.join(f.dir,'link-delivery.enc'),'utf8')).startsWith('sealed:'));
 f.setOwner(2);assert.equal((await f.api.linkDeliveryState()).connected,false);await assert.rejects(f.api.sendKakaoLink(),/연결/);
});
test('메일 연결 답장은 명시한 발신자·새 제목·시간·한 번 처리·일일 한도에만 적용',async t=>{
 const f=await fixture(t);assert.equal((await f.api.linkDeliveryState()).mail.enabled,false);
 await f.api.configureLinkDelivery({mail:{enabled:true,provider:'google',senders:['me@example.test'],phrase:'Flowrium 링크'}});
 f.setMails([
  {id:'foreign',from:'other@example.test',at:new Date(f.now+100).toISOString(),title:'Flowrium 링크'},
  {id:'old',from:'me@example.test',at:new Date(f.now-100).toISOString(),title:'Flowrium 링크'},
  {id:'wrong',from:'me@example.test',at:new Date(f.now+100).toISOString(),title:'다른 업무'},
  {id:'valid',from:'내 계정 <me@example.test>',at:new Date(f.now+100).toISOString(),title:'Flowrium 링크 주세요'},
 ]);
 await f.api.checkLinkMail();assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'me@example.test');assert.match(f.sent[0].body,/#handoff=/);
 await f.api.checkLinkMail();assert.equal(f.sent.length,1);await assert.rejects(f.api.sendLinkMail('other@example.test'),/허용/);
 for(let i=0;i<19;i++)await f.api.sendLinkMail('me@example.test');assert.equal(f.sent.length,20);await assert.rejects(f.api.sendLinkMail('me@example.test'),/20/);assert.equal(f.sent.length,20);
 assert.equal(sender('내 계정 <ME@example.test>'),'me@example.test');
});
test('메일 대기 중 계정이 바뀌면 늦은 요청으로 메일을 보내지 않는다',async t=>{
 const f=await fixture(t);await f.api.configureLinkDelivery({mail:{enabled:true,provider:'google',senders:['me@example.test'],phrase:'Flowrium 링크'}});
 f.setOwner(2);f.setMails([{id:'old-owner',from:'me@example.test',at:new Date(f.now+100).toISOString(),title:'Flowrium 링크'}]);await f.api.checkLinkMail();assert.equal(f.sent.length,0);
});
