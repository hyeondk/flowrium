const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {addTrustedFixtureProject,backendFixtureAccount} = require('./project-trust-fixture.cjs');
const {openConversation,dockDismissButton,settledLayout,waitForCodexConnection} = require('./shell-test-helpers.cjs');

async function testConversationTabs() {
  const root = path.resolve(__dirname,'..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-conversation-tabs-'));
  const profile = path.join(temp,'profile');
  const errors = [];
  let app;
  try {
    const mapFolder = path.join(temp,'도시 지도');
    const eventFolder = path.join(temp,'지역 행사');
    await Promise.all([fs.mkdir(mapFolder),fs.mkdir(eventFolder)]);
    const store = new Store(profile);
    await store.load();
    const map = await addTrustedFixtureProject(store,mapFolder,{account:backendFixtureAccount});
    const event = await addTrustedFixtureProject(store,eventFolder,{account:backendFixtureAccount});
    const message = text=>({id:randomUUID(),role:'assistant',text,createdAt:new Date().toISOString()});
    const first = await store.createSession(map.id,{title:'골목 지도 초안 작성',messages:[message('골목 지도 기준을 먼저 정했어요.')]});
    const second = await store.createSession(event.id,{title:'동네 행사 일정표 수정',messages:[message('행사 시간과 장소를 확인했어요.')]});
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
    const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root],env,timeout:45000});
    const page = await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:900});
    await waitForCodexConnection(page);
    const dock = page.locator('.conversation-dock');
    const list = dock.getByRole('tablist',{name:'열린 대화',exact:true});
    const scopes = dock.locator('.dock-scope-tabs');
    const composer = dock.getByLabel('Codex에 보낼 작업 요청',{exact:true});
    const add = dock.getByRole('button',{name:'대화 탭 추가',exact:true});
    const tab = title=>list.getByRole('tab',{name:title,exact:true});
    const open = title=>dock.getByRole('tabpanel',{name:title,exact:true}).waitFor();
    const close = title=>list.getByRole('button',{name:`${title} 탭 닫기`,exact:true}).click();

    await openConversation(page,first.title);
    await open(first.title);
    await composer.fill('지도의 색상을 검토할 초안');
    await add.click();
    await dock.getByLabel('대화함 검색',{exact:true}).waitFor();
    assert.equal(await tab(first.title).getAttribute('aria-selected'),'false');
    await openConversation(page,second.title);
    await open(second.title);
    await composer.fill('행사 순서를 조정할 초안');
    assert.equal(await list.getByRole('tab').count(),2);
    assert.match(await tab(first.title).getAttribute('aria-description'),/도시 지도/);
    assert.match(await tab(second.title).getAttribute('aria-description'),/지역 행사/);
    await tab(second.title).press('ArrowLeft');
    await open(first.title);
    assert.equal(await composer.inputValue(),'지도의 색상을 검토할 초안');
    assert.equal(await tab(first.title).evaluate(button=>button===document.activeElement),true);
    await composer.fill('대기검증');
    await dock.getByRole('button',{name:'작업 보내기',exact:true}).click();
    await dock.getByRole('button',{name:'작업 중지',exact:true}).waitFor();
    await tab(second.title).click();
    await open(second.title);
    assert.equal(await composer.inputValue(),'행사 순서를 조정할 초안');
    await list.locator('[data-active=false]:has(i[data-state=running])').waitFor();
    await scopes.getByRole('button',{name:'일반',exact:true}).click();
    await dock.getByRole('button',{name:'새 대화 시작',exact:true}).click();
    const general = '새 일반 대화';
    await open(general);
    await composer.fill('일반 대화에 남길 초안');
    assert.equal(await list.getByRole('tab').count(),3);
    assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.length,3);
    const screenshot = process.env.FLOWRIUM_TABS_SCREENSHOT;
    if(screenshot) {
      await dock.getByRole('button',{name:'대화 패널 넓히기',exact:true}).click();
      await settledLayout(dock);
      await fs.mkdir(path.dirname(screenshot),{recursive:true});
      const png = await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG());
      await fs.writeFile(screenshot,Buffer.from(png));
      await dock.getByRole('button',{name:'대화 패널 좁히기',exact:true}).click();
    }

    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      await settledLayout(dock);
      assert.equal(await add.isVisible(),true);
      await tab(general).press('Home');
      await open(first.title);
      const geometry = await tab(first.title).evaluate(button=>{
        const active = button.parentElement.getBoundingClientRect();
        const scroller = button.closest('[role=tablist]'), viewport = scroller.getBoundingClientRect();
        return active.left>=viewport.left-1 && active.right<=viewport.right+1 &&
          document.documentElement.scrollWidth<=innerWidth+1;
      });
      assert(geometry,`${width}픽셀에서 키보드 전환한 탭이 내부 스크롤로 드러납니다.`);
      await dock.getByRole('button',{name:'작업 중지',exact:true}).waitFor();
      await tab(first.title).press('End');
      await open(general);
      assert.equal(await composer.inputValue(),'일반 대화에 남길 초안');
    }

    await close(first.title);
    assert.equal(await tab(first.title).count(),0);
    await open(general);
    await openConversation(page,first.title);
    await open(first.title);
    await dock.getByRole('button',{name:'작업 중지',exact:true}).click();
    await dock.getByRole('button',{name:'작업 보내기',exact:true}).waitFor();
    await tab(first.title).press('Delete');
    await open(general);
    assert.equal(await tab(general).evaluate(button=>button===document.activeElement),true);
    assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.length,3,'탭을 닫아도 대화 세 건은 보존됩니다.');
    await dockDismissButton(dock).click();
    await dock.waitFor({state:'detached'});
    await page.getByRole('button',{name:'대화 패널 펼치기',exact:true}).click();
    await open(general);
    assert.equal(await composer.inputValue(),'일반 대화에 남길 초안');
    assert.equal(await list.getByRole('tab').count(),2);
    assert.deepEqual(errors,[]);
    console.log('대화 탭 / 프로젝트 간 열기 / 독립 초안 / 새 대화 / 390·320픽셀 가로 이동 / 백그라운드 실행 / 닫기와 복귀 통과');
  }finally {
    if(app)await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});
  }
}

testConversationTabs().catch(error=>{console.error(error);process.exitCode=1;});
