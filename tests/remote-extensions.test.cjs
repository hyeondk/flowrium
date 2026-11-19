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
  await assert.rejects(fs.stat(path.join(projectFolder,'.flowrium','attachments',id)),{code:'ENOENT'});
  const receipt=randomUUID();assert.equal((await f.call('send',{sessionId:session.id,submissionId:receipt,text:'',requestSourceId:id,mode:'plan'})).status,200);
  const source=await sourceRecord(store,project.id,id,true);assert.equal(source.bytes.toString('utf8'),text);
  assert.equal(sent.length,1);assert.equal(sent[0].requestSourceId,id);
  assert.deepEqual(await fs.readdir(path.join(projectFolder,'.flowrium','attachments')),[id]);
  const medium='고'.repeat(900000);assert.equal((await f.call('send',{sessionId:session.id,text:medium,mode:'plan'})).status,200);
  assert.equal(sent[1].text,medium);
  assert.equal((await f.call('mobileSettings',medium)).status,400);
  const abandoned=Buffer.from('구형 화면에서 보내지 않고 닫은 미전송 원문');
  const legacy=await fetch(f.base+'/api/mobile/request-source?sessionId='+session.id,{method:'POST',headers:{Origin:f.base,Authorization:'Bearer '+f.key,'Content-Type':'application/octet-stream'},body:abandoned});
  assert.equal(legacy.status,200);
  await f.api.stopRemoteAccess();
  assert.deepEqual(await fs.readdir(path.join(folder,'profile','mobile-request-staging-v1')),[]);
  assert.deepEqual(await fs.readdir(path.join(projectFolder,'.flowrium','attachments')),[id]);
  const {MobileRequestUploads}=require('../electron/mobile-request-uploads.cjs');
  const expiring=new MobileRequestUploads(undefined,100);
  const staged=await expiring.legacy('expired',abandoned,store,project.id,async()=>{});
  for(let i=0;i<100 && (await fs.readdir(path.join(folder,'profile','mobile-request-staging-v1'))).length;i++)await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(expiring.rows.size,0);
  assert.deepEqual(await fs.readdir(path.join(folder,'profile','mobile-request-staging-v1')),[]);
  await assert.rejects(fs.stat(path.join(projectFolder,'.flowrium','attachments',staged.id)),{code:'ENOENT'});
});

test('휴대폰 전송 조각은 권한 확인과 임시 파일 쓰기까지 끝난 뒤에만 접수한다',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {createHash}=require('node:crypto'),{Store}=require('../electron/store.cjs');
  const {MobileRequestUploads}=require('../electron/mobile-request-uploads.cjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-mobile-part-'));
  const uploads=new MobileRequestUploads();
  const release=Promise.withResolvers();
  t.after(async()=>{release.resolve();await uploads.clear();await fs.rm(dir,{recursive:true,force:true});});
  const store=new Store(path.join(dir,'profile'));await store.load();
  const root=path.join(dir,'project');await fs.mkdir(root);
  const project=await store.addProject(root);
  const bytes=Buffer.from('승인한 전송 조각');
  const checksum=createHash('sha256').update(bytes).digest('hex');
  const entered=Promise.withResolvers();
  let checks=0,settled=false;
  uploads.begin('fixture',bytes.length,store,project.id,async()=>{
    if(++checks===2){entered.resolve();await release.promise;}
  });
  const result=uploads.part('fixture',0,bytes,checksum).finally(()=>{settled=true;});
  await entered.promise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'권한 확인을 기다리는 중에는 조각을 접수하지 않는다');
  release.resolve();
  assert.deepEqual(await result,{offset:bytes.length});
  const staged=path.join(dir,'profile','mobile-request-staging-v1');
  const [entry]=await fs.readdir(staged);
  assert.deepEqual(await fs.readFile(path.join(staged,entry,'request.txt')),bytes);
});

test('휴대폰 100MiB 초과 단일 원문은 인증된 조각 재전송, 해시 검증, 계정 격리와 미완료 정리를 거친다',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
  const {createHash}=require('node:crypto'),{createReadStream}=require('node:fs'),{Store}=require('../electron/store.cjs');
  const {chunkBytes}=require('../electron/mobile-request-uploads.cjs'),hash=bytes=>createHash('sha256').update(bytes).digest();
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-mobile-raw-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const store=new Store(path.join(folder,'profile'));await store.load();
  const root=path.join(folder,'업무');await fs.mkdir(root);
  const project=await require('./project-trust-fixture.cjs').addTrustedFixtureProject(store,root);
  const first=await store.createSession(project.id),other=await store.createSession(project.id);
  const f=await fixture(t,{store}),uploadId=randomUUID();
  async function request(action,body,{id=uploadId,session=first.id,offset=0,key=f.key,sum,remove=false}={}){
    const part=action==='part',query=new URLSearchParams({sessionId:session,id,action,offset:String(offset)});
    const res=await fetch(f.base+'/api/mobile/request-upload?'+query,{method:remove?'DELETE':part?'PUT':'POST',
      headers:{Origin:f.base,Authorization:'Bearer '+key,'Content-Type':part?'application/octet-stream':'application/json',...part&&{'x-content-sha256':sum||hash(body).toString('hex')}},
      body:remove?undefined:part?body:JSON.stringify(body)});
    return {status:res.status,value:await res.json()};
  }
  const unit='한🌿글 / ',bytes=Buffer.byteLength(unit);
  const block=Buffer.from(unit.repeat(Math.ceil(chunkBytes/bytes)+2)),total=Math.ceil((100*1024*1024+1)/bytes)*bytes;
  const full=createHash('sha256'),firstChunk=block.subarray(0,chunkBytes);
  assert.equal((await request('begin',{size:total},{key:'invalid-test-key'})).status,401);
  assert.equal((await request('begin',{size:total})).status,200);
  assert.equal((await request('part',firstChunk,{session:other.id})).status,400);
  assert.equal((await request('part',firstChunk,{sum:'0'.repeat(64)})).status,400);
  assert.equal((await request('part',Buffer.alloc(chunkBytes+1))).status,400);
  let chain=Buffer.alloc(32),parts=0,largest=0;
  for(let offset=0;offset<total;offset+=chunkBytes){
    const n=Math.min(total-offset,chunkBytes),start=offset%bytes,part=block.subarray(start,start+n);
    const sum=hash(part),expected={status:200,value:{offset:offset+n}};
    assert.deepEqual(await request('part',part,{offset}),expected);
    full.update(part);chain=hash(Buffer.concat([chain,sum]));parts++;largest=Math.max(largest,n);
    if(offset===0){
      assert.deepEqual(await request('part',part,{offset}),expected,'접수 응답 유실 뒤 같은 조각 재시도');
      f.lock(true);assert.equal((await request('begin',{size:total})).status,403);f.lock(false);
      f.owner(1);assert.equal((await request('begin',{size:total})).status,401);f.owner(0);
      assert.deepEqual((await request('begin',{size:total})).value,{offset:n,chain:chain.toString('hex'),chunkBytes});
      assert.equal((await request('finish',{chain:chain.toString('hex')})).status,400);
    }
  }
  const completed=await request('finish',{chain:chain.toString('hex')});
  assert.equal(completed.status,200,JSON.stringify(completed));assert.equal(completed.value.size,total);
  assert.equal(completed.value.sha256,full.digest('hex'));
  assert.deepEqual(await request('finish',{chain:chain.toString('hex')}),completed);
  const attachmentRoot=path.join(root,'.flowrium','attachments'),stored=createHash('sha256');
  const stages=path.join(folder,'profile','mobile-request-staging-v1');
  await assert.rejects(fs.stat(path.join(attachmentRoot,completed.value.id)),{code:'ENOENT'});
  assert.equal((await fs.readdir(stages)).length,1,'보내기 전 원문은 앱 프로필 임시 보관');
  assert.equal((await f.call('send',{sessionId:first.id,text:'',requestSourceId:completed.value.id,submissionId:uploadId})).status,200);
  for await(const chunk of createReadStream(path.join(attachmentRoot,completed.value.id,'request.txt')))stored.update(chunk);
  assert.equal(stored.digest('hex'),completed.value.sha256);
  const partial=randomUUID();await request('begin',{size:total},{id:partial});await request('part',firstChunk,{id:partial});
  assert.equal((await request('',null,{id:partial,remove:true})).status,200);
  assert.deepEqual(await fs.readdir(stages),[]);
  assert.deepEqual(await fs.readdir(attachmentRoot),[completed.value.id]);
  const small=Buffer.from('보낸 원문과 취소한 원문의 독립 보관'),smallChain=hash(Buffer.concat([Buffer.alloc(32),hash(small)])).toString('hex');
  async function stageSmall(id){
    await request('begin',{size:small.length},{id});await request('part',small,{id});
    const response=await request('finish',{chain:smallChain},{id});assert.equal(response.status,200);return response.value.id;
  }
  const standalone=randomUUID();await stageSmall(standalone);
  await request('',null,{id:standalone,remove:true});
  assert.deepEqual(await fs.readdir(stages),[]);
  assert.deepEqual(await fs.readdir(attachmentRoot),[completed.value.id],'완료 뒤 보내기를 취소하면 임시 원문 정리');
  const secondId=randomUUID(),thirdId=randomUUID(),ref=await stageSmall(secondId);
  assert.equal(await stageSmall(thirdId),ref);
  assert.equal((await f.call('send',{sessionId:first.id,text:'',requestSourceId:ref,submissionId:secondId})).status,200);
  await request('',null,{id:thirdId,remove:true});
  assert.deepEqual((await fs.readdir(attachmentRoot)).sort(),[completed.value.id,ref].sort());
  await request('begin',{size:total},{id:partial});await request('part',firstChunk,{id:partial});
  await stageSmall(standalone);
  await f.api.stopRemoteAccess();assert.deepEqual((await fs.readdir(attachmentRoot)).sort(),[completed.value.id,ref].sort());
  assert.deepEqual(await fs.readdir(stages),[]);
  t.diagnostic('UTF-8 '+total+'바이트 / HTTP 본문 최대 '+largest+'바이트 / '+parts+'개 조각 / 저장 원문 1개 / SHA-256 일치');
});
