// 홈페이지 대표 그림을 실제 데스크톱 앱에서 격리된 공개용 자료만 사용해 촬영한다.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { registerPortfolio } = require('../electron/portfolio.cjs');
const { registerProjectDetails } = require('../electron/project-details.cjs');
const { openConversation, settledLayout } = require('../tests/shell-test-helpers.cjs');

async function capture() {
  const { monthlySales, amount, salesAnswer } = await import('../docs/sales-example.mjs');
  const root = path.resolve(__dirname, '..');
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-store-example-')));
  const profile = path.join(temp, 'profile');
  let app;
  try {
    const store = new Store(profile);
    await store.load();
    await store.saveSettings({ theme: 'light', codexPath: path.join(root, 'tests/backend-fake-codex.cjs') });
    const api = {};
    const register = (name, action) => { api[name] = action; };
    registerPortfolio(register, store, { chooseFolder: async () => temp, reveal: () => {} });
    registerProjectDetails(register, store);
    const project = await api.kickoffProject({
      name: '온라인 스토어 매출 분석', goal: '상반기 주문 자료를 집계합니다.', owner: '스토어 운영팀',
      privacy: '업무', createFolder: true, phase: '진행',
    });
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
    const localDay = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    let details = await api.readProjectDetails(project.id);
    details = await api.updateProjectDetails(project.id, details.revision, {
      action: 'goal-add', period: 'week', key: localDay(monday), text: '월별 자료 확인', target: 6, due: localDay(now),
    });
    details = await api.updateProjectDetails(project.id, details.revision, { action: 'goal-progress', id: details.periodGoals.at(-1).id, current: 6 });
    for (const text of ['월별 주문 합계 확인', '증감 원인 정리']) {
      details = await api.updateProjectDetails(project.id, details.revision, {action: 'add', text});
    }
    const data = ['| 월 | 매출 (만 원) |', '| :--- | ---: |', ...monthlySales.map((value, index) => `| ${index + 1}월 | ${amount(value)} |`)].join('\n');
    const session = await store.createSession(project.id, {
      title: '상반기 매출 흐름',
      messages: [
        { id: randomUUID(), role: 'user', text: '상반기 매출 흐름을 보여줘.', createdAt: now.toISOString() },
        { id: randomUUID(), role: 'assistant', text: `${salesAnswer}\n\n${data}\n\n3월에는 매출이 잠시 줄었고, 4월부터 다시 늘었어요.`, createdAt: now.toISOString() },
      ],
    });
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') };
    for (const key of ['ELECTRON_RENDERER_URL','ELECTRON_RUN_AS_NODE','OPENAI_API_KEY']) delete env[key];
    app = await _electron.launch({ args: [root], env, timeout: 45000 });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    page.setDefaultTimeout(30000);
    await page.locator('.side-usage[data-connected=true]').waitFor();
    await page.locator('.workspace-side').hover();
    await page.locator('.side-project').filter({ hasText: project.name }).click();
    await openConversation(page, session.title);
    await page.getByRole('region',{name:'이번 주 목표'}).getByText('월별 자료 확인',{exact:true}).waitFor();
    for (const text of ['월별 주문 합계 확인','증감 원인 정리']) await page.getByRole('region',{name:'프로젝트 할 일'}).getByText(text,{exact:true}).waitFor();
    const answer = page.locator('.message.assistant');
    await answer.getByText(salesAnswer, { exact: true }).waitFor();
    assert.deepEqual(await answer.locator('tbody tr td:last-child').allTextContents(), monthlySales.map(amount));
    await page.evaluate(() => document.fonts.ready);
    await settledLayout(page.locator('.conversation-dock'));
    const publicText = await page.locator('body').innerText();
    for (const token of [temp, os.homedir(), 'backend-fake-codex', '모의 계정', '편집 허용']) assert(!publicText.includes(token),'공개 이미지에 실행 경로나 계정이 보입니다.');
    await page.screenshot({ path: path.join(root, 'docs/workspace-sales.png'), animations: 'disabled', scale: 'css' });
    // Electron의 페이지 배율을 반영해 답변 영역을 잘라야 왼쪽 글자가 잘리지 않는다.
    const answerBox = await answer.boundingBox();
    assert(answerBox && answerBox.width > 0 && answerBox.height > 0);
    const chatImage = await app.evaluate(async ({BrowserWindow}, box) => {
      const window = BrowserWindow.getAllWindows()[0];
      const zoom = window.webContents.getZoomFactor();
      const bounds = {x:Math.floor(box.x*zoom),y:Math.floor(box.y*zoom),width:Math.ceil(box.width*zoom),height:Math.ceil(box.height*zoom)};
      const image = await window.webContents.capturePage(bounds);
      return {data:image.toPNG().toString('base64'),width:image.getSize().width,height:image.getSize().height};
    }, answerBox);
    assert(chatImage.width > 250 && chatImage.height > 180, '답변 전체를 읽을 수 있는 캡처 크기');
    await fs.writeFile(path.join(root, 'docs/workspace-sales-chat.png'), Buffer.from(chatImage.data, 'base64'));
    console.log('격리된 실제 앱에서 월별 입력 6개 / 50% 답변 / 프로젝트 업무와 대화 / 모바일용 답변 확대 사진 촬영');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
capture().catch(error => { console.error(error); process.exitCode=1; });
