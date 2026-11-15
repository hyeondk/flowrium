const {UUID}=require('./project-store.cjs');
const {asksToContinue}=require('./execution-state.js');
function replyFollowupHint(session, message) {
 if (session.workflow || session.personalAssistant || session.codexLink || session.sourceThreadId || session.scope === 'integrated') return '';
 const formatOrArtifact = /보고서|산출물|제안서|발표문|이메일|메일 초안|번역|양식|형식|서식|서류|문서|표로|표만|코드만|답만|(?:본문|결과|정답|답변)만|(?:한|두|세|\d+)\s*(?:줄|문장|단어)(?:만|로|으로|\s*이내)|\b(?:json|yaml|xml|csv|tsv|sql|html|pdf|docx?|xlsx?|pptx?|verbatim)\b|only (?:the )?(?:answer|code|text)|exact (?:format|wording)/i;
 const decline = /(?:후속|다음\s*(?:단계|작업)|추천|제안|질문)[^.!?\n]{0,32}(?:없이|제외|생략|말[아고]|지\s*마|마세요|금지|원하지\s*않|필요\s*없|빼)|(?:do not|don't|no)\s+(?:ask|suggest|recommend|follow[ -]?up|next steps?)/i;
 if (formatOrArtifact.test(message) || decline.test(message)) return '';
 return '\n이번 답변 한 번에만 적용하세요. 사용자가 요청한 작업을 먼저 수행하세요. 대화에서 확인한 구체적인 미완료 작업이 있고 이를 위해 사용자의 새 요청이 실제로 필요할 때만 마지막에 “다음 단계: …해 주세요.” 한 줄로 그 작업을 제안하세요. 사용자 요청을 그대로 마칠 수 있거나 이미 끝난 일, 단순한 질의, 다른 출력 형식이나 산출물을 요청한 경우, 추가 제안을 원하지 않는 경우에는 이 줄을 생략하세요.';
}
const stale=()=>Error('대화나 계정 상태가 바뀌었습니다. 최신 답변을 확인하고 다시 선택해 주세요.');
function snapshot(controller,input,includeCompleted=false){
 if(!input||typeof input!=='object'||!UUID.test(input.sessionId)||!UUID.test(input.messageId))throw Error('후속 작업의 대화와 답변을 확인해 주세요.');
 if(controller.shuttingDown||controller.options.canRun?.()===false)throw stale();
 const session=controller.store.session(input.sessionId),message=session.messages.at(-1);
 if(!message||message.id!==input.messageId||message.role!=='assistant'||!message.text?.trim()||session.workflow?.status==='done'||session.compacting||controller.runs.has(session.id)||controller.editingSessions.has(session.id)||controller.messageQueue?.pending(session.id))throw stale();
 if(!includeCompleted && session.completedContinuationId===message.id)throw stale();
 return {session,message,owner:controller.options.queueOwner?.()??'local',text:message.text};
}
function recheck(controller,input,before){const next=snapshot(controller,input);if(next.owner!==before.owner||next.text!==before.text)throw stale();return next;}
const schema={type:'object',additionalProperties:false,required:['suggestions'],properties:{suggestions:{type:'array',minItems:0,maxItems:3,items:{type:'object',additionalProperties:false,required:['title','prompt','reason'],properties:{title:{type:'string'},prompt:{type:'string'},reason:{type:'string'}}}}}};
function followupContext(history){
 const rows=[];
 for(let index=history.length-1;index>=0 && rows.length<4;index--){
  const item=history[index];
  if(item.role!=='user' && item.role!=='assistant')continue;
  const value=item.text||'',limit=rows.length===0?1800:rows.length===1?1100:400;
  const text=value.length<=limit?value:value.slice(0,Math.floor(limit/3))+'\n…\n'+value.slice(-Math.ceil(limit*2/3));
  rows.push({role:item.role,text});
 }
 return rows.reverse();
}
async function suggest(controller,input){
 const before=snapshot(controller,input);
 const settings=controller.store.state.settings;
 const model=before.session.preferences?.model||settings.chatDefaults?.model||settings.model;
 const target=JSON.stringify([before.owner,input.sessionId,input.messageId,model]);
 controller.followupFlights ||=new Set();if(controller.followupFlights.has(target))throw Error('이 대화의 후속 작업을 이미 검토하고 있습니다.');
 controller.followupFlights.add(target);
 try{
  const messages=followupContext(before.session.messages);
  const result=await controller.runStructuredAnalysis({
   model,background:input.background===true,
   effort:'lowest-supported',
   prompt:'마지막 답변과 사용자의 목표를 읽고 가장 유용한 후속 작업 1개를 추천하세요. 이미 끝낸 일은 제외하고 근거가 없으면 빈 배열을 쓰세요. 제목은 짧게, 요청은 산출물이나 검증 기준이 있는 한국어 한 문장, 이유는 한 구절로 쓰세요.\n'+JSON.stringify(messages),schema
  });
  recheck(controller,input,before);
  if(!result||!Array.isArray(result.suggestions)||result.suggestions.length>3)throw Error('모델의 후속 작업 추천 형식을 확인하지 못했습니다. 다시 요청해 주세요.');
  const seen=new Set(),suggestions=result.suggestions.map(value=>{
   const row={};for(const [key,max]of [['title',100],['prompt',4000],['reason',600]]){if(typeof value?.[key]!=='string'||!value[key].trim()||value[key].length>max||value[key].includes('\0'))throw Error('모델의 후속 작업 추천 내용을 확인하지 못했습니다.');row[key]=value[key].trim();}return row;
  }).filter(row=>{if(seen.has(row.prompt))return false;seen.add(row.prompt);return true;});
  return {sessionId:input.sessionId,messageId:input.messageId,source:'model',suggestions};
 }finally{controller.followupFlights.delete(target);}
}
async function continueConversation(controller,input){
 const before=snapshot(controller,input);
 controller.continuationFlights ||=new Set();if(controller.continuationFlights.has(input.sessionId))throw Error('이 대화의 진행 요청을 이미 보내고 있습니다.');
 controller.continuationFlights.add(input.sessionId);
 try{
  if(input.text!==undefined&&(typeof input.text!=='string'||input.text.length>100000||input.text.includes('\0')))throw Error('이어서 보낼 내용을 확인해 주세요.');
  if(input.attachments!==undefined&&(!Array.isArray(input.attachments)||input.attachments.length>16||input.attachments.some(id=>typeof id!=='string')))throw Error('첨부 자료를 확인해 주세요.');
  recheck(controller,input,before);
  return await controller.send({sessionId:input.sessionId,text:input.text?.trim()||'앞서 제안한 다음 단계를 이어서 진행해 주세요.',attachments:input.attachments||[],mode:input.mode||'plan',model:input.model,effort:input.effort},{expectedContinuation:{messageId:input.messageId,text:before.text,owner:before.owner}});
 }finally{controller.continuationFlights.delete(input.sessionId);}
}
async function completeContinuation(controller,input){
 const {session,message,owner}=snapshot(controller,input,true);
 if(!asksToContinue(message.text)||controller.continuationFlights?.has(session.id))throw stale();
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
module.exports={suggest,continueConversation,completeContinuation,snapshot,schema,replyFollowupHint};
