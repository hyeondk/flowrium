const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {chatInput}=require('../electron/mobile/chat-input.js');
const attachmentLimit=require('../electron/chat-attachments.cjs').MAX_FILE;
const {readRequestSource,projectInlineLimit}=require('../electron/chat-long-request.cjs');
const {scopedRequest,reader}=require('../electron/scoped-request.cjs');
const {storeRequestSource}=require('../electron/chat-attachments.cjs');
const {validateQueue}=require('../electron/chat-queue.cjs');
const {Store}=require('../electron/store.cjs');
const {mergeMessages}=require('../electron/codex-transfer-merge.cjs');

test('프로젝트 입력 도구는 현재 계정과 작업의 본문만 반환한다',async()=>{
  const {EventEmitter}=require('node:events');
  const client=new EventEmitter(),session={id:'test',threadId:'thread',requestReaderThreadId:'thread'};
  let owner='first',answer;
  client.answerTool=(id,result)=>{answer=result;};
  const controller=new(require('../electron/controller.cjs').Controller)({session:()=>session},{
    client,queueOwner:()=>owner,applicationTools:()=>[],
  });
  const run={sessionId:session.id,threadId:session.threadId,turnId:'first-turn',ownerRevision:owner,requestPages:{length:1,read:async()=>'첫 요청 원문'}};
  controller.runs.set(session.id,run);
  const read=async(changes={},args={page:1})=>{
    answer=null;
    client.emit('tool',{requestId:1,params:{threadId:run.threadId,turnId:run.turnId,tool:reader.name,arguments:args,...changes}});
    await new Promise(resolve=>setImmediate(resolve));
    assert(answer);
    return answer;
  };
  assert.equal(JSON.parse((await read()).contentItems[0].text).text,'첫 요청 원문');
  assert.equal((await read({},{page:1,path:'../another.txt'})).success,false);
  assert.equal((await read({threadId:'another'})).success,false);
  assert.equal((await read({turnId:'prior-turn'})).success,false);
  owner='second';
  assert.equal((await read()).success,false);
  owner='first';
  Object.assign(run,{turnId:'second-turn',requestPages:{length:1,read:async()=>'새 요청 원문'}});
  assert.equal((await read({turnId:'first-turn'})).success,false);
  assert.equal(JSON.parse((await read()).contentItems[0].text).text,'새 요청 원문');
  controller.runs.delete(session.id);
  assert.equal((await read()).success,false);
});

test('글자 수와 UTF-8 자동 첨부 경계가 공백과 복합 문자를 보존한다',()=>{
  const exact='가'.repeat(Math.floor(attachmentLimit/3))+'a'.repeat(attachmentLimit%3);
  assert.equal(chatInput(exact),exact);
  assert.equal(chatInput(exact+'a'),exact+'a');
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

test('20MiB 초과 UTF-8 원문은 청크 경계를 넘어도 한 번 저장되고 모델과 다시 연 화면에서 페이지별로 복원된다',async t=>{
  const {createHash}=require('node:crypto');
  const {sourceRecord, filePage}=require('../electron/chat-request-source.cjs');
  const {addAttachments,checkedAttachments,resolveAttachments,MAX_FILE}=require('../electron/chat-attachments.cjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-large-source-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:4}));
  const folder=path.join(directory,'project'), store=new Store(path.join(directory,'profile'));
  await fs.mkdir(folder);await store.load();
  const project=await store.addProject(folder);
  const session=store.session((await store.createSession(project.id)).id);
  const text='\uFEFF  시작\n'+'❄️동기🪴'.repeat(1400000)+'\r\n끝  ';
  const bytes=Buffer.from(text);
  assert(bytes.length>MAX_FILE);
  const digest=createHash('sha256').update(bytes).digest('hex');
  async function* pieces(){
    for(let i=0;i<bytes.length;i+=75531)yield bytes.subarray(i,i+75531);
  }
  const source=await storeRequestSource(store,project.id,pieces());
  assert.equal(source.sha256,digest);assert.equal(source.size,bytes.length);
  assert.deepEqual(await storeRequestSource(store,project.id,text),source);
  assert.throws(()=>checkedAttachments([source]));
  await assert.rejects(resolveAttachments(store,project.id,[source.id]),/첨부/);
  await assert.rejects(addAttachments(store,project.id,[{name:'수동.txt',type:'text/plain',bytes}]),/20MB/);
  const message={id:randomUUID(),role:'user',text:'원문',sourceOnly:true,requestSource:source,createdAt:new Date().toISOString()};
  session.messages.push(message);await store.save();
  const restored=new Store(path.dirname(store.file));await restored.load();
  assert.deepEqual(restored.session(session.id).messages[0].requestSource,source);
  // Force the on-disk cold-index path across app restarts, including byte splits inside an emoji.
  const filename=path.join(folder,'.flowrium','attachments',source.id,'request.txt');
  await fs.utimes(filename,new Date(0),new Date(1));
  const file=await sourceRecord(restored,project.id,source.id);
  const rawHash=createHash('sha256');
  for(let n=0;n<file.index.pages.length;n++){
    const part=await filePage(file,n);assert(part.length<=12000 && part.isWellFormed());rawHash.update(part);
  }
  assert.equal(rawHash.digest('hex'),digest);
  const first=await readRequestSource(restored,session.id,message.id,0);
  assert(first.text.startsWith('\uFEFF  시작'));
  const last=await readRequestSource(restored,session.id,message.id,file.index.pages.at(-1).character);
  assert(last.text.endsWith('\r\n끝  '));assert.equal(last.next,null);
  const originalThread=randomUUID(), row=restored.session(session.id);row.requestReaderThreadId=originalThread;
  const run={threadId:originalThread,userMessageId:message.id,sessionId:session.id,requestSource:source};
  let active=true;
  const prompt=await scopedRequest({store:restored},run,row,'원문',null,()=>{if(!active)throw Error('종료');});
  assert(prompt.includes(digest));assert(prompt.length<1000);
  assert.equal((await require('../electron/scoped-request.cjs').readPage(run,{page:1})).text,first.text);
  assert.equal((await require('../electron/scoped-request.cjs').readPage(run,{page:run.requestPages.length})).text,last.text);
  active=false;await assert.rejects(require('../electron/scoped-request.cjs').readPage(run,{page:1}),/종료/);
  const sourceRoot=path.dirname(path.dirname(filename));
  const badStreams=[
    (async function*(){yield Buffer.from([0x77,0xe2]);})(),
    (async function*(){yield Buffer.from('   \t\r\n');})(),
    (async function*(){yield Buffer.from('정상');yield Buffer.from([0]);})(),
    (async function*(){yield Buffer.from('앞');throw Error('연결 종료');})()
  ];
  for(const stream of badStreams)await assert.rejects(storeRequestSource(store,project.id,stream));
  let checked=0;
  await assert.rejects(storeRequestSource(store,project.id,pieces(),{guard(){if(++checked>4)throw Error('사용자 변경');}}),/사용자 변경/);
  assert.deepEqual(await fs.readdir(sourceRoot),[source.id]);
});

test('모바일 미전송 원문은 취소·프로필 재시작에서만 정리되고 공유 원문과 저장한 대화 개정은 보존된다',async t=>{
  const {storeRequestSource,cleanupMobileRequestStages,sourceRecord}=require('../electron/chat-request-source.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-upload-stage-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const profile=path.join(root,'프로필'),folder=path.join(root,'업무');
  const store=new Store(profile);await store.load();await fs.mkdir(folder);
  const project=await store.addProject(folder),session=store.session((await store.createSession(project.id)).id);
  const text='서로 다른 메시지에 같은 원문 사용 🪴'.repeat(3500);
  const stagedRoot=path.join(profile,'mobile-request-staging-v1');
  const defer=()=>storeRequestSource(store,project.id,text,{defer:true});
  const first=await defer(), second=await defer();
  assert.equal(first.id,second.id);
  const pathOf=source=>path.join(folder,'.flowrium','attachments',source.id,'request.txt');
  await assert.rejects(fs.stat(pathOf(first)),{code:'ENOENT'});
  await cleanupMobileRequestStages(store);
  assert.equal((await fs.readdir(stagedRoot)).length,2);
  await first.discard();await assert.rejects(first.publish(),/취소/);
  assert.equal((await fs.readdir(stagedRoot)).length,1);
  await assert.rejects(fs.stat(pathOf(second)),{code:'ENOENT'});
  const [ref,again]=await Promise.all([second.publish(),second.publish(),second.discard()]);
  assert.deepEqual(ref,again);assert.deepEqual(await fs.readdir(stagedRoot),[]);
  session.messages.push({id:randomUUID(),role:'user',text:'원문',requestSource:ref,sourceOnly:true,createdAt:new Date().toISOString()});
  await store.save();
  const duplicate=await defer();await duplicate.discard();
  const restored=new Store(profile);await restored.load();
  assert.equal((await sourceRecord(restored,project.id,ref.id,true)).bytes.toString('utf8'),text);
  assert.deepEqual(restored.session(session.id).messages[0].requestSource,ref);
  const old=path.join(stagedRoot,'upload-'+randomUUID()),unrelated=path.join(stagedRoot,'직접 보관'),unknown=path.join(stagedRoot,'upload-'+randomUUID());
  for(const dir of [old,unrelated,unknown])await fs.mkdir(dir);
  await fs.writeFile(path.join(old,'request.txt'),'중단된 전송 일부');
  await fs.writeFile(path.join(old,'.flowrium-write-'+randomUUID()+'.tmp'),'작성 중 메타데이터');
  await fs.writeFile(path.join(unknown,'사용자 자료.md'),'보존');
  await cleanupMobileRequestStages(restored);
  await assert.rejects(fs.stat(old),{code:'ENOENT'});
  assert.deepEqual(new Set(await fs.readdir(stagedRoot)),new Set([path.basename(unrelated),path.basename(unknown)]));
  assert.equal(await fs.readFile(pathOf(ref),'utf8'),text);
});

test('별도 볼륨의 프로젝트에는 전송을 선택한 뒤에만 원자적으로 복사하고 원문 다이제스트를 검증한다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-stage-volume-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const profile=path.join(root,'app'),folder=path.join(root,'project');
  const store=new Store(profile);await store.load();await fs.mkdir(folder);
  const project=await store.addProject(folder);
  const original=fs.rename,projectSources=path.join(folder,'.flowrium','attachments');
  let copyCount=0;
  t.mock.method(fs,'rename',async(src,dst)=>{
    if(src.includes('mobile-request-staging-v1') && path.dirname(dst).endsWith(path.join('.flowrium','attachments'))){
      copyCount++;
      throw Object.assign(Error('cross-volume fixture'),{code:'EXDEV'});
    }
    return original(src,dst);
  });
  const text='다른 볼륨의 프로젝트에 게시할 한글 원문 🪴'.repeat(28000);
  const staged=await storeRequestSource(store,project.id,text,{defer:true});
  await assert.rejects(fs.stat(path.join(projectSources,staged.id)),{code:'ENOENT'});
  const ref=await staged.publish();
  assert.equal(copyCount,1);
  assert.equal(await fs.readFile(path.join(projectSources,ref.id,'request.txt'),'utf8'),text);
  assert.deepEqual(await fs.readdir(projectSources),[ref.id]);
  assert.deepEqual(await fs.readdir(path.join(profile,'mobile-request-staging-v1')),[]);
});
