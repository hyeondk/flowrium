// 실제 번들 app-server로 일반 / 통합 대화, 제한 프로필, 첨부, 분기, 되감기를 검증한다.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {CodexClient,resolveCodex}=require('../electron/codex.cjs'),{Controller}=require('../electron/controller.cjs'),{Store}=require('../electron/store.cjs');
const {addAttachments}=require('../electron/chat-attachments.cjs'),{registerConversationTools,threadTurns}=require('../electron/conversation-tools.cjs'),{registerConversationScopes}=require('../electron/conversation-scopes.cjs');
function done(c,id){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.off('event',handler);reject(Error('대화 완료 대기 시간 초과'));},20000);function handler(e){if(e.type==='done'&&e.sessionId===id){clearTimeout(timer);c.off('event',handler);if(e.status==='completed')resolve(e);else reject(Error(e.text));}}c.on('event',handler);});}
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-native-hub-')),folder=path.join(temp,'project'),profile=path.join(temp,'codex');
 let server,controller,client,failure;const bodies=[];let delegated=0,projectId,patchAttempted=false;
 try{
  await fs.mkdir(folder);await fs.mkdir(profile);await fs.writeFile(path.join(folder,'protected.txt'),'원본 보존');
  server=http.createServer(async(req,res)=>{try{
   if(req.method!=='POST'||!req.url.startsWith('/v1/responses')){res.writeHead(404).end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());bodies.push(body);
   const number=bodies.length,id='resp_hub_'+number,itemId='item_'+number,names=(body.tools||[]).flatMap(t=>t.tools?t.tools.map(v=>v.name):[t.name||t.type]);
   for(const name of ['exec_command','write_stdin','shell','spawn_agent','web_search','flowrium_chat_send','flowrium_memory_save','read_file','list_dir','view_image'])assert(!names.includes(name),'제한 대화의 외부 실행 도구: '+name);
   const namespace=(body.tools||[]).find(t=>t.type==='namespace'&&t.tools?.some(v=>v.name==='flowrium_hub_snapshot'));
   const integrated=names.includes('flowrium_hub_snapshot'),outputs=body.input.filter(v=>v.type==='function_call_output');let item;
   if(JSON.stringify(body.input).includes('차단시도')&&!patchAttempted){patchAttempted=true;item={id:itemId,type:'custom_tool_call',call_id:'blocked-patch',name:'apply_patch',input:'*** Begin Patch\n*** Update File: '+path.join(folder,'protected.txt')+'\n@@\n-원본 보존\n+변경 시도\n*** End Patch'};}
   else if(integrated&&outputs.length<2){const name=outputs.length?'flowrium_hub_delegate':'flowrium_hub_snapshot';item={id:itemId,type:'function_call',call_id:'hub_call_'+outputs.length,name,...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify(outputs.length?{projectId,title:'승인할 업무',text:'테스트 프로젝트 수정 요청'}:{query:''})};}
   else item={id:itemId,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'범위 검증 응답 '+number,annotations:[]}]};
   const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='function_call'?{arguments:''}:{content:[]})}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}}}];
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  }catch(e){failure=e;console.error(e.message);res.writeHead(500).end();}});
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const base='http://127.0.0.1:'+server.address().port+'/v1';
  await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium local test"','base_url = '+JSON.stringify(base),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false',''].join('\n'));
  const descriptor=await resolveCodex();assert(descriptor);
  client=new CodexClient({descriptor,spawn:(cmd,args,options)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...options,env:{...options.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:base}})});
  const nativeRequest=client.request.bind(client);
  // 인증 자체는 별도 검사한다. 합성 계정 응답으로 Controller를 통과시키고 모든 대화 RPC는 실제 app-server에 보낸다.
  client.request=(method,params,...rest)=>method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):nativeRequest(method,params,...rest);
  const store=new Store(path.join(temp,'app'));await store.load();const project=await store.addProject(folder);projectId=project.id;await store.createSession(project.id,{title:'실제 프로젝트 업무'});await store.saveSettings({model:'gpt-5.5'});
  controller=new Controller(store,{client,canRun:()=>true,queueOwner:()=>0,applicationTools:()=>{throw Error('제한 대화에서 프로젝트 도구를 가져오면 안 됩니다.');}});
  controller.on('event',event=>{if(event.type==='error')console.error(event.text);});
  const handlers=new Map(),register=(name,fn)=>handlers.set(name,fn);registerConversationScopes(register,store,controller,{accountRevision:()=>0,workflowAction:async input=>{assert.equal(input.action,'request');assert.equal(input.projectId,project.id);delegated++;return{id:'test-proposal',status:'pending'};}});registerConversationTools(register,controller);
  const general=await handlers.get('createHubConversation')({scope:'general'}),hub=await handlers.get('createHubConversation')({scope:'integrated'}),edit=handlers.get('editConversation');
  await edit(general.id,{action:'preferences',preferences:{sandbox:'danger-full-access',approval:'on-request',networkAccess:true}});
  const attachments=await addAttachments(store,general.projectId,[{name:'근거.txt',type:'text/plain',bytes:Buffer.from('명시적 첨부 근거 ABC')},{name:'화면.png',type:'image/png',bytes:require('./chat-fixtures.cjs').png}]);
  async function send(id,text,extra={}){const completed=done(controller,id);await controller.send({sessionId:id,text,mode:'build',...extra});await completed;if(failure)throw failure;}
  await send(general.id,'일반첫요청',{attachments:attachments.map(a=>a.id)});assert(JSON.stringify(bodies[0]).includes('명시적 첨부 근거 ABC'));assert(/data:image\/[a-z]+;base64,/.test(JSON.stringify(bodies[0])));
  assert(!JSON.stringify(bodies[0]).includes('실제 프로젝트 업무'),'일반 대화에 프로젝트 내용이 없어야 합니다.');
  await send(general.id,'두번째제외대상');const original=store.session(general.id).threadId,users=store.session(general.id).messages.filter(m=>m.role==='user');
  const fork=await edit(general.id,{action:'branch',messageId:users[0].id});assert.equal(fork.scope,'general');assert.equal(fork.projectId,general.projectId);assert.notEqual(fork.threadId,original);await send(fork.id,'분기후요청');assert(!JSON.stringify(bodies.at(-1)).includes('두번째제외대상'));
  const rewind=await edit(general.id,{action:'rewind',messageId:users[1].id});assert.equal(rewind.restoredDraft.text,'두번째제외대상');await send(general.id,'되감기후요청');assert(!JSON.stringify(bodies.at(-1)).includes('두번째제외대상'));
  const privateClient=await controller.conversationClient(store.session(general.id));assert.equal((await threadTurns(privateClient,original)).length,2,'원본 실행 기록을 보존해야 합니다.');
  await send(hub.id,'모든 프로젝트 현황을 보고 업무를 제안해 줘');assert.equal(delegated,1);assert.equal(store.state.sessions.length,1,'승인 전에 프로젝트 업무 대화를 만들지 않습니다.');
  const integrated=bodies.filter(b=>JSON.stringify(b).includes('flowrium_hub_snapshot'));assert(integrated.some(b=>JSON.stringify(b.input).includes('실제 프로젝트 업무')));assert(integrated.some(b=>b.input.some(i=>i.type==='function_call_output'&&JSON.stringify(i.output).includes('결정함'))));
  const guarded=await handlers.get('createHubConversation')({scope:'general'});await send(guarded.id,'차단시도 / 프로젝트 파일을 변경해 줘');assert(patchAttempted);assert.equal(await fs.readFile(path.join(folder,'protected.txt'),'utf8'),'원본 보존');
  const patchOutputs=[...new Set(bodies.flatMap(body=>body.input||[]).filter(item=>['custom_tool_call_output','function_call_output'].includes(item.type)&&item.call_id==='blocked-patch').map(item=>JSON.stringify({type:item.type,call_id:item.call_id,output:item.output})))];
  const patchDiagnostic=(patchOutputs.length?patchOutputs.join('\n'):'blocked-patch의 도구 반환 항목을 찾지 못했습니다.').slice(0,2000);
  assert(bodies.at(-1).input.some(i=>['custom_tool_call_output','function_call_output'].includes(i.type)&&/reject|denied|not allowed|not permitted|permission|refusing to run unsandboxed/i.test(JSON.stringify(i))),'파일 변경 도구의 거부 결과가 모델에 반환돼야 합니다.\n합성 파일 변경 도구 반환 진단 (최대 2000자):\n'+patchDiagnostic);
  const restored=new Store(path.join(temp,'app'));await restored.load();restored.conversations.getOwner=()=>0;await restored.syncConversationOwner();assert.equal(restored.session(general.id).threadId,store.session(general.id).threadId);assert.equal(restored.session(fork.id).scope,'general');
  console.log('번들 Codex 실제 RPC 통과 / 일반 대화의 프로젝트 격리 / 외부 실행 도구 미노출 / 위험 설정 강제 제한과 실제 파일 변경 시도 차단 / 첨부 텍스트와 이미지 모델 입력 / 실제 분기와 되감기 / 통합 현황 조회와 승인 대기 제안 / 재시작 영속 저장');
 }finally{
  await controller?.shutdown();client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
