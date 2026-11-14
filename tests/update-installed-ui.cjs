const {execFile:rawExecFile}=require('node:child_process');
function within(promise,timeout,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' / '+timeout+'ms 대기 초과')),timeout);})]).finally(()=>clearTimeout(timer));}
async function killOwnedProcess(child){
 if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise(resolve=>child.once('exit',resolve));
 if(process.platform==='win32')await new Promise((resolve,reject)=>rawExecFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10000},error=>error&&child.exitCode===null?reject(error):resolve()));
 else child.kill('SIGKILL');
 if(child.exitCode===null&&child.signalCode===null)await within(exited,10000,'소유한 검사 프로세스 종료 확인');
}
function execFixture(file,args,options={}){
 const {timeout=60000,label='검사 프로세스',...rest}=options;
 return new Promise((resolve,reject)=>{
  let expired=false,timer;const child=rawExecFile(file,args,{...rest,windowsHide:true,timeout:0},(error,stdout,stderr)=>{if(expired)return;clearTimeout(timer);if(error){error.stdout=stdout;error.stderr=stderr;reject(error);}else resolve({stdout,stderr});});
  timer=setTimeout(async()=>{expired=true;const failure=Error(label+' / '+timeout+'ms 대기 초과 / 소유한 검사 프로세스를 종료합니다.');try{await killOwnedProcess(child);}catch(error){failure.cause=error;}reject(failure);},timeout);
 });
}
async function closeInstalledApp(application,label='검사 앱 종료'){
 const child=application.process();console.log(label+' / 시작');
 try{await within(application.close(),30000,label);console.log(label+' / 완료');}
 catch(error){console.error(label+' / 실패 / '+error.message);try{await killOwnedProcess(child);}catch(failure){error.cause=failure;}throw error;}
}
// 설치한 앱의 검사/다운로드/종료 코드는 그대로 사용한다. 테스트 릴리스의 HTTPS 응답 본문만 로컬 파일에서 공급한다.
async function bindUpdateTransport(application, fixture) {
  await within(application.evaluate(({app}, data) => {
    const module = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const fs = process.getBuiltinModule('node:fs');
    const load = module.createRequire(path.join(app.getAppPath(), 'package.json'));
    const {DesktopUpdater} = load('./electron/updater.cjs');
    const original = DesktopUpdater.prototype.check;
    DesktopUpdater.prototype.check = function(...args) {
      this.fetchImpl = async (url) => {
        if (url === 'https://api.github.com/repos/hyeondk/flowrium/releases/latest') return Response.json(data.manifest);
        if (url === data.sumsURL) return new Response(data.sums);
        if (url === data.assetURL) return new Response(fs.createReadStream(data.file));
        throw new Error('예상한 업데이트 주소와 다릅니다.');
      };
      return original.apply(this,args);
    };
  }, fixture),30000,'업데이트 전송 연결');
}
async function clickAvailable(application,version) {
  const page=await within(application.firstWindow({timeout:45000}),45000,'업데이트 창 열기');
  await within(page.setViewportSize({width:1440,height:1000}),30000,'업데이트 창 크기');await within(page.bringToFront(),30000,'업데이트 창 전면 표시');
  await within(application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed())?.focus()),30000,'업데이트 창 포커스');
  page.setDefaultTimeout(25000);
  const banner=page.locator('.update-banner').filter({hasText:'Flowrium '+version+' 업데이트'});
  if(!await banner.isVisible()) {
    const rail=page.locator('.workspace-side');if(await rail.count())await rail.hover();
    await page.locator('.settings-button').click();
    const settings=page.getByRole('dialog').getByRole('region',{name:'프로그램 업데이트'});
    const check=settings.getByRole('button',{name:'새 버전 확인'});
    if(await check.isVisible()) await check.click();
    await settings.getByRole('button',{name:'업데이트 후 재시작'}).waitFor();
    await page.getByRole('button',{name:'설정 닫기'}).click();
  }
  await banner.getByRole('button',{name:'업데이트 후 재시작'}).click();
  return page;
}
async function seedOldProject(userData,temporary) {
  const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
  const {Store}=require('../electron/store.cjs');
  const directory=path.join(temporary,'이전 프로젝트');
  await fs.mkdir(directory);
  await fs.mkdir(path.join(temporary,'codex'),{recursive:true});
  const store=new Store(userData);await store.load();
  const project=await store.addProject(directory);
  const text='이전 설치에서 작성한 검증용 메시지';
  const message={id:randomUUID(),role:'user',text,createdAt:new Date().toISOString()};
  const session=await store.createSession(project.id,{title:'보존할 대화',messages:[message]});
  return {project:project.id,session:session.id,directory,message,draft:{text:'보내기 전의 검증 문장',mode:'plan'}};
}
async function checkProject(page,fixture) {
  const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
  console.log('설치 프로필 / 작업 공간 조회 시작');
  const state=await within(page.evaluate(()=>window.flowrium.bootstrap()),30000,'설치 프로필 작업 공간 조회');
  console.log('설치 프로필 / 작업 공간 조회 완료');
  const project=state.projects.find(p=>p.id===fixture.project);
  assert.equal(path.relative(await fs.realpath(project.path),await fs.realpath(fixture.directory)),'','설치 전후 같은 실제 프로젝트 폴더 보존');
  const session=state.sessions.find(s=>s.id===fixture.session);
  assert.equal(session.projectId,fixture.project);assert.equal(session.workflow,undefined);
  assert.deepEqual(session.messages,[fixture.message]);
}
async function writeOldDraft(page,fixture) {
  const assert=require('node:assert/strict');
  await checkProject(page,fixture);
  page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
  console.log('이전 설치 초안 / API 확인 시작');
  const accountDrafts=await within(page.evaluate(()=>{
    const api=window.flowrium;
    return typeof api?.readDrafts==='function'&&typeof api?.writeDrafts==='function'&&typeof api?.securityState==='function';
  }),30000,'이전 설치 초안 API 확인');
  if(accountDrafts){
    const saved=await within(page.evaluate(async f=>{
      const api=window.flowrium,security=await api.securityState();
      await api.writeDrafts(security.accountRevision,{['session:'+f.session]:f.draft});
      return (await api.readDrafts(security.accountRevision))['session:'+f.session];
    },fixture),30000,'이전 설치 초안 저장');
    assert.deepEqual(saved,fixture.draft);
    await page.reload();await page.waitForLoadState('domcontentloaded');
    const reloaded=await within(page.evaluate(async id=>{
      const api=window.flowrium,security=await api.securityState();
      return (await api.readDrafts(security.accountRevision))['session:'+id];
    },fixture.session),30000,'이전 설치 초안 다시 읽기');
    assert.deepEqual(reloaded,fixture.draft);
    return;
  }
  await within(page.evaluate(f=>localStorage.setItem('flowrium.drafts',JSON.stringify({['session:'+f.session]:f.draft})),fixture),30000,'이전 설치 초안 기록');
  await page.reload();await page.waitForLoadState('domcontentloaded');
  const draft=await within(page.evaluate(id=>JSON.parse(localStorage.getItem('flowrium.drafts'))['session:'+id],fixture.session),30000,'이전 설치 초안 읽기');
  assert.deepEqual(draft,fixture.draft);
}
async function checkNewProfile(binary,temporary,userData,fixture,version) {
  const {_electron}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
  const env={...process.env,CODEX_HOME:path.join(temporary,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  console.log('새 프로필 / 앱 실행 시작');
  const app=await _electron.launch({executablePath:binary,args:['--user-data-dir='+userData],env,timeout:45000});
  try {
    console.log('새 프로필 / 앱 실행 완료');
    assert.equal(await within(app.evaluate(({app})=>app.getVersion()),30000,'새 설치 버전 조회'),version);
    const page=await within(app.firstWindow({timeout:45000}),45000,'새 설치 창 열기');
    page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
    console.log('새 프로필 / 창 열기 완료');
    await within(page.setViewportSize({width:1440,height:1000}),30000,'새 설치 창 크기');
    await checkProject(page,fixture);
    const migrated=await within(page.evaluate(async id=>{
      const api=window.flowrium, security=await api.securityState();
      return (await api.readDrafts(security.accountRevision))['session:'+id];
    },fixture.session),30000,'새 설치 초안 조회');
    assert.deepEqual(migrated,fixture.draft);
    assert.equal(await within(page.evaluate(()=>localStorage.getItem('flowrium.drafts')),30000,'이전 초안 이관 상태 확인'),null);
    console.log('새 프로필 / API 자료와 초안 확인 완료');
    console.log('새 프로필 / 대시보드 선택 시작');
    await page.locator('.workspace-side').hover();
    await page.locator('.workspace-side').getByRole('button',{name:'대시보드',exact:true}).click();
    console.log('새 프로필 / 보존할 대화 선택 시작');
    await page.locator('.pf-row').filter({hasText:'보존할 대화'}).first().click();
    console.log('새 프로필 / 보존할 대화 선택 완료');
    const composer=page.getByLabel('Codex에 보낼 작업 요청',{exact:true});
    await composer.waitFor();
    console.log('새 프로필 / 입력창 초안 복원 대기');
    await page.waitForFunction(text=>document.querySelector('textarea[aria-label="Codex에 보낼 작업 요청"]')?.value===text,fixture.draft.text,{timeout:30000});
    assert.equal(await composer.inputValue(),fixture.draft.text);
    assert.equal(await page.getByLabel('작업 모드',{exact:true}).inputValue(),fixture.draft.mode);
    console.log('새 설치본 재기동 / 이전 프로젝트 주소와 평문 메시지 / 보내지 않은 입력의 이전 및 복원 확인');
  } finally {await closeInstalledApp(app,'새 프로필 검사 앱 종료');}
}
module.exports={bindUpdateTransport,clickAvailable,seedOldProject,writeOldDraft,checkNewProfile,within,closeInstalledApp,execFixture,killOwnedProcess};
