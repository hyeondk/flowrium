const test=require('node:test'),assert=require('node:assert/strict'),{CodexClient}=require('../electron/codex.cjs'),{supportedEffort}=require('../electron/model-effort.cjs');
const catalog=[{model:'model-none',supportedReasoningEfforts:[{reasoningEffort:'none'}],defaultReasoningEffort:'none'},{model:'model-deep',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low'},{model:'model-empty',supportedReasoningEfforts:[]},{model:'model-missing'}];
test('서버 model과 id가 다르면 어느 식별자로 요청해도 같은 지원 정보를 찾는다',()=>{const rows=[null,{model:'runtime-name',id:'catalog-id',supportedReasoningEfforts:[{reasoningEffort:'none'}],defaultReasoningEffort:'none'}];assert.equal(supportedEffort('high','runtime-name',rows),'none');assert.equal(supportedEffort('high','catalog-id',rows),'none');});
test('Codex가 광고한 속도만 새 턴에 전달하고 대화 전체의 속도에는 손대지 않는다', async () => {
 const {serviceTier,supportedSpeeds}=require('../electron/model-speed.cjs');
 const {c,wire}=client();
 await c.prepareAnalysisCatalog({modelCatalog:{owner:'local',at:Date.now(),data:[
  {model:'new',serviceTiers:[{id:'priority'},{id:'ultrafast'}]},
  {model:'legacy',additionalSpeedTiers:['fast']},
  {model:'standard',serviceTiers:[]},
 ]}});
 assert.deepEqual(supportedSpeeds({serviceTiers:[],additionalSpeedTiers:['fast']}),['standard','fast']);
 assert.throws(()=>serviceTier('ultra'),/실행 속도/);
 for (const [model,speed] of [['new','ultrafast'],['legacy','fast'],['standard','fast'],['new','standard'],['new',undefined]]) {
  const tier=serviceTier(speed);
  await c.request('turn/start',{model,threadId:'speed',...(tier&&{serviceTierForTurn:tier})});
 }
 assert.deepEqual(wire.map(row=>row.params.serviceTierForTurn),['ultrafast','priority','default','default',undefined]);
 assert(wire.every(row=>row.method==='turn/start'&&!Object.hasOwn(row.params,'serviceTier')));
});
function client(options={}){const c=new CodexClient(options),wire=[];c._write=request=>{wire.push(request);setImmediate(()=>{const result=request.method==='model/list'?{data:catalog}:request.method.startsWith('thread/')?{thread:{id:request.params.threadId||'thread'},model:request.params.model||'model-deep'}:{turn:{id:'turn',status:'inProgress'}};c._message({id:request.id,result});});};return{c,wire};}
test('서비스의 다음 모델 페이지까지 반영하고 반복 커서가 오면 마지막 정상 목록을 보존한다',async()=>{
 const {c}=client(),params=[];
 c.rawRequest=async(method,input)=>{assert.equal(method,'model/list');params.push(input);return input.cursor?{data:[catalog[1]],nextCursor:null}:{data:[catalog[0]],nextCursor:'다음'};};
 const result=await c.request('model/list',{limit:1,includeHidden:false});
 assert.deepEqual(result.data,catalog.slice(0,2));assert.deepEqual(params,[{limit:1,includeHidden:false},{limit:1,includeHidden:false,cursor:'다음'}]);
 c.rawRequest=async()=>({data:[],nextCursor:'같음'});
 await assert.rejects(c.request('model/list'),/페이지/);assert.deepEqual(c.modelCatalog.data,result.data);
});
test('추천은 같은 계정의 최근 모델 목록으로 최저 지원 강도를 선택하고 재조회하지 않는다',async()=>{
 const {c,wire}=client({queueOwner:()=>4});
 const fresh={modelCatalog:{owner:4,at:Date.now(),data:[{model:'selected',defaultReasoningEffort:'high',supportedReasoningEfforts:['high','low','minimal'].map(reasoningEffort=>({reasoningEffort}))}]}};
 await c.prepareAnalysisCatalog(fresh);
 await c.request('turn/start',{threadId:'analysis',model:'selected',effort:'lowest-supported'});
 assert.deepEqual(wire.map(request=>request.method),['turn/start']);
 assert.equal(wire[0].params.effort,'minimal');
});
test('만료되거나 다른 계정의 목록은 한 번 새로 조회하고 실패할 때는 서버 기본 강도로 시작한다',async()=>{
 for(const [owner,at] of [[1,Date.now()],[2,Date.now()-600000]]){
  const {c,wire}=client({queueOwner:()=>2});
  const original=c._write;
  c._write=req=>{
   if(req.method!=='model/list')return original(req);
   wire.push(req);setImmediate(()=>c._message({id:req.id,error:{message:'목록 조회 실패'}}));
  };
  await c.prepareAnalysisCatalog({modelCatalog:{owner,at,data:catalog}});
  await c.request('turn/start',{threadId:'analysis',model:'model-deep',effort:'lowest-supported'});
  assert.deepEqual(wire.map(request=>request.method),['model/list','turn/start']);
  assert(!Object.hasOwn(wire[1].params,'effort'));
 }
});
test('이전 강도는 실제 지원 목록과 기본값으로 정규화하고 none은 보존한다',()=>{assert.equal(supportedEffort('high','model-none',catalog),'none');assert.equal(supportedEffort('none','model-none',catalog),'none');assert.equal(supportedEffort('ultra','model-deep',catalog),'low');assert.equal(supportedEffort('high','model-deep',catalog),'high');for(const id of ['unknown','model-empty','model-missing'])assert.equal(supportedEffort('high',id,catalog),undefined);assert.equal(supportedEffort('ultra',undefined,catalog),'low');});
test('연결 목록을 재사용하며 normal·scope·analysis 클라이언트 모두 실제 turn 경계에서 정규화한다',async()=>{for(const route of ['normal','scope','analysis']){const {c,wire}=client();await c.request('model/list',{limit:100});await c.request('thread/start',{model:'model-none'});await c.request('turn/start',{threadId:'thread',effort:'high',label:route});assert.equal(wire.find(row=>row.method==='turn/start').params.effort,'none');assert.equal(wire.filter(row=>row.method==='model/list').length,1);}});
test('모델을 바꾸거나 기본 모델을 쓰더라도 오래된 강도를 그대로 보내지 않는다',async()=>{const {c,wire}=client();await c.request('thread/start',{model:'model-deep'});await c.request('turn/start',{threadId:'thread',model:'model-none',effort:'high'});await c.request('turn/start',{threadId:'thread',effort:'ultra'});await c.request('thread/start',{});await c.request('turn/start',{threadId:'thread',effort:'ultra'});const turns=wire.filter(row=>row.method==='turn/start');assert.equal(turns[0].params.effort,'none');assert.equal(turns[1].params.effort,'none');assert.equal(turns[2].params.effort,'low');});
test('정보 없음·빈 목록·조회 실패는 effort 필드를 생략하고 요청은 계속한다',async()=>{for(const model of ['unknown','model-empty','model-missing']){const {c,wire}=client();await c.request('turn/start',{threadId:'thread',model,effort:'medium'});assert(!Object.hasOwn(wire.find(row=>row.method==='turn/start').params,'effort'));}const {c,wire}=client(),raw=c.rawRequest.bind(c);c.rawRequest=(method,...args)=>method==='model/list'?Promise.reject(Error('목록 조회 실패')):raw(method,...args);await c.request('turn/start',{threadId:'thread',model:'model-none',effort:'high'});assert(!Object.hasOwn(wire.find(row=>row.method==='turn/start').params,'effort'));});
test('동시 조회를 합치고 계정이 바뀌거나 조회 중 중지하면 turn을 보내지 않는다',async()=>{let owner=1,current=true;const {c,wire}=client({queueOwner:()=>owner,captureTurnGuard:()=>()=>current});const [a,b]=await Promise.all([c.request('turn/start',{model:'model-none',threadId:'a',effort:'high'}),c.request('turn/start',{model:'model-none',threadId:'b',effort:'high'})]);assert(a.turn&&b.turn);assert.equal(wire.filter(row=>row.method==='model/list').length,1);c.clearModelCatalog();const raw=c.rawRequest.bind(c);c.rawRequest=async(method,...args)=>{const result=await raw(method,...args);if(method==='model/list')owner=2;return result};await assert.rejects(c.request('turn/start',{model:'model-none'}),/상태가 바뀌/);assert.equal(wire.filter(row=>row.method==='turn/start').length,2);c.clearModelCatalog();c.rawRequest=async(method,...args)=>{const result=await raw(method,...args);if(method==='model/list')current=false;return result};await assert.rejects(c.request('turn/start',{model:'model-none'}),/상태가 바뀌/);assert.equal(wire.filter(row=>row.method==='turn/start').length,2);});
test('만료된 목록 갱신 실패는 오래된 강도를 재사용하지 않는다',async()=>{const {c,wire}=client();c.modelCatalog={owner:'local',at:0,data:catalog};const raw=c.rawRequest.bind(c);c.rawRequest=(method,...args)=>method==='model/list'?Promise.reject(Error('조회 실패')):raw(method,...args);await c.request('turn/start',{threadId:'thread',model:'model-none',effort:'high'});assert(!Object.hasOwn(wire.find(row=>row.method==='turn/start').params,'effort'));});
test('실제 Controller가 목록 대기 중 완료 처리로 run을 제거해도 예전 turn이 살아나지 않는다',async()=>{const {Controller}=require('../electron/controller.cjs'),{c,wire}=client(),session={id:'s',messages:[]},store={state:{settings:{}},peekSession:()=>session,session:()=>session,save:async()=>{}},controller=new Controller(store,{client:c,queueOwner:()=>1,canRun:()=>true}),run={sessionId:'s',threadId:'thread',ownerRevision:1,finalized:false,cancelled:false};controller.runs.set('s',run);controller.shuttingDown=true;const release=Promise.withResolvers(),raw=c.rawRequest.bind(c);c.rawRequest=(method,...args)=>method==='model/list'?release.promise:raw(method,...args);const pending=c.request('turn/start',{threadId:'thread',model:'model-none',effort:'high'});pending.catch(()=>{});await controller.finish(run,'interrupted');assert.equal(controller.runs.size,0);release.resolve({data:catalog});await assert.rejects(pending,/상태가 바뀌/);assert.equal(wire.filter(row=>row.method==='turn/start').length,0);});
