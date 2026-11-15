const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const readline = require('node:readline');

function serveCodex() {
  // Only authentication is synthetic. All thread, turn and permission RPCs
  // run in the Codex binary shipped inside the package under test.
  const child=spawn(process.env.FLOWRIUM_PACKAGED_CODEX,[...process.argv.slice(2),'-c','model_provider="flowrium_test"'],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  child.stdout.pipe(process.stdout);
  const lines=readline.createInterface({input:process.stdin});
  lines.on('line',line=>{
    const request=JSON.parse(line);
    if(request.method==='account/read') {
      process.stdout.write(JSON.stringify({id:request.id,result:{account:{type:'chatgpt',email:'test@example.invalid',planType:'pro'}}})+'\n');
    }else child.stdin.write(line+'\n');
  });
  lines.on('close',()=>child.stdin.end());
  child.stdin.on('error',()=>{});
  child.on('error',()=>process.exit(1));
  child.on('exit',code=>process.exit(code||0));
  process.on('exit',()=>child.kill());
}

async function run() {
  const {_electron}=require('playwright');
  const {Store}=require('../electron/store.cjs');
  const {composer,dockHome,openConversation,newProjectConversation}=require('./shell-test-helpers.cjs');
  const windows=process.platform==='win32';
  assert(windows || process.platform==='darwin');
  const input=process.argv[2]||(windows?'release/win-unpacked/Flowrium.exe':'release/mac-arm64/Flowrium.app');
  const executable=path.resolve(windows?input:path.join(input,'Contents','MacOS','Flowrium'));
  const resources=path.resolve(path.dirname(executable),windows?'resources':'../Resources');
  const triple=windows?'x86_64-pc-windows-msvc':'aarch64-apple-darwin';
  const native=path.join(resources,'app.asar.unpacked','node_modules','@openai','codex-'+(windows?'win32-x64':'darwin-arm64'),'vendor',triple,'bin',windows?'codex.exe':'codex');
  await fs.access(executable);await fs.access(native);
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-package-chat-')));
  const profile=path.join(temp,'profile'),codex=path.join(temp,'codex');
  let app,page,server,phase='시작',serviceError,responseCount=0;
  const inputs=[], errors=[];
  const env={...process.env,CODEX_HOME:codex,FLOWRIUM_OFFLINE_KEY:'local-test-only',FLOWRIUM_PACKAGED_CODEX:native};
  if(!windows)env.HOME=temp;
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  async function launch() {
    app=await _electron.launch({executablePath:executable,args:['--user-data-dir='+profile,'--use-mock-keychain'],env,timeout:45000});
    const location=await app.evaluate(({app})=>({packaged:app.isPackaged,data:app.getPath('userData')}));
    assert(location.packaged && path.relative(profile,location.data)==='','독립 프로필의 배포 앱이어야 합니다.');
    page=await app.firstWindow();page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:960});
    await page.waitForFunction(()=>document.querySelector('.side-usage')?.dataset.connected==='true');
  }
  async function send(prompt,scope,projectId) {
    phase=prompt;
    const expected='시험 응답 '+prompt;
    await composer(page).fill(prompt);await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    await page.locator('.dock-chat').getByText(expected,{exact:true}).first().waitFor();
    const state=await page.evaluate(()=>window.flowrium.bootstrap());
    const session=state.sessions.find(s=>s.messages.some(m=>m.role==='user'&&m.text===prompt));
    assert(session?.threadId && session.messages.some(m=>m.role==='assistant'&&m.text===expected));
    assert.equal(session.scope,scope);if(projectId)assert.equal(session.projectId,projectId);
    assert(inputs.includes(prompt),'포장된 Codex가 시험 입력을 로컬 서비스로 보내야 합니다.');
    return session;
  }
  try {
    server=http.createServer(async(req,res)=>{
      if(req.method!=='POST'||req.url!=='/v1/responses'){res.writeHead(404).end();return;}
      try{
        const chunks=[];for await (const chunk of req)chunks.push(chunk);
        const {input}=JSON.parse(Buffer.concat(chunks));
        const prompt=input.filter(v=>v.role==='user').flatMap(v=>Array.isArray(v.content)?v.content.map(c=>c.text):v.content).findLast(v=>/^시험요청\d+$/.test(v));
        if(prompt)inputs.push(prompt);
        const id='resp_'+(++responseCount);
        // Suggestions and housekeeping may request a separate completion.
        const text=prompt?'시험 응답 '+prompt:'보조 요청을 확인했습니다.';
        const answer={id:'item_'+responseCount,type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text,annotations:[]}]};
        const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{...answer,content:[]}},{type:'response.output_item.done',output_index:0,item:answer},{type:'response.completed',response:{id,status:'completed',output:[answer],usage:{input_tokens:5,output_tokens:5,total_tokens:10}}}];
        res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
      }catch(error){serviceError=error;res.writeHead(500).end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    await fs.mkdir(codex);
    const endpoint='http://127.0.0.1:'+server.address().port+'/v1';
    await fs.writeFile(path.join(codex,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium test"','base_url = '+JSON.stringify(endpoint),'wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false'].join('\n'));
    const store=new Store(profile);await store.load();
    const projects=[];
    for(const name of ['첫 프로젝트','두 번째 프로젝트']){
      const folder=path.join(temp,name);await fs.mkdir(folder);projects.push(await store.addProject(folder));
    }
    await store.saveSettings({codexPath:__filename,model:'gpt-5.5'});
    await launch();
    await newProjectConversation(page,projects[0].id);
    const first=await send('시험요청1',undefined,projects[0].id);
    await newProjectConversation(page,projects[1].id);
    const second=await send('시험요청2',undefined,projects[1].id);
    const sessions=[first,second];
    for(const [scope,label,prompt] of [['general','새 일반 대화','시험요청3'],['integrated','새 통합 대화','시험요청4']]){
      const dock=await dockHome(page);await dock.getByRole('button',{name:label,exact:true}).click();
      sessions.push(await send(prompt,scope));
    }
    assert.equal(new Set(sessions.map(s=>s.threadId)).size,4);
    await app.close();app=undefined;
    await launch();await openConversation(page,first.title);
    const resumed=await send('시험요청5',undefined,projects[0].id);
    assert.equal(resumed.id,first.id);assert.equal(resumed.threadId,first.threadId);
    assert.deepEqual(resumed.messages.filter(m=>m.role==='user').map(m=>m.text),['시험요청1','시험요청5']);
    assert.deepEqual(inputs,['시험요청1','시험요청2','시험요청3','시험요청4','시험요청5']);
    assert.deepEqual(errors,[]);assert.ifError(serviceError);
    console.log('설치형 앱과 내장 Codex / 두 프로젝트의 새 대화 / 일반 대화 / 통합 대화 / 재시작 후 원래 대화에 이어 보내기 / 입력과 모델 응답 표시 통과');
  }catch(error){
    if(serviceError)console.error(serviceError);
    console.error('검증 위치',phase,'실제 응답 수',inputs.length);
    if(page&&!page.isClosed())console.error('표시된 알림',await page.locator('[role="alert"],.toast,.snackbar').allTextContents().catch(()=>[]));
    throw error;
  }finally{
    if(app)await app.close();
    if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  }
}
if(process.argv[2]==='app-server')serveCodex();else run().catch(error=>{console.error(error);process.exitCode=1;});
