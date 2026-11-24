const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {setTimeout:delay}=require('node:timers/promises');

async function waitForProcessExit(pid) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {
    try { process.kill(pid,0); }
    catch(error) { if(error.code==='ESRCH')return; throw error; }
    await delay(150);
  }
  throw Error('본체 PID '+pid+'의 정상 종료를 확인하지 못했습니다.');
}

function serveCodex() {
  // Only authentication is synthetic. All thread, turn and permission RPCs
  // run in the Codex binary shipped inside the package under test.
  const child=spawn(process.env.FLOWRIUM_PACKAGED_CODEX,[...process.argv.slice(2),'-c','model_provider="flowrium_test"'],{stdio:['pipe','pipe','inherit'],windowsHide:true});
  child.stdout.pipe(process.stdout);
  const lines=readline.createInterface({input:process.stdin});
  lines.on('line',line=>{
    const request=JSON.parse(line);
    if(request.method==='turn/start' && process.env.FLOWRIUM_POLICY_TRACE) {
      const params=request.params||{};
      require('node:fs').appendFileSync(process.env.FLOWRIUM_POLICY_TRACE,JSON.stringify({
        threadId:params.threadId,sandbox:params.sandboxPolicy?.type,approval:params.approvalPolicy,
      })+'\n');
    }
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
  const {closeInstalledApp,within}=require('./update-installed-ui.cjs');
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
  let app,page,server,appPid,phase='시작',serviceError,responseCount=0;
  const inputs=[], errors=[], projects=[];
  const env={...process.env,CODEX_HOME:codex,FLOWRIUM_OFFLINE_KEY:'local-test-only',FLOWRIUM_PACKAGED_CODEX:native,FLOWRIUM_POLICY_TRACE:path.join(temp,'turn-policies.jsonl')};
  if(!windows)env.HOME=temp;
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  env.FLOWRIUM_LIFECYCLE_DIAGNOSTICS='1';

  async function step(label,timeout,operation) {
    phase=label;
    console.log(label+' / 시작');
    const result=await within(Promise.resolve().then(operation),timeout,label);
    console.log(label+' / 완료');
    return result;
  }

  async function close(label) {
    const current=app, pid=appPid;
    try {
      await step(label,45000,()=>closeInstalledApp(current,'배포 앱 정상 종료'));
    } finally {
      if (current.process().exitCode!==null || current.process().signalCode!==null) app=undefined;
    }
    if(windows && pid) await step(label+' / 본체 PID '+pid+' 확인',11000,()=>waitForProcessExit(pid));
    app=undefined;
    appPid=undefined;
    page=undefined;
  }

  async function launch(label,trustChoices=[]) {
    let abandoned=false;
    try {
      await step(label+' / 프로세스와 디버거 연결',55000,async()=>{
        const launched=await _electron.launch({executablePath:executable,args:['--user-data-dir='+profile,'--use-mock-keychain'],env,timeout:45000});
        if(abandoned) {
          await closeInstalledApp(launched,'제한 시간 뒤 도착한 시험 앱 정리');
          return;
        }
        app=launched;
      });
    } catch(error) {
      abandoned=true;
      throw error;
    }
    const location=await step(label+' / 메인 프로세스·프로필 확인',20000,()=>app.evaluate(({app})=>({
      packaged:app.isPackaged,data:app.getPath('userData'),binary:app.getPath('exe'),pid:process.pid,
    })));
    appPid=location.pid;
    assert(Number.isSafeInteger(appPid)&&appPid>0,'실제 앱 프로세스를 확인해야 합니다.');
    assert(location.packaged && path.relative(profile,location.data)==='','독립 프로필의 배포 앱이어야 합니다.');
    if(windows) assert.equal(path.relative(executable,location.binary),'','검증용으로 빌드한 실행 파일이어야 합니다.');
    console.log(label+' / 앱 PID '+appPid+' / 실행 도구 PID '+app.process().pid);
    const bundledEngine=await step(label+' / 내장 엔진 확인',20000,()=>app.evaluate(({app})=>{
      const path=process.getBuiltinModule('node:path');
      const require=process.getBuiltinModule('node:module').createRequire(path.join(app.getAppPath(),'package.json'));
      return require('./electron/codex.cjs').resolveCodex();
    }));
    assert.equal(bundledEngine?.node,false);
    assert.equal(await fs.realpath(bundledEngine.command),await fs.realpath(native),'별도 데스크톱 앱을 찾기 전에 배포본의 해당 운영체제용 Codex를 사용해야 합니다.');
    // Only this isolated packaged-app test supplies the user's native dialog choices.
    await step(label+' / 합성 권한 대화 연결',20000,()=>app.evaluate(({dialog},choices)=>{
      const original=dialog.showMessageBox.bind(dialog);
      globalThis.flowriumTrustPrompts=[];
      dialog.showMessageBox=async(...args)=>{
        const options=args.at(-1);
        if (!options.buttons?.includes('신뢰하고 편집 허용')) return original(...args);
        const choice=choices.shift();
        if (!choice) throw Error('이미 신뢰한 프로젝트의 재승인 요청');
        globalThis.flowriumTrustPrompts.push([options.message,options.detail].join(' '));
        return {response:options.buttons.indexOf(choice),checkboxChecked:false};
      };
    },trustChoices));
    page=await step(label+' / 첫 창',35000,()=>app.firstWindow({timeout:30000}));
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    await step(label+' / 화면 크기',20000,()=>page.setViewportSize({width:1440,height:960}));
    await step(label+' / 연결 준비',30000,()=>page.waitForFunction(
      ()=>document.querySelector('.side-usage')?.dataset.connected==='true',null,{timeout:25000},
    ));
  }
  async function send(prompt,scope,projectId) {
    phase=prompt;
    const expected='시험 응답 '+prompt;
    await composer(page).fill(prompt);await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    await page.locator('.dock-chat').getByText(expected,{exact:true}).first().waitFor();
    const state=await step(prompt+' / 실제 대화 기록 조회',20000,()=>page.evaluate(()=>window.flowrium.bootstrap()));
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
        // Internal housekeeping may request a separate completion.
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
    for(const name of ['첫 프로젝트','두 번째 프로젝트']){
      const folder=path.join(temp,name);await fs.mkdir(folder);projects.push(await store.addProject(folder));
    }
    await store.saveSettings({codexPath:__filename,model:'gpt-5.5'});
    await launch('첫 배포 앱 실행',['취소','신뢰하고 편집 허용','신뢰하고 편집 허용']);
    await newProjectConversation(page,projects[0].id);
    await composer(page).fill('시험요청1');
    await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    const {expect}=require('playwright/test');
    await expect.poll(()=>app.evaluate(()=>globalThis.flowriumTrustPrompts.length)).toBe(1);
    assert.equal(await composer(page).inputValue(),'시험요청1','취소한 초안 보존');
    assert.deepEqual(inputs,[],'신뢰 취소 시 모델 전송 없음');
    const first=await send('시험요청1',undefined,projects[0].id);
    await newProjectConversation(page,projects[1].id);
    const second=await send('시험요청2',undefined,projects[1].id);
    const sessions=[first,second];
    for(const [scope,label,prompt] of [['general','새 일반 대화','시험요청3'],['integrated','새 통합 대화','시험요청4']]){
      const dock=await dockHome(page);await dock.getByRole('button',{name:label,exact:true}).click();
      sessions.push(await send(prompt,scope));
    }
    assert.equal(new Set(sessions.map(s=>s.threadId)).size,4);
    const policies=(await fs.readFile(env.FLOWRIUM_POLICY_TRACE,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    for(const projectChat of [first,second]){
      const turn=policies.find(row=>row.threadId===projectChat.threadId);
      assert.equal(turn?.sandbox,'workspaceWrite','설치본 프로젝트 입력창의 실제 쓰기 권한');
      assert.equal(turn.approval,'on-request','설치본 프로젝트 입력창의 추가 승인 정책');
    }
    const prompts=await step('첫 실행에서 거친 신뢰 요청 확인',20000,()=>app.evaluate(()=>globalThis.flowriumTrustPrompts));
    assert.equal(prompts.length,3);
    for(const [index,project] of [projects[0],projects[0],projects[1]].entries())
      assert(prompts[index].includes(await fs.realpath(project.path)),'권한 확인창에 실제 프로젝트 경로 표시');
    await close('첫 대화 검증 뒤 배포 앱 종료');
    await launch('같은 프로필로 배포 앱 재실행');
    await step('재시작 뒤 기존 대화 열기',40000,()=>openConversation(page,first.title));
    const resumed=await send('시험요청5',undefined,projects[0].id);
    assert.equal(resumed.id,first.id);assert.equal(resumed.threadId,first.threadId);
    assert.deepEqual(resumed.messages.filter(m=>m.role==='user').map(m=>m.text),['시험요청1','시험요청5']);
    assert.deepEqual(inputs,['시험요청1','시험요청2','시험요청3','시험요청4','시험요청5']);
    const restoredTrust=await step('재시작 뒤 신뢰 유지 확인',20000,()=>app.evaluate(()=>globalThis.flowriumTrustPrompts));
    assert.deepEqual(restoredTrust,[],'재시작 뒤 신뢰 유지');
    assert.deepEqual(errors,[]);assert.ifError(serviceError);
    await close('다시 시작한 배포 앱 종료');
    console.log('설치형 앱과 내장 Codex / 두 프로젝트의 새 대화 / 일반 대화 / 통합 대화 / 재시작 후 원래 대화에 이어 보내기 / 입력과 모델 응답 표시 통과');
  }catch(error){
    if(serviceError)console.error(serviceError);
    console.error('검증 위치',phase,'실제 응답 수',inputs.length);
    if(page&&!page.isClosed())console.error('표시된 알림',await within(page.locator('[role="alert"],.toast,.snackbar').allTextContents(),3000,'검증 화면 알림 읽기').catch(()=>[]));
    throw error;
  }finally{
    try { if(app)await close('실패한 배포 앱 검사 정리'); }
    finally {
      if(server) {
        server.closeAllConnections();
        await within(new Promise(resolve=>server.close(resolve)),10000,'합성 응답 서버 종료');
      }
      await within(fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200}),15000,'합성 자료 정리');
    }
  }
}
if(process.argv[2]==='app-server')serveCodex();else run().catch(error=>{console.error(error);process.exitCode=1;});
