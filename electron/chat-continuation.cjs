const {UUID}=require('./project-store.cjs');
const {asksToContinue,continuationAnswer}=require('./execution-state.js');
const {followupFromAnswer}=require('./mobile/answer-followup.js');
const stale=()=>Error('대화나 계정 상태가 바뀌었습니다. 최신 답변을 확인하고 다시 선택해 주세요.');
function snapshot(controller,input,includeCompleted=false){
 if(!input||typeof input!=='object'||!UUID.test(input.sessionId)||!UUID.test(input.messageId))throw Error('후속 작업의 대화와 답변을 확인해 주세요.');
 if(controller.shuttingDown||controller.options.canRun?.()===false)throw stale();
 const session=controller.store.session(input.sessionId),message=continuationAnswer(session);
 if(!message||message.id!==input.messageId||!asksToContinue(message.text)||session.workflow?.status==='done'||session.compacting||controller.runs.has(session.id)||controller.editingSessions.has(session.id)||controller.codexTransfer?.liveTurn?.(session)||controller.messageQueue?.pending(session.id))throw stale();
 if(!includeCompleted && session.completedContinuationId===message.id)throw stale();
 return {session,message,owner:controller.options.queueOwner?.()??'local',text:message.text};
}
function recheck(controller,input,before){const next=snapshot(controller,input);if(next.owner!==before.owner||next.text!==before.text)throw stale();return next;}
async function continueConversation(controller,input){
 const before=snapshot(controller,input);
 controller.continuationFlights ||=new Set();if(controller.continuationFlights.has(input.sessionId))throw Error('이 대화의 진행 요청을 이미 보내고 있습니다.');
 controller.continuationFlights.add(input.sessionId);
 try{
  if(input.text!==undefined&&(typeof input.text!=='string'||input.text.includes('\0')))throw Error('이어서 보낼 내용을 확인해 주세요.');
  if(input.attachments!==undefined&&(!Array.isArray(input.attachments)||input.attachments.length>16||input.attachments.some(id=>typeof id!=='string')))throw Error('첨부 자료를 확인해 주세요.');
  recheck(controller,input,before);
  return await controller.send({sessionId:input.sessionId,requestSourceId:input.requestSourceId,submissionId:input.submissionId,text:input.text?.trim()?input.text:followupFromAnswer(before.text)?.prompt||'앞서 제안한 다음 단계를 이어서 진행해 주세요.',attachments:input.attachments||[],mode:input.mode,model:input.model,effort:input.effort},{expectedContinuation:{messageId:input.messageId,text:before.text,owner:before.owner}});
 }finally{controller.continuationFlights.delete(input.sessionId);}
}
async function completeContinuation(controller,input){
 const {session,message,owner}=snapshot(controller,input,true);
 if(controller.continuationFlights?.has(session.id))throw stale();
 const previous=session.completedContinuationId;
 if(previous===message.id)return;
 session.completedContinuationId=message.id;
 try{await controller.store.save();}
 catch(error){
  if(session.completedContinuationId===message.id){
   if(previous)session.completedContinuationId=previous;
   else delete session.completedContinuationId;
  }
  throw error;
 }
 if(owner!==(controller.options.queueOwner?.()??'local')||controller.options.canRun?.()===false)throw stale();
 controller.emitEvent({type:'session',sessionId:session.id,session:structuredClone(session)});
}
module.exports={continueConversation,completeContinuation,snapshot};
