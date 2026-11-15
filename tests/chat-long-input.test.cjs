const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chatInput,maxRequestBytes}=require('../electron/mobile/chat-input.js');
const {prepareRequest,readRequestSource,projectInlineLimit}=require('../electron/chat-long-request.cjs');
const {validateQueue}=require('../electron/chat-queue.cjs');
const {Store}=require('../electron/store.cjs');
const {mergeMessages}=require('../electron/codex-transfer-merge.cjs');

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
  const short='q'.repeat(projectInlineLimit);assert.deepEqual(await prepareRequest(store,session,short,dir),{text:short});
  const text='🪴'.repeat(8191)+'가'+'🪴'+'긴 요청'.repeat(75112)+'\n\n    끝\n';
  const [first,second]=await Promise.all([prepareRequest(store,session,text,dir),prepareRequest(store,session,text,dir)]);
  assert.deepEqual(first,second);assert(!first.text.includes(dir));assert(!first.text.includes(text));
  assert.equal((await fs.readdir(path.join(dir,'.flowrium','attachments'))).length,1);
  const original={id:randomUUID(),role:'user',text,requestSource:first.source,turnId:randomUUID(),createdAt:new Date().toISOString()};
  const remote={...original,id:randomUUID(),text:first.text};delete remote.requestSource;
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
