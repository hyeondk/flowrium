// 실제 번들 Codex의 첨부 입력 / 동적 도구 / 내부 대화 fork와 revert를 로컬 모의 모델로 검증한다.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {CodexClient,resolveCodex}=require('../electron/codex.cjs'),{Controller}=require('../electron/controller.cjs'),{Store}=require('../electron/store.cjs');
const {addAttachments}=require('../electron/chat-attachments.cjs'),{registerConversationTools,threadTurns}=require('../electron/conversation-tools.cjs');
function done(c,id){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.off('event',handler);reject(Error('실제 Codex 작업 완료 대기 시간 초과'));},20000);function handler(e){if(e.type==='done'&&e.sessionId===id){clearTimeout(timer);c.off('event',handler);if(e.status==='completed')resolve(e);else reject(Error(e.text));}}c.on('event',handler);});}
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-native-chat-')),folder=path.join(temp,'project'),profile=path.join(temp,'codex');
 let server,controller,client,failure,workflow,memory;const bodies=[];let toolCalled=false;
 try{
  await fs.mkdir(folder);await fs.mkdir(profile);
  server=http.createServer(async(req,res)=>{try{
   if(req.method!=='POST'||!req.url.startsWith('/v1/responses')){res.writeHead(404).end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());bodies.push(body);
   const number=bodies.length,id='resp_chat_'+number,itemId='item_'+number;
   let item;
   if(number===1){const namespace=(body.tools||[]).find(t=>t.type==='namespace'&&t.tools?.some(v=>v.name==='flowrium_memory_save'));
    assert(namespace||(body.tools||[]).some(t=>t.name==='flowrium_memory_save'),'실제 모델에 앱 도구가 제공돼야 합니다.');
    item={id:itemId,type:'function_call',call_id:'call_echo',name:'flowrium_memory_save',...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify({scope:'project',id:'',revision:'',title:'시험기억',body:'내부도구상태-A',role:''})};
   }else item={id:itemId,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(body.input).includes('합성 프로세스 목록')?JSON.stringify({candidates:[{pid:12345,reason:'합성 실행 자료의 자원 사용 확인'}],summary:'합성 분석 결과'}):'합성 검증 응답 '+number,annotations:[]}]};
   const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='function_call'?{arguments:''}:{content:[]})}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}}];
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  }catch(e){failure=e;res.writeHead(500).end();}});
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const base='http://127.0.0.1:'+server.address().port+'/v1';
  await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium local test"','base_url = '+JSON.stringify(base),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false',''].join('\n'));
  const descriptor=await resolveCodex();assert(descriptor);
  client=new CodexClient({descriptor,spawn:(cmd,args,options)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...options,env:{...options.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:base}})});
  const nativeRequest=client.request.bind(client);
  // 인증 자체는 별도 검사한다. 합성 계정 응답으로 Controller를 통과시키고 모든 대화 RPC는 실제 app-server에 보낸다.
  client.request=(method,params,...rest)=>method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):nativeRequest(method,params,...rest);
  const store=new Store(path.join(temp,'app'));await store.load();const project=await store.addProject(folder),session=await store.createSession(project.id);await store.saveSettings({model:'gpt-5.5'});
  memory=require('../electron/memory.cjs').registerMemory(()=>{},store);
  controller=new Controller(store,{client,applicationTools:s=>workflow.toolsFor(s),callApplicationTool:async input=>{toolCalled=true;return workflow.callTool(input);},canRun:()=>true});
  workflow=new(require('../electron/workflow.cjs').WorkflowRuntime)(store,controller,{memory,canRun:()=>true,accountRevision:()=>0,intervalMs:3600000});
  await controller.connect();const handlers=new Map();registerConversationTools((name,fn)=>handlers.set(name,fn),controller);const edit=handlers.get('editConversation');
  const png=require('./chat-fixtures.cjs').png;
  const attachments=await addAttachments(store,project.id,[{name:'검증화면.png',type:'image/png',bytes:png},{name:'근거.txt',type:'text/plain',bytes:Buffer.from('합성 근거')}]);
  async function send(id,text,extra={}){const completed=done(controller,id);await controller.send({sessionId:id,text,mode:'plan',...extra});await completed;if(failure)throw failure;}
  await send(session.id,'원본첫요청',{attachments:attachments.map(a=>a.id)});
  assert(toolCalled,'동적 도구 응답을 실제 Codex가 요청해야 합니다.');
  assert(/data:image\/[a-z]+;base64,/.test(JSON.stringify(bodies[0])),'localImage가 실제 모델의 이미지 입력으로 변환돼야 합니다. / '+JSON.stringify(bodies[0].input).slice(-1500));
  assert(bodies[1].input.some(i=>i.type==='function_call_output'&&JSON.stringify(i.output).includes('내부도구상태-A')),'앱 도구의 결과가 다음 모델 요청으로 반환돼야 합니다.');
  assert((await memory.listMemory(project.id)).some(n=>n.title==='시험기억'&&n.body==='내부도구상태-A'),'실제 프로젝트 기억 파일이 생성돼야 합니다.');
  await send(session.id,'두번째제외대상');const originalThread=store.session(session.id).threadId;
  const users=store.session(session.id).messages.filter(m=>m.role==='user');assert(users.every(m=>m.turnId));assert.equal((await threadTurns(client,originalThread)).length,2);
  const fork=await edit(session.id,{action:'branch',messageId:users[0].id});assert.notEqual(fork.threadId,originalThread);assert.equal((await threadTurns(client,fork.threadId)).length,1);
  await send(fork.id,'분기후요청');let input=JSON.stringify(bodies.at(-1).input);assert(bodies.at(-1).input.some(i=>i.type==='function_call_output'&&JSON.stringify(i.output).includes('내부도구상태-A')));assert(!input.includes('두번째제외대상'));
  const rewind=await edit(session.id,{action:'rewind',messageId:users[1].id});assert.equal(rewind.restoredDraft.text,'두번째제외대상');assert.notEqual(rewind.threadId,originalThread);
  assert.equal((await threadTurns(client,rewind.threadId)).length,1);assert.equal((await threadTurns(client,originalThread)).length,2,'원본 내부 대화를 보존해야 합니다.');
  await send(session.id,'되감기후요청');input=JSON.stringify(bodies.at(-1).input);assert(bodies.at(-1).input.some(i=>i.type==='function_call_output'&&JSON.stringify(i.output).includes('내부도구상태-A')));assert(!input.includes('두번째제외대상'));
  const restored=new Store(path.dirname(store.file));await restored.load();assert.equal(restored.session(session.id).threadId,store.session(session.id).threadId);assert.equal(restored.session(session.id).messages[0].attachments.length,2);
  const analysis=await controller.runStructuredAnalysis({prompt:'합성 프로세스 목록 [{"pid":12345,"name":"시험서비스","cpu":12,"memory":1024}]',schema:{type:'object',properties:{candidates:{type:'array',items:{type:'object',properties:{pid:{type:'integer'},reason:{type:'string'}},required:['pid','reason'],additionalProperties:false}},summary:{type:'string'}},required:['candidates','summary'],additionalProperties:false}});
  assert.equal(analysis.candidates[0].pid,12345);assert.equal(analysis.summary,'합성 분석 결과');
  const names=(bodies.at(-1).tools||[]).flatMap(t=>t.tools?t.tools.map(x=>x.name):[t.name||t.type]);
  for(const name of ['exec_command','write_stdin','shell','spawn_agent','web_search','flowrium_memory_save'])assert(!names.includes(name),'분석 전용 대화에 외부 실행 도구가 없어야 합니다: '+name);
  assert.equal(controller.analysisRuns.size,0);assert.equal(controller.editingSessions.size,0);
  console.log('번들 Codex 실제 RPC 통과 / 래스터 이미지 모델 입력 / 앱 도구 왕복 / 도구 상태를 포함한 선택 턴 분기 / 실제 revert / 원본 보존 / 재기동 기록 / 파일 읽기 제한 프로필의 구조화 AI 분석');
 }finally{
  await workflow?.shutdown();await controller?.shutdown();client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
