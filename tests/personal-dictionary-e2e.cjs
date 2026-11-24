const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { addTrustedFixtureProject, backendFixtureAccount } = require('./project-trust-fixture.cjs');
const { closeSettings, composer, openConversation, settledLayout } = require('./shell-test-helpers.cjs');
const { closeInstalledApp } = require('./update-installed-ui.cjs');

const development = '합성배포관문';
const design = '합성기준격자';
const analysis = '합성잔존율';
const renamed = '합성재방문율';
const pin = '7913';
const firstPrompt = `${development}을 기준으로 이 배포 요청을 확인해줘. 사전 검사 켜짐.`;
const secondPrompt = `${development}을 기준으로 이 배포 요청을 확인해줘. 사전 검사 꺼짐.`;
const unrelatedPrompt = '회의실 예약 가능 시각을 확인해줘. 사전 일치 없음 검사.';
const fakeEngine = path.join(__dirname, 'backend-fake-codex.cjs');
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const label = (scope, name) => scope.getByLabel(name, { exact: true });

async function recordModelRequests(application) {
  // 격리 앱에서 실제 전송 직전의 합성 요청만 기록하고, 원래 RPC는 그대로 실행한다.
  await application.evaluate(({ app }) => {
    const module = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const load = module.createRequire(path.join(app.getAppPath(), 'package.json'));
    const { CodexClient } = load('./electron/codex.cjs');
    const original = CodexClient.prototype.rawRequest;
    globalThis.dictionaryTestRequests = [];
    CodexClient.prototype.rawRequest = function (method, params, ...options) {
      if (method === 'turn/start') globalThis.dictionaryTestRequests.push(structuredClone(params));
      return original.call(this, method, params, ...options);
    };
  });
}

async function readRequest(application, prompt) {
  const matching = await application.evaluate((_, requested) => globalThis.dictionaryTestRequests
    .filter(request => request.input?.some(item => item.type === 'text' && item.text === requested)), prompt);
  assert.equal(matching.length, 1, '지정한 사용자 요청이 엔진에 한 번만 전달되어야 합니다.');
  return matching[0];
}

async function captureDictionary(app, panel, destination) {
  const bounds = await panel.evaluate(element => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom, width: innerWidth, height: innerHeight };
  });
  const png = await app.evaluate(async ({ BrowserWindow }, box) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
    const size = image.getSize();
    const scaleX = size.width / box.width;
    const scaleY = size.height / box.height;
    const x = Math.max(0, Math.floor(box.left * scaleX));
    const y = Math.max(0, Math.floor(box.top * scaleY));
    const right = Math.min(size.width, Math.ceil(box.right * scaleX));
    const bottom = Math.min(size.height, Math.ceil(box.bottom * scaleY));
    return image.crop({ x, y, width: right - x, height: bottom - y }).toPNG().toString('base64');
  }, bounds);
  await fs.writeFile(destination, Buffer.from(png, 'base64'));
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-dictionary-screen-'));
  let app;
  let page;
  try {
    const profile = path.join(temp, 'profile');
    const folder = path.join(temp, '사전 시험 프로젝트');
    await fs.mkdir(folder);
    const store = new Store(profile);
    await store.load();
    const project = await addTrustedFixtureProject(store, folder, { account: backendFixtureAccount });
    const session = await store.createSession(project.id, { title: '관련 단어 전달 확인' });
    await store.saveSettings({ codexPath: fakeEngine, theme: 'light' });
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;

    async function launch() {
      app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env, timeout: 45000 });
      page = await app.firstWindow();
      page.setDefaultTimeout(18000);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }

    async function close() {
      await closeInstalledApp(app, '개인 사전 검사 앱 종료');
      app = null;
    }

    const side = () => page.locator('.workspace-side');
    async function sidebarAction(name) {
      await side().hover();
      await button(side(), name).click();
    }

    const title = () => page.getByRole('heading', { name: '개인 사전', exact: true });
    const card = (term) => page.getByRole('article', { name: term, exact: true });
    const search = () => label(page, '사전 검색');
    const reference = () => page.getByRole('switch', { name: '대화에서 사전 참고', exact: true });

    async function openDictionary() {
      if (!await title().isVisible()) await sidebarAction('사전');
      await title().waitFor();
      await search().waitFor();
      await label(page, '단어 입력').waitFor();
    }

    const entryDate = (term) => card(term).locator('time').getAttribute('datetime');
    async function addWord(term, enter = false) {
      const before = Date.now();
      const field = label(page, '단어 입력');
      await field.fill(term);
      if (enter) await field.press('Enter');
      else await button(page, '추가').click();
      await card(term).waitFor();
      assert.equal(await field.inputValue(), '', '단어를 추가한 직후 다음 단어를 입력할 수 있어야 합니다.');
      const date = await entryDate(term);
      const stamp = Date.parse(date);
      assert(stamp >= before && stamp <= Date.now(), '처음 추가한 날짜를 표시해야 합니다.');
      assert((await card(term).locator('time').innerText()).trim(), '추가 날짜를 화면에서 읽을 수 있어야 합니다.');
      return date;
    }

    async function setReference(enabled) {
      if ((await reference().isChecked()) !== enabled) await reference().click();
      await page.waitForFunction(expected => {
        const toggle = document.querySelector('[role=switch][aria-label="대화에서 사전 참고"]');
        return toggle?.checked === expected && !toggle.disabled;
      }, enabled);
    }

    async function send(prompt) {
      await openConversation(page, session.title);
      const stored = await page.evaluate(async id => (await window.flowrium.bootstrap())
        .sessions.find(item => item.id === id).messages.filter(message => message.role === 'assistant').length, session.id);
      await composer(page).fill(prompt);
      await composer(page).press('Enter');
      await page.waitForFunction(async ({ id, prompt, stored }) => {
        const messages = (await window.flowrium.bootstrap()).sessions.find(item => item.id === id).messages;
        return messages.some(message => message.role === 'user' && message.text === prompt)
          && messages.filter(message => message.role === 'assistant' && message.text.includes('확인한 결과입니다.')).length > stored;
      }, { id: session.id, prompt, stored });
      return readRequest(app, prompt);
    }

    await launch();
    await recordModelRequests(app);
    await button(side(), '로그아웃').waitFor();
    await openDictionary();
    const addedDate = await addWord(development);
    await addWord(design, true);
    const analysisDate = await addWord(analysis);
    const dictionary = await page.evaluate(() => window.flowrium.dictionaryState());
    assert.equal(dictionary.entries.length, 3);
    for (const entry of dictionary.entries) assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'id', 'term']);

    await button(card(analysis), '수정').click();
    const editor = page.getByRole('dialog', { name: '단어 수정', exact: true });
    await label(editor, '단어 입력').fill(renamed);
    await button(editor, '저장').click();
    await editor.waitFor({ state: 'hidden' });
    await card(analysis).waitFor({ state: 'hidden' });
    await card(renamed).waitFor();
    assert.equal(await entryDate(renamed), analysisDate, '단어를 수정해도 최초 추가 날짜는 유지해야 합니다.');
    if (process.env.FLOWRIUM_DICTIONARY_PREVIEW) {
      const panel = page.locator('.personal-dictionary');
      await settledLayout(panel);
      await captureDictionary(app, panel, process.env.FLOWRIUM_DICTIONARY_PREVIEW);
    }

    await search().fill('배포관');
    await card(development).waitFor();
    await card(design).waitFor({ state: 'hidden' });
    await card(renamed).waitFor({ state: 'hidden' });
    await search().fill('기준격');
    await card(design).waitFor();
    await card(development).waitFor({ state: 'hidden' });
    await card(renamed).waitFor({ state: 'hidden' });

    for (const width of [320, 390, 800, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await settledLayout(card(design));
      const fit = await card(design).evaluate(node => {
        const root = document.documentElement;
        const bounds = node.getBoundingClientRect();
        return {
          page: root.scrollWidth <= root.clientWidth + 1,
          card: node.scrollWidth <= node.clientWidth + 1 && bounds.left >= -1 && bounds.right <= innerWidth + 1,
        };
      });
      assert(fit.page && fit.card, `개인 사전 카드가 ${width}픽셀 화면의 가로폭을 넘었습니다. ${JSON.stringify(fit)}`);
    }
    await search().fill('');
    await setReference(true);
    const matching = await send(firstPrompt);
    const context = matching.additionalContext?.flowrium_dictionary;
    assert.equal(context?.kind, 'untrusted');
    const referenceList = context.value.split('\n').find(line => line.startsWith('['));
    assert(referenceList, '현재 요청에 닿는 단어 목록을 모델 참고 문맥에서 찾을 수 있어야 합니다.');
    assert.deepEqual(JSON.parse(referenceList), [development], '현재 요청과 일치하는 단어만 전달해야 합니다.');
    const unrelated = await send(unrelatedPrompt);
    assert.equal(unrelated.additionalContext?.flowrium_dictionary, undefined,
      '새 요청과 무관해진 이전 차례의 단어는 모델에 새 참고 문맥으로 전달되지 않아야 합니다.');

    await openDictionary();
    await setReference(false);
    const disabled = await send(secondPrompt);
    assert.equal(disabled.additionalContext?.flowrium_dictionary, undefined);

    await openDictionary();
    await button(card(design), '삭제').click();
    const confirm = page.getByRole('dialog', { name: '단어를 삭제할까요?', exact: true });
    await button(confirm, '삭제').click();
    await confirm.waitFor({ state: 'hidden' });
    await card(design).waitFor({ state: 'hidden' });
    await sidebarAction('설정');
    await page.locator('[data-settings-target=security]').click();
    await label(page, '새 잠금 번호').fill(pin);
    await label(page, '새 번호 확인').fill(pin);
    await button(page, '잠금 번호 설정').click();
    await page.getByText('잠금 번호를 저장했습니다.', { exact: true }).waitFor();
    await closeSettings(page);
    await sidebarAction('잠금');
    await page.getByRole('heading', { name: '화면 잠금', exact: true }).waitFor();
    await title().waitFor({ state: 'hidden' });
    await assert.rejects(page.evaluate(() => window.flowrium.dictionaryState()), /잠겼습니다/);

    await close();
    await launch();
    await page.getByRole('heading', { name: '화면 잠금', exact: true }).waitFor();
    await label(page, '잠금 번호').fill(pin);
    await button(page, '잠금 해제').click();
    await openDictionary();
    await card(development).waitFor();
    await card(renamed).waitFor();
    assert.equal(await entryDate(development), addedDate);
    assert.equal(await entryDate(renamed), analysisDate);
    await card(design).waitFor({ state: 'hidden' });
    assert.equal(await reference().isChecked(), false);
    console.log('실제 앱 개인 사전 검증 통과 / 단어 빠른 추가·검색·수정·삭제 / 최초 추가 날짜 유지 / 가로 배치 / 관련 단어만 모델 전달 / PIN 잠금과 재시작');
  } finally {
    try {
      if (app) await closeInstalledApp(app, '개인 사전 검사 앱 정리');
    } finally {
      await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
