const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Store}=require('../electron/store.cjs');
const {registerMessageReactions}=require('../electron/message-reactions.cjs');
test('답변 반응 저장 / 재시작 복원 / 취소 / 계정 변경과 저장 실패 처리',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-reactions-'));
 try{
  const directory=path.join(temp,'profile'),folder=path.join(temp,'project');await fs.mkdir(folder);
  const store=new Store(directory);await store.load();const project=await store.addProject(folder),session=await store.createSession(project.id);
  const assistant={id:randomUUID(),role:'assistant',text:'검증 답변',createdAt:new Date().toISOString()},user={id:randomUUID(),role:'user',text:'질문',createdAt:new Date().toISOString()};
  store.session(session.id).messages.push(user,assistant);await store.save();
  let revision=0,allowed=true,react;registerMessageReactions((name,fn)=>react=fn,store,{accountRevision:()=>revision,canRun:()=>allowed});
  await assert.rejects(react({sessionId:session.id,messageId:user.id,liked:true}),/답변/);
  await assert.rejects(react({sessionId:session.id,messageId:assistant.id,liked:'true'}),/반응/);
  await react({sessionId:session.id,messageId:assistant.id,liked:true});
  const loaded=new Store(directory);await loaded.load();assert.equal(loaded.session(session.id).messages[1].reaction,'like');
  await react({sessionId:session.id,messageId:assistant.id,liked:false});assert.equal(assistant.reaction,undefined);
  allowed=false;await assert.rejects(react({sessionId:session.id,messageId:assistant.id,liked:true}),/저장/);assert.equal(assistant.reaction,undefined);allowed=true;
  const save=store.save.bind(store);store.save=async()=>{throw Error('검증 저장 실패')};await assert.rejects(react({sessionId:session.id,messageId:assistant.id,liked:true}),/검증 저장 실패/);assert.equal(assistant.reaction,undefined);
  store.save=async()=>{await save();revision++};await assert.rejects(react({sessionId:session.id,messageId:assistant.id,liked:true}),/계정/);
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
