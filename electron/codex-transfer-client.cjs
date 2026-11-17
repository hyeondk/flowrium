const {CodexClient}=require('./codex.cjs');
const {publicMessage}=require('./errors.cjs');

function linkedError(error){
 if(/already has an active writer|is closing; retry thread\/resume after the thread is closed/i.test(error?.rpcMessage||error?.message||''))return Object.assign(Error('원래 대화의 쓰기 권한을 기다리고 있습니다.'),{code:'THREAD_WRITER_BUSY'});
 return error;
}
function createRunClient(controller,run){
 const client=controller.options.linkedClientFactory?.(run)||new CodexClient({...controller.client.options});
 if(client===controller.client)throw Error('공유 대화의 별도 실행 연결을 준비하지 못했습니다.');
 controller.linkedClients??=new Map();controller.linkedClients.set(run.sessionId,client);run.client=client;
 client.on('notification',message=>controller.notification(message,client).catch(error=>controller.emitEvent({type:'error',sessionId:run.sessionId,text:publicMessage(error)})));
 client.on('approval',request=>controller.forwardApproval(request,client));
 client.on('input',({requestId,params})=>{
  if(controller.runs.get(run.sessionId)!==run||run.finalized||run.cancelled||run.threadId!==params.threadId||controller.options.canRun?.()===false||run.ownerRevision!==(controller.options.queueOwner?.()??'local')||(run.turnId&&run.turnId!==params.turnId)){client.resolveInput(requestId,true);return;}
  controller.noteRequest(run,'input:'+requestId,'사용자에게 질문을 보냈어요');
  controller.emitEvent({type:'input',sessionId:run.sessionId,requestId,questions:params.questions,isBlocking:params.isBlocking,text:'Codex가 사용자에게 질문했습니다.'});
 });
 client.on('inputResolved',({requestId})=>controller.emitEvent({type:'inputResolved',sessionId:run.sessionId,requestId}));
 client.on('tool',async({requestId,params})=>{
  try{
   if(controller.runs.get(run.sessionId)!==run||run.finalized||run.cancelled||params.threadId!==run.threadId||(run.turnId&&params.turnId!==run.turnId)||controller.options.canRun?.()===false||run.ownerRevision!==(controller.options.queueOwner?.()??'local'))throw Error('이 작업의 도구 요청은 종료됐습니다.');
   const request=require('./scoped-request.cjs');
   if(params.tool===request.reader.name){client.answerTool(requestId,await request.projectPage(controller.store.session(run.sessionId),run,params.arguments));return;}
   const tools=await controller.options.applicationTools?.(controller.store.session(run.sessionId))||[];
   if(!tools.some(tool=>tool.name===params.tool))throw Error('원래 앱 전용 도구를 Flowrium에서 실행할 수 없습니다. 이 도구가 필요한 작업은 원래 앱에서 이어가 주세요.');
   const result=await controller.options.callApplicationTool?.({sessionId:run.sessionId,name:params.tool,arguments:params.arguments,callId:params.callId});
   client.answerTool(requestId,{contentItems:[{type:'inputText',text:JSON.stringify(result??null)}],success:true});
  }catch(error){client.answerTool(requestId,{contentItems:[{type:'inputText',text:publicMessage(error)}],success:false});}
 });
 client.on('unsupported',()=>controller.emitEvent({type:'error',sessionId:run.sessionId,text:'원래 앱 전용 추가 입력을 Flowrium에서 처리할 수 없어 거절했습니다. 필요한 작업은 원래 앱에서 이어가 주세요.'}));
 client.on('disconnect',error=>{if(!run.finalized && !run.claimingWriter)controller.finish(run,'failed',publicMessage(linkedError(error))).catch(()=>{});});
 let releasing;
 run.releaseClient=()=>releasing??=(async()=>{
  try{if(client.ready&&run.threadId)await client.request('thread/unsubscribe',{threadId:run.threadId},2500).catch(()=>{});}
  finally{
   const proc=client.proc;client.close();
   if(proc&&proc.exitCode===null)await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);proc.off('exit',done);resolve();};proc.once('exit',done);timer=setTimeout(()=>{if(proc.exitCode===null)proc.kill();done();},2500);if(proc.exitCode!==null)done();});
   if(controller.linkedClients.get(run.sessionId)===client)controller.linkedClients.delete(run.sessionId);
   controller.loadedThreads.delete(run.threadId);
  }
 })();
 return client;
}
module.exports={createRunClient,linkedError};
