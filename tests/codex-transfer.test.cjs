const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {Store}=require('../electron/store.cjs');
const {CodexTransfer}=require('../electron/codex-transfer.cjs');
class Client extends EventEmitter{
 constructor(folder){super();this.folder=folder;this.calls=[];this.threads=new Map();this.turns=new Map();this.ready=true;this.approvals=new Map();this.inputs=new Map();this.options={};}
 async start(){this.ready=true;}
 async request(method,params){this.calls.push({method,params});if(this.hook)await this.hook(method,params);
  if(method==='account/read')return{account:{type:'chatgpt'}};
  if(method==='project/list')return{data:this.projects||[],nextCursor:null};
  if(method==='thread/list')return{data:[...this.threads.values()].filter(t=>!params.cwd||t.cwd===params.cwd),nextCursor:null};
  if(method==='thread/read'){const thread=this.threads.get(params.threadId);if(!thread)throw Error('대화 없음');return{thread:structuredClone(thread)};}
  if(method==='thread/turns/list'){let turns=structuredClone(this.turns.get(params.threadId)||[]);if(params.sortDirection==='desc')turns.reverse();return{data:turns.slice(0,params.limit||turns.length).map(turn=>params.itemsView==='notLoaded'?{...turn,itemsView:'notLoaded',items:[]}:turn),nextCursor:null};}
  if(method==='thread/items/list'){const turn=this.turns.get(params.threadId).find(t=>t.id===params.turnId),items=turn.extraItems||turn.items.map(item=>({item})),offset=Number(params.cursor||0),data=items.slice(offset,offset+params.limit);return{data:structuredClone(data),nextCursor:offset+data.length<items.length?String(offset+data.length):null};}
  if(method==='thread/fork'){const original=this.threads.get(params.threadId),id='사본-'+this.calls.length;this.threads.set(id,{...original,id,status:{type:'idle'}});this.turns.set(id,structuredClone(this.turns.get(params.threadId)));return{thread:{...original,id}};}
  if(method==='thread/resume')return{thread:this.threads.get(params.threadId)};
  if(method==='turn/start')return{turn:{id:'새작업'}};
  return{};
 }
 close(){this.ready=false;}
}
test('공식 대화 만들기로 전달한 요청은 출처를 표시하고 일반 도구 결과는 요청으로 읽지 않는다',async t=>{
 const {client,folder}=await fixture(t),thread=client.threads.get('원본대화');
 const item={type:'functionCallOutput',id:'one',name:'create_thread',namespace:'codex_app',
  output:'<codex_delegation>\n<source_thread_id>'+require('node:crypto').randomUUID()+'</source_thread_id>\n<input>연결 시험 요청</input>\n</codex_delegation>'};
 const turn={id:'test',items:[item,{...item,id:'two',namespace:'other'},{...item,id:'three',output:'기타 응답'}]};
 const {messages}=await require('../electron/codex-transfer-data.cjs').snapshot(client,thread.id,folder,false,{thread,turns:[turn],textOnly:true});
 assert.deepEqual(messages.map(m=>[m.role,m.text,m.delegated]),[['user','연결 시험 요청',true]]);
});
test('등록 폴더의 새 Codex 요청과 응답이 자동 연결되고 휴지통·다른 계정의 과거·하위 작업은 제외한다',async t=>{
 const f=await fixture(t),runtime=f.runtime,ctx=runtime.context(),excluded=new Set(),newId=()=>require('node:crypto').randomUUID();
 f.controller.trashRuntime={isBusy:()=>false,excludedThreadIds:async()=>excluded};
 const discover=(rows,page)=>require('../electron/chat-discovery.cjs').discoverProjectThreads(rows,ctx,runtime,page);
 await discover([]);
 const template=f.client.threads.get('원본대화'),turns=f.client.turns.get(template.id);
 const add=(patch={})=>{
  const row={...template,id:newId(),createdAt:runtime.discovery.since,updatedAt:runtime.discovery.since,...patch};
  f.client.threads.set(row.id,row);f.client.turns.set(row.id,turns);return row;
 };
 const newChat=add(),trash=add(),other=add({cwd:path.dirname(f.folder)}),old=add({createdAt:runtime.discovery.since-3600}),sub=add({parentThreadId:newChat.id});
 excluded.add(trash.id);
 await discover([trash,other,old,sub,newChat]);
 assert.deepEqual(f.store.state.sessions.map(s=>s.threadId),[newChat.id]);
 const linked=f.store.state.sessions[0];
 assert.equal(linked.codexLink.sourceThreadId,newChat.id);
 assert(linked.messages.some(m=>m.role==='user'));assert(linked.messages.some(m=>m.role==='assistant'));
 const next=add(),firstPage=[trash,other,old,sub,newChat];
 await discover(firstPage,{nextCursor:'다음',params:{archived:false}});
 const original=f.client.request.bind(f.client);
 f.client.request=async(method,params)=>method==='thread/list'&&params.cursor==='다음'?{data:[next],nextCursor:null}:original(method,params);
 await discover(firstPage,{nextCursor:'다음',params:{archived:false}});
 assert.deepEqual(new Set(f.store.state.sessions.map(s=>s.threadId)),new Set([newChat.id,next.id]));
 await discover([next,newChat]);assert.equal(f.store.state.sessions.length,2);
 const project=f.store.state.projects[0], bound=newId();
 project.codexNameLink={id:bound,name:project.name,owner:ctx.owner};
 const marker=path.join(runtime.base,'codex-discovery',ctx.owner+'-'+ctx.revision+'-'+await runtime.device()+'.json');
 await fs.writeFile(marker,JSON.stringify({since:runtime.discovery.since-120}));
 const offline=add({projectId:bound,createdAt:runtime.discovery.since-30});
 const wrong=add({projectId:newId(),createdAt:offline.createdAt}), noBinding=add({createdAt:offline.createdAt});
 delete runtime.discovery;
 await discover([offline,wrong,noBinding,old]);
 assert.deepEqual(new Set(f.store.state.sessions.map(s=>s.threadId)),new Set([newChat.id,next.id,offline.id]));
 const reloaded=new Store(path.dirname(f.store.file));await reloaded.load();
 assert.equal(reloaded.session(linked.id).threadId,newChat.id);
});
test('자동 새로고침 중 들어온 채팅 전송은 최신 본문 확인까지 기다린다', async t => {
  const f = await fixture(t);
  const plan = await f.preview();
  await f.runtime.apply({planId:plan.id});
  const session = f.store.state.sessions[0];
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  f.client.hook = async method => {
    if (method !== 'thread/read') return;
    f.client.hook = null;
    started.resolve();
    await release.promise;
  };
  const sync = f.runtime.refresh(session.id,{background:true});
  await started.promise;
  const sending = f.runtime.beforeSend(session.id);
  release.resolve();
  await Promise.all([sync,sending]);
  assert.equal(session.threadId,'원본대화');
});
test('과거 전송 실패가 마지막에 저장된 대화도 오프라인 재실행과 원본 갱신에서 시간순으로 표시한다',async t=>{
 const f=await fixture(t), plan=await f.preview();
 await f.runtime.apply({planId:plan.id});
 const session=f.store.state.sessions[0], source=[...session.messages];
 const local=(role,text,second)=>({id:require('node:crypto').randomUUID(),role,text,createdAt:new Date(second*1000).toISOString()});
 const failed=[local('user','전송하지 못한 요청',1700000005),local('system','Codex 응답 크기가 허용 범위를 초과했습니다.',1700000006)];
 session.messages.push(...failed);
 await f.store.save();
 const expected=[...source.slice(0,3),...failed,...source.slice(3)];
 const reopened=new Store(path.dirname(f.store.file));
 await reopened.load();
 assert.deepEqual(reopened.session(session.id).messages,expected);
 assert.equal(reopened.repositories.get(f.project.id).heads.get(session.id),f.store.repositories.get(f.project.id).heads.get(session.id));

 f.client.turns.get('원본대화').push({id:'새작업',status:'completed',startedAt:1700000030,completedAt:1700000031,
  items:[{id:'새답변',type:'agentMessage',text:'이어서 받은 답변'}]});
 await f.runtime.refresh(session.id);
 assert.deepEqual(session.messages.slice(0,-1),expected);
 assert.equal(session.messages.at(-1).text,'이어서 받은 답변');
});
test('진행 중인 원본 답변이 갱신될 때에도 중간에 있었던 로컬 실패를 끝으로 이동하지 않는다',()=>{
 const {withLiveTurn}=require('../electron/mobile/live-turn.js');
 const row=(text,seconds,turnId)=>({text,createdAt:new Date(seconds*1000).toISOString(),turnId});
 const user=row('진행 중 요청',10,'turn'),error=row('로컬 실패',12),partial=row('이전 부분',13,'turn');
 const final=row('나중 부분',17,'turn');
 assert.deepEqual(withLiveTurn([user,error,partial],'turn',[user,final]),[user,error,final]);
});
test('같은 대화의 Claude 행과 최신 시각은 Codex 새로고침과 재연결을 거쳐도 보존된다', async t=>{
 const f=await fixture(t),plan=await f.preview(),{randomUUID}=require('node:crypto');
 await f.runtime.apply({planId:plan.id});
 const session=f.store.state.sessions[0],sessionId=session.id,sourceThread=f.client.threads.get('원본대화');
 const at=second=>new Date(second*1000).toISOString(),turnId=randomUUID();
 const local=[
  {id:randomUUID(),role:'user',text:'Claude에게만 보낸 내용',provider:'claude',turnId,createdAt:at(1700000100)},
  {id:randomUUID(),role:'assistant',text:'Claude에서만 받은 답변',provider:'claude',turnId,createdAt:at(1700000101)},
 ];
 session.messages.push(...local);session.updatedAt=local[1].createdAt;
 await f.store.save();
 function addCodex(title,second){
  sourceThread.updatedAt=second;
  f.client.turns.get(sourceThread.id).push({id:title,status:'completed',startedAt:second,completedAt:second,itemsView:'full',items:[{id:title,type:'agentMessage',text:title}]});
 }
 async function verify(second){
  const latest=f.store.session(sessionId);
  assert.equal(latest.updatedAt,local[1].createdAt);
  assert.equal(latest.codexLink.sourceUpdatedAt,at(second));
  assert.deepEqual(latest.messages.slice(-2),local);
  assert(local.every(message=>!latest.codexLink.sourceMessageIds.includes(message.id)));
 }
 addCodex('원본 앱의 첫 답변',1700000030);
 await f.runtime.refresh(sessionId);
 await verify(1700000030);
 addCodex('원본 앱의 다음 답변',1700000040);
 const next=await f.preview();
 const receipt=await f.runtime.apply({planId:next.id});
 assert.equal(receipt.updated,1);
 await verify(1700000040);
 const reopened=new Store(path.dirname(f.store.file));
 await reopened.load();
 assert.deepEqual(reopened.session(sessionId).messages.slice(-2),local);
});
test('메시지 식별자가 겹치면 원본을 보관 폴더에 새로 쓰기 전에 Codex 갱신을 중단한다', async t=>{
 const f=await fixture(t),first=await f.preview();
 await f.runtime.apply({planId:first.id});
 const session=f.store.state.sessions[0],sourceThread=f.client.threads.get('원본대화');
 const second=1700000040;
 sourceThread.updatedAt=second;
 f.client.turns.get(sourceThread.id).push({id:'다음 턴',status:'completed',startedAt:second,completedAt:second,itemsView:'full',items:[{id:'다음 응답',type:'agentMessage',text:'나중에 온 원본'}]});
 const incoming=await require('../electron/codex-transfer-data.cjs').snapshot(f.client,sourceThread.id,f.folder);
 session.messages.push({...incoming.messages.at(-1),provider:'claude',text:'로컬 Claude 답변'});
 await f.store.save();
 const previous=structuredClone(session);
 const archiveDir=path.dirname(path.join(f.folder,session.codexLink.archivePath));
 const files=await fs.readdir(archiveDir);
 await assert.rejects(f.runtime.refresh(session.id),/기존 대화를 보존/);
 const plan=await f.preview(),receipt=await f.runtime.apply({planId:plan.id});
 assert.equal(receipt.failed,1);
 assert.deepEqual(await fs.readdir(archiveDir),files);
 assert.deepEqual(f.store.session(session.id),previous);
});
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-codex-transfer-'))),folder=path.join(root,'프로젝트');await fs.mkdir(folder);const store=new Store(path.join(root,'설정'));await store.load();const project=await store.addProject(folder),client=new Client(folder);let revision=0,epoch=0,owner='시험계정',allowed=true;
const controller={client,runs:new Map(),editingSessions:new Set(),loadedThreads:new Set(),emitEvent(){}};
const runtime=new CodexTransfer(store,controller,{accountRevision:()=>revision,stateEpoch:()=>epoch,accountOwner:()=>owner,canRun:()=>allowed,allowTemporaryProjects:true});
client.threads.set('원본대화',{id:'원본대화',cwd:folder,name:'원래 대화 제목',source:'appServer',originator:'codex_app',createdAt:1700000000,updatedAt:1700000020,ephemeral:false,status:{type:'idle'}});
client.turns.set('원본대화',[{id:'첫작업',status:'completed',startedAt:1700000000,completedAt:1700000002,itemsView:'full',items:[{id:'요청1',type:'userMessage',content:[{type:'text',text:'원래 질문 전체'},{type:'localImage',path:'원래첨부.png'}]},{id:'도구1',type:'commandExecution',command:'시험 명령',aggregatedOutput:'원래 도구 결과'},{id:'답변1',type:'agentMessage',text:'원래 답변 전체'}]},{id:'둘째작업',status:'completed',startedAt:1700000010,completedAt:1700000012,itemsView:'summary',items:[],extraItems:[{item:{id:'요청2',type:'userMessage',content:[{type:'text',text:'다음 페이지 질문'}]}},{item:{id:'답변2',type:'agentMessage',text:'다음 페이지 답변'}}]}]);
t.after(async()=>{await runtime.shutdown();await store.queue;await fs.rm(root,{recursive:true,force:true})});return{root,folder,store,project,client,controller,runtime,setRevision:v=>revision=v,setEpoch:v=>epoch=v,setOwner:v=>owner=v,setAllowed:v=>allowed=v,preview:()=>runtime.action({action:'preview',projects:[{name:'지정한 프로젝트 이름',path:folder,threadIds:['원본대화']}]})};}
test('프로젝트 대화의 본문 / 도구 / 첨부 참조 / 모든 항목을 읽고 원문 사본과 원래 실행 연결을 보존한다',async t=>{const f=await fixture(t),plan=await f.preview();assert.equal(plan.entries[0].messages,5);assert.equal(plan.entries[0].attachments,1);assert(f.client.calls.every(c=>['account/read','thread/read','thread/turns/list','thread/items/list'].includes(c.method)));const original=JSON.stringify(f.client.turns.get('원본대화'));const result=await f.runtime.action({action:'apply',planId:plan.id});assert.equal(result.imported,1);assert.equal(result.failed,0);assert.equal(f.store.state.projects[0].name,'지정한 프로젝트 이름');const session=f.store.state.sessions[0];assert.equal(session.threadId,'원본대화');assert.equal(session.sourceThreadId,'원본대화');assert.equal(session.title,'원래 대화 제목');assert.equal(session.messages[1].text.includes('원래 도구 결과'),true);assert.equal(session.createdAt,'2023-11-14T22:13:20.000Z');const raw=await f.runtime.action({action:'readOriginal',receiptId:result.id,threadId:'원본대화'});assert(raw.text.includes('원래첨부.png'));assert.equal(JSON.stringify(f.client.turns.get('원본대화')),original);assert.equal(f.client.calls.some(c=>['thread/resume','thread/fork','turn/start','thread/archive','thread/delete'].includes(c.method)),false);const reload=new Store(path.join(f.root,'설정'));await reload.load();assert.equal(reload.state.sessions[0].threadId,'원본대화');assert.equal(reload.state.sessions[0].messages.length,5);});
test('동일 대화 재시도는 중복을 만들지 않고 원본 추가 본문은 명시적 새로고침으로 반영한다',async t=>{const f=await fixture(t);let p=await f.preview();await f.runtime.apply({planId:p.id});p=await f.preview();const repeated=await f.runtime.apply({planId:p.id});assert.equal(repeated.skipped,1);assert.equal(f.store.state.sessions.length,1);const session=f.store.state.sessions[0],oldArchive=session.codexLink.archivePath;f.client.turns.get('원본대화').push({id:'외부작업',status:'completed',startedAt:1700000050,completedAt:1700000051,itemsView:'full',items:[{type:'agentMessage',id:'외부답변',text:'다른 앱에서 추가한 답변'}]});f.client.threads.get('원본대화').updatedAt=1700000051;f.controller.loadedThreads.add('원본대화');await f.runtime.beforeSend(session.id);assert.equal(session.messages.at(-1).text,'다른 앱에서 추가한 답변');assert.equal(session.threadId,'원본대화');assert.equal(f.controller.loadedThreads.has('원본대화'),false);assert.notEqual(session.codexLink.archivePath,oldArchive);await fs.access(path.join(f.folder,oldArchive));});
test('큰 보관 원문은 압축해도 같은 대화 링크와 원문 바이트를 유지한다', async t => {
  const f = await fixture(t);
  const large = '긴 회의록에서 사용할 원문 😊\n'.repeat(22000);
  f.client.turns.get('원본대화')[0].items[2].text = large;
  const plan = await f.preview();
  const receipt = await f.runtime.apply({planId:plan.id});
  assert.equal(receipt.imported,1);
  const session = f.store.state.sessions[0];
  const file = path.join(f.folder,session.codexLink.archivePath);
  await assert.rejects(fs.access(file),{code:'ENOENT'});
  assert((await fs.stat(file+'.gz')).size < Buffer.byteLength(large)*0.1);
  const original = await f.runtime.readOriginal(receipt.id,'원본대화');
  assert.equal(original.sha256,path.basename(file,'.json'));
  assert.equal(JSON.parse(original.text).turns[0].items[2].item.text,large);
  const restored = new Store(path.dirname(f.store.file));
  await restored.load();
  assert.equal(restored.session(session.id).codexLink.archivePath,session.codexLink.archivePath);
  assert.equal(restored.session(session.id).messages[2].text,large);
});
test('실행 중에 연결한 대화는 실제 작업 종료를 확인한 뒤 별도 버튼 없이 이어 쓴다',async t=>{
 const f=await fixture(t),p=await f.runtime.preview({projects:[{name:'프로젝트',path:f.folder,threadIds:['원본대화']}],activeThreadIds:['원본대화']});
 await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0],source=f.client.threads.get('원본대화');
 source.status={type:'active'};
 assert.deepEqual(await f.runtime.action({action:'sync',sessionId:session.id}),{sync:'active'});
 await assert.rejects(f.runtime.beforeSend(session.id),/다른 앱/);
 source.status={type:'notLoaded'};const last=f.client.turns.get('원본대화').at(-1);last.status='inProgress';
 assert.deepEqual(await f.runtime.action({action:'sync',sessionId:session.id}),{sync:'active'});
 await assert.rejects(f.runtime.beforeSend(session.id),/다른 앱/);
 last.status='completed';assert.deepEqual(await f.runtime.action({action:'sync',sessionId:session.id}),{sync:'current'});
 assert.equal(session.codexLink.activeAtImport,false);await f.runtime.beforeSend(session.id);
});
test('선택한 독립 사본만 fork하고 진행 중인 대화는 마지막 완료 작업까지 복사한다',async t=>{const f=await fixture(t),p=await f.runtime.preview({projects:[{name:'프로젝트',path:f.folder,threadIds:['원본대화']}],activeThreadIds:['원본대화']});const r=await f.runtime.apply({planId:p.id,mode:'copy'});assert.equal(r.imported,1);assert.notEqual(f.store.state.sessions[0].threadId,'원본대화');assert.equal(f.store.state.sessions[0].codexLink.mode,'copy');const call=f.client.calls.find(c=>c.method==='thread/fork');assert.equal(call.params.lastTurnId,'둘째작업');assert.equal(call.params.excludeTurns,true);assert.equal(f.client.calls.some(c=>['turn/start','thread/delete','thread/archive'].includes(c.method)),false);});
test('다른 프로젝트와 하위 에이전트는 원문 저장 전 차단하고 계정 변경은 연결 갱신을 거절한다',async t=>{const f=await fixture(t);f.client.threads.set('하위대화',{...f.client.threads.get('원본대화'),id:'하위대화',parentThreadId:'원본대화',source:{subAgent:{threadSpawn:{parent_thread_id:'원본대화'}}}});const p=await f.runtime.preview({projects:[{name:'프로젝트',path:f.folder,threadIds:['원본대화','하위대화']}]});assert.match(p.entries[1].error,/사용자 대화/);await assert.rejects(f.runtime.apply({planId:p.id}),/읽을 수 있는/);const r=await f.runtime.apply({planId:p.id,threadIds:['원본대화']});assert.equal(r.imported,1);f.setOwner('다른 계정');await assert.rejects(f.runtime.refresh(f.store.state.sessions[0].id),/원래 계정/);assert.equal((await f.runtime.receipts()).length,0);await assert.rejects(f.runtime.readOriginal(r.id,'원본대화'),/현재 계정/);});
test('본문 조회 중 계정이 바뀌면 미리보기를 저장하지 않고 실패한 저장은 기존 사본을 유지한다',async t=>{const f=await fixture(t);f.client.hook=async method=>{if(method==='thread/items/list')f.setRevision(1)};await assert.rejects(f.preview(),/계정/);assert.equal(f.store.state.sessions.length,0);f.client.hook=null;const p=await f.preview(),save=f.store.save.bind(f.store);let failed=false;f.store.save=async()=>{if(f.store.state.sessions.length&&!failed){failed=true;throw Error('합성 저장 실패')}return save()};const r=await f.runtime.apply({planId:p.id});assert.equal(r.failed,1);assert.equal(f.store.state.sessions.length,0);assert.equal(f.client.calls.some(c=>c.method==='thread/delete'),false);});
test('기본 발견은 정상 루트만 선택하고 Flowrium 자체 대화와 하위 대화를 제외한다',async t=>{const f=await fixture(t);f.client.threads.set('앱대화',{...f.client.threads.get('원본대화'),id:'앱대화',originator:'flowrium'});f.client.threads.set('서브대화',{...f.client.threads.get('원본대화'),id:'서브대화',source:{subAgent:{other:'시험'}}});const p=await f.runtime.preview({});assert.deepEqual(p.entries.map(e=>e.threadId),['원본대화']);});
test('미리보기 뒤 추가된 원문을 적용 직전에 다시 읽고 기존 좋아요와 메시지 참조를 유지한다',async t=>{const f=await fixture(t);let p=await f.preview();await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0],answer=session.messages.find(m=>m.role==='assistant'),id=answer.id;answer.reaction='like';const timestamp=answer.createdAt;p=await f.preview();f.client.turns.get('원본대화')[0].items.find(i=>i.id==='답변1').text='같은 항목의 갱신된 원문';f.client.turns.get('원본대화').push({id:'추가작업',status:'completed',startedAt:1700000060,completedAt:1700000061,itemsView:'full',items:[{id:'추가요청',type:'userMessage',content:[{type:'text',text:'미리보기 이후 추가 요청'}]}]});const result=await f.runtime.apply({planId:p.id});assert.equal(result.updated,1);const kept=session.messages.find(m=>m.id===id);assert.equal(kept.text,'같은 항목의 갱신된 원문');assert.equal(kept.reaction,'like');assert.equal(kept.createdAt,timestamp);assert(session.messages.some(m=>m.text==='미리보기 이후 추가 요청'));});
test('변경 없는 자동 갱신은 디스크 쓰기와 화면 갱신을 반복하지 않는다',async t=>{const f=await fixture(t),p=await f.preview();await f.runtime.apply({planId:p.id});let saves=0,events=0;const save=f.store.save.bind(f.store);f.store.save=(...args)=>{saves++;return save(...args)};f.controller.emitEvent=()=>events++;await f.runtime.refresh(f.store.state.sessions[0].id,{background:true});assert.equal(saves,0);assert.equal(events,0);});
test('동시에 미리보기를 두 번 호출하면 하나만 실행하고 잠금 상태 변경 뒤 저장하지 않는다',async t=>{const f=await fixture(t);let resume;f.client.hook=async method=>{if(method==='account/read')await new Promise(r=>resume=r)};const first=f.preview();await assert.rejects(f.preview(),/처리 중/);assert(f.runtime.isBusy());resume();await first;f.client.hook=null;const p=await f.preview();f.setAllowed(false);await assert.rejects(f.runtime.apply({planId:p.id}),/잠금/);assert.equal(f.store.state.sessions.length,0);});
test('첨부 이미지 바이트를 보관하고 재시도는 중복 첨부를 만들지 않는다',async t=>{const f=await fixture(t);const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64');f.client.turns.get('원본대화')[0].items[0].content[1]={type:'image',url:'data:image/png;base64,'+png.toString('base64')};const p=await f.preview();await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0],message=session.messages[0];assert.equal(message.attachments.length,1);const attachment=message.attachments[0],resolved=await require('../electron/chat-attachments.cjs').resolveAttachments(f.store,f.project.id,[attachment.id]);assert.deepEqual(await fs.readFile(resolved[0].path),png);const p2=await f.preview();await f.runtime.apply({planId:p2.id});assert.equal(session.messages[0].attachments[0].id,attachment.id);});
test('보관 원문 폴더를 다른 위치의 링크로 바꾸면 읽기를 거절한다',async t=>{const f=await fixture(t),p=await f.preview(),result=await f.runtime.apply({planId:p.id}),session=f.store.state.sessions[0],file=path.join(f.folder,session.codexLink.archivePath),outside=path.join(f.root,'다른 원문 폴더');await fs.mkdir(outside);await fs.copyFile(file,path.join(outside,path.basename(file)));await fs.rm(path.dirname(file),{recursive:true});await fs.symlink(outside,path.dirname(file),process.platform==='win32'?'junction':'dir');await assert.rejects(f.runtime.readOriginal(result.id,'원본대화'),/다른 위치/);});
test('독립 사본에 추가 작업이 있으면 원본 변경을 재적용해 기존 사본을 덮어쓰지 않는다',async t=>{const f=await fixture(t);let p=await f.preview();await f.runtime.apply({planId:p.id,mode:'copy'});const session=f.store.state.sessions[0],target=session.threadId;session.messages.push({id:require('node:crypto').randomUUID(),role:'assistant',text:'독립 사본에서 이어간 작업',createdAt:new Date().toISOString()});f.client.turns.get('원본대화')[0].items[2].text='원본의 나중 변경';p=await f.preview();const result=await f.runtime.apply({planId:p.id,mode:'copy'});assert.equal(result.skipped,1);assert.equal(session.threadId,target);assert(session.messages.some(m=>m.text==='독립 사본에서 이어간 작업'));});
test('원문 응답을 읽는 동안 계정이 바뀌면 이전 계정의 본문을 반환하지 않는다',async t=>{const f=await fixture(t),p=await f.preview(),result=await f.runtime.apply({planId:p.id}),read=f.runtime.readArchive.bind(f.runtime);f.runtime.readArchive=async(...args)=>{const bytes=await read(...args);f.setOwner('다른 계정');return bytes;};await assert.rejects(f.runtime.action({action:'readOriginal',receiptId:result.id,threadId:'원본대화'}),/계정이나 잠금/);});
test('저장 도중 잠금이 걸렸다 풀려도 갱신 응답과 이벤트를 내보내지 않는다',async t=>{const f=await fixture(t),p=await f.preview();await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0];f.client.turns.get('원본대화')[0].items[2].text='나중 갱신';let events=0;f.controller.emitEvent=()=>events++;const save=f.store.save.bind(f.store);f.store.save=async()=>{await save();f.setEpoch(2);};await assert.rejects(f.runtime.refresh(session.id),/계정이나 잠금/);assert.equal(events,0);assert.equal(f.runtime.isBusy(),false);});
test('미리보기 후 잠금 회차가 바뀌면 기존 선택을 재사용하지 않는다',async t=>{const f=await fixture(t),p=await f.preview();f.setEpoch(2);await assert.rejects(f.runtime.apply({planId:p.id}),/계정이나 잠금/);assert.equal(f.store.state.sessions.length,0);});
test('큰 단일 항목도 본문을 자르지 않고 작업 메타와 항목을 분리하여 읽는다',async t=>{const f=await fixture(t),large='큰 원문 시작\n'+'x'.repeat(17*1024*1024)+'\n큰 원문 끝';f.client.turns.set('원본대화',[{id:'큰작업',status:'completed',startedAt:1700000000,completedAt:1700000002,itemsView:'full',items:[{id:'큰답변',type:'agentMessage',text:large}]}]);const data=await require('../electron/codex-transfer-data.cjs').snapshot(f.client,'원본대화',f.folder);assert.equal(data.messages.map(message=>message.text).join(''),large);assert.equal(data.raw.turns[0].items[0].item.text,large);assert(f.client.calls.filter(call=>call.method==='thread/turns/list').every(call=>call.params.itemsView==='notLoaded'&&call.params.limit===25));assert(f.client.calls.filter(call=>call.method==='thread/items/list').every(call=>call.params.limit===25));});
test('백그라운드 메타가 같으면 본문 재분석을 생략하고 수동과 전송 전은 전체를 대조한다',async t=>{const f=await fixture(t),p=await f.preview();await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0];f.client.calls=[];await f.runtime.refresh(session.id,{background:true});assert(f.client.calls.some(call=>call.method==='thread/read'));assert(!f.client.calls.some(call=>['thread/turns/list','thread/items/list'].includes(call.method)));f.client.turns.get('원본대화')[0].items[2].text='시각이 같아도 수동 대조로 확인할 변경';await f.runtime.beforeSend(session.id);assert(session.messages.some(message=>message.text==='시각이 같아도 수동 대조로 확인할 변경'));assert(f.client.calls.some(call=>call.method==='thread/items/list'));});
test('백그라운드 원본 시각이 바뀌면 전체 항목을 읽어 새 메시지를 반영한다',async t=>{const f=await fixture(t),p=await f.preview();await f.runtime.apply({planId:p.id});const session=f.store.state.sessions[0];f.client.threads.get('원본대화').updatedAt=1700000030;f.client.turns.get('원본대화')[0].items[2].text='새로 반영할 원문';f.client.calls=[];await f.runtime.refresh(session.id,{background:true});assert(session.messages.some(message=>message.text==='새로 반영할 원문'));assert(f.client.calls.some(call=>call.method==='thread/items/list'));});

test('혼합 대화의 Claude 작업 중 Codex 진행을 읽고 완료된 원본을 같은 대화로 갱신한다',async t=>{
 const f=await fixture(t),plan=await f.preview();
 await f.runtime.apply({planId:plan.id});
 const session=f.store.state.sessions[0],thread=f.client.threads.get(session.threadId);
 const {ConversationRuns}=require('../electron/conversation-runs.cjs');
 f.store.state.settings.providerMode='mixed';
 f.controller.runs=new ConversationRuns();
 f.controller.runs.set(session.id,{sessionId:session.id,provider:'claude'});
 const local={id:require('node:crypto').randomUUID(),provider:'claude',turnId:'claude-turn',role:'assistant',text:'작성 중',createdAt:new Date().toISOString()};
 session.messages.push(local);
 const turn={id:'new-native',status:'inProgress',startedAt:Math.floor(Date.now()/1000),items:[{id:'new-answer',type:'agentMessage',text:'Codex 응답 작성 중'}]};
 f.client.turns.get(session.threadId).push(turn);
 thread.status={type:'active'};
 assert.deepEqual(await f.runtime.action({action:'sync',sessionId:session.id}),{sync:'active'});
 assert(f.runtime.liveView(session).messages.some(row=>row.text==='Codex 응답 작성 중'));
 assert(f.runtime.liveView(session).messages.includes(local));
 await assert.rejects(f.runtime.beforeSend(session.id),{code:'THREAD_ACTIVE'});
 thread.status={type:'idle'};
 turn.status='completed';turn.completedAt=turn.startedAt+1;
 turn.items[0].text='Codex 응답 완료';thread.updatedAt=turn.completedAt;
 await f.runtime.beforeSend(session.id);
 assert(session.messages.some(row=>row.text==='Codex 응답 완료'));
 assert(session.messages.includes(local));
 f.controller.runs.set(session.id,{sessionId:session.id,provider:'codex'});
 assert.deepEqual(await f.runtime.action({action:'sync',sessionId:session.id}),{sync:'deferred'});
 await assert.rejects(f.runtime.beforeSend(session.id),/실행 중인 대화/);
});

test('Codex 갱신 저장 실패에서 동시에 생긴 Claude 본문과 문맥을 유지한다',async t=>{
 const f=await fixture(t),plan=await f.preview();
 await f.runtime.apply({planId:plan.id});
 const session=f.store.state.sessions[0],link=session.codexLink;
 const {ConversationRuns}=require('../electron/conversation-runs.cjs');
 f.store.state.settings.providerMode='mixed';
 f.controller.runs=new ConversationRuns();
 f.controller.runs.set(session.id,{sessionId:session.id,provider:'claude'});
 const local={id:'claude-local',provider:'claude',turnId:'claude-turn',role:'assistant',text:'작성 중',createdAt:new Date().toISOString()};
 session.messages.push(local);
 f.client.turns.get(session.threadId)[0].items[2].text='저장하지 못한 Codex 내용';
 f.store.save=async()=>{
  assert(session.messages.includes(local));
  assert(session.messages.some(row=>row.text==='저장하지 못한 Codex 내용'));
  local.text='작성 완료';
  session.messages.push({...local,id:'claude-next',text:'동시에 보존할 후속 답변'});
  session.claudeContext={used:5,max:10};
  session.updatedAt='2099-01-01T00:00:00.000Z';
  throw Error('시험 저장 실패');
 };
 await assert.rejects(f.runtime.refresh(session.id),/시험 저장 실패/);
 assert.equal(session.codexLink,link);
 assert.equal(session.updatedAt,'2099-01-01T00:00:00.000Z');
 assert.deepEqual(session.claudeContext,{used:5,max:10});
 assert(!session.messages.some(row=>row.text==='저장하지 못한 Codex 내용'));
 assert.deepEqual(session.messages.filter(row=>row.provider==='claude').map(row=>row.text),['작성 완료','동시에 보존할 후속 답변']);
});
test('큰 항목 페이지는 같은 커서에서 크기를 줄여 복구하고 모든 항목을 순서대로 보존한다',async()=>{const items=Array.from({length:7},(_,index)=>({item:{id:'항목'+index,type:'agentMessage',text:'본문'+index}})),calls=[];let recoveries=0;const client={async request(method,params){calls.push({method,...params});if(params.limit>3)throw Object.assign(Error('크기 초과'),{code:'PROTOCOL_FRAME_TOO_LARGE'});const offset=Number(params.cursor||0),data=items.slice(offset,offset+params.limit);return{data,nextCursor:offset+data.length<items.length?String(offset+data.length):null};}};const actual=await require('../electron/codex-transfer-data.cjs').itemPages(client,'대화','작업',{recover:async()=>recoveries++});assert.deepEqual(actual,items);assert.equal(recoveries,3);assert.deepEqual(calls.slice(0,4).map(call=>call.limit),[25,12,6,3]);assert(calls.slice(0,4).every(call=>call.cursor===undefined));assert(calls.every(call=>call.method==='thread/items/list'));});
test('단일 항목도 읽기 한도를 넘으면 본문을 자르지 않고 명확히 실패한다',async()=>{let recovered=0;const client={async request(){throw Object.assign(Error('크기 초과'),{code:'PROTOCOL_FRAME_TOO_LARGE'});}};await assert.rejects(require('../electron/codex-transfer-data.cjs').itemPages(client,'대화','작업',{recover:async()=>recovered++}),/단일 항목이 128MB/);assert.equal(recovered,5);});
test('이미 연결한 대화의 사라진 첨부는 명시적 재시도로 복사하고 메시지를 중복 생성하지 않는다',async t=>{
 const f=await fixture(t),image=path.join(f.root,'나중에 복원된 이미지.png'),part=f.client.turns.get('원본대화')[0].items[0].content[1];part.path=image;
 let plan=await f.preview();await f.runtime.apply({planId:plan.id});const session=f.store.state.sessions[0],count=session.messages.length;assert(!session.messages[0].attachments);
 await fs.writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
 plan=await f.preview();const result=await f.runtime.apply({planId:plan.id,retryAttachments:true});assert.equal(result.updated,1);assert.equal(result.attachments.copied,1);assert.equal(session.messages.length,count);assert.equal(session.messages[0].attachments.length,1);const saved=session.messages[0].attachments[0].id;
 plan=await f.preview();const repeated=await f.runtime.apply({planId:plan.id,retryAttachments:true});assert.equal(repeated.skipped,1);assert.equal(repeated.attachments.copied,0);assert.equal(session.messages.length,count);assert.equal(session.messages[0].attachments[0].id,saved);
});

test('같은 시각에 완료된 외부 작업도 자동으로 반영하고 빈 갱신은 메타데이터만 조회한다',async t=>{
 const f=await fixture(t),p=await f.preview();await f.runtime.apply({planId:p.id});
 const session=f.store.state.sessions[0],sync=()=>f.runtime.action({action:'sync',sessionId:session.id});
 await sync();f.client.calls.length=0;await sync();assert(!f.client.calls.some(c=>c.method==='thread/items/list'));
 f.client.turns.get(session.threadId).push({id:'같은시각',status:'completed',itemsView:'full',items:[{id:'외부',type:'agentMessage',text:'같은 초의 새 답변'}]});
 await sync();assert.equal(session.messages.at(-1).text,'같은 초의 새 답변');
});
test('Flowrium에서 시작한 연결은 로컬에만 저장하고 외부 본문을 중복 없이 받아 원래 입력과 좋아요를 보존한다',async t=>{
 const f=await fixture(t),id=require('node:crypto').randomUUID(),session=await f.store.createSession(f.project.id);
 f.client.threads.set(id,{...f.client.threads.get('원본대화'),id});
 const first=f.client.turns.get('원본대화')[0];f.client.turns.set(id,[first]);
 const stored=f.store.session(session.id);
 stored.threadId=id;stored.messages=[{id:require('node:crypto').randomUUID(),role:'user',text:'화면에 입력한 순수 요청',turnId:first.id,createdAt:stored.createdAt},{id:require('node:crypto').randomUUID(),role:'assistant',reaction:'like',text:'로컬 답변',turnId:first.id,createdAt:stored.updatedAt}];
 f.runtime.bindNative(stored,id,f.folder);await f.store.save();
 const fresh=new Store(path.dirname(f.store.file));await fresh.load();assert.equal(fresh.session(stored.id).desktopThread.threadId,id);
 assert.equal(f.store.repositories.get(f.project.id).saved.get(stored.id).desktopThread,undefined);
 const outgoing=[];f.runtime.options.openDesktopThread=async url=>outgoing.push(url);
 await f.runtime.action({action:'openDesktop',sessionId:stored.id});assert.deepEqual(outgoing,['codex://threads/'+id]);
 f.client.turns.get(id).push({id:'외부',status:'completed',startedAt:Date.now()/1000+3,itemsView:'full',items:[{id:'사용자',type:'userMessage',content:[{type:'text',text:'다른 앱에서 보낸 요청'}]},{id:'응답',type:'agentMessage',text:'다른 앱에서 받은 답변'}]});
 await f.runtime.action({action:'sync',sessionId:stored.id});await f.runtime.action({action:'sync',sessionId:stored.id,force:true});
 assert.deepEqual(stored.messages.filter(m=>m.role!=='system').map(m=>m.text),['화면에 입력한 순수 요청','원래 답변 전체','다른 앱에서 보낸 요청','다른 앱에서 받은 답변']);assert.equal(stored.messages.find(m=>m.role==='assistant').reaction,'like');
 f.setOwner('다른계정');await assert.rejects(f.runtime.action({action:'sync',sessionId:stored.id}),/기기에서 대화를/);await assert.rejects(f.runtime.action({action:'openDesktop',sessionId:stored.id}),/기기에서 대화를/);assert.equal(outgoing.length,1);
});

test('로컬 요청과 같은 작업에 도착한 추가 지시·완료 답변도 보존하고 두 번째 갱신은 중복을 만들지 않는다',()=>{
 const {mergeNative}=require('../electron/chat-sync.cjs'),createdAt='2026-10-01T01:00:00Z',turnId='same';
 const rows=[{id:'u',role:'user',text:'원래 입력',turnId,createdAt},{id:'a',role:'assistant',text:'일부 응답',turnId,createdAt,reaction:'like'}];
 const remote=[{id:'r1',role:'user',text:'이전 버전의 원문과 앱 문맥',turnId,createdAt},{id:'r2',role:'user',text:'같은 작업의 추가 입력',turnId,createdAt},{id:'r3',role:'assistant',text:'최종 답변',turnId,createdAt}];
 const first=mergeNative(rows,remote);
 assert.deepEqual(first.map(m=>m.text),['원래 입력','같은 작업의 추가 입력','최종 답변']);
 assert.deepEqual(mergeNative(rows.slice(0,1),remote).map(m=>m.text),['원래 입력','같은 작업의 추가 입력','최종 답변']);
 assert.equal(first.find(m=>m.id==='a').reaction,'like');assert.deepEqual(mergeNative(first,remote),first);
});

test('기기 식별자가 누락된 연결 대화를 검증된 원본으로 복구하고 재시작 뒤에도 보존한다',async t=>{
  const f=await fixture(t),plan=await f.preview();
  await f.runtime.apply({planId:plan.id});
  const session=f.store.state.sessions[0];
  delete session.threadId;
  await f.store.save();
  const before=f.client.calls.length;
  await f.runtime.beforeSend(session.id);
  assert.equal(session.threadId,session.codexLink.sourceThreadId);
  assert(!f.client.calls.slice(before).some(call=>call.method.startsWith('thread/')&&!call.params.threadId));
  const persisted=new Store(path.dirname(f.store.file));
  await persisted.load();assert.equal(persisted.session(session.id).threadId,session.codexLink.sourceThreadId);
  delete session.threadId;
  f.client.threads.get('원본대화').cwd=path.dirname(f.folder);
  await assert.rejects(f.runtime.beforeSend(session.id),/프로젝트/);
  assert.equal(session.threadId,undefined);
  f.setOwner('별도계정');
  await assert.rejects(f.runtime.beforeSend(session.id),/원래 계정/);
  assert.equal(session.threadId,undefined);
});

test('다른 앱의 진행 설명과 도구 상태를 공개 범위에서 표시하고 완료 뒤 원문 및 순서를 보존한다',async t=>{
 const f=await fixture(t),plan=await f.preview();
 await f.runtime.apply({planId:plan.id});
 const s=f.store.state.sessions[0],thread=f.client.threads.get(s.threadId);
 const active={id:'진행중인원본',startedAt:Math.floor(Date.now()/1000)-300,status:'interrupted',items:[
  {id:'원래요청',type:'userMessage',content:[{type:'text',text:'원래 앱의 추가 요청'}]},
  {id:'원래답변',type:'agentMessage',text:'첫 부분'},
  {id:'진행설명',type:'agentMessage',phase:'commentary',text:'자료를 확인하고 있어요.'},
  {id:'명령',type:'commandExecution',status:'inProgress',command:'원래 명령',aggregatedOutput:'원래 출력'},
  {id:'도구',type:'mcpToolCall',status:'completed',arguments:{test:'원래 입력'}},
  {id:'파일',type:'fileChange',status:'completed',changes:[{path:'원래 경로'}]},
  {id:'비공개추론',type:'reasoning',content:['비공개 모델 추론']}
 ]};
 f.client.turns.get(s.threadId).push(active);
 thread.status={type:'notLoaded'};
 const events=[];
 f.controller.emitEvent=event=>{if(event.type==='externalTurn')events.push(event);};
 const check=()=>f.runtime.action({action:'sync',sessionId:s.id});
 const current=()=>f.runtime.liveView(s).messages.filter(m=>m.turnId===active.id&&m.role!=='system').map(m=>m.text);
 const repository=f.store.repositories.get(s.projectId),savedRevision=repository.heads.get(s.id);
 const before=s.messages.map(m=>m.id);
 await check();
 assert.equal(events.at(-1).status,'pending');
 assert.equal(f.runtime.liveTurn(s).running,false);
 active.startedAt=Math.floor(Date.now()/1000);
 await Promise.all([check(),check()]);
 assert.deepEqual(current(),['원래 앱의 추가 요청','첫 부분']);
 assert.equal(events.at(-1).status,'running');
 assert.equal(f.runtime.liveTurn(s).running,true);
 const progress=events.at(-1).turnMessages.filter(message=>message.role==='system');
 assert.deepEqual(progress.map(message=>message.text),['자료를 확인하고 있어요.','실행 도구 / 명령\n진행 중','도구 실행 기록\n완료','파일 변경 기록\n완료']);
 assert.equal(progress[0].progressCommentary,true);
 const observed=f.runtime.liveView(s).messages.filter(m=>m.turnId===active.id).map(m=>m.id);
 assert.deepEqual(s.messages.map(m=>m.id),before);
 active.items[1].text='첫 부분과 다음 부분';
 await check();assert.deepEqual(current(),['원래 앱의 추가 요청','첫 부분과 다음 부분']);
 await f.store.save();
 assert.equal(repository.heads.get(s.id),savedRevision);
 assert.deepEqual(s.messages.map(m=>m.id),before);
 active.status='completed';active.completedAt=active.startedAt+5;thread.updatedAt=active.completedAt;thread.status={type:'idle'};
 active.items[3].status='completed';
 active.items[1].text='첫 부분과 다음 부분, 최종 답변';
 await check();await check();
 assert.deepEqual(s.messages.map(m=>m.id),[...before,...observed]);
 assert.notEqual(repository.heads.get(s.id),savedRevision);
 assert.equal(f.runtime.liveTurn(s),undefined);
 assert.equal(events.at(-1).status,'idle');
 assert.deepEqual(current(),['원래 앱의 추가 요청','첫 부분과 다음 부분, 최종 답변']);
 assert(s.messages.some(message=>message.text.includes('원래 출력')));
 assert(!s.messages.some(message=>message.text.includes('비공개 모델 추론')));
 assert(!f.client.calls.some(c=>['thread/resume','turn/start'].includes(c.method)));
});
test('등록한 Codex 프로젝트 중 선택한 폴더만 대화 없이 불러올 수 있다',async t=>{
 const f=await fixture(t),selected=path.join(f.root,'선택한 폴더'),excluded=path.join(f.root,'다른 폴더');
 await fs.mkdir(selected);await fs.mkdir(excluded);
 f.client.projects=[{name:'선택한 Codex 프로젝트',roots:[{path:selected}]},{name:'다른 Codex 프로젝트',roots:[{path:excluded}]}];
 const plan=await f.runtime.preview({});
 const project=plan.projects.find(row=>row.name==='선택한 Codex 프로젝트');
 assert.equal(project.threads,0);
 assert(plan.projects.some(row=>row.name==='다른 Codex 프로젝트'));
 await assert.rejects(f.runtime.apply({planId:plan.id,projectKeys:['다른 미리보기']}),/프로젝트 목록/);
 const result=await f.runtime.apply({planId:plan.id,projectKeys:[project.key],threadIds:[]});
 assert.equal(result.projects,1);
 assert.equal(result.imported,0);
 assert.equal(f.store.state.sessions.length,0);
 assert(f.store.state.projects.some(row=>row.path===selected));
 assert(!f.store.state.projects.some(row=>row.path===excluded));
 await assert.rejects(fs.access(path.join(excluded,'.flowrium')),{code:'ENOENT'});
});
