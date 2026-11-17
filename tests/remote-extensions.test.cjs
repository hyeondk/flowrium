const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const {registerRemote}=require('../electron/remote.cjs');
async function fixture(t, options={}){let locked=false,owner=0,time=Date.now(),changes=0;const api={},controller=new EventEmitter();controller.runs=new Map();controller.status={authenticated:true};controller.connectionStatus=async()=>({authenticated:true,available:true});
const handlers=new Map([['workflowState',()=>({version:1,revision:1,preferences:{},notifications:[],proposals:[{id:randomUUID(),revision:1,title:'결정',body:'본문',args:{secret:'숨길 값'},method:'외부 내부 메서드'}],reminders:[],deliveries:[],reports:[],projects:[],sessions:[],toolCalls:[{secret:'내부'}],pending:[{type:'input',requestId:'secret',questions:[{id:'q',question:'숨길 질문',isSecret:true}]}]})],['saveSettings',i=>({...i,codexPath:'숨길 경로'})],['send',options.send|| (async()=>({accepted:true}))]]);
const runtime=registerRemote((name,fn)=>api[name]=fn,{store:options.store||{state:{projects:[],sessions:[],settings:{}}},controller,handlers,isLocked:()=>locked,accountRevision:()=>owner,now:()=>time,onContextChanged:()=>changes++,version:'test',tunnelFactory:()=>{const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.exitCode=p.signalCode=null;p.kill=()=>{p.exitCode=0;p.emit('exit',0)};setTimeout(()=>p.stderr.emit('data',Buffer.from('https://unit-test.trycloudflare.com Registered tunnel connection')),1);return p}});t.after(()=>runtime.shutdown());
const access=await api.startRemoteAccess(),base=new URL(access.localUrl).origin,key=new URLSearchParams(new URL(access.localUrl).hash.slice(1)).get('key');
const exchange=link=>fetch(base+'/api/mobile/handoff',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({handoff:new URLSearchParams(new URL(link.url).hash.slice(1)).get('handoff')})});
const call=(method,...args)=>fetch(base+'/api/mobile/call',{method:'POST',headers:{Origin:base,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({method,args})});return {api,runtime,base,key,call,exchange,lock:v=>locked=v,owner:v=>owner=v,advance:v=>time+=v,changes:()=>changes};}
test('한 번 쓰는 연결 주소는 시간 / 사용 / 계정 / 연결 종료로 무효화된다',async t=>{const f=await fixture(t),first=f.runtime.issueLink({ttlMinutes:5});assert(!first.url.includes(f.key));assert.equal((await f.exchange(first)).status,200);assert.equal((await f.exchange(first)).status,400);const exp=f.runtime.issueLink({ttlMinutes:5});f.advance(300001);assert.equal((await f.exchange(exp)).status,400);const owner=f.runtime.issueLink({ttlMinutes:15});f.owner(1);assert.equal((await f.exchange(owner)).status,400);assert.equal((await fetch(f.base+'/api/mobile/state',{headers:{Authorization:'Bearer '+f.key}})).status,401);assert.equal(f.runtime.pushContext().enabled,false);f.owner(0);const locked=f.runtime.issueLink({ttlMinutes:60});f.lock(true);assert.equal((await f.exchange(locked)).status,400);f.lock(false);await f.api.stopRemoteAccess();assert(f.changes()>=2);assert.equal(f.runtime.pushContext().enabled,false);});
test('모바일 확장은 내부 호출 / 실행 권한 변경 / 비밀 입력을 노출하지 않는다',async t=>{const f=await fixture(t);for(const [method,args]of [['saveSettings',[{codexPath:'/x'}]],['saveMobileSettings',[{chatDefaults:{approval:'never'}}]],['workflowAction',[{action:'preferences',value:{github:true}}]],['changeTeamRun',['p','r',{action:'deleteRun'},0]],['directTeam',['p','t','g','r',{strategy:'manual',attachments:['/etc/passwd']}]]])assert.equal((await f.call(method,...args)).status,400,method);
const state=await(await f.call('mobileWorkflowState')).json();assert.equal(state.result.toolCalls,undefined);assert.equal(state.result.proposals[0].args,undefined);assert.equal(state.result.pending[0].desktopOnly,true);assert(!JSON.stringify(state).includes('숨길 질문'));const saved=await(await f.call('saveMobileSettings',{model:'model',effort:'low',chatDefaults:{answerLength:'short'}})).json();assert.equal(saved.result.codexPath,undefined);assert.equal(saved.result.chatDefaults.answerLength,'short');
const sw=await fetch(f.base+'/sw.js');assert.equal(sw.status,200);assert(sw.headers.get('content-security-policy').includes("worker-src 'self'"));const icon=await fetch(f.base+'/icon.png');assert.equal(icon.headers.get('content-type'),'image/png');assert.equal((await fetch(f.base+'/manifest.webmanifest')).status,200);
});

test('휴대폰의 큰 입력은 인증 후 같은 프로젝트의 원문 하나로 보존된다',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {Store}=require('../electron/store.cjs'),{sourceRecord}=require('../electron/chat-long-request.cjs');
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-long-mobile-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const store=new Store(path.join(folder,'profile'));await store.load();
  const projectFolder=path.join(folder,'project');await fs.mkdir(projectFolder);
  const project=await store.addProject(projectFolder),session=await store.createSession(project.id);
  await require('./project-trust-fixture.cjs').trustFixtureProject(store,project);
  const sent=[];const f=await fixture(t,{store,send:input=>{sent.push(input);return {accepted:true};}});
  const text='\uFEFF처음'+ '가🪴'.repeat(400000)+'중간'+'나🪴'.repeat(400000)+'마지막\n  ';
  const upload=async token=>fetch(f.base+'/api/mobile/request-source?sessionId='+session.id,{
    method:'POST',headers:{Origin:f.base,Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body:Buffer.from(text)
  });
  assert.equal((await upload('invalid')).status,401);
  const stored=await upload(f.key);assert.equal(stored.status,200);const {id}=await stored.json();
  const retry=await upload(f.key);assert.equal((await retry.json()).id,id);
  const source=await sourceRecord(store,project.id,id,true);assert.equal(source.bytes.toString('utf8'),text);
  const receipt=randomUUID();assert.equal((await f.call('send',{sessionId:session.id,submissionId:receipt,text:'',requestSourceId:id,mode:'plan'})).status,200);
  assert.equal(sent.length,1);assert.equal(sent[0].requestSourceId,id);
  assert.deepEqual(await fs.readdir(path.join(projectFolder,'.flowrium','attachments')),[id]);
  const medium='고'.repeat(900000);assert.equal((await f.call('send',{sessionId:session.id,text:medium,mode:'plan'})).status,200);
  assert.equal(sent[1].text,medium);
  assert.equal((await f.call('mobileSettings',medium)).status,400);
});
