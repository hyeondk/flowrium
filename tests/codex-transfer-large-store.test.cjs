const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,createHash}=require('node:crypto');
const {Store}=require('../electron/store.cjs');
const {ProjectStore,readJSON,createJSON,DEFAULT_JSON_BYTES,SESSION_REVISION_BYTES}=require('../electron/project-store.cjs');
const digest=text=>createHash('sha256').update(text).digest('hex');
test('35MB가 넘는 검증된 대화를 저장하고 재시작 복원과 추가 개정을 보존한다',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-large-session-')),folder=path.join(root,'합성 프로젝트'),settings=path.join(root,'설정');await fs.mkdir(folder);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new Store(settings);await store.load();const project=await store.addProject(folder),created=await store.createSession(project.id),session=store.session(created.id),body='검증용 대형 본문 시작\n'+'x'.repeat(1_900_000)+'\n검증용 대형 본문 끝';
 for(let index=0;index<20;index++)session.messages.push({id:randomUUID(),role:index%2?'assistant':'user',text:body,createdAt:new Date().toISOString()});
 session.threadId='합성 실행 연결';const beforeHash=digest(JSON.stringify(session.messages));await store.save();
 const history=path.join(folder,'.flowrium','sessions'),names=await fs.readdir(history),large=[];for(const name of names)if((await fs.stat(path.join(history,name))).size>35*1024*1024)large.push(name);assert.equal(large.length,1);const firstFile=path.join(history,large[0]);
 await assert.rejects(readJSON(firstFile),/허용 크기/);assert.equal(DEFAULT_JSON_BYTES,32*1024*1024);assert.equal(SESSION_REVISION_BYTES,128*1024*1024);assert(!(await fs.readFile(store.file,'utf8')).includes('검증용 대형 본문'));
 const reload=new Store(settings);await reload.load();const restored=reload.session(session.id);assert.equal(digest(JSON.stringify(restored.messages)),beforeHash);assert.equal(restored.threadId,'합성 실행 연결');
 restored.messages.push({id:randomUUID(),role:'assistant',text:'재시작 뒤 이어간 추가 답변',createdAt:new Date().toISOString()});await reload.save();
 const finalStore=new Store(settings);await finalStore.load();assert.equal(finalStore.session(session.id).messages.length,21);assert.equal(finalStore.session(session.id).messages.at(-1).text,'재시작 뒤 이어간 추가 답변');assert.equal(digest(JSON.stringify(finalStore.session(session.id).messages.slice(0,20))),beforeHash);await fs.access(firstFile);
 await assert.rejects(createJSON(path.join(root,'일반 설정.json'),{text:body.repeat(20)}),/허용 크기/);await assert.rejects(readJSON(firstFile,{maxBytes:129*1024*1024}),/한도를/);
 const invalidFolder=path.join(root,'잘못된 개정');await fs.mkdir(invalidFolder);const repo=await ProjectStore.open(invalidFolder),revision=randomUUID(),id=randomUUID();await createJSON(path.join(repo.history,id+'--'+revision+'.json'),{version:1,projectId:repo.id,sessionId:id,revision,parentRevision:null,deleted:false,session:{id,projectId:repo.id,title:'검증 실패',createdAt:new Date().toISOString(),updatedAt:'잘못된 날짜',messages:session.messages}},{maxBytes:SESSION_REVISION_BYTES});await assert.rejects(ProjectStore.open(invalidFolder),/대화 형식/);
});
