const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { CodexClient, resolveCodex } = require('../electron/codex.cjs');
const { Store } = require('../electron/store.cjs');
const { Controller } = require('../electron/controller.cjs');
const { CodexTransfer } = require('../electron/codex-transfer.cjs');
const D = require('../electron/codex-transfer-data.cjs');
const monitor = require('../electron/chat-sync-monitor.cjs');

function onceEvent(emitter, event, matches) {
  const result=new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); emitter.off(event, listen); };
    const listen = value => { if(matches(value)){ stop(); resolve(value); } };
    const timer = setTimeout(() => { stop(); reject(Error('동기화 시험 응답 시간 초과')); }, process.platform==='win32'?45000:30000);
    emitter.on(event, listen);
  });
  result.catch(()=>{});
  return result;
}

async function resumeWhenReleased(client,params) {
  const limit=Date.now()+20000;
  for(;;){
    try{return await client.request('thread/resume',params);}
    catch(error){
      if(Date.now()>=limit||require('../electron/codex-transfer-client.cjs').linkedError(error).code!=='THREAD_WRITER_BUSY')throw error;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
  }
}

async function main() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-desktop-sync-')));
  const profile = path.join(root,'codex'), cwd = path.join(root,'project');
  let server, controller, runtime, desktop, primary, reader;
  let requests = 0, hold;
  try {
    await fs.mkdir(profile); await fs.mkdir(cwd);
    server = http.createServer(async (req,res) => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/responses')) {res.writeHead(404).end();return;}
      for await (const unused of req) {}
      if(hold){const gate=hold;hold=undefined;gate.started.resolve();await gate.release.promise;}
      const id='resp_sync_'+(++requests);
      const item={id:'answer_'+requests,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'동기화 응답 '+requests,annotations:[]}]};
      const events=[
        {type:'response.created',response:{id,status:'in_progress'}},
        {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
        {type:'response.output_item.done',output_index:0,item},
        {type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:5,output_tokens:5,total_tokens:10}}}
      ];
      res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address='http://127.0.0.1:'+server.address().port+'/v1';
    await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium local test"','base_url = '+JSON.stringify(address),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false',''].join('\n'));
    const descriptor=await resolveCodex();assert(descriptor);
    function makeClient() {
      const client=new CodexClient({descriptor,spawn:(cmd,args,opts)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...opts,env:{...opts.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-local-only',OPENAI_BASE_URL:address}})});
      const request=client.request.bind(client);
      client.request=(method,...args)=>method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):request(method,...args);
      return client;
    }
    primary=makeClient();reader=makeClient();desktop=makeClient();
    let store=new Store(path.join(root,'flowrium'));await store.load();
    const project=await store.addProject(cwd),session=await store.createSession(project.id);
    await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client:primary,canRun:()=>true});
    runtime=new CodexTransfer(store,controller,{readClient:reader,accountOwner:()=> 'synthetic',canRun:()=>true});
    await controller.connect();
    async function send(text) {
      const done=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===session.id);
      await controller.send({sessionId:session.id,text,mode:'plan'});assert.equal((await done).status,'completed');
    }
    await send('첫 번째 로컬 요청');
    const live=store.session(session.id),id=live.threadId;
    assert.equal(live.desktopThread.threadId,id);
    await desktop.start();
    const first=await D.snapshot(desktop,id,cwd);
    assert.equal(first.thread.name,'첫 번째 로컬 요청');
    assert.deepEqual(first.messages.filter(m=>m.role==='user').map(m=>m.text),['첫 번째 로컬 요청']);
    assert(first.messages.some(m=>m.text==='동기화 응답 1'));
    await resumeWhenReleased(desktop,{threadId:id,excludeTurns:true,cwd,approvalPolicy:'never',sandbox:'read-only'});
    // There is no renderer and no selected chat. Only the main process monitor
    // can bring the source user's request and the subsequent answer into view.
    const done=onceEvent(desktop,'notification',e=>e.method==='turn/completed'&&e.params.threadId===id);
    const remoteStarted=Promise.withResolvers(),remoteRelease=Promise.withResolvers();
    hold={started:remoteStarted,release:remoteRelease};
    const externalText='상대 앱에서 작성한 요청';
    const received=text=>onceEvent(controller,'event',e=>e.sessionId===session.id&&(
      e.type==='session'&&e.session.messages.some(m=>m.text===text) ||
      e.type==='externalTurn'&&e.turnMessages.some(m=>m.text===text)
    ));
    monitor.start(runtime);
    const incomingUser=received(externalText);
    await desktop.request('turn/start',{threadId:id,input:[{type:'text',text:externalText}]});
    try{
      await remoteStarted.promise;
      assert.equal((await incomingUser).type,'externalTurn');
      assert.equal(runtime.liveView(live).messages.filter(m=>m.text===externalText).length,1);
      assert(!live.messages.some(m=>m.text===externalText));
    }finally{remoteRelease.resolve();}
    const incomingReply=received('동기화 응답 2');
    assert.equal((await done).params.turn.status,'completed');
    await incomingReply;
    await monitor.scan(runtime);
    await monitor.stop(runtime);
    assert.deepEqual(live.messages.filter(m=>m.role!=='system').map(m=>m.text),['첫 번째 로컬 요청','동기화 응답 1',externalText,'동기화 응답 2']);
    await desktop.request('thread/unsubscribe',{threadId:id});
    console.log('화면과 선택 대화 없는 자동 동기화 / 상대 작업 중 입력 수신 / 같은 원본에서 최종 답변과 정확한 순서 및 중복 없음');
    await send('다시 Flowrium에서 이어 쓰는 요청');
    const roundTrip=(await D.snapshot(desktop,id,cwd)).messages.filter(m=>m.role!=='system').map(m=>m.text);
    assert.deepEqual(roundTrip,['첫 번째 로컬 요청','동기화 응답 1',externalText,'동기화 응답 2','다시 Flowrium에서 이어 쓰는 요청','동기화 응답 3']);
    assert.equal(requests,3);
    // The other desktop connection is closed. Only Flowrium and its bundled
    // app server handle this request, real-time steering, and the resulting turn.
    desktop.close();
    const started=Promise.withResolvers(),release=Promise.withResolvers();hold={started,release};
    const complete=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===session.id);
    await controller.send({sessionId:session.id,mode:'plan',text:'혼자 실행한 작업'});
    try {
      await started.promise;
      const active=controller.runs.get(session.id);
      assert(active.turnId);
      const result=await controller.send({sessionId:session.id,mode:'plan',text:'현재 작업에 추가한 지시',delivery:'steer'});
      assert(result.steered && !result.queued);
      assert.equal(live.messages.at(-1).turnId,active.turnId);
    } finally {release.resolve();}
    assert.equal((await complete).status,'completed');
    const updated=await D.snapshot(reader,id,cwd);
    assert(updated.messages.some(m=>m.text==='현재 작업에 추가한 지시'));
    console.log('상대 앱 종료 상태 / 독립 내장 Codex 실행 / 현재 작업에 추가 지시 / 같은 원본 기록으로 수신 확인');
    await desktop.start();
    const operations = {};
    const register=(name,method)=>{operations[name]=method;};
    require('../electron/conversation-tools.cjs').registerConversationTools(register,controller);
    const portfolio=require('../electron/portfolio.cjs').registerPortfolio(register,store,{getRuntime:()=>runtime});
    runtime.options.syncProjectNames=portfolio.syncProjectNames;
    await operations.editConversation(session.id,{action:'rename',title:'이름 변경 왕복'});
    assert.equal((await desktop.request('thread/read',{threadId:id,includeTurns:false})).thread.name,'이름 변경 왕복');
    await desktop.request('thread/name/set',{threadId:id,name:'상대 앱의 새 제목'});
    await runtime.action({action:'sync',sessionId:session.id});
    assert.equal(live.title,'상대 앱의 새 제목');
    await desktop.request('thread/name/set',{threadId:id,name:'열지 않은 대화 제목'});
    controller.status.authenticated=true;
    const second=path.join(root,'second'),other=path.join(root,'other');
    await fs.mkdir(second);await fs.mkdir(other);
    const secondProject=await store.addProject(second);
    const create=(name,folder)=>desktop.request('project/create',{name,roots:[{path:folder}],idempotencyKey:require('node:crypto').randomUUID()}).then(r=>r.project);
    const firstRemote=await create('첫 번째',cwd), foreign=await create('다른 카드',other), secondRemote=await create('두 번째',second);
    await desktop.request('project/move',{projectId:firstRemote.id,beforeProjectId:foreign.id});
    await desktop.request('project/move',{projectId:secondRemote.id,beforeProjectId:null});
    const navigation=await operations.portfolioAction({action:'navigation',sync:true});
    assert.deepEqual(navigation.order,[project.id,secondProject.id]);assert.equal(navigation.names[project.id],'첫 번째');
    assert.equal(navigation.titles[session.id],'열지 않은 대화 제목');
    const blank=await store.createSession(project.id);
    await operations.editConversation(blank.id,{action:'rename',title:'첫 실행 전에 정한 제목'});
    const blankDone=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===blank.id);
    await controller.send({sessionId:blank.id,text:'새 대화의 첫 요청',mode:'plan'});
    assert.equal((await blankDone).status,'completed');
    const named=store.session(blank.id);
    const desktopBlank=(await desktop.request('thread/read',{threadId:named.threadId,includeTurns:false})).thread;
    assert.equal(desktopBlank.name,'첫 실행 전에 정한 제목');
    assert.equal(desktopBlank.projectId,firstRemote.id);
    assert.equal(named.title,'첫 실행 전에 정한 제목');
    const moved=await operations.portfolioAction({action:'move',id:secondProject.id,target:project.id,sync:true});
    assert.deepEqual(moved.order,[secondProject.id,project.id]);
    assert.equal((await desktop.request('project/list',{sortKey:'position'})).data[0].id,secondRemote.id);
    await operations.setKickoffDetails(project.id,null,{name:'Flowrium에서 바꾼 프로젝트'});
    assert.equal((await desktop.request('project/read',{projectId:firstRemote.id})).project.name,'Flowrium에서 바꾼 프로젝트');
    await desktop.request('project/update',{projectId:firstRemote.id,name:'Codex에서 바꾼 프로젝트'});
    assert.equal((await operations.portfolioAction({action:'navigation',sync:true})).names[project.id],'Codex에서 바꾼 프로젝트');
    assert.equal((await operations.readPortfolio()).find(card=>card.project.id===project.id).details.kickoff.name,'Codex에서 바꾼 프로젝트');
    assert.equal((await desktop.request('project/read',{projectId:foreign.id})).project.name,'다른 카드');
    const fresh=new Store(path.join(root,'flowrium'));await fresh.load();
    assert.equal(fresh.project(project.id).name,'Codex에서 바꾼 프로젝트');
    // Only explicitly naming an unregistered project creates its Codex metadata.
    const localFolder=path.join(root,'local-only');await fs.mkdir(localFolder);
    const local=await store.addProject(localFolder);
    assert.equal((await operations.portfolioAction({action:'navigation',sync:true})).nameLinks[local.id],'local');
    assert(!(await desktop.request('project/list',{})).data.some(p=>p.roots.some(r=>r.path===localFolder)));
    await operations.setKickoffDetails(local.id,null,{name:'새로 연결한 프로젝트'});
    const registered=(await desktop.request('project/list',{})).data.find(p=>p.roots.some(r=>r.path===localFolder));
    assert.equal(registered.name,'새로 연결한 프로젝트');
    const readLocal=()=>operations.readPortfolio().then(cards=>cards.find(card=>card.project.id===local.id).details);
    controller.status.authenticated=false;
    await operations.setKickoffDetails(local.id,(await readLocal()).revision,{name:'오프라인에서 정한 이름'});
    assert.equal((await operations.portfolioAction({action:'navigation'})).nameLinks[local.id],'queued');
    const noMatches={status:'supported',context:{owner:'other'},matches:new Map(),remote:[],runtime};
    assert.equal(require('../electron/project-navigation.cjs').nameStatus(store.project(local.id),noMatches),'differentAccount');
    assert.equal((await desktop.request('project/read',{projectId:registered.id})).project.name,'새로 연결한 프로젝트');
    controller.status.authenticated=true;
    await operations.portfolioAction({action:'navigation',sync:true});
    assert.equal((await desktop.request('project/read',{projectId:registered.id})).project.name,'오프라인에서 정한 이름');
    controller.status.authenticated=false;
    await operations.setKickoffDetails(local.id,(await readLocal()).revision,{name:'충돌한 로컬 제목'});
    await desktop.request('project/update',{projectId:registered.id,name:'충돌한 Codex 제목'});
    controller.status.authenticated=true;
    const conflicted=await operations.portfolioAction({action:'navigation',sync:true});
    assert.equal(conflicted.nameLinks[local.id],'conflict');
    assert.equal(conflicted.names[local.id],'충돌한 로컬 제목');
    assert.equal((await desktop.request('project/read',{projectId:registered.id})).project.name,'충돌한 Codex 제목');
    await operations.setKickoffDetails(local.id,(await readLocal()).revision,{name:'최종 이름'});
    assert.equal((await desktop.request('project/read',{projectId:registered.id})).project.name,'최종 이름');
    await desktop.request('project/update',{projectId:registered.id,name:'닫힌 창에서 바꾼 이름'});
    runtime.syncMonitor.projectNamesAt=0;
    await require('../electron/chat-sync-monitor.cjs').scan(runtime);
    assert.equal(store.project(local.id).name,'닫힌 창에서 바꾼 이름');
    assert.equal((await readLocal()).kickoff.name,'닫힌 창에서 바꾼 이름');
    const multiFolder=path.join(root,'multi-root');await fs.mkdir(multiFolder);
    const multi=await store.addProject(multiFolder);
    const remoteMulti=(await desktop.request('project/create',{name:'두 경로를 연결한 이름',roots:[{path:multiFolder},{path:other}],idempotencyKey:require('node:crypto').randomUUID()})).project;
    assert.equal((await operations.portfolioAction({action:'navigation',sync:true})).nameLinks[multi.id],'ambiguous');
    await operations.setKickoffDetails(multi.id,null,{name:'내 개별 폴더'});
    assert.equal((await desktop.request('project/read',{projectId:remoteMulti.id})).project.name,'두 경로를 연결한 이름');
    assert((await fs.stat(localFolder)).isDirectory() && (await fs.stat(multiFolder)).isDirectory());
    const request=reader.request.bind(reader);
    reader.request=(method,...args)=>method==='project/list'?Promise.reject(Object.assign(Error('unsupported'),{rpcCode:-32601})):request(method,...args);
    try{
      await desktop.request('thread/name/set',{threadId:id,name:'프로젝트 API가 없어도 수신한 제목'});
      const legacy=await operations.portfolioAction({action:'navigation',sync:true});
      assert.equal(legacy.nameLinks[local.id],'unsupported');
      assert.equal(legacy.titles[session.id],'프로젝트 API가 없어도 수신한 제목');
    }finally{reader.request=request;}
    console.log('미등록 프로젝트 이름 저장과 첫 등록 / 오프라인 변경의 재연결·충돌 처리 / 여러 루트의 원본 보존 / 구형 프로젝트 API에서도 채팅 제목 수신 통과');


    // Keep the other app's server alive and subscribed to this conversation.
    // The model must not see an unsent message, even after a Flowrium restart.
    const source=(await desktop.request('thread/start',{cwd,model:'gpt-5.5',approvalPolicy:'never',sandbox:'read-only'})).thread.id;
    async function originalTurn(text) {
      const ended=onceEvent(desktop,'notification',e=>e.method==='turn/completed'&&e.params.threadId===source);
      await desktop.request('turn/start',{threadId:source,input:[{type:'text',text}]});
      assert.equal((await ended).params.turn.status,'completed');
    }
    await originalTurn('이전 대화의 첫 메시지');
    const plan=await runtime.preview({projects:[{name:'긴 대화 검증',path:cwd,threadIds:[source]}]});
    await runtime.apply({planId:plan.id});
    let shared=store.state.sessions.find(s=>s.codexLink?.sourceThreadId===source);
    assert(shared);
    // Use a native engine configured for the same synthetic local model.
    controller.options.linkedClientFactory=makeClient;
    controller.status.authenticated=true;
    const draft={sessionId:shared.id,mode:'plan',text:'같은 대화의 예약된 요청'};
    const externalStart=Promise.withResolvers(),externalRelease=Promise.withResolvers();
    hold={started:externalStart,release:externalRelease};
    const externalDone=originalTurn('원래 앱에서 실행 중인 요청');
    try{
      await externalStart.promise;
      const active=await controller.send({...draft,text:'원래 작업 중 취소할 요청'});
      assert(active.queued&&active.waitingForWriter);
      assert(!controller.runs.has(shared.id));
      await controller.cancelQueuedMessage(shared.id,active.queueId);
    }finally{externalRelease.resolve();}
    await externalDone;
    for(let i=0;i<4&&!shared.messages.some(m=>m.text==='동기화 응답 '+requests);i++)await monitor.scan(runtime);
    assert.equal(shared.messages.filter(m=>m.text==='원래 앱에서 실행 중인 요청').length,1);
    assert.equal(shared.messages.filter(m=>m.text==='동기화 응답 '+requests).length,1);
    const beforeCount=requests;
    const queued=await controller.send(draft);
    assert(queued.queued && queued.waitingForWriter);
    assert(!controller.runs.has(shared.id));
    assert(!shared.messages.some(m=>m.text===draft.text));
    const cancelled=await controller.send({...draft,text:'취소한 요청'});
    await controller.cancelQueuedMessage(shared.id,cancelled.queueId);
    await controller.shutdown();await runtime.shutdown();
    const disk=new Store(path.join(root,'flowrium'));await disk.load();
    assert.equal(disk.session(shared.id).queuedMessages.find(q=>q.id===queued.queueId).waitingForWriter,true);
    assert.equal(disk.session(shared.id).queuedMessages.find(q=>q.id===cancelled.queueId).status,'cancelled');
    primary=makeClient();reader=makeClient();
    store=disk;shared=store.session(shared.id);
    controller=new Controller(store,{client:primary,canRun:()=>true,linkedClientFactory:makeClient});
    runtime=new CodexTransfer(store,controller,{readClient:reader,accountOwner:()=> 'synthetic',canRun:()=>true});
    await controller.connect();
    // Let at least one automatic retry encounter the busy writer again.
    await new Promise(resolve=>setTimeout(resolve,5500));
    assert.equal(requests,beforeCount);
    // A retry may be inside thread/resume (particularly on Windows). Inspect
    // both the pending reservation and actual protocol/model delivery.
    for(const run of controller.runs.values()){
      assert(run.claimingWriter);
      assert.equal(run.userMessageId,null);
      assert.equal(run.turnId,null);
    }
    assert.equal(shared.queuedMessages.find(q=>q.id===queued.queueId).status,'queued');
    assert.equal(shared.messages.filter(m=>m.text===draft.text).length,0);
    const ended=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===shared.id);
    await desktop.request('thread/unsubscribe',{threadId:source});
    assert.equal((await ended).status,'completed');
    assert.equal(requests,beforeCount+1);
    const transcript=await D.snapshot(desktop,source,cwd);
    assert.deepEqual(transcript.messages.filter(m=>m.role==='user').map(m=>m.text),['이전 대화의 첫 메시지','원래 앱에서 실행 중인 요청',draft.text]);
    assert(shared.messages.some(m=>m.role==='assistant'&&m.text==='동기화 응답 '+requests));
    console.log('상대가 작업 중인 대화와 유휴 대화의 쓰기 권한 대기 / Flowrium 재시작 보존과 취소 / 다른 앱을 닫지 않고 권한 반환 후 원본에 한 번만 자동 전송');
    await resumeWhenReleased(desktop,{threadId:source,excludeTurns:true});
    const longText='가'.repeat(1024*1024-32);
    for(let i=0;i<6;i++)await originalTurn(longText+i);
    await desktop.request('thread/unsubscribe',{threadId:source});
    const detached=makeClient();
    try{
      await detached.start();
      // Full-history hydration exceeds the production 16 MiB frame limit.
      let baseline;
      try {await resumeWhenReleased(detached,{threadId:source});}
      catch(error){baseline=error;}
      assert.equal(baseline?.code,'PROTOCOL_FRAME_TOO_LARGE');
    }finally{detached.close();}
    const afterLarge=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===shared.id);
    await controller.send({...draft,text:'긴 원본을 이어 쓰는 요청'});
    assert.equal((await afterLarge).status,'completed');
    const all=await D.snapshot(desktop,source,cwd);
    const original=all.messages.filter(m=>m.role==='user');
    assert.equal(original.length,10);
    assert.equal(original.at(-1).text,'긴 원본을 이어 쓰는 요청');
    for(let i=0;i<6;i++)assert.equal(original[i+3].text,longText+i);
    console.log('18MiB가 넘는 원본 / 기존 방식 응답 한도 초과 재현 / 원본 전체 보존과 같은 대화 답변 통과');
    console.log('서로 다른 앱 서버의 대화 제목 왕복 / 미열람 대화 제목 수신 / 프로젝트 이름 왕복과 순서 이동 / 관련 없는 카드 및 파일 경로 보존 / 재실행 복원 통과');
    console.log('독립 Codex 앱 서버 두 개의 같은 대화 3회 왕복 / 원래 본문과 순서 보존 / 버튼 없는 수신 / 상대 프로세스를 종료하지 않고 재개 통과');
  } finally {
    let shutdownError;
    for(const resource of [controller,runtime]){
      try{await resource?.shutdown();}catch(error){shutdownError??=error;}
    }
    for(const client of [desktop,primary,reader])client?.close();
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
    if(shutdownError)throw shutdownError;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
