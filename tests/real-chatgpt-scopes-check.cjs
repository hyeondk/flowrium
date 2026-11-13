// 실제 계정 사용은 명시한 수동 검증에서만 실행합니다. 인증 자료를 읽거나 복사하지 않습니다.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs');
const scopes=require('../electron/conversation-scopes.cjs');
async function main(){
 if(process.env.FLOWRIUM_RUN_ACCOUNT_CHECK!=='1')throw Error('실제 ChatGPT 사용량을 사용하는 수동 검사입니다.');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-real-scopes-')),started=Date.now();let controller;
 try{
  const store=new Store(path.join(temporary,'profile'));await store.load();const directory=path.join(temporary,'합성 검증 프로젝트');await fs.mkdir(directory);const project=await store.addProject(directory);
  await store.createSession(project.id,{title:'안내 문구 점검',messages:[{id:require('node:crypto').randomUUID(),role:'assistant',text:'합성 안내 문구 3개를 확인했습니다.',createdAt:new Date().toISOString()}]});
  controller=new Controller(store,{canRun:()=>true,queueOwner:()=>0});const handlers=new Map();scopes.registerConversationScopes((n,f)=>handlers.set(n,f),store,controller,{accountRevision:()=>0,accountOwner:()=> 'isolated-account-validation',workflowAction:()=>{throw Error('실제 검사에서 업무 실행은 허용하지 않습니다.')}});
  const connection=await controller.connect();assert.equal(connection.status.authenticated,true);
  const catalog=connection.models,selected=catalog.find(m=>m.isDefault)||catalog[0];const model=process.env.FLOWRIUM_VALIDATION_MODEL||selected?.id;assert(model);
  const results=[];
  for(const scope of ['general','integrated']){
   const session=await handlers.get('createHubConversation')({scope,title:'실제 계정 범위 검증'}),client=await scopes.scopeClient(controller,session),request=client.request.bind(client);let calls=0;
   // 검증 대화만 비영구로 만들고 제품의 전송 / 제한 프로필 / 도구 처리 경로를 그대로 사용합니다.
   client.request=(method,params)=>request(method,method==='thread/start'?{...params,ephemeral:true}:params);
   const tool=()=>{calls++};client.on('tool',tool);
   const done=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('실제 대화 검증 시간 초과')),90000);const event=e=>{if(e.type==='done'&&e.sessionId===session.id){clearTimeout(timeout);controller.off('event',event);e.status==='completed'?resolve():reject(Error(e.text||'실제 대화 미완료'));}};controller.on('event',event);});done.catch(()=>{});
   await controller.send({sessionId:session.id,mode:'plan',model,effort:'low',text:scope==='general'?'한국어로 "일반 대화 연결을 확인했습니다." 한 문장만 답하세요. 파일과 도구는 사용하지 마세요.':'합성 검증입니다. flowrium_hub_snapshot 도구를 한 번 호출해 등록 프로젝트 수와 안내 문구 점검의 확인 개수를 두 문장으로만 답하세요. 파일 접근과 실행, 업무 제안은 하지 마세요.'});await done;
   const answer=store.session(session.id).messages.filter(m=>m.role==='assistant').at(-1)?.text||'';assert(answer.length>5);assert.equal(calls,scope==='general'?0:1);if(scope==='integrated'){assert.match(answer,/프로젝트[^\n]{0,35}(?:1|한)\s*개/);assert.match(answer,/3\s*개|세\s*개/);assert.match(answer,/안내|문구|점검/);}
   results.push({범위:scope==='general'?'일반 대화':'통합 채팅',도구호출:calls,응답:answer});client.off('tool',tool);client.request=request;
  }
  await fs.writeFile(path.resolve(__dirname,'../docs/validation/actual-chatgpt-scopes.md'),['# 실제 ChatGPT 대화 범위 검사','',`검증 시각 / ${new Date().toISOString()}`,`모델 / ${model}`,`소요 시간 / ${Math.round((Date.now()-started)/1000)}초`,'','임시 앱 프로필과 합성 프로젝트만 사용했습니다. 기존 ChatGPT 로그인을 정상 연결했으며 인증 자료를 복사하지 않았습니다. 검증용 대화는 비영구로 생성했습니다.','',...results.flatMap(r=>['## '+r.범위,'',`앱 도구 호출 / ${r.도구호출}회`,'',r.응답,'']),'일반 대화의 응답과 통합 현황 조회를 실제 모델에서 확인한 검사입니다. 모든 기능과 실제 외부 계정 연동의 확인을 뜻하지 않습니다.',''].join('\n'));
  console.log('실제 ChatGPT 일반 대화 / 통합 현황 동적 도구 / 제한 프로필 통과 / '+Math.round((Date.now()-started)/1000)+'초');
 }finally{await controller?.shutdown();await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
