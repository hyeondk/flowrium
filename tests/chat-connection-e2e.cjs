const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {expect} = require('playwright/test');
const {Store} = require('../electron/store.cjs');
const {composer,openConversation} = require('./shell-test-helpers.cjs');
const {addTrustedFixtureProject,backendFixtureAccount} = require('./project-trust-fixture.cjs');

const loginUrl = 'https://auth.openai.com/authorize?test=true';

async function recordWeb(app) {
  await app.evaluate(({app,shell,clipboard}) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    require('./electron/chat-connection.cjs').desktopAppInstalled = async () => false;
    globalThis.flowriumChatWebFixture = {opened:[],copied:[]};
    shell.openExternal = async url => {globalThis.flowriumChatWebFixture.opened.push(url);};
    clipboard.writeText = text => {globalThis.flowriumChatWebFixture.copied.push(text);};
  });
}

async function sidebarAccountAction(page, name) {
  const sidebar = page.locator('.workspace-side');
  if (await sidebar.getAttribute('data-expanded') !== 'true') await sidebar.hover();
  const actions = sidebar.locator('.side-account-actions');
  const action = actions.getByRole('button',{name,exact:true});
  await action.waitFor();
  const opposite = name === '로그인' ? '로그아웃' : '로그인';
  await expect(actions.getByRole('button',{name:opposite,exact:true})).toHaveCount(0);
  return action;
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
    const firstAuthReturn = path.join(temp,'first-oauth.returned');

    app = await _electron.launch({args:[path.resolve(__dirname,'..')],env:{
      ...env,FLOWRIUM_TEST_LOGIN_GATE:firstAuthReturn,
    }});
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({width:1280,height:900});
    await sidebarAccountAction(page,'로그인');
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
    await (await sidebarAccountAction(page,'로그인')).click();
    await expect.poll(() => recorded().then(snapshot => snapshot.opened)).toEqual([
      'https://chatgpt.com/', loginUrl,
    ]);
    await sidebarAccountAction(page,'로그인');
    await fs.writeFile(firstAuthReturn,'');
    await sidebarAccountAction(page,'로그아웃');
    assert.equal(await page.evaluate(async () => (await window.flowrium.securityState()).accountLinked),true);
    console.log('데스크톱 앱 미설치·미로그인 화면 검사 통과 / 초안 보존 / 공식 브라우저 인증 뒤 자동 연결 / 설치 안내 최초 한 번');

    await app.close();
    app = undefined;
    const authenticatedProfile = path.join(temp,'authenticated');
    const authReturn = path.join(temp,'oauth.returned');
    const authenticatedStore = new Store(authenticatedProfile);
    await authenticatedStore.load();
    const authenticatedProject = await addTrustedFixtureProject(authenticatedStore,projectPath);
    const address='https://chatgpt.com/c/7cd4b328-c629-4edb-bed5-2452ad03929a';
    const authenticatedSession=await authenticatedStore.createSession(authenticatedProject.id,{title:'앱 미설치 로그인 시험',preferences:{chatGptUrl:address}});
    await authenticatedStore.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env:{
      ...env,FLOWRIUM_USER_DATA:authenticatedProfile,FLOWRIUM_TEST_LOGIN_GATE:authReturn,
    }});
    const authenticated = await app.firstWindow();
    authenticated.setDefaultTimeout(12000);
    await authenticated.setViewportSize({width:1280,height:900});
    await recordWeb(app);
    const connection = await authenticated.evaluate(() => window.flowrium.connect());
    assert.equal(connection.status.available,true);
    assert.equal(await authenticated.evaluate(async () => (await window.flowrium.securityState()).accountLinked),false);
    await (await sidebarAccountAction(authenticated,'로그인')).click();
    await expect.poll(() => recorded().then(snapshot => snapshot.opened)).toEqual([loginUrl]);
    await sidebarAccountAction(authenticated,'로그인');
    assert.equal(await authenticated.evaluate(async () => (await window.flowrium.securityState()).accountLinked),false);
    await fs.writeFile(authReturn,'');
    await sidebarAccountAction(authenticated,'로그아웃');
    assert.equal(await authenticated.evaluate(async () => (await window.flowrium.securityState()).accountLinked),true);
    assert.deepEqual(await recorded(),{opened:[loginUrl],copied:[]});
    await openConversation(authenticated,authenticatedSession.title);
    const options=authenticated.getByRole('group',{name:'데스크톱 앱과 브라우저 선택'});
    await options.getByRole('button',{name:'데스크톱 앱 설치',exact:true}).click();
    await composer(authenticated).fill(draft);
    await options.getByRole('button',{name:'초안 복사하고 웹 열기',exact:true}).click();
    assert.deepEqual(await recorded(),{opened:[loginUrl,'https://learn.chatgpt.com/docs/app',address],copied:[draft]});
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

    await app.close();
    app=undefined;
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env:{...env,FLOWRIUM_USER_DATA:authenticatedProfile}});
    const reopened=await app.firstWindow();
    await reopened.setViewportSize({width:1280,height:900});
    await sidebarAccountAction(reopened,'로그아웃');
    assert.equal(await reopened.evaluate(async () => (await window.flowrium.securityState()).accountLinked),true);
    console.log('기존 Codex 계정이 있어도 최초 로그인은 공식 브라우저에서 진행 / 인증 뒤 자동 연결 / 재실행 뒤 연결 보존');

    await app.close();
    app=undefined;
    const legacyProfile=path.join(temp,'legacy-account');
    await fs.mkdir(legacyProfile);
    const legacyStore=new Store(legacyProfile);
    await legacyStore.load();
    await legacyStore.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const owner=createHash('sha256').update('flowrium-account:'+backendFixtureAccount.toLowerCase()).digest('hex');
    await fs.writeFile(path.join(legacyProfile,'security.json'),JSON.stringify({
      version:1, preferences:{}, failures:0, retryAt:0, accountOwner:owner,
    }));
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env:{...env,FLOWRIUM_USER_DATA:legacyProfile}});
    const legacy=await app.firstWindow();
    await legacy.setViewportSize({width:1280,height:900});
    await sidebarAccountAction(legacy,'로그아웃');
    console.log('기존 설치의 계정 연결 상태는 업데이트 뒤에도 유지');
  } finally {
    if (app) await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
