// 설치한 앱의 검사/다운로드/종료 코드는 그대로 사용한다. 테스트 릴리스의 HTTPS 응답 본문만 로컬 파일에서 공급한다.
async function bindUpdateTransport(application, fixture) {
  await application.evaluate(({app}, data) => {
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
  }, fixture);
}
async function clickAvailable(application,version) {
  const page=await application.firstWindow();
  await page.setViewportSize({width:1440,height:1000});await page.bringToFront();
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed())?.focus());
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
  const assert=require('node:assert/strict'),path=require('node:path');
  const state=await page.evaluate(()=>window.flowrium.bootstrap());
  const project=state.projects.find(p=>p.id===fixture.project);
  assert.equal(path.relative(project.path,fixture.directory),'');
  const session=state.sessions.find(s=>s.id===fixture.session);
  assert.equal(session.projectId,fixture.project);assert.equal(session.workflow,undefined);
  assert.deepEqual(session.messages,[fixture.message]);
}
async function writeOldDraft(page,fixture) {
  const assert=require('node:assert/strict');
  await checkProject(page,fixture);
  const accountDrafts=await page.evaluate(()=>{
    const api=window.flowrium;
    return typeof api?.readDrafts==='function'&&typeof api?.writeDrafts==='function'&&typeof api?.securityState==='function';
  });
  if(accountDrafts){
    const saved=await page.evaluate(async f=>{
      const api=window.flowrium,security=await api.securityState();
      await api.writeDrafts(security.accountRevision,{['session:'+f.session]:f.draft});
      return (await api.readDrafts(security.accountRevision))['session:'+f.session];
    },fixture);
    assert.deepEqual(saved,fixture.draft);
    await page.reload();await page.waitForLoadState('domcontentloaded');
    const reloaded=await page.evaluate(async id=>{
      const api=window.flowrium,security=await api.securityState();
      return (await api.readDrafts(security.accountRevision))['session:'+id];
    },fixture.session);
    assert.deepEqual(reloaded,fixture.draft);
    return;
  }
  await page.evaluate(f=>localStorage.setItem('flowrium.drafts',JSON.stringify({['session:'+f.session]:f.draft})),fixture);
  await page.reload();await page.waitForLoadState('domcontentloaded');
  const draft=await page.evaluate(id=>JSON.parse(localStorage.getItem('flowrium.drafts'))['session:'+id],fixture.session);
  assert.deepEqual(draft,fixture.draft);
}
async function checkNewProfile(binary,temporary,userData,fixture,version) {
  const {_electron}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
  const env={...process.env,CODEX_HOME:path.join(temporary,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  const app=await _electron.launch({executablePath:binary,args:['--user-data-dir='+userData],env,timeout:45000});
  try {
    assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
    const page=await app.firstWindow();
    await checkProject(page,fixture);
    const migrated=await page.evaluate(async id=>{
      const api=window.flowrium, security=await api.securityState();
      return (await api.readDrafts(security.accountRevision))['session:'+id];
    },fixture.session);
    assert.deepEqual(migrated,fixture.draft);
    assert.equal(await page.evaluate(()=>localStorage.getItem('flowrium.drafts')),null);
    await page.locator('.workspace-side').getByRole('button',{name:'대시보드',exact:true}).click();
    await page.locator('.pf-row').filter({hasText:'보존할 대화'}).first().click();
    const composer=page.getByLabel('Codex에 보낼 작업 요청',{exact:true});
    await composer.waitFor();
    await page.waitForFunction(text=>document.querySelector('textarea[aria-label="Codex에 보낼 작업 요청"]')?.value===text,fixture.draft.text);
    assert.equal(await composer.inputValue(),fixture.draft.text);
    assert.equal(await page.getByLabel('작업 모드',{exact:true}).inputValue(),fixture.draft.mode);
    console.log('새 설치본 재기동 / 이전 프로젝트 주소와 평문 메시지 / 보내지 않은 입력의 이전 및 복원 확인');
  } finally {await app.close();}
}
module.exports={bindUpdateTransport,clickAvailable,seedOldProject,writeOldDraft,checkNewProfile};
