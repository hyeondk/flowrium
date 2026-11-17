const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {trustFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const {composer, openConversation} = require('./shell-test-helpers.cjs');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-chat-model-'));
  const profile = path.join(temp, 'profile');
  const env = {...process.env, FLOWRIUM_USER_DATA:profile, CODEX_HOME:path.join(temp, 'codex'), FLOWRIUM_TEST_CHAT_MODELS:'1', FLOWRIUM_TEST_CATALOG_FILE:path.join(temp,'new-model.fixture')};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app, page;
  const picker = () => page.getByRole('combobox', {name:'이 채팅의 모델', exact:true});
  const button = name => page.getByRole('button', {name, exact:true});
  const snapshot = () => page.evaluate(() => window.flowrium.bootstrap());
  async function launch() {
    app = await _electron.launch({args:[path.resolve(__dirname, '..')], env});
    page = await app.firstWindow();
    await page.setViewportSize({width:1280, height:900});
    page.setDefaultTimeout(10000);
    await button('개인 비서').waitFor();
  }
  const waitForChoice = value => page.waitForFunction(expected => {
    const select = document.querySelector('select[aria-label="이 채팅의 모델"]');
    return select && !select.disabled && select.value === expected;
  }, value);
  async function choose(value) {
    await picker().selectOption(value);
    await waitForChoice(value);
    assert.equal(await page.getByRole('dialog', {name:'설정', exact:true}).count(), 0);
  }
  async function verifyTurn(id, model, effort) {
    const before = (await snapshot()).sessions.find(s => s.id === id).messages.length;
    await composer(page).fill('전송 모델 확인 ' + id);
    await button('작업 보내기').click();
    await page.waitForFunction(async ({id, before, expected}) => {
      const s = (await window.flowrium.bootstrap()).sessions.find(s => s.id === id);
      return s.messages.slice(before).some(m => m.role === 'assistant' && m.text === expected);
    }, {id, before, expected:`실제 전송 / ${model} / ${effort}`});
    await button('작업 보내기').waitFor();
  }
  try {
    const store = new Store(profile);
    await store.load();
    const directory = path.join(temp, '프로젝트');
    await fs.mkdir(directory);
    const project = await store.addProject(directory);
    await trustFixtureProject(store, project, {account:backendFixtureAccount});
    const a = await store.createSession(project.id, {title:'첫 대화', preferences:{answerLength:'short',sandbox:'read-only'}});
    const b = await store.createSession(project.id, {title:'두 번째 대화'});
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'), model:'gpt-6.1-sol', effort:'high'});
    await launch();
    await openConversation(page, a.title);
    await waitForChoice('');
    assert.match(await picker().locator('option:checked').innerText(), /기본 설정 따르기.*GPT-6.1 Sol/);
    await fs.writeFile(env.FLOWRIUM_TEST_CATALOG_FILE,'합성 모델 출시');
    await picker().focus();
    await page.getByText('새 모델을 사용할 수 있습니다. 추가된 시험 모델',{exact:true}).waitFor();
    assert(await picker().locator('option[value="catalog-preview"]').count());
    await choose('catalog-preview');
    await verifyTurn(a.id,'catalog-preview','high');
    assert.equal(await button('이 대화에서 프로젝트 편집 허용').count(),0);
    assert.equal(await page.getByLabel('작업 모드',{exact:true}).count(),0);
    assert.equal((await snapshot()).projects.find(row=>row.id===project.id).trustedForFileAccess,true);
    await composer(page).fill('대기검증');
    await button('작업 보내기').click();
    await button('작업 중지').waitFor();
    await page.waitForFunction(async sid => (await window.flowrium.bootstrap()).sessions.find(s=>s.id===sid).messages.at(-1)?.turnId,a.id);
    await composer(page).fill('현재 단계에 반영해 주세요');
    await composer(page).press('Enter');
    await page.waitForFunction(async sid => (await window.flowrium.bootstrap()).sessions.find(s=>s.id===sid).messages.some(m=>m.text==='추가 지시 반영 / 현재 단계에 반영해 주세요'),a.id);
    await button('작업 보내기').waitFor();
    const delivered=(await snapshot()).sessions.find(s=>s.id===a.id).messages.slice(-2);
    assert.deepEqual(delivered.map(m=>m.role),['user','assistant']);
    assert.equal(delivered[0].text,'현재 단계에 반영해 주세요');
    await choose('gpt-6.1-terra');
    await verifyTurn(a.id,'gpt-6.1-terra','low');
    let state = await snapshot();
    assert.equal(state.settings.model, 'gpt-6.1-sol');
    assert.equal(state.sessions.find(s=>s.id===a.id).preferences.answerLength, 'short');
    await openConversation(page, b.title);
    await waitForChoice('');
    await verifyTurn(b.id,'gpt-6.1-sol','high');
    await app.close();
    app = undefined;
    await launch();
    const title = (await snapshot()).sessions.find(s=>s.id===a.id).title;
    await openConversation(page, title);
    await waitForChoice('gpt-6.1-terra');
    await button('대화 관리').click();
    assert.equal(await page.getByLabel('이 대화의 모델',{exact:true}).inputValue(),'gpt-6.1-terra');
    await button('닫기').click();
    await composer(page).fill('대기검증');
    await button('작업 보내기').click();
    await button('작업 중지').waitFor();
    await choose('gpt-6.1-sol');
    await composer(page).fill('전송 모델 확인 / 대기열');
    await button('추가 지시 대기열에 넣기').click();
    await page.locator('.chat-queue-panel').getByText('전송 모델 확인 / 대기열', {exact:true}).waitFor();
    await choose('gpt-6.1-terra');
    await button('작업 중지').click();
    await page.waitForFunction(async id=>{
      const s=(await window.flowrium.bootstrap()).sessions.find(row=>row.id===id);
      return s.messages.at(-1)?.text==='실제 전송 / gpt-6.1-sol / high' && s.queuedMessages.some(q=>q.status==='sent');
    }, a.id);
    await choose('');
    await verifyTurn(a.id,'gpt-6.1-sol','high');
    await page.evaluate(()=>window.flowrium.saveSettings({model:''}));
    await page.reload();
    await button('개인 비서').waitFor();
    await openConversation(page, title);
    await waitForChoice('');
    await verifyTurn(a.id,'test-model','high');
    state = await snapshot();
    assert.equal(state.sessions.find(s=>s.id===a.id).preferences.model, undefined);
    assert.equal(state.sessions.find(s=>s.id===b.id).preferences?.model, undefined);
    console.log('대화별 모델 화면 검사 통과 / 두 대화 독립·전역 상속 / 재시작 / 전송과 대기열 모델·추론 강도 / 계정 기본값 복귀');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, {recursive:true,force:true,maxRetries:6,retryDelay:100});
  }
}
main().catch(error => {console.error(error); process.exitCode=1;});
