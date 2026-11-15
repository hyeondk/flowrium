const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs');
const {Controller}=require('../electron/controller.cjs');
const {addAttachments,resolveAttachments}=require('../electron/chat-attachments.cjs');
const {Drafts}=require('../electron/drafts.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-chat-core-'));await fs.mkdir(path.join(root,'project'));const store=new Store(path.join(root,'profile'));await store.load();const project=await store.addProject(path.join(root,'project'));const session=await store.createSession(project.id);const result={root,store,project,session,controllers:[]};t.after(async()=>{for(const c of result.controllers)await c.shutdown();await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});});return result;}
const png=require('./chat-fixtures.cjs').png;
function wait(c,predicate){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.off('event',handler);reject(Error('검증 이벤트 대기 시간 초과'));},6000);function handler(e){if(predicate(e)){clearTimeout(timer);c.off('event',handler);resolve(e);}}c.on('event',handler);});}
test('첨부는 프로젝트에 보관하고 원본 크기와 해시, 래스터 이미지를 검증한다',async t=>{
 const{store,project}=await fixture(t);
 const files=await addAttachments(store,project.id,[{name:'화면.png',type:'image/png',bytes:png},{name:'자료.md',type:'text/markdown',bytes:Buffer.from('원본 자료')}]);
 const result=await resolveAttachments(store,project.id,files.map(a=>a.id));assert.equal(result[0].image,true);assert.match(result[0].dataUrl,/^data:image\/png;base64,/);assert.equal(result[1].image,false);
 await assert.rejects(addAttachments(store,project.id,[{name:'../외부.txt',bytes:png}]),/이름/);
 await assert.rejects(addAttachments(store,project.id,[{name:'다른:스트림.txt',bytes:png}]),/이름/);
 await assert.rejects(resolveAttachments(store,project.id,['../../outside']),/식별자/);
 await fs.writeFile(result[1].path,'원본 변경');await assert.rejects(resolveAttachments(store,project.id,[files[1].id]),/원본|변경/);
});
test('첨부 초안은 계정별 저장과 재시작을 거쳐 복원된다',async t=>{
 const{root,store,project,session}=await fixture(t),security={accountRevision:0,loggingOut:false,locked:false,accountOwner:async()=>false};
 const controller={store,client:{start:async()=>{},request:async()=>({account:{type:'chatgpt'}})}};
 const files=await addAttachments(store,project.id,[{name:'화면.png',type:'image/png',bytes:png}]);
 const drafts=new Drafts(path.join(root,'profile'),security,controller);await drafts.migrate(null);const key='session:'+session.id;
 await drafts.write(0,{[key]:{text:'이 화면 확인',mode:'plan',attachments:files}});
 const reopened=new Drafts(path.join(root,'profile'),security,controller);assert.deepEqual((await reopened.read(0))[key].attachments,files);
 security.accountRevision=1;await assert.rejects(drafts.read(0),/계정/);
});
test('작업 중 지시는 첨부와 순서를 보존하고 턴 종료 뒤 하나씩 전달하며 취소 지시는 실행하지 않는다',async t=>{
 const f=await fixture(t),{store,project,session}=f;
 const c=new Controller(store,{descriptor:{command:process.execPath,prefix:[path.join(__dirname,'backend-fake-codex.cjs')],label:'격리 시험',node:false}});f.controllers.push(c);await c.connect();
 const files=await addAttachments(store,project.id,[{name:'화면.png',type:'image/png',bytes:png}]);
 const started=wait(c,e=>e.type==='status'&&e.status==='running');await c.send({sessionId:session.id,text:'대기검증',mode:'plan'});await started;
 const queued=await c.send({sessionId:session.id,text:'첨부를 확인하고 이어서',attachments:files.map(a=>a.id),mode:'plan'});assert.equal(queued.queued,true);
 const cancelled=await c.send({sessionId:session.id,text:'취소할 지시',mode:'plan'});await c.messageQueue.cancel(session.id,cancelled.queueId);
 const delivered=wait(c,e=>e.type==='done'&&e.status==='completed'&&store.session(session.id).messages.filter(m=>m.role==='user').length===2);
 await c.interrupt(session.id);await delivered;
 const users=store.session(session.id).messages.filter(m=>m.role==='user');assert.equal(users.length,2);assert.equal(users[1].attachments[0].id,files[0].id);
 assert(!users.some(m=>m.text==='취소할 지시'));assert.equal(c.messageQueue.list(session.id).find(q=>q.id===cancelled.queueId).status,'cancelled');
 const loaded=new Store(path.dirname(store.file));await loaded.load();assert.equal(loaded.session(session.id).messages[1].role,'system');assert(loaded.session(session.id).messages.find(m=>m.attachments?.length));
});
test('앱 기본 설정을 상속하고 대화의 답변 동작과 실행 범위를 개별 덮어쓴다',async t=>{
 const{store}=await fixture(t),{preferences,resolved,instructions}=require('../electron/chat-preferences.cjs');
 await store.saveSettings({chatDefaults:{answerLength:'short',testing:false,autoCompact:false,compactAt:90}});
 const p=resolved(store.state.settings.chatDefaults,preferences({answerLength:'detailed',sandbox:'read-only',approval:'never'}));assert.equal(p.testing,false);assert.equal(p.autoCompact,false);assert.equal(p.answerLength,'detailed');assert.match(instructions(p),/자세히/);assert.throws(()=>preferences({compactAt:99}));
});

test('대화별 문맥 사용량을 반영하고 설정한 기준에서만 자동 압축한다',async t=>{
 const f=await fixture(t),{store,session}=f;
 const c=new Controller(store,{descriptor:{command:process.execPath,prefix:[path.join(__dirname,'backend-fake-codex.cjs')],label:'격리 시험',node:false}});f.controllers.push(c);await c.connect();
 let compactions=0;const request=c.client.request.bind(c.client);c.client.request=(method,...args)=>{if(method==='thread/compact/start')compactions++;return request(method,...args);};
 await store.saveSettings({chatDefaults:{autoCompact:true,compactAt:70}});
 const compacted=wait(c,e=>e.type==='session'&&e.session.context?.percent===20&&!e.session.compacting);
 await c.send({sessionId:session.id,text:'문맥검증',mode:'plan'});await compacted;assert.equal(compactions,1);assert.equal(store.session(session.id).context.max,1000);
 await store.saveSettings({chatDefaults:{autoCompact:false,compactAt:50}});const completed=wait(c,e=>e.type==='done'&&e.sessionId===session.id);
 await c.send({sessionId:session.id,text:'문맥검증 다시',mode:'plan'});await completed;await new Promise(r=>setImmediate(r));assert.equal(compactions,1);assert.equal(store.session(session.id).context.percent,90);
});
test('한글 첨부의 정규화 형식이 다른 실제 경로도 같은 파일로 읽고 다른 이름은 거절한다',async t=>{
 const {store,project}=await fixture(t),name='기록 사본.png',records=await addAttachments(store,project.id,[{name,type:'image/png',bytes:png}]),file=path.join(project.path,'.flowrium','attachments',records[0].id,name),realpath=fs.realpath;let outside=false;
 try{fs.realpath=async(value,...args)=>{const result=await realpath(value,...args);if(path.resolve(String(value))!==path.resolve(file))return result;return path.join(path.dirname(result),outside?'다른 파일.png':name.normalize('NFD'));};
  const [resolved]=await resolveAttachments(store,project.id,[records[0].id]);assert.equal(resolved.name,name);assert.equal(resolved.sha256,records[0].sha256);assert.match(resolved.dataUrl,/^data:image\/png;base64,/);outside=true;await assert.rejects(resolveAttachments(store,project.id,[records[0].id]),/첨부 파일 원본/);
 }finally{fs.realpath=realpath;}
});

test('작업 중 추가 지시 수신과 기존 답변의 마지막 조각이 교차해도 말풍선 순서를 보존한다',async t=>{
  const {store,session}=await fixture(t), s=store.session(session.id);
  const controller=new Controller(store);
  const run={sessionId:s.id,threadId:'thread',turnId:'turn',ownerRevision:'local',items:new Map(),itemOrder:[]};
  controller.runs.set(s.id,run);
  controller.updateText(run,'first','첫 답변',true);
  run.client={request:async()=>{
    controller.updateText(run,'second','둘째 ',true); // impatient transport issues deltas before its RPC reply
    return {turnId:'turn'};
  }};
  await controller.send({sessionId:s.id,text:'추가 지시',mode:'plan',delivery:'steer'});
  controller.updateText(run,'first','첫 답변의 완성',false);
  controller.updateText(run,'second','답변',true);
  assert.deepEqual(s.messages.map(m=>m.text),['첫 답변의 완성','추가 지시','둘째 답변']);
  assert.equal(s.messages[1].turnId,'turn');
  controller.runs.clear();await controller.shutdown();
});

test('같은 턴에서 추가한 지시마다 답변 조각을 합치고 자동 동기화 후에도 대화와 반응을 보존한다',()=>{
 const {mergeNative}=require('../electron/chat-sync.cjs'),{mergeMessages}=require('../electron/codex-transfer-merge.cjs');
 const row=(id,role,text)=>({id,role,text,turnId:'turn',createdAt:'2026-11-16T00:00:00.000Z'});
 const local=[row('u','user','처음'),{...row('a','assistant','첫 응답'),reaction:'like'},row('u2','user','추가'),row('a2','assistant','뒤 응답')];
 const remote=[row('remote-u','user','처음'),row('remote-a','assistant','첫 발언'),row('remote-b','assistant','첫 답변'),row('remote-u2','user','추가'),row('remote-a2','assistant','둘째 답변')];
 for(const merge of [mergeNative,mergeMessages]){
  const result=merge(local,remote);
  assert.deepEqual(result.map(m=>m.id),['u','a','u2','a2']);
  assert.deepEqual(result.map(m=>m.text),['처음','첫 발언\n\n첫 답변','추가','둘째 답변']);
  assert.equal(result[1].reaction,'like');assert.deepEqual(merge(result,remote),result);
 }
});

test('이름 저장 실패 시 그사이 도착한 답변과 대기 지시를 유지한다', async () => {
  const {rename} = require('../electron/chat-sync.cjs');
  const session = {id:'local', title:'이전 이름', messages:[], queuedMessages:[]};
  const started = Promise.withResolvers(), done = Promise.withResolvers();
  const controller = {
    editingSessions:new Set(), store:{session:()=>session, save:()=>{started.resolve();return done.promise;}}
  };
  const change = rename(controller, session, '변경한 이름');
  await started.promise;
  session.messages.push({role:'assistant',text:'늦게 도착한 답변'});
  session.queuedMessages.push({id:'queue',status:'queued'});
  done.reject(Error('디스크 저장 실패'));
  await assert.rejects(change, /저장 실패/);
  assert.equal(session.title, '이전 이름');
  assert.equal(session.pendingThreadName, undefined);
  assert.equal(session.messages[0].text, '늦게 도착한 답변');
  assert.equal(session.queuedMessages[0].status, 'queued');
});

test('첫 자동 이름의 전송이 지연되어도 사용자가 이어 저장한 마지막 이름이 로컬과 원본에 남는다', async t => {
  const {flushInitialTitle,rename} = require('../electron/chat-sync.cjs');
  const {store,project,session:copy} = await fixture(t), session=store.session(copy.id);
  const threadId = require('node:crypto').randomUUID();
  const owner = 'a'.repeat(64);
  session.threadId=threadId; session.desktopThread={threadId,ownerHash:owner,cwd:project.path};
  session.title='첫 요청'; session.pendingThreadName=session.title;
  const started=Promise.withResolvers(), done=Promise.withResolvers(), writes=[];
  const client={request:async(method,params)=>{
    if(method==='thread/read')return {thread:{id:threadId,cwd:project.path}};
    assert.equal(method,'thread/name/set');
    if(params.name==='첫 요청'){started.resolve();await done.promise;}
    writes.push(params.name);
  }};
  const controller={store,editingSessions:new Set(),codexTransfer:{store,client,ready:async()=>({owner}),guard:()=>{}}};
  const automatic=flushInitialTitle(session,client,threadId,()=>true);
  await started.promise;
  const first=rename(controller,session,'새 이름'), latest=rename(controller,session,'마지막 이름');
  done.resolve();
  await Promise.all([automatic,first,latest]);
  assert.deepEqual(writes,['첫 요청','새 이름','마지막 이름']);
  assert.equal(session.title,'마지막 이름');
  assert.equal(session.pendingThreadName,undefined);
});

test('원본 대기열 전송은 프로젝트의 일반 짧은 글과 이 기기의 원본 연결만 허용한다', () => {
  const {eligible} = require('../electron/codex-native-queue.cjs');
  const session={codexLink:{mode:'linked'}}, input={text:'확인할 일',attachments:[]};
  assert(eligible(session,input));assert(eligible({desktopThread:{}},input));
  for(const changes of [{codexLink:{mode:'copy'}},{scope:'general'},{scope:'integrated'},
    {workflow:{kind:'report'}},{personalAssistant:true},{applicationTools:true}])
    assert(!eligible({...session,...changes},input));
  assert(!eligible({},input));
  for(const changes of [{attachments:[{id:'a'}]},{text:'가'.repeat(32001)},{requestSourceId:'source'},{text:' '}])
    assert(!eligible(session,{...input,...changes}));
});
