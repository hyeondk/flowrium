const {randomUUID} = require('node:crypto');
const {resolveAttachments,checkedAttachments} = require('./chat-attachments.cjs');

// A turn may finish while resolving files. Only a definite rejection can be
// retried in the following turn; unknown delivery (timeout/disconnect) must not replay.
async function deliver(controller, session, run, input, text, owner) {
  if (!run.threadId || !run.turnId || run.cancelled || run.finalized) return false;
  const {threadId,turnId} = run;
  const current = () => controller.runs.get(session.id) === run && run.turnId === turnId && !run.cancelled && !run.finalized;
  const guard = () => {
    if (controller.options.canRun?.()===false || owner !== (controller.options.queueOwner?.() ?? 'local') || run.ownerRevision !== owner)
      throw Error('계정이나 잠금 상태가 바뀌었습니다. 추가 지시를 다시 확인해 주세요.');
  };
  const client = run.client || controller.client;
  const files = await resolveAttachments(controller.store,session.projectId,input.attachments || []);
  // Each turn's paged reader stays bound to that turn's original submission.
  if (input.requestSourceId || text.length>require('./chat-long-request.cjs').projectInlineLimit || files.some(file=>!file.image) || (session.scope && files.length)) return false;
  guard();
  if (!current()) return false;
  const anchor=session.messages.at(-1);
  const previousAnswer=run.assistant, previousItems=[...run.itemOrder];
  const id = input.submissionId || randomUUID(), createdAt = new Date().toISOString();
  const message = {id,role:'user',turnId,text,createdAt,...(files.length ? {attachments:checkedAttachments(files)} : {})};
  try {
    const result = await client.request('turn/steer',{
      threadId,expectedTurnId:turnId,clientUserMessageId:id,
      input:[{type:'text',text},...files.map(file=>({type:'localImage',path:file.path}))]
    });
    if (result.turnId !== turnId) throw Error('추가 지시의 수신 상태를 확인하지 못했습니다. 대화를 새로고침해 주세요.');
  } catch(error) {
    if (error.rpcCode === -32601 || /no active turn|not (?:currently )?in progress|(?:expected|active) turn .{0,140}(?:mismatch|does not match|not found)|turn mismatch/i.test(error.rpcMessage || '')) return false;
    throw error;
  }
  // Acknowledged input is never replayed into a different account or project.
  if (controller.options.canRun?.()===false || owner!==(controller.options.queueOwner?.()??'local') || controller.store.peekSession(session.id)!==session) return true;
  const position=anchor ? session.messages.indexOf(anchor)+1 : 0;
  session.messages.splice(position,0,message);
  session.updatedAt = new Date().toISOString();
  // A reply notification can precede the acknowledgement on the same stdout read.
  // Keep later items after the new input and complete earlier items in their own bubble.
  if (previousAnswer && run.assistant===previousAnswer) {
    const prior={assistant:previousAnswer,itemOrder:previousItems,items:new Map()};
    run.priorAnswers??=new Map();
    for(const key of previousItems) {
      prior.items.set(key,run.items.get(key));
      run.priorAnswers.set(key,prior);
      run.items.delete(key);
    }
    previousAnswer.text=previousItems.map(key=>prior.items.get(key)).join('\n\n');
    run.itemOrder=run.itemOrder.filter(key=>!prior.items.has(key));
    run.assistant=null;
    if(run.itemOrder.length)controller.assistant(run).text=run.itemOrder.map(key=>run.items.get(key)).join('\n\n');
  }
  try { await controller.store.save(); }
  catch { controller.emitEvent({type:'error',sessionId:session.id,text:'추가 지시는 전달됐지만 기록을 저장하지 못했습니다. 같은 지시를 다시 보내지 말고 대화를 새로고침해 주세요.'}); }
  controller.emitEvent({type:'session',sessionId:session.id,session:structuredClone(session)});
  return true;
}
function steer(controller,session,run,input,text,owner) {
  const send=()=>deliver(controller,session,run,input,text,owner);
  const task=(run.steerTail || Promise.resolve()).then(send);
  run.steerTail=task.catch(()=>{});
  return task;
}
module.exports = {steer};
