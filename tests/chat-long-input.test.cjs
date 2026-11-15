const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chatInput,maxRequestBytes}=require('../electron/mobile/chat-input.js');
const {readRequestSource,projectInlineLimit}=require('../electron/chat-long-request.cjs');
const {scopedRequest,reader}=require('../electron/scoped-request.cjs');
const {storeRequestSource}=require('../electron/chat-attachments.cjs');
const {validateQueue}=require('../electron/chat-queue.cjs');
const {Store}=require('../electron/store.cjs');
const {mergeMessages}=require('../electron/codex-transfer-merge.cjs');

test('프로젝트 입력 도구는 현재 계정과 작업의 본문만 반환한다',()=>{
  const {EventEmitter}=require('node:events');
  const client=new EventEmitter(),session={id:'test',threadId:'thread',requestReaderThreadId:'thread'};
  let owner='first',answer;
  client.answerTool=(id,result)=>{answer=result;};
  const controller=new(require('../electron/controller.cjs').Controller)({session:()=>session},{
    client,queueOwner:()=>owner,applicationTools:()=>[],
  });
  const run={sessionId:session.id,threadId:session.threadId,turnId:'first-turn',ownerRevision:owner,requestPages:['첫 요청 원문']};
  controller.runs.set(session.id,run);
  const read=(changes={},args={page:1})=>{
    answer=null;
    client.emit('tool',{requestId:1,params:{threadId:run.threadId,turnId:run.turnId,tool:reader.name,arguments:args,...changes}});
    assert(answer);
    return answer;
  };
  assert.equal(JSON.parse(read().contentItems[0].text).text,'첫 요청 원문');
  assert.equal(read({},{page:1,path:'../another.txt'}).success,false);
  assert.equal(read({threadId:'another'}).success,false);
  assert.equal(read({turnId:'prior-turn'}).success,false);
  owner='second';
  assert.equal(read().success,false);
  owner='first';
  Object.assign(run,{turnId:'second-turn',requestPages:['새 요청 원문']});
  assert.equal(read({turnId:'first-turn'}).success,false);
  assert.equal(JSON.parse(read().contentItems[0].text).text,'새 요청 원문');
  controller.runs.delete(session.id);
  assert.equal(read().success,false);
});

test('글자 수와 UTF-8 자동 첨부 경계가 공백과 복합 문자를 보존한다',()=>{
  const exact='가'.repeat(Math.floor(maxRequestBytes/3))+'a'.repeat(maxRequestBytes%3);
  assert.equal(chatInput(exact),exact);
  assert.throws(()=>chatInput(exact+'a'),/20MB/);
  const spaced='\n  처음\n   안녕 🪴  \n마침\n';
  assert.equal(chatInput(spaced),spaced);
  assert.throws(()=>chatInput('x\0y'));assert.throws(()=>chatInput('x\uD800'));
  const text=' 대기 '+ '가'.repeat(299990)+' 끝 ';
  assert.doesNotThrow(()=>validateQueue([{id:randomUUID(),text,mode:'plan',status:'queued',createdAt:new Date().toISOString(),owner:'test'}]));
});

test('긴 프로젝트 요청은 재동기화 및 재기동해도 원문 하나로 복원된다',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-source-regression-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=new Store(path.join(directory,'profile'));await store.load();
  const dir=path.join(directory,'project');await fs.mkdir(dir);
  const project=await store.addProject(dir),session=await store.createSession(project.id);
  const threadId=randomUUID();
  const run={sessionId:session.id,threadId,userMessageId:randomUUID()};
  session.requestReaderThreadId=threadId;
  const short='q'.repeat(projectInlineLimit);assert.equal(await scopedRequest({store},run,session,short,null,()=>{}),short);
  const text='🪴'.repeat(8191)+'가'+'🪴'+'긴 요청'.repeat(75112)+'\n\n    끝\n';
  const [source,other]=await Promise.all([storeRequestSource(store,project.id,text),storeRequestSource(store,project.id,text)]);
  assert.deepEqual(source,other);
  assert.equal((await fs.readdir(path.join(dir,'.flowrium','attachments'))).length,1);
  const original={id:run.userMessageId,role:'user',text,turnId:randomUUID(),createdAt:new Date().toISOString()};
  session.messages.push(original);
  run.requestSource=source;
  const prompt=await scopedRequest({store},run,session,text,null,()=>{});
  assert(prompt.includes(reader.name));assert(!prompt.includes(dir));assert(!prompt.includes(text));
  const remote={...original,id:randomUUID(),text:prompt};delete remote.requestSource;
  for(const id of [original.id,remote.id]){
    const [merged]=mergeMessages([original],[{...remote,id}]);assert.equal(merged.text,text);assert.equal(merged.id,original.id);
  }
  store.session(session.id).messages.push(original);await store.save();
  const loaded=new Store(path.dirname(store.file));await loaded.load();
  const row=loaded.session(session.id).messages[0];assert.equal(row.text,text);
  let offset=0;const chunks=[];
  do{const page=await readRequestSource(loaded,session.id,row.id,offset);assert(page.text.isWellFormed());chunks.push(page.text);offset=page.next;}while(offset!==null);
  assert.equal(chunks.join(''),text);
  assert.equal((await readRequestSource(loaded,session.id,row.id,'full')).text,text);
});
