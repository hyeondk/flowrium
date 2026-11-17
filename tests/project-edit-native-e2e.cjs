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
    const request=client.request.bind(client);
    client.request=(method,...args)=>method==='account/read'?Promise.resolve({account:{type:'chatgpt',planType:'test'}}):request(method,...args);
    const store=new Store(path.join(temp,'flowrium')); await store.load();
    const project=await store.addProject(cwd); await store.saveSettings({model:'gpt-5.5'});
    controller=new Controller(store,{client,canRun:()=>true}); await controller.connect();
    if(process.platform === 'win32') {
      const userConfig = await client.request('config/read', {includeLayers:false});
      console.log('보호 구성',userConfig.config.windows, Object.keys(userConfig.origins || {}).filter(k=>k.startsWith('windows')));
      const raw = client.request.bind(client);
      client.request = (method, params, ...rest) => {
        if (method === 'thread/start' || method === 'thread/resume') {
          const override = process.env.FLOWRIUM_TEST_WINDOWS_SANDBOX === 'nested' ? {windows:{sandbox:'unelevated'}} : {'windows.sandbox':'unelevated'};
          params={...params,config:{...params.config,...override}};
        }
        return raw(method,params,...rest);
      };
    }
    const baseline=process.argv.includes('--baseline');
    for(const writable of baseline?[false]:[true,false]){
      const session=await store.createSession(project.id,writable||baseline?{}:{preferences:{sandbox:'read-only',approval:'never'}});
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
      await controller.send({sessionId:session.id,text:'프로젝트의 input.txt를 읽고 한 줄을 추가해 copy.txt에도 저장해줘.',...(baseline&&{mode:'plan'})},{fromComposer:true});
      const result=await done; if(issue)throw issue;assert.equal(result.status,'completed',result.text);
      const source=await fs.readFile(path.join(cwd,'input.txt'),'utf8');
      if(writable){assert.match(source,/EDIT/);assert((await fs.readFile(path.join(cwd,'copy.txt'),'utf8')).includes(current.marker));}
      else{assert.equal(source,current.marker+'\n');await assert.rejects(fs.stat(path.join(cwd,'copy.txt')),{code:'ENOENT'});}
      assert(store.session(session.id).messages.some(m=>m.role==='assistant'&&m.text.includes(current.marker)));
      console.log(writable?'새 프로젝트 기본값 / 실제 파일 읽기·수정·복사 확인':'읽기 전용 / 실제 읽기 및 수정 거부 확인');
    }
  } finally {await controller?.shutdown();client?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true,maxRetries:5});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
