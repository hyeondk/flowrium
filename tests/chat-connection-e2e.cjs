const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {composer,openConversation} = require('./shell-test-helpers.cjs');

async function recordWeb(app) {
  await app.evaluate(({app,shell,clipboard}) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    require('./electron/chat-connection.cjs').desktopAppInstalled = async () => false;
    globalThis.flowriumChatWebFixture = {opened:[],copied:[]};
    shell.openExternal = async url => {globalThis.flowriumChatWebFixture.opened.push(url);};
    clipboard.writeText = text => {globalThis.flowriumChatWebFixture.copied.push(text);};
  });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-chat-connection-'));
  const profile = path.join(temp,'profile');
  const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app;
  try {
    const fixture = path.join(temp,'logged-out.cjs');
    await fs.writeFile(fixture,`process.argv.push('--no-account');require(${JSON.stringify(path.join(__dirname,'backend-fake-codex.cjs'))});`);
    const projectPath = await fs.mkdtemp(path.join(temp,'project-'));
    const store = new Store(profile);
    await store.load();
    const project = await store.addProject(projectPath);
    const session = await store.createSession(project.id,{title:'웹 연결 시험'});
    await store.saveSettings({codexPath:fixture});

    app = await _electron.launch({args:[path.resolve(__dirname,'..')],env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({width:1280,height:900});
    await page.locator('.workspace-side').hover();
    const accountActions=page.locator('.side-account-actions');
    await accountActions.getByRole('button',{name:'로그인',exact:true}).waitFor();
    assert.equal(await accountActions.getByRole('button',{name:'로그아웃',exact:true}).count(),0);
    await recordWeb(app);

    const draft = '시험용 대화 초안\n웹에서 이어서 처리해 주세요.';
    const notice = '데스크톱 앱을 설치하면 Flowrium과 Codex 대화를 양방향으로 이어갈 수 있습니다.';
    const send = page.getByRole('button',{name:'작업 보내기',exact:true});
    const fallback = page.getByRole('region',{name:'브라우저에서 대화 이어가기'});
    const recorded = () => app.evaluate(() => globalThis.flowriumChatWebFixture);
    await openConversation(page,session.title);
    await composer(page).fill(draft);
    await send.click();
    await fallback.waitFor();
    await page.getByText(notice,{exact:true}).waitFor();
    assert.deepEqual(await recorded(),{opened:[],copied:[]});
    assert.equal(await composer(page).inputValue(),draft);
    assert(await fallback.getByRole('button',{name:'Flowrium에서 로그인',exact:true}).isVisible());
    await fallback.getByRole('button',{name:'초안 복사하고 웹 열기',exact:true}).click();
    assert.deepEqual(await recorded(),{opened:['https://chatgpt.com/'],copied:[draft]});
    const snapshot = await page.evaluate(() => window.flowrium.bootstrap());
    assert.equal(snapshot.sessions.find(row => row.id === session.id).messages.length,0);

    await page.reload();
    await openConversation(page,session.title);
    assert.equal(await composer(page).inputValue(),draft);
    await send.click();
    await fallback.waitFor();
    assert.equal(await page.getByText(notice,{exact:true}).count(),0);
    assert(await fallback.getByRole('button',{name:'데스크톱 앱 설치',exact:true}).isVisible());
    console.log('데스크톱 앱 미설치·미로그인 화면 검사 통과 / 초안 보존 / 공식 웹과 로그인 선택 / 설치 안내 최초 한 번');

    await app.close();
    app = undefined;
    const authenticatedProfile = path.join(temp,'authenticated');
    const authenticatedStore = new Store(authenticatedProfile);
    await authenticatedStore.load();
    const authenticatedProject = await require('./project-trust-fixture.cjs').addTrustedFixtureProject(authenticatedStore,projectPath);
    const address='https://chatgpt.com/c/7cd4b328-c629-4edb-bed5-2452ad03929a';
    const authenticatedSession=await authenticatedStore.createSession(authenticatedProject.id,{title:'앱 미설치 로그인 시험',preferences:{chatGptUrl:address}});
    await authenticatedStore.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env:{...env,FLOWRIUM_USER_DATA:authenticatedProfile}});
    const authenticated = await app.firstWindow();
    authenticated.setDefaultTimeout(12000);
    await authenticated.setViewportSize({width:1280,height:900});
    await recordWeb(app);
    await authenticated.locator('.workspace-side').hover();
    await authenticated.locator('.side-account-actions').getByRole('button',{name:'로그아웃',exact:true}).waitFor();
    await openConversation(authenticated,authenticatedSession.title);
    const options=authenticated.getByRole('group',{name:'데스크톱 앱과 브라우저 선택'});
    await options.getByRole('button',{name:'데스크톱 앱 설치',exact:true}).click();
    await composer(authenticated).fill(draft);
    await options.getByRole('button',{name:'초안 복사하고 웹 열기',exact:true}).click();
    assert.deepEqual(await recorded(),{opened:['https://learn.chatgpt.com/docs/app',address],copied:[draft]});
    assert.equal(await composer(authenticated).inputValue(),draft);
    const syncedTitle='다른 창에서 바꾼 시험 제목';
    await app.evaluate(({BrowserWindow},{id,title})=>BrowserWindow.getAllWindows()[0].webContents.send('flowrium:event',{type:'sessionTitle',sessionId:id,title}),{id:authenticatedSession.id,title:syncedTitle});
    await authenticated.locator('.session-heading').getByRole('heading',{name:syncedTitle,exact:true}).waitFor();
    assert.equal(await composer(authenticated).inputValue(),draft);
    await authenticated.getByRole('button',{name:'작업 보내기',exact:true}).click();
    await authenticated.waitForFunction(async({id,text})=>{
      const chat=(await window.flowrium.bootstrap()).sessions.find(row=>row.id===id);
      return chat.messages.some(message=>message.role==='user'&&message.text===text);
    },{id:authenticatedSession.id,text:draft});
    console.log('데스크톱 앱 미설치·로그인 화면 검사 통과 / 공식 설치와 저장한 웹 주소 열기 / Flowrium에서 새 요청 전송');
  } finally {
    if (app) await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
