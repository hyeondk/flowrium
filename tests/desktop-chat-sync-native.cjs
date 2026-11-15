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
  let requests = 0;
  try {
    await fs.mkdir(profile); await fs.mkdir(cwd);
    server = http.createServer(async (req,res) => {
      if (req.method !== 'POST' || !req.url.startsWith('/v1/responses')) {res.writeHead(404).end();return;}
      for await (const unused of req) {}
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
    console.log('독립 Codex 앱 서버 두 개의 같은 대화 3회 왕복 / 원래 본문과 순서 보존 / 버튼 없는 수신 / 상대 프로세스를 종료하지 않고 재개 통과');
  } finally {
    await runtime?.shutdown();await controller?.shutdown();
    for(const client of [desktop,primary,reader])client?.close();
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:200});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
