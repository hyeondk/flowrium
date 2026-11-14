const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-report-popup-')));
  let app, page; const errors = [];
  try {
    const profile = path.join(temp, '검증 프로필'), log = path.join(temp, '모델 요청.jsonl'), fake = path.join(temp, '검증 모델.cjs');
    const fixture = (await fs.readFile(path.join(__dirname, 'backend-fake-codex.cjs'), 'utf8'))
      .replace('const request = JSON.parse(line);', 'const request = JSON.parse(line); require("node:fs").appendFileSync(' + JSON.stringify(log) + ', JSON.stringify(request) + "\\n");')
      .replace('{ id: "test-model", model: "test-model", displayName: "검증 모델" },', '{id:"test-model",model:"test-model",displayName:"깊이 검증 모델",isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium",description:"균형"},{reasoningEffort:"xhigh",description:"깊이"}]},{id:"fast-model",model:"fast-model",displayName:"빠른 검증 모델",supportedReasoningEfforts:[{reasoningEffort:"minimal"}]}')
      .replace('require("./teams-fake-response.cjs")', 'require(' + JSON.stringify(path.join(__dirname, 'teams-fake-response.cjs')) + ')');
    await fs.writeFile(fake, fixture);
    const store = new Store(profile); await store.load(); await store.saveSettings({ codexPath: fake, theme: 'light' });
    const projects = [];
    for (const name of ['첫 보고 프로젝트', '두 번째 보고 프로젝트']) { const folder = path.join(temp, name); await fs.mkdir(folder); const project = await store.addProject(folder); projects.push(project); await store.createSession(project.id, { title: name + ' 최근 작업' }); }
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({ args: [root], env, timeout: 45000 }); page = await app.firstWindow(); page.setDefaultTimeout(16000); page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.getByRole('heading', { name: '프로젝트 대시보드', exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('.side-usage')?.dataset.connected === 'true');
    const originalView = await page.locator('.main-shell').getAttribute('data-view');
    const snapshot = () => page.evaluate(() => window.flowrium.bootstrap());
    async function open(title) { await page.locator('.workspace-side').hover(); await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: title, exact: true }).click(); const dialog = page.getByRole('dialog', { name: title, exact: true }); await dialog.waitFor(); await dialog.getByLabel('보고서 AI 모델', { exact: true }).locator('option[value="test-model"]').waitFor({ state: 'attached' }); await page.waitForTimeout(300); return dialog; }
    async function assertCentered(dialog, width) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(350);
      const box = await dialog.boundingBox(); assert(Math.abs(box.x + box.width / 2 - width / 2) < 2, '팝업 수평 중앙'); assert(Math.abs(box.y + box.height / 2 - 500) < 2, '팝업 수직 중앙');
      assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= 1001, '팝업 화면 안에 유지');
      assert.equal(await page.locator('.main-shell').getAttribute('data-view'), originalView, '원래 화면 유지');
      const overflow = await dialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth })); assert(overflow.scroll <= overflow.client + 1, '팝업 가로 넘침 없음');
    }
    let dialog = await open('주간업무보고');
    for (const width of [1440, 800, 390]) await assertCentered(dialog, width);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(350);
    assert.equal(await dialog.evaluate(element => element.parentElement?.parentElement === document.body), true, '본문 포털에 팝업 배치');
    await dialog.getByRole('button', { name: '전체 선택', exact: true }).click();
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('test-model');
    assert.deepEqual(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['', 'medium', 'xhigh']);
    await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('xhigh');
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('fast-model');
    assert.equal(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).inputValue(), '');
    assert.deepEqual(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['', 'minimal']);
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('test-model'); await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('xhigh');
    await dialog.getByRole('button', { name: '직접 정하기', exact: true }).click(); await dialog.getByLabel('조회 시작일', { exact: true }).fill('2026-11-01'); await dialog.getByLabel('조회 종료일', { exact: true }).fill('2026-11-06');
    await dialog.getByLabel('덧붙일 말 선택 사항', { exact: true }).fill('완료한 업무를 과제별로 정리');
    await dialog.getByText('제목과 보고 형식 설정', { exact: true }).click(); await dialog.getByLabel('보고서 제목', { exact: true }).fill('팝업 검증 주간보고');
    if (process.env.FLOWRIUM_REPORTS_SCREENSHOT) { await fs.mkdir(path.dirname(process.env.FLOWRIUM_REPORTS_SCREENSHOT), { recursive: true }); await page.screenshot({ path: process.env.FLOWRIUM_REPORTS_SCREENSHOT }); }
    await dialog.getByRole('button', { name: 'ChatGPT로 보고서 작성', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).sessions.some(session => session.title === '팝업 검증 주간보고' && session.messages.some(message => message.role === 'assistant')));
    let data = await snapshot(); const report = data.sessions.find(session => session.title === '팝업 검증 주간보고'); assert.equal(report.preferences.model, 'test-model'); assert.equal(report.preferences.effort, 'xhigh'); assert.deepEqual(report.workflow.reportProjects, projects.map(project => project.id)); assert.equal(report.workflow.from, '2026-11-01'); assert.equal(report.workflow.to, '2026-11-06');
    dialog = await open('주간업무보고'); await dialog.getByRole('button', { name: '작성된 보고', exact: true }).click(); await dialog.getByRole('button').filter({ hasText: '팝업 검증 주간보고' }).click(); await dialog.waitFor({ state: 'detached' });
    dialog = await open('업무 마감'); await dialog.getByRole('button', { name: '전체 선택', exact: true }).click(); await dialog.getByRole('button', { name: '회의', exact: true }).click();
    await dialog.getByLabel('복귀할 때 참고할 메모 선택 사항', { exact: true }).fill('회의 후 검증 결과 이어서 확인'); await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('fast-model'); await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('minimal');
    await dialog.getByText('제목과 인계 대상 설정', { exact: true }).click(); await dialog.getByLabel('마감 기록 제목', { exact: true }).fill('팝업 검증 업무마감'); await dialog.getByRole('button', { name: 'ChatGPT로 업무 마감 작성', exact: true }).click();
    await dialog.getByRole('heading', { name: 'AI 작업을 시작했습니다', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).sessions.filter(session => session.title === '팝업 검증 업무마감' && session.messages.some(message => message.role === 'assistant')).length === 2);
    data = await snapshot(); const endings = data.sessions.filter(session => session.title === '팝업 검증 업무마감'); assert.equal(endings.length, 2); assert.deepEqual(new Set(endings.map(session => session.projectId)), new Set(projects.map(project => project.id)));
    for (const session of endings) { assert.equal(session.preferences.model, 'fast-model'); assert.equal(session.preferences.effort, 'minimal'); assert.equal(session.workflow.brief, '회의 / 회의 후 검증 결과 이어서 확인'); }
    await dialog.getByRole('button', { name: '닫기', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.locator('.main-shell').getAttribute('data-view'), originalView);
    const requests = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(request => request.method === 'turn/start');
    assert(requests.some(request => request.params.model === 'test-model' && request.params.effort === 'xhigh'), '주간보고 실제 모델과 강도 요청');
    assert.equal(requests.filter(request => request.params.model === 'fast-model' && request.params.effort === 'minimal').length, 2, '프로젝트별 마감 실제 모델과 강도 요청');
    assert.deepEqual(errors, []);
    console.log('보고와 마감 실제 앱 팝업 / 중앙 위치와 본문 포털 / 원래 화면 유지 / 1440·800·390폭 / 계정 실제 모델·지원 추론 강도 / 모델 변경 초기화 / AI 보고 생성 / 기록 열기 / 프로젝트별 AI 마감 / 실제 요청 전달 검증 통과');
  } catch (error) { if (page && !page.isClosed()) console.error('실패 시 실제 화면', await page.locator('body').innerText().catch(() => '')); throw error; }
  finally { if (app) await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
