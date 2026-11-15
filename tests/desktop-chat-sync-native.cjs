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

function onceEvent(emitter, event, matches) {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); emitter.off(event, listen); };
    const listen = value => { if(matches(value)){ stop(); resolve(value); } };
    const timer = setTimeout(() => { stop(); reject(Error('동기화 시험 응답 시간 초과')); }, 15000);
    emitter.on(event, listen);
  });
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
    const store=new Store(path.join(root,'flowrium'));await store.load();
    const project=await store.addProject(cwd),session=await store.createSession(project.id);
    await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client:primary,canRun:()=>true});
    runtime=new CodexTransfer(store,controller,{readClient:reader,accountOwner:()=> 'synthetic',canRun:()=>true});
    async function send(text) {
      const done=onceEvent(controller,'event',e=>e.type==='done'&&e.sessionId===session.id);
      await controller.send({sessionId:session.id,text,mode:'plan'});assert.equal((await done).status,'completed');
    }
    await send('첫 번째 로컬 요청');
    const live=store.session(session.id),id=live.threadId;
    assert.equal(live.desktopThread.threadId,id);
    await desktop.start();
    const first=await D.snapshot(desktop,id,cwd);
    assert.deepEqual(first.messages.filter(m=>m.role==='user').map(m=>m.text),['첫 번째 로컬 요청']);
    assert(first.messages.some(m=>m.text==='동기화 응답 1'));
    await desktop.request('thread/resume',{threadId:id,excludeTurns:true,cwd,approvalPolicy:'never',sandbox:'read-only'});
    const done=onceEvent(desktop,'notification',e=>e.method==='turn/completed'&&e.params.threadId===id);
    await desktop.request('turn/start',{threadId:id,input:[{type:'text',text:'상대 앱에서 작성한 요청'}]});
    assert.equal((await done).params.turn.status,'completed');
    await desktop.request('thread/unsubscribe',{threadId:id});
    assert.deepEqual(await runtime.action({action:'sync',sessionId:session.id}),{sync:'current'});
    assert.deepEqual(live.messages.filter(m=>m.role!=='system').map(m=>m.text),['첫 번째 로컬 요청','동기화 응답 1','상대 앱에서 작성한 요청','동기화 응답 2']);
    await send('다시 Flowrium에서 이어 쓰는 요청');
    assert((await D.snapshot(desktop,id,cwd)).messages.some(m=>m.text==='동기화 응답 3'));
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
    require('../electron/portfolio.cjs').registerPortfolio(register,store,{getRuntime:()=>runtime});
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
    assert.equal((await desktop.request('thread/read',{threadId:named.threadId,includeTurns:false})).thread.name,'첫 실행 전에 정한 제목');
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
    console.log('서로 다른 앱 서버의 대화 제목 왕복 / 미열람 대화 제목 수신 / 프로젝트 이름 왕복과 순서 이동 / 관련 없는 카드 및 파일 경로 보존 / 재실행 복원 통과');
    console.log('독립 Codex 앱 서버 두 개의 같은 대화 3회 왕복 / 원래 본문과 순서 보존 / 버튼 없는 수신 / 상대 프로세스를 종료하지 않고 재개 통과');
  } finally {
    await runtime?.shutdown();await controller?.shutdown();
    for(const client of [desktop,primary,reader])client?.close();
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
