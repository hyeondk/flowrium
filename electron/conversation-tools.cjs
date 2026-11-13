const {randomUUID}=require('node:crypto');
const {text}=require('./store.cjs');
async function threadTurns(client,threadId) {
  const all=[];let cursor;
  for(let page=0;page<100;page++) {
    const result=await client.request('thread/turns/list',{threadId,sortDirection:'asc',limit:100,...(cursor?{cursor}:{})});
    all.push(...(result.data||[]));
    if(!result.nextCursor)return all;
    if(result.nextCursor===cursor)throw Error('Codex 대화 기록의 페이지가 반복됐습니다.');
    cursor=result.nextCursor;
  }
  throw Error('대화가 너무 길어 한 번에 확인하지 못했습니다.');
}
function assignTurns(messages,turns) {
  const user=messages.filter(m=>m.role==='user');
  const used=new Set();
  for(const message of user) {
    const found=turns.find(t=>(t.items||[]).some(i=>i.type==='userMessage'&&i.id===message.id));
    if(found){message.turnId=found.id;used.add(found.id);}
  }
  if(user.length===turns.length)user.forEach((m,i)=>{m.turnId=turns[i].id;});
}
async function prepare(controller,session) {
  if(!session.threadId)throw Error('이 기기의 Codex 대화 상태가 없습니다. 원본 기기에서 대화를 실행한 뒤 다시 시도해 주세요.');
  const client=await controller.conversationClient?.(session)||controller.client;
  await client.start(controller.store.state.settings.codexPath);
  if(!controller.loadedThreads.has(session.threadId)){
    const params=await controller.conversationThreadParams?.(session)||{};
    const resumed=await client.request('thread/resume',{threadId:session.threadId,...params});
    if(session.scope&&resumed.activePermissionProfile?.id!==params.permissions)throw Error('대화의 파일 접근 제한을 확인하지 못했습니다.');
    controller.loadedThreads.add(session.threadId);
  }
  const turns=await threadTurns(client,session.threadId);
  assignTurns(session.messages,turns);
  return {turns,client};
}
function registerConversationTools(register,controller) {
 const {store}=controller,editing=controller.editingSessions;
 register('editConversation',async(id,input)=>{
  const session=store.session(text(id,'대화 식별자',100));
  if(controller.runs.has(id)||editing.has(id)||session.compacting||controller.messageQueue.pending(id))throw Error('실행 중인 작업과 대기 지시를 마친 뒤 다시 시도해 주세요.');
  editing.add(id);
  const old=structuredClone(session);
  try {
   if(input?.action==='compact'){
    const {client}=await prepare(controller,session);
    session.compacting=true;
    controller.emitEvent({type:'session',sessionId:id,session:structuredClone(session)});
    try{await client.request('thread/compact/start',{threadId:session.threadId});}
    catch(e){session.compacting=false;throw e;}
    return structuredClone(session);
   }
   let index=session.messages.findIndex(m=>m.id===input?.messageId);
   if(input?.action==='branch'){
    if(input.messageId&&(index<0||session.messages[index].role!=='user'))throw Error('분기할 요청을 찾을 수 없습니다.');
    const {turns,client}=await prepare(controller,session);
    const target=input.messageId?session.messages[index]:null;
    if(target&&!turns.some(t=>t.id===target.turnId))throw Error('선택한 요청의 Codex 내부 기록을 찾지 못했습니다. 원본 기록은 유지됩니다.');
    const scopeParams=await controller.conversationThreadParams?.(session)||{};
    const fork=await client.request('thread/fork',{threadId:session.threadId,...scopeParams,...(target?{lastTurnId:target.turnId}:{})});
    if(session.scope&&fork.activePermissionProfile?.id!==scopeParams.permissions)throw Error('분기 대화의 파일 접근 제한을 확인하지 못했습니다.');
    if(!fork.thread?.id)throw Error('Codex가 분기한 대화를 반환하지 않았습니다.');
    const nextUser=target?session.messages.findIndex((m,i)=>i>index&&m.role==='user'):-1;
    const messages=structuredClone(session.messages.slice(0,nextUser<0?undefined:nextUser));
    const forkTurns=await threadTurns(client,fork.thread.id);assignTurns(messages,forkTurns);
    const workflow=session.workflow&&{...structuredClone(session.workflow),status:'active'};if(workflow)delete workflow.completion;
    const result=await store.createSession(session.projectId,{title:('분기 / '+session.title).slice(0,300),workflow,messages:messages.map(m=>({...m,id:randomUUID()})),threadId:fork.thread.id,preferences:session.preferences,context:session.context,applicationTools:session.applicationTools});
    controller.loadedThreads.add(fork.thread.id);
    return result;
   }
   if(input?.action==='preferences')session.preferences=require('./chat-preferences.cjs').preferences(input.preferences);
   else if(input?.action==='rename')session.title=text(input.title,'대화 이름',300);
   else if(input?.action==='rewind'&&index>=0&&session.messages[index].role==='user'){
    const {turns,client}=await prepare(controller,session),target=session.messages[index];
    const turnIndex=turns.findIndex(t=>t.id===target.turnId);
    if(turnIndex<0)throw Error('선택한 요청의 Codex 실행 기록이 없습니다. 원본 기록을 유지했습니다.');
    // 먼저 원본을 실제로 분기한다. 이후 저장 실패가 나도 원래 Codex 대화는 변경하지 않는다.
    const scopeParams=await controller.conversationThreadParams?.(session)||{};
    const fork=await client.request('thread/fork',{threadId:session.threadId,...scopeParams});
    if(session.scope&&fork.activePermissionProfile?.id!==scopeParams.permissions)throw Error('보관 대화의 파일 접근 제한을 확인하지 못했습니다.');
    if(!fork.thread?.id)throw Error('되감기 전 원본 보관에 실패했습니다.');
    const forkTurns=await threadTurns(client,fork.thread.id);
    if(forkTurns.length!==turns.length)throw Error('Codex 분기 기록이 원본과 달라 되감기를 중단했습니다.');
    const reverted=await client.request('thread/revert',{threadId:fork.thread.id,beforeTurnId:forkTurns[turnIndex].id});
    session.threadId=reverted.thread?.id||fork.thread.id;
    session.messages=session.messages.slice(0,index);
    assignTurns(session.messages,forkTurns.slice(0,turnIndex));
    delete session.context;
    if(session.workflow){session.workflow.status='active';delete session.workflow.completion;}
    session.updatedAt=new Date().toISOString();
    await store.save();controller.loadedThreads.add(session.threadId);
    return {...structuredClone(session),restoredDraft:{text:target.text,attachments:target.attachments||[]}};
   }else throw Error('대화 편집 요청을 확인해 주세요.');
   session.updatedAt=new Date().toISOString();await store.save();return structuredClone(session);
  }catch(e){for(const key of Object.keys(session))delete session[key];Object.assign(session,old);throw e;}
  finally{editing.delete(id);}
 });
}
module.exports={registerConversationTools,threadTurns,assignTurns};
