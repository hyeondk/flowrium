const {CodexClient}=require('./codex.cjs');
const {publicMessage}=require('./errors.cjs');
const closingWriter=/is closing; retry thread\/resume after the thread is closed/i;

function linkedError(error){
 const message=error?.rpcMessage||error?.message||'';
 if(/already has an active writer/i.test(message)||closingWriter.test(message))return Object.assign(Error('Codex에서 원래 대화를 사용 중입니다.'),{code:'THREAD_WRITER_BUSY'});
 return error;
}

async function resumeClosingThread(client, params, check) {
 const deadline=Date.now()+1500;
 for(;;){
  check();
  try{return await client.request('thread/resume',params);}
  catch(error){
   if(!closingWriter.test(error?.rpcMessage||error?.message||''))throw error;
   if(Date.now()>=deadline)throw linkedError(error);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
}
function createRunClient(controller,run){
 const client=controller.options.linkedClientFactory?.(run)||new CodexClient({...controller.client.options});
 if(client===controller.client)throw Error('공유 대화의 별도 실행 연결을 준비하지 못했습니다.');
 controller.linkedClients??=new Map();controller.linkedClients.set(run.sessionId,client);run.client=client;
 client.on('notification',message=>controller.notification(message,client).catch(error=>controller.emitEvent({type:'error',sessionId:run.sessionId,text:publicMessage(error)})));
 client.on('approval',request=>controller.forwardApproval(request,client));
 client.on('input',request=>controller.forwardInput(request,client));
 client.on('inputResolved',request=>controller.forwardInputResolved(request));
 client.on('tool',async({requestId,params})=>{
  try{
   if(params.threadId!==run.threadId||(run.turnId&&params.turnId!==run.turnId)||!controller.canExecuteRun(run))throw Error('이 작업의 도구 요청은 종료됐습니다.');
   const request=require('./scoped-request.cjs');
   if(params.tool===request.reader.name){client.answerTool(requestId,await request.projectPage(controller.store.session(run.sessionId),run,params.arguments));return;}
   if(controller.options.canRun?.()===false)throw Error('잠금 해제 후 앱 기능을 이용해 주세요.');
   const tools=await controller.options.applicationTools?.(controller.store.session(run.sessionId))||[];
   if(!tools.some(tool=>tool.name===params.tool))throw Error('원래 앱 전용 도구를 Flowrium에서 실행할 수 없습니다. 이 도구가 필요한 작업은 원래 앱에서 이어가 주세요.');
   const result=await controller.options.callApplicationTool?.({sessionId:run.sessionId,name:params.tool,arguments:params.arguments,callId:params.callId});
   client.answerTool(requestId,{contentItems:[{type:'inputText',text:JSON.stringify(result??null)}],success:true});
  }catch(error){client.answerTool(requestId,{contentItems:[{type:'inputText',text:publicMessage(error)}],success:false});}
 });
 client.on('unsupported',()=>controller.emitEvent({type:'error',sessionId:run.sessionId,text:'원래 앱 전용 추가 입력을 Flowrium에서 처리할 수 없어 거절했습니다. 필요한 작업은 원래 앱에서 이어가 주세요.'}));
 client.on('disconnect',error=>{if(!run.finalized && !run.claimingWriter)controller.finish(run,'failed',linkedError(error)).catch(()=>{});});
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
module.exports={createRunClient,linkedError,resumeClosingThread};
