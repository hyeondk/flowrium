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
