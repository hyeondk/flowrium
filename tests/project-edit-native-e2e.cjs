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
let writeCommand = process.platform === 'win32'
  ? 'Add-Content input.txt EDIT; Copy-Item input.txt copy.txt'
  : 'echo EDIT >> input.txt && cp input.txt copy.txt';

const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {CodexClient, resolveCodex} = require('../electron/codex.cjs');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-edit-proof-'));
  const cwd = path.join(temp,'project'), profile = path.join(temp,'account');
  let current, server, controller, client, issue, variant;
  const external = path.join(process.env.GITHUB_WORKSPACE || process.cwd(),'.flowrium-probe-'+randomUUID());
  const externalMarker = 'BOUNDED_'+randomUUID();
  try {
    await fs.writeFile(external,externalMarker,{flag:'wx'}); await fs.mkdir(cwd); await fs.mkdir(profile);
    server = http.createServer(async (req,res) => {
      try {
        assert.equal(req.url,'/v1/responses');
        const chunks=[];
        for await (const chunk of req) chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks));
        console.log(variant,'모델 시험 응답 요청',body.input?.length,body.previous_response_id ? '이전 응답 지정' : '전체 기록 지정');
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
      } catch(e){console.error(variant,'모델 시험 응답 오류',e.message); issue=e; res.writeHead(400).end();}
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port+'/v1';
    await fs.writeFile(path.join(profile,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium file test"','base_url = '+JSON.stringify(base),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false'].join('\n'));
    client=new CodexClient({descriptor:await resolveCodex(),spawn:(cmd,args,opts)=>spawn(cmd,[...args,'-c','model_provider="flowrium_test"'],{...opts,env:{...opts.env,CODEX_HOME:profile,FLOWRIUM_OFFLINE_KEY:'synthetic-only',OPENAI_BASE_URL:base}})});
    client.on('notification',({method,params})=>{
      if(method==='error' || method==='turn/completed' || method==='item/completed' && params.item?.type==='commandExecution') {
        const item=params.item;
        console.log(variant,method,JSON.stringify(method==='error'?params.error:
          item?{status:item.status,exitCode:item.exitCode,output:item.aggregatedOutput?.slice(-500)}:
          {status:params.turn?.status,error:params.turn?.error}));
      }
    });
    const request=client.request.bind(client), projectCalls=[];
    client.request=(method, ...args)=>{
      if (method === 'thread/start' || method === 'thread/resume') {
        if (variant?.startsWith('seed')) args[0].sandbox='read-only';
        else assert.equal(args[0].sandbox,'workspace-write');
        projectCalls.push({method,variant,id:args[0].threadId,config:args[0].config});
      }
      if(method==='turn/start'){
        if (variant?.startsWith('seed')) args[0].sandboxPolicy={type:'readOnly'};
        else {
          assert.equal(args[0].sandboxPolicy.type,'workspaceWrite');
          assert.deepEqual(args[0].sandboxPolicy.writableRoots,[cwd]);
          assert.equal(args[0].sandboxPolicy.networkAccess,false);
        }
      }
      return method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):request(method,...args);
    };
    const store=new Store(path.join(temp,'flowrium')); await store.load();
    const project=await store.addProject(cwd); await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client,canRun:()=>true}); await controller.connect();
    const originalProfile = await fs.readFile(path.join(profile,'config.toml'),'utf8');
    const saved={};
    for (variant of ['seed-hot','upgrade-hot-plan','seed-cold','upgrade-cold-build','new-plan','new-build','external']) {
      console.log(variant,'시험 시작');
      const old = saved[variant.includes('hot')?'hot':'cold'];
      const upgrading = variant.startsWith('upgrade');
      const seed = variant.startsWith('seed');
      const writable = !seed && variant!=='external';
      if (variant === 'upgrade-cold-build') {
        const exit = once(client.proc, 'exit');
        client.close(); await exit; await controller.connect();
      }
      const session = upgrading ? store.session(old.id) : await store.createSession(project.id,
        {preferences:{sandbox:'read-only',approval:'never'}});
      if(variant==='external') {
        const quoted = "'" + external.replaceAll("'","''") + "'";
        writeCommand = 'Set-Content -LiteralPath '+quoted+' -Value ALTERED';
      }
      current={id:randomUUID(),marker:'INPUT_'+randomUUID()};
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
      await controller.send({sessionId:session.id,text:'프로젝트의 input.txt를 읽고 한 줄을 추가해 copy.txt에도 저장해줘.',mode:variant.includes('plan')?'plan':'build'},{fromComposer:true});
      const result=await done; if(issue)throw issue;assert.equal(result.status,'completed',result.text);
      const source=await fs.readFile(path.join(cwd,'input.txt'),'utf8');
      if(writable){assert.match(source,/EDIT/);assert((await fs.readFile(path.join(cwd,'copy.txt'),'utf8')).includes(current.marker));}
      else{assert.equal(source,current.marker+'\n');await assert.rejects(fs.stat(path.join(cwd,'copy.txt')),{code:'ENOENT'});}
      assert(store.session(session.id).messages.some(m=>m.role==='assistant'&&m.text.includes(current.marker)));
      if(seed) saved[variant.endsWith('hot')?'hot':'cold']={id:session.id,thread:store.session(session.id).threadId,marker:current.marker};
      if(upgrading){
        assert.equal(store.session(session.id).threadId,old.thread);
        assert(store.session(session.id).messages.some(m=>m.role==='assistant'&&m.text.includes(old.marker)));
      }
      if(variant==='external')assert.equal(await fs.readFile(external,'utf8'),externalMarker);
      console.log(variant, writable?'실제 편집 성공':'실제 쓰기 차단 확인');
    }
    assert(!projectCalls.some(c=>c.variant==='upgrade-hot-plan'));
    assert(projectCalls.some(c=>c.variant==='upgrade-cold-build' && c.method==='thread/resume' && c.id===saved.cold.thread));
    assert.equal(await fs.readFile(path.join(profile,'config.toml'),'utf8'), originalProfile);
  } finally {await fs.rm(external,{force:true});await controller?.shutdown();client?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true,maxRetries:5});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
