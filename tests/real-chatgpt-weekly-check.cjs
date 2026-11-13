// 실제 계정 사용은 수동으로 명시한 경우에만 실행한다. 인증 자료는 읽거나 복사하지 않는다.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {CodexClient}=require('../electron/codex.cjs'),{disabledConnections}=require('../electron/structured-analysis.cjs');
const {Store}=require('../electron/store.cjs'),{registerWorkbench,workContext}=require('../electron/workbench.cjs'),{createProjectTools}=require('../electron/project-ai-tools.cjs');
async function main(){
 if(process.env.FLOWRIUM_RUN_ACCOUNT_CHECK!=='1')throw Error('이 검증은 실제 ChatGPT 사용량을 사용합니다. 승인된 수동 검증에서만 실행하세요.');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-real-weekly-'));let preflight,client,timer;const startedAt=Date.now();let stage='임시 프로젝트 준비';let model='',saved,toolCalls=0,finalText='';
 const evidenceDir=path.resolve(__dirname,'../docs/validation'),profile='flowrium_report_'+randomUUID().replaceAll('-','');
 try{
  const folder=await fs.realpath(await fs.mkdir(path.join(dir,'project'),{recursive:true}).then(()=>path.join(dir,'project')));
  const store=new Store(path.join(dir,'profile'));await store.load();const project=await store.addProject(folder),handlers=new Map();registerWorkbench((name,fn)=>handlers.set(name,fn),store,{reveal:()=>{}});const tools=createProjectTools({handlers,store});
  const at=new Date().toISOString();
  for(const [title,summary]of [['검증 자료 정리','더미 화면 체크리스트 3개를 정리하고 누락 여부를 확인했습니다.'],['안내 문구 검토','더미 안내 문장의 어절 줄바꿈과 용어 2개를 확인했습니다.']])await store.createSession(project.id,{title,workflow:{kind:'task',status:'done',role:'검증 담당',brief:'사용자 자료가 아닌 합성 검증 업무',audience:'',from:'',to:'',checklist:[],completion:{at,summary,commits:[]}}});
  stage='기본 인증 연결';preflight=new CodexClient();await preflight.start();stage='계정 읽기';const account=await preflight.request('account/read',{refreshToken:false});if(account.account?.type!=='chatgpt')throw Error('현재 기본 인증이 ChatGPT 로그인 방식이 아니어서 실제 계정 검증을 중단했습니다.');
  stage='설정과 모델 목록';const [config,catalog]=await Promise.all([preflight.request('config/read',{includeLayers:false}),preflight.request('model/list',{includeHidden:false})]);
  const models=catalog.data||[],selected=models.find(m=>/mini/.test(m.id)&&!m.hidden)||models.find(m=>m.isDefault)||models[0];model=process.env.FLOWRIUM_VALIDATION_MODEL||selected?.model||selected?.id;if(!model)throw Error('사용할 수 있는 모델을 확인하지 못했습니다.');
  const selectedModel=models.find(m=>m.model===model||m.id===model),efforts=(selectedModel?.supportedReasoningEfforts||[]).map(v=>v.reasoningEffort);const effort=efforts.includes('low')?'low':selectedModel?.defaultReasoningEffort||'medium';
  const overrides=disabledConnections(config.config);preflight.close();preflight=null;
  const session=await handlers.get('startWork')({projectId:project.id,kind:'weekly',title:'격리 검증 주간업무보고',model,reportProjects:[project.id]});
  const context=await workContext(store,session.id);assert(context.includes('더미 화면 체크리스트'));
  stage='격리 모델 연결';client=new CodexClient({configOverrides:overrides});await client.start();
  let threadId,end,fail;const done=new Promise((resolve,reject)=>{end=resolve;fail=reject});done.catch(()=>{});
  const abort=message=>{client.close();fail(Error(message))};
  client.on('disconnect',()=>fail(Error('실제 모델 검증 연결이 종료됐습니다.')));
  client.on('approval',({requestId})=>{client.decide(requestId,'decline');abort('범위 밖의 실행 권한 요청을 거절했습니다.')});
  client.on('input',({requestId})=>{client.resolveInput(requestId,true);abort('실제 모델 검증의 추가 입력 요청을 중단했습니다.')});
  client.on('tool',async({requestId,params})=>{
    try{
      if(params.threadId!==threadId||params.tool!=='flowrium_project_artifact_create'||++toolCalls!==1)throw Error('허용하지 않은 도구 또는 중복 저장 요청입니다.');
      if(params.arguments?.format!=='md'||typeof params.arguments.body!=='string'||params.arguments.body.length>16000)throw Error('주간보고 산출물 형식이 올바르지 않습니다.');
      saved=await tools.call({sessionId:session.id,name:params.tool,arguments:params.arguments});
      client.answerTool(requestId,{success:true,contentItems:[{type:'inputText',text:JSON.stringify(saved)}]});
    }catch(e){client.answerTool(requestId,{success:false,contentItems:[{type:'inputText',text:'허용된 검증 산출물을 저장하지 못했습니다.'}]});abort(e.message)}
  });
  client.on('notification',message=>{
    if(message.params?.threadId!==threadId)return;
    if(message.method==='item/started'&&!['reasoning','userMessage','agentMessage','dynamicToolCall','compaction','contextCompaction'].includes(message.params.item?.type))abort('검증 범위 밖의 내장 도구 실행을 중단했습니다.');
    if(message.method==='item/completed'&&message.params.item?.type==='agentMessage')finalText=message.params.item.text||'';
    if(message.method==='turn/completed')end(message.params.turn);
  });
  stage='비영구 대화 생성';const result=await client.request('thread/start',{ephemeral:true,cwd:folder,model,permissions:profile,approvalPolicy:'never',
    developerInstructions:'한국어로 합성 검증 자료만 처리하세요. 명령 / 외부 연결 / 일반 파일 도구를 사용하지 마세요. 완성 보고서 저장은 제공된 Flowrium 산출물 동적 도구 한 번만 사용하세요.',
    config:{permissions:{[profile]:{filesystem:{':root':'deny',':minimal':'read',':tmpdir':'deny',':slash_tmp':'deny',[folder]:'read'},network:{enabled:false}}},web_search:'disabled',project_doc_max_bytes:0},
    dynamicTools:tools.definitions.filter(t=>t.name==='flowrium_project_artifact_create').map(t=>({type:'function',...t}))});
  assert.equal(result.activePermissionProfile?.id,profile);threadId=result.thread.id;
  timer=setTimeout(()=>abort('실제 주간보고 생성 3분 상한을 넘겨 중단했습니다.'),Math.max(1000,180000-(Date.now()-startedAt)));timer.unref?.();
  stage='보고 생성 요청';await client.request('turn/start',{threadId,approvalPolicy:'never',permissions:profile,effort,input:[{type:'text',text:'사용자가 승인한 기능 검증입니다. 실제 사용자 자료가 없는 아래 합성 완료 업무 2개만 근거로 한국어 주간업무보고를 400~900자 내외로 작성하세요. 완료한 일 / 검증 결과 / 다음 확인할 일을 구분하고, 근거에 없는 성과·날짜·커밋·수치·외부 활동을 꾸며내지 마세요. 외부 조회와 명령 실행, 파일 도구는 금지합니다. 본문이 완성되면 flowrium_project_artifact_create 도구를 정확히 한 번 호출하여 title="주간업무보고 검증", format="md", body=완성 마크다운으로 실제 저장하세요. 마지막 답변에는 저장 결과만 짧게 확인하세요.\n\n합성 자료:\n'+context}]});
  stage='보고와 산출물 응답';const turn=await done;assert.equal(turn.status,'completed',turn.error?.message||'주간보고 생성 미완료');assert.equal(toolCalls,1);assert(saved?.artifact?.path);const report=await fs.readFile(path.join(folder,...saved.artifact.path.split('/')),'utf8');assert(report.includes('검증 자료')||report.includes('체크리스트'));assert(report.includes('안내')||report.includes('줄바꿈'));assert(!/sk-[A-Za-z0-9]{20,}|access_token|refresh_token|Bearer\s+[A-Za-z0-9._-]{20,}/.test(report));
  await fs.mkdir(evidenceDir,{recursive:true});await fs.writeFile(path.join(evidenceDir,'actual-chatgpt-weekly.md'),report);
  const summary=['# 실제 ChatGPT 주간보고 검증','',`- 실행 시각: ${new Date().toISOString()}`,`- 결과: 통과`,`- 모델: ${model}`,`- 소요 시간: ${Math.round((Date.now()-startedAt)/1000)}초`,'- 인증: 기존 ChatGPT 로그인의 정상 읽기 / 인증 자료 복사 없음','- 범위: 새 임시 프로젝트와 앱 프로필 / 합성 완료 업무 2개 / 비영구 대화','- 권한: 호스트 파일 접근 제한 / 명령·외부 도구 거절 / 추가 API 키 없음',`- 실제 도구 호출: flowrium_project_artifact_create ${toolCalls}회`,'- 결과: 모델 생성 → 동적 도구 호출 → 도구 응답 → 프로젝트 파일 저장 확인','- 보존: 합성 보고서와 이 검증 요약만 보존 / 임시 프로젝트 정리','- 제한: 실제 휴대폰 Push 수신과 Windows 설치는 이 검증 범위에 포함되지 않음',''].join('\n');await fs.writeFile(path.join(evidenceDir,'actual-chatgpt-weekly-check.md'),summary);
  console.log('실제 ChatGPT 주간보고 생성 / 동적 산출물 도구 / 파일 저장 검증 통과 / 모델 '+model+' / '+Math.round((Date.now()-startedAt)/1000)+'초');
 }catch(error){throw Error(stage+" / "+error.message)}finally{clearTimeout(timer);preflight?.close();client?.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
}
main().catch(error=>{console.error('실제 ChatGPT 주간보고 검증 결과: '+error.message);process.exitCode=1});
