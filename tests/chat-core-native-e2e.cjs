const {addTrustedFixtureProject} = require('./project-trust-fixture.cjs');
const {createLargeRequest} = require('./large-request-fixture.cjs');
// 실제 번들 Codex의 첨부 입력 / 동적 도구 / 내부 대화 fork와 revert를 로컬 모의 모델로 검증한다.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {CodexClient,resolveCodex}=require('../electron/codex.cjs'),{Controller}=require('../electron/controller.cjs'),{Store}=require('../electron/store.cjs');
const {addAttachments}=require('../electron/chat-attachments.cjs'),{registerConversationTools,threadTurns}=require('../electron/conversation-tools.cjs');
function done(c,id,timeout=20000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.off('event',handler);reject(Error('실제 Codex 작업 완료 대기 시간 초과'));},timeout);function handler(e){if(e.type==='done'&&e.sessionId===id){clearTimeout(timer);c.off('event',handler);if(e.status==='completed')resolve(e);else reject(Error(e.text));}}c.on('event',handler);});}
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-native-chat-')),folder=path.join(temp,'project'),profile=path.join(temp,'codex');
 let server,controller,client,failure,workflow,memory;const bodies=[];let toolCalled=false,longProbe;
 try{
  await fs.mkdir(folder);await fs.mkdir(profile);
  server=http.createServer(async(req,res)=>{try{
   if(req.method!=='POST'||!req.url.startsWith('/v1/responses')){res.writeHead(404).end();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());bodies.push(body);
   const number=bodies.length,id='resp_chat_'+number,itemId='item_'+number;
   let item,batch;
   if(number===1){const namespace=(body.tools||[]).find(t=>t.type==='namespace'&&t.tools?.some(v=>v.name==='flowrium_memory_save'));
    assert(namespace||(body.tools||[]).some(t=>t.name==='flowrium_memory_save'),'실제 모델에 앱 도구가 제공돼야 합니다.');
    item={id:itemId,type:'function_call',call_id:'call_echo',name:'flowrium_memory_save',...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify({scope:'project',id:'',revision:'',title:'시험기억',body:'내부도구상태-A',role:''})};
   }else if(longProbe){
    const name='flowrium_read_current_request';
    const namespace=(body.tools||[]).find(t=>t.type==='namespace' && t.tools.some(tool=>tool.name===name));
    assert(namespace || body.tools.some(t=>t.name===name));
    if(!longProbe.sent){
     const prompt=JSON.stringify(body.input);
     assert(!prompt.includes(longProbe.head) && !prompt.includes('.flowrium/attachments/'));
     if(longProbe.probes) assert(prompt.includes(longProbe.digest));
    }
    for(const receipt of body.input.filter(row=>row.type==='function_call_output' && row.call_id.startsWith('read_project_'))){
     if(longProbe.seen.has(receipt.call_id))continue;
     let content=typeof receipt.output==='string'?JSON.parse(receipt.output):receipt.output;
     if(Array.isArray(content))content=JSON.parse(content[0].text);
     assert.equal(content.pages,longProbe.pages);
     assert.equal(content.sha256,longProbe.digest);
     assert.equal(receipt.call_id,'read_project_'+content.page);
     if(longProbe.probes){
      const probe=longProbe.probes.find(p=>p.page===content.page);
      assert(probe,'요청한 세 부분만 모델에 전달합니다.');
      assert.equal(content.text,longProbe.source.slice((probe.page-1)*longProbe.pageSize,probe.page*longProbe.pageSize));
      assert.equal(content.text.indexOf(probe.marker)+(probe.page-1)*longProbe.pageSize,probe.offset);
      const start=content.text.indexOf(probe.marker);
      longProbe.markers.push(content.text.slice(start,start+probe.marker.length));
     }
     longProbe.parts[content.page-1]=content.text;
     longProbe.seen.add(receipt.call_id);
    }
    const requested=longProbe.probes?.length ?? longProbe.pages;
    if(longProbe.sent<requested){
     const count=longProbe.probes?1:Math.min(12,requested-longProbe.sent);
     batch=Array.from({length:count},()=>{
      const index=longProbe.sent++;
      const page=longProbe.probes?longProbe.probes[index].page:index+1;
      return {id:itemId+'_'+page,type:'function_call',call_id:'read_project_'+page,name,...(namespace&&{namespace:namespace.name}),arguments:JSON.stringify({page})};
     });
    }else{
     assert.equal(longProbe.seen.size,requested);
     const answer=longProbe.markers?.join(' / ') ?? '긴 입력 전체 검증 완료';
     item={id:itemId,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
    }
   }else item={id:itemId,type:'message' ,role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(body.input).includes('합성 프로세스 목록')?JSON.stringify({candidates:[{pid:12345,reason:'합성 실행 자료의 자원 사용 확인'}],summary:'합성 분석 결과'}):'합성 검증 응답 '+number,annotations:[]}]};
   const output=batch||[item];
   const events=[{type:'response.created',response:{id,status:'in_progress'}},
    ...output.flatMap((entry,index)=>[
     {type:'response.output_item.added',output_index:index,item:{...entry,...(entry.type==='function_call'?{arguments:''}:{content:[]})}},
     {type:'response.output_item.done',output_index:index,item:entry}
    ]),
    {type:'response.completed',response:{id,status:'completed',output,usage:{input_tokens:20,output_tokens:10,total_tokens:30}}}];
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  }catch(e){failure=e;res.writeHead(400).end();}});
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const base='http://127.0.0.1:'+server.address().port+'/v1';
  await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium local test"','base_url = '+JSON.stringify(base),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false',''].join('\n'));
  const descriptor=await resolveCodex();assert(descriptor);
  client=new CodexClient({descriptor,spawn:(cmd,args,options)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...options,env:{...options.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:base}})});
  const nativeRequest=client.request.bind(client);
  // 인증 자체는 별도 검사한다. 합성 계정 응답으로 Controller를 통과시키고 모든 대화 RPC는 실제 app-server에 보낸다.
  client.request=(method,params,...rest)=>method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):nativeRequest(method,params,...rest);
  const store=new Store(path.join(temp,'app'));await store.load();const project=await addTrustedFixtureProject(store, folder),session=await store.createSession(project.id);await store.saveSettings({model:'gpt-5.5'});
  memory=require('../electron/memory.cjs').registerMemory(()=>{},store);
  controller=new Controller(store,{client,applicationTools:s=>workflow.toolsFor(s),callApplicationTool:async input=>{toolCalled=true;return workflow.callTool(input);},canRun:()=>true});
  workflow=new(require('../electron/workflow.cjs').WorkflowRuntime)(store,controller,{memory,canRun:()=>true,accountRevision:()=>0,intervalMs:3600000});
  await controller.connect();const handlers=new Map();registerConversationTools((name,fn)=>handlers.set(name,fn),controller);const edit=handlers.get('editConversation');
  const png=require('./chat-fixtures.cjs').png;
  const attachments=await addAttachments(store,project.id,[{name:'검증화면.png',type:'image/png',bytes:png},{name:'근거.txt',type:'text/plain',bytes:Buffer.from('합성 근거')}]);
  async function send(id,text,extra={}){const completed=done(controller,id,longProbe?120000:20000);await controller.send({sessionId:id,text,mode:'plan',...extra},{fromComposer:true});await completed;if(failure)throw failure;}
  await send(session.id,'원본첫요청',{attachments:attachments.map(a=>a.id)});
  assert.doesNotMatch(JSON.stringify(bodies[0].input),/미완료 작업/,'실제 모델 입력에 추천용 지시를 덧붙이지 않습니다.');
  assert.equal(store.session(session.id).messages.find(row=>row.role==='user').text,'원본첫요청');
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
  const large=await store.createSession(project.id);
  const edge='START_REQUEST_LONG__',mid='MIDDLE_REQUEST____',end='END_REQUEST_________';
  const source=[edge,' '.repeat(1_070_000),mid,' '.repeat(1_070_000),end].join('\n');
  assert.equal(source.indexOf(mid),(source.length-mid.length)/2);
  const digest=require('node:crypto').createHash('sha256').update(source).digest('hex');
  longProbe={head:edge,pages:Math.ceil(source.length/12000),sent:0,seen:new Set(),parts:[],digest};
  const submissionId=require('node:crypto').randomUUID();
  await send(large.id,source,{submissionId});
  const received=longProbe.parts.join('');
  assert.equal(received.length,source.length);
  assert(received.startsWith(edge) && received.slice(source.indexOf(mid)).startsWith(mid) && received.endsWith(end));
  assert.equal(require('node:crypto').createHash('sha256').update(received).digest('hex'),digest);
  assert(received===source,'모델이 받은 모든 부분을 순서대로 합치면 사용자가 보낸 원문과 일치해야 합니다.');
  console.log('합성 모델로 전달된 요청 원문 전체 / '+longProbe.pages+'부분 SHA-256 대조 통과');
  longProbe=null;
  const row=store.session(large.id).messages.find(m=>m.id===submissionId);
  assert(row.sourceOnly && row.requestSource.sha256===digest);
  const repeat=await controller.send({sessionId:large.id,text:source,submissionId,mode:'plan'});assert(repeat.accepted);
  assert.equal(store.session(large.id).messages.filter(m=>m.role==='user').length,1);
  const reopened=new Store(path.dirname(store.file));await reopened.load();
  const saved=await require('../electron/chat-long-request.cjs').readRequestSource(reopened,large.id,row.id,'full');assert.equal(saved.text,source);
  console.log('프로젝트 214만 자 단일 턴 / 번들 Codex 실제 입력 페이지 읽기 / 합성 모델에 앞·중간·끝과 전체 SHA-256 반환 / 동일 요청 재전송 억제 / 재기동 원문 전수 대조 통과');
  const sample=createLargeRequest(), sampled=await store.createSession(project.id);
  longProbe={head:sample.probes[0].marker,pages:sample.pages,probes:sample.probes,source:sample.text,pageSize:sample.pageSize,sent:0,seen:new Set(),parts:[],markers:[],digest:sample.sha256};
  await send(sampled.id,sample.text);
  assert.equal(longProbe.sent,3);assert.equal(longProbe.seen.size,3);
  const sessionAfter=new Store(path.dirname(store.file));await sessionAfter.load();
  const sampledStored=sessionAfter.session(sampled.id),sampledUsers=sampledStored.messages.filter(m=>m.role==='user'),answers=sampledStored.messages.filter(m=>m.role==='assistant');
  const expected=sample.probes.map(probe=>probe.marker).join(' / ');
  assert.equal(sampledUsers.length,1);assert.equal(answers.length,1);assert.equal(answers[0].text,expected);
  const request=sampledUsers[0];assert.equal(request.requestSource.size,sample.byteLength);assert.equal(request.requestSource.sha256,sample.sha256);
  const original=await require('../electron/chat-long-request.cjs').readRequestSource(sessionAfter,sampled.id,request.id,'full');
  assert.equal(require('node:crypto').createHash('sha256').update(original.text).digest('hex'),sample.sha256);
  const turns=await threadTurns(client,sampledStored.threadId);assert.equal(turns.length,1);assert.equal(turns[0].id,request.turnId);assert.equal(turns[0].status,'completed');
  const items=(await require('../electron/codex-transfer-data.cjs').itemPages(client,sampledStored.threadId,turns[0].id)).map(entry=>entry.item||entry);
  assert.equal(items.filter(item=>item.type==='userMessage').length,1);
  assert.deepEqual(items.filter(item=>item.type==='agentMessage').map(item=>item.text),[expected]);
  longProbe=null;
  console.log('프로젝트 혼합 한글·이모지 원문 '+sample.byteLength+'바이트 / '+sample.pages+'부분 중 처음·중간·끝의 위치와 내용 / 재시작 원문 SHA-256 / 한 턴과 한 답변 통과');
  console.log('번들 Codex 실제 RPC 통과 / 래스터 이미지 모델 입력 / 앱 도구 왕복 / 도구 상태를 포함한 선택 턴 분기 / 실제 revert / 원본 보존 / 재기동 기록 / 파일 읽기 제한 프로필의 구조화 AI 분석');
 }finally{
  await workflow?.shutdown();await controller?.shutdown();client?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
