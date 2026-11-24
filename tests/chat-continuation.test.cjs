const { trustFixtureProject } = require('./project-trust-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs'),{continueConversation}=require('../electron/chat-continuation.cjs');
async function fixture(t){const base=path.resolve(__dirname,'../.flowrium-tmp/qa-261115_03');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'continuation-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100}));const folder=path.join(dir,'project');await fs.mkdir(folder);const store=new Store(path.join(dir,'profile'));await store.load();const project=await store.addProject(folder),session=store.session((await store.createSession(project.id)).id);session.messages=[{id:randomUUID(),role:'user',text:'검색 기능을 검증해 주세요.',createdAt:new Date().toISOString()},{id:randomUUID(),role:'assistant',text:'검색 결과를 확인했습니다. 회귀 검사도 이어서 진행할까요?',createdAt:new Date().toISOString()}];await store.save();let owner=1,allowed=true,calls=0;const controller={store,options:{queueOwner:()=>owner,canRun:()=>allowed},runs:new Map(),editingSessions:new Set(),messageQueue:{pending:()=>false},send:async input=>{calls++;session.messages.push({id:randomUUID(),role:'user',text:input.text,createdAt:new Date().toISOString()});return {accepted:true}}};return {controller,session,input:{sessionId:session.id,messageId:session.messages.at(-1).id},owner:value=>owner=value,allowed:value=>allowed=value,calls:()=>calls};}
test('새 답변·실행·실패·중단·완료 업무에서는 지난 답변의 진행을 거절한다',async t=>{for(const state of ['new','running','failed','interrupted','done']){const f=await fixture(t);if(state==='new')f.session.messages.push({...f.session.messages.at(-1),id:randomUUID()});if(state==='running')f.controller.runs.set(f.session.id,{});if(['failed','interrupted'].includes(state))f.session.messages.push({id:randomUUID(),role:'system',text:state,createdAt:new Date().toISOString()});if(state==='done')f.session.workflow={status:'done'};await assert.rejects(continueConversation(f.controller,f.input),/상태가 바뀌/);assert.equal(f.calls(),0);}});
test('명시 진행만 한 번 보내고 동일한 지난 답변으로 중복 실행하지 않는다',async t=>{const f=await fixture(t);await continueConversation(f.controller,{...f.input,text:'회귀 검사를 먼저 진행해 주세요.',mode:'review'});assert.equal(f.calls(),1);assert.equal(f.session.messages.at(-1).text,'회귀 검사를 먼저 진행해 주세요.');await assert.rejects(continueConversation(f.controller,f.input),/상태가 바뀌/);assert.equal(f.calls(),1);});
test('실제 후속 제안은 공개 작업 설명 뒤에도 정확한 답변을 식별하고 초안이 비면 구체적인 작업을 보낸다',async t=>{
 const f=await fixture(t);
 f.session.messages.push({id:randomUUID(),role:'system',progressCommentary:true,text:'검증 결과를 정리했습니다.',createdAt:new Date().toISOString()});
 await continueConversation(f.controller,{...f.input,mode:'plan'});
 assert.equal(f.session.messages.at(-1).text,'회귀 검사도 이어서 진행해줘');
 assert.equal(f.calls(),1);
});
test('실제 전송의 파일 확인 대기 중 일반 요청이 완료돼도 지난 답변의 진행을 추가하거나 큐에 넣지 않는다',async t=>{
 const f=await fixture(t),{Controller}=require('../electron/controller.cjs'),controller=new Controller(f.controller.store,{canRun:()=>true,queueOwner:()=>1}),folder=f.controller.store.project(f.session.projectId).path,originalStat=fs.stat,entered=Promise.withResolvers(),release=Promise.withResolvers();let intercepted=false;
 await trustFixtureProject(f.controller.store, f.controller.store.project(f.session.projectId));
 fs.stat=async function(target,...args){if(target===folder&&!intercepted){intercepted=true;entered.resolve();await release.promise;}return originalStat.call(this,target,...args)};
 try{controller.startRun=async run=>{f.session.messages.push({id:randomUUID(),role:'assistant',text:'새 요청을 완료했습니다.',createdAt:new Date().toISOString()});await controller.finish(run,'completed')};const old=controller.continueConversation({...f.input,mode:'plan'});old.catch(()=>{});await entered.promise;const finished=new Promise(resolve=>controller.once('event',function observe(event){if(event.type==='done')resolve();else controller.once('event',observe)}));await controller.send({sessionId:f.session.id,text:'별도 새 요청을 처리해 주세요.',mode:'plan'});await finished;release.resolve();await assert.rejects(old,/상태가 바뀌/);assert.equal(f.session.messages.filter(m=>m.role==='user').length,2);assert(!f.session.messages.some(m=>m.text.includes('앞서 제안한 다음 단계')));assert.equal(controller.listQueuedMessages(f.session.id).length,0);}
 finally{release.resolve();fs.stat=originalStat;await controller.shutdown();}
});
test('분석 강도는 모델이 지원하는 값만 선택하고 정보가 없으면 서버 기본값을 사용한다',()=>{
 const {analysisEffort}=require('../electron/structured-analysis.cjs'),models=[{model:'fast',defaultReasoningEffort:'none',supportedReasoningEfforts:[{reasoningEffort:'none'}]},{model:'deep',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'xhigh'}]}];assert.equal(analysisEffort('low','fast',models),'none');assert.equal(analysisEffort('xhigh','deep',models),'xhigh');assert.equal(analysisEffort('ultra','deep',models),'medium');assert.equal(analysisEffort('low','unknown',models),undefined);assert.equal(analysisEffort('low',undefined,models),undefined);
});

test('후속 완료 저장 실패를 되돌리고 재시도와 중복 완료가 메시지나 전송을 바꾸지 않는다',async t=>{
 const f=await fixture(t),{completeContinuation}=require('../electron/chat-continuation.cjs');
 const before=structuredClone(f.session.messages),events=[];
 f.controller.emitEvent=e=>events.push(e);
 const save=f.controller.store.save.bind(f.controller.store);
 f.controller.store.save=async()=>{throw Error('쓰기 실패')};
 await assert.rejects(completeContinuation(f.controller,f.input),/쓰기 실패/);
 assert.equal(f.session.completedContinuationId,undefined);assert.equal(events.length,0);
 f.controller.store.save=save;
 await completeContinuation(f.controller,f.input);
 await completeContinuation(f.controller,f.input);
 assert.equal(f.session.completedContinuationId,f.input.messageId);
 assert.equal(events.length,1);assert.equal(f.calls(),0);assert.deepEqual(f.session.messages,before);
 await assert.rejects(continueConversation(f.controller,f.input),/상태가 바뀌/);
});
test('실제 대기 답변만 완료하고 실행, 대기열, 다른 진행 요청 또는 교체된 메시지는 건드리지 않는다',async t=>{
 const {completeContinuation}=require('../electron/chat-continuation.cjs');
 for(const state of ['plain','running','queue','old','proceeding']){
  const f=await fixture(t);
  if(state==='plain')f.session.messages.at(-1).text='모든 확인이 끝났습니다.';
  if(state==='running')f.controller.runs.set(f.session.id,{});
  if(state==='queue')f.controller.messageQueue.pending=()=>true;
  if(state==='old')f.session.messages.push({...f.session.messages.at(-1),id:randomUUID()});
  if(state==='proceeding')f.controller.continuationFlights=new Set([f.session.id]);
  await assert.rejects(completeContinuation(f.controller,f.input),/상태가 바뀌/);
  assert.equal(f.session.completedContinuationId,undefined);assert.equal(f.calls(),0);
 }
});
