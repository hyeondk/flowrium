// The model's two local HTTP replies are deterministic. Codex itself executes the file operations.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const readCommand = process.platform === 'win32' ? 'Get-Content input.txt' : 'cat input.txt';
const writeCommand = process.platform === 'win32'
  ? 'Add-Content input.txt EDIT; Copy-Item input.txt copy.txt'
  : 'echo EDIT >> input.txt && cp input.txt copy.txt';

const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {CodexClient, resolveCodex} = require('../electron/codex.cjs');
const {killOwnedProcess,within}=require('./update-installed-ui.cjs');

async function closeTestClient(client) {
  const child=client?.proc;
  if (!child) return;
  const closed=once(child,'close');
  // The isolated Windows sandbox can hold the temporary account open in a child process.
  if (process.platform==='win32') await killOwnedProcess(child);
  client.close();
  await within(closed,15000,'시험용 Codex 프로세스 및 표준 입출력 종료');
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-edit-proof-'));
  const cwd = path.join(temp,'project'), profile = path.join(temp,'account');
  let current, server, controller, client, issue;
  try {
    await fs.mkdir(cwd); await fs.mkdir(profile);
    server = http.createServer(async (req,res) => {
      try {
        assert.equal(req.url,'/v1/responses');
        const chunks=[];
        for await (const chunk of req) chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks));
        const outputs = body.input.filter(i => i.type === 'function_call_output');
        const readOutput = outputs.find(i => i.call_id === 'read_' + current.id);
        const writeOutput = outputs.find(i => i.call_id === 'write_' + current.id);
        if (readOutput) assert(JSON.stringify(readOutput.output).includes(current.marker),
          '실제 파일 읽기: ' + JSON.stringify(readOutput.output).slice(0, 1200));
        let item;
        if (!writeOutput) {
          const tool = 'exec_command';
          const namespace = body.tools.find(t => t.type === 'namespace' && t.tools.some(v => v.name === tool));
          assert(namespace || body.tools.some(t => t.name === tool), '프로젝트 셸 도구');
          const call = (readOutput ? 'write_' : 'read_') + current.id;
          const command = readOutput ? writeCommand : readCommand;
          item = {id: 'cmd_' + call, type: 'function_call', call_id: call, name: tool,
            ...(namespace && {namespace: namespace.name}),
            arguments: JSON.stringify({cmd: command, workdir: cwd, max_output_tokens: 256})};
        } else {
          assert(readOutput);
          item = {id:'msg_'+current.id,type:'message',role:'assistant',status:'completed',
            content:[{type:'output_text',text:'읽은 내용 '+current.marker,annotations:[]}]};
        }
        const id='resp_'+randomUUID();
        const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...item,...(item.type==='function_call'?{arguments:''}:{content:[]})}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:10,total_tokens:20}}}];
        res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
      } catch(e){issue=e; res.writeHead(400).end();}
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port+'/v1';
    await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium file test"','base_url = '+JSON.stringify(base),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false'].join('\n'));
    client=new CodexClient({descriptor:await resolveCodex(),spawn:(cmd,args,opts)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...opts,env:{...opts.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-only',OPENAI_BASE_URL:base}})});
    const request=client.request.bind(client), projectCalls=[], turns=[];
    client.request=(method, ...args)=>{
      // Import a real read-only source turn, then resume its original ID through Flowrium.
      if (current?.legacySource) {
        if (method === 'thread/start') args[0] = {...args[0],sandbox:'read-only',approvalPolicy:'never'};
        if (method === 'turn/start') args[0] = {...args[0],sandboxPolicy:{type:'readOnly'},approvalPolicy:'never'};
      }
      if (method === 'turn/start') turns.push(args[0].sandboxPolicy.type);
      if (method === 'thread/start' || method === 'thread/resume')
        projectCalls.push({method,config:args[0].config,sandbox:args[0].sandbox,cwd:args[0].cwd});
      return method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):request(method,...args);
    };
    const store=new Store(path.join(temp,'flowrium')); await store.load();
    const project=await store.addProject(cwd); await store.saveSettings({model:'gpt-5.5',chatDefaults:{approval:'manual'}});
    controller=new Controller(store,{client,canRun:()=>true}); await controller.connect();
    const baseline=process.argv.includes('--baseline');
    const legacy = await store.createSession(project.id,{preferences:{sandbox:'read-only',approval:'manual'}});
    delete store.session(legacy.id).defaultProjectMode;
    await store.save();
    const beforeTrust = await fs.readFile(path.join(profile,'config.toml'),'utf8');
    const guardPrompt = {sessionId:legacy.id,text:'승인 전 프로젝트 요청'};
    await assert.rejects(controller.send(guardPrompt,{fromComposer:true}), /신뢰/);
    assert.equal(projectCalls.length,0);
    assert.equal(store.session(legacy.id).messages.length,0);
    assert.equal(await store.requestProjectTrust(project.id,async()=>false),false);
    await assert.rejects(controller.send(guardPrompt,{fromComposer:true}), /신뢰/);
    assert.equal(await store.requestProjectTrust(project.id, async folder=>{
      assert.equal(await fs.realpath(folder.path),await fs.realpath(cwd));
      return true;
    }),true);
    let sourceId, oldHistory;
    for (const variant of baseline ? ['legacy-origin'] : ['new','legacy-origin','hot-resume','resume','new-plan']) {
      const legacySource=variant === 'legacy-origin';
      const writable=!legacySource;
      if (variant === 'resume') {
        await closeTestClient(client); await controller.connect();
        assert.equal(await store.requestProjectTrust(project.id,async()=>assert.fail('이미 신뢰한 프로젝트')),true);
      }
      const session=legacySource || variant === 'resume' || variant==='hot-resume' ? legacy : await store.createSession(project.id);
      current={id:randomUUID(),marker:'INPUT_'+randomUUID(),legacySource};
      await fs.writeFile(path.join(cwd,'input.txt'),current.marker+'\n');await fs.rm(path.join(cwd,'copy.txt'),{force:true});
      const done=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{controller.off('event',listen);reject(issue||Error('파일 작업 시간 초과'));},30000);
        async function listen(event){
          if(event.type === 'approval' && event.sessionId === session.id) {
            try {
              const request = client.approvals.get(event.requestId);
              assert(writable && request.method === 'item/commandExecution/requestApproval');
              const approvedCommand = request.params.commandActions?.some(
                action => [readCommand, writeCommand].includes(action.command)
              );
              assert(approvedCommand, '예정된 시험용 파일 명령의 일회 승인');
              assert.equal(await fs.realpath(request.params.cwd), await fs.realpath(cwd), '격리된 시험 폴더');
              controller.decideApproval(event.requestId, 'accept');
            } catch(error) {
              clearTimeout(timer);controller.off('event',listen);reject(error);
            }
          }
          if(event.type==='done' && event.sessionId===session.id){clearTimeout(timer);controller.off('event',listen);resolve(event);}}
        controller.on('event',listen);
      });
      await controller.send({sessionId:session.id,text:'프로젝트의 input.txt를 읽고 한 줄을 추가해 copy.txt에도 저장해줘.',...((variant==='resume'||variant==='new-plan'||variant==='hot-resume')&&{mode:'plan'})},{fromComposer:true});
      const result=await done; if(issue)throw issue;assert.equal(result.status,'completed',result.text);
      const source=await fs.readFile(path.join(cwd,'input.txt'),'utf8');
      if(writable){assert.match(source,/EDIT/);assert((await fs.readFile(path.join(cwd,'copy.txt'),'utf8')).includes(current.marker));}
      else{assert.equal(source,current.marker+'\n');await assert.rejects(fs.stat(path.join(cwd,'copy.txt')),{code:'ENOENT'});}
      assert(store.session(session.id).messages.some(m=>m.role==='assistant'&&m.text.includes(current.marker)));
      if (legacySource) {
        sourceId=store.session(session.id).threadId;
        oldHistory=store.session(session.id).messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>m.text);
      } else if (variant === 'resume' || variant==='hot-resume') {
        const resumed=store.session(session.id);
        assert.equal(resumed.threadId,sourceId);
        const history=resumed.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>m.text);
        assert.deepEqual(history.slice(0,oldHistory.length),oldHistory);
      }
      console.log(legacySource ? '이전 읽기 전용 원본 대화 생성 / 실제 수정 거절 확인' :
        variant==='hot-resume' ? '이미 열려 있는 읽기 전용 원본 ID 유지 / 같은 프로세스에서 실제 수정' :
        variant==='resume' ? '이전 원본 ID·기록 유지 / 재시작 후 계획 모드로 파일 읽기·수정·복사' :
        variant==='new-plan' ? '같은 프로젝트의 새 계획 대화 / 파일 읽기·수정·복사' :
        '프로젝트 최초 신뢰 후 새 대화 / 파일 읽기·수정·복사');
    }
    if (!baseline) {
      assert.deepEqual(projectCalls.filter(c=>c.method==='thread/start').map(c=>c.sandbox),['workspace-write','read-only','workspace-write']);
      const resumedCalls=projectCalls.filter(c=>c.method==='thread/resume');
      assert(resumedCalls.length>=1 && resumedCalls.every(c=>c.sandbox==='workspace-write'));
      assert.deepEqual(turns,['workspaceWrite','readOnly','workspaceWrite','workspaceWrite','workspaceWrite']);
      for (const call of projectCalls) assert.equal(await fs.realpath(call.cwd),await fs.realpath(cwd));
      if (process.platform === 'win32') for (const { config } of projectCalls) {
        assert.equal(config?.['features.prefer_mxc'], true);
        assert.equal(config?.['windows.sandbox'], 'unelevated');
      }
      assert.equal(await fs.readFile(path.join(profile,'config.toml'),'utf8'), beforeTrust);
    }
  } finally {
    await closeTestClient(client);
    await controller?.shutdown();
    server?.closeAllConnections();
    if(server)await new Promise(r=>server.close(r));
    await fs.rm(temp,{recursive:true,force:true,maxRetries:12,retryDelay:200});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
