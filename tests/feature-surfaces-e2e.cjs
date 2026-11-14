const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-feature-surfaces-'));
  const folder = path.join(temp, '화면 검증 프로젝트');
  const profile = path.join(temp, '분리한 프로필');
  await fs.mkdir(folder);
  await fs.mkdir(path.join(folder, '산출물'));
  await fs.writeFile(path.join(folder, '산출물', '검증 문서.html'), '<h1>기능 화면 검증 문서</h1><p>합성 자료로 확인하는 문서입니다.</p>');
  const store = new Store(profile);
  await store.load();
  await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs'), theme: 'light' });
  const project = await store.addProject(folder);
  await store.createSession(project.id, { title: '화면 검증 업무 대화' });
  const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app, page;
  const samples = [], errors = [];
  const widths = [1440, 1024, 800, 390, 320];
  const button = name => page.getByRole('button', { name, exact: true });
  const tab = name => page.getByRole('navigation', { name: '프로젝트 상세 탭' }).getByRole('button', { name, exact: true });
  async function navigate(name) {
    await page.locator('.workspace-side').hover();
    await page.waitForFunction(() => document.querySelector('.workspace-side')?.dataset.expanded === 'true');
    await page.waitForTimeout(300);
    await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: true }).click();
    await page.mouse.move(900, 85);
    await page.waitForTimeout(550);
  }
  async function foldDock() {
    const fold = button('대화함 접기');
    if (await fold.isVisible()) {
      await fold.click();
      await page.locator('.conversation-dock').waitFor({ state: 'detached' });
    }
  }
  async function measure(label) {
    const sample = await page.evaluate(label => {
      const main = document.querySelector('.main-shell');
      const cards = [...document.querySelectorAll('.pf-panel,.team-panel,.workflow-hub,.repo-page>fieldset,.repo-page>.repo-inspection,.repo-page>.repo-batch,.project-ports,.project-details,.di-card')]
        .filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none')
        .map(node => {
          const css = getComputedStyle(node), box = node.getBoundingClientRect();
          return { className: node.className, padding: parseFloat(css.paddingLeft), left: box.left, right: box.right, width: box.width, scroll: node.scrollWidth, client: node.clientWidth };
        });
      return { label, width: innerWidth, document: document.documentElement.scrollWidth, mainScroll: main?.scrollWidth, mainClient: main?.clientWidth, cards };
    }, label);
    assert.ok(sample.document <= sample.width + 1, '문서 가로 넘침 / ' + JSON.stringify(sample));
    assert.ok(sample.mainScroll <= sample.mainClient + 1, '본문 가로 넘침 / ' + JSON.stringify(sample));
    for (const card of sample.cards) {
      assert.ok(card.padding >= 16, '면 내부 여백 / ' + JSON.stringify({ label, ...card }));
      assert.ok(card.scroll <= card.client + 1, '면 가로 넘침 / ' + JSON.stringify({ label, ...card }));
    }
    samples.push(sample);
  }
  async function screenshot(name) {
    if (!process.env.FLOWRIUM_FEATURE_SCREENSHOTS) return;
    await fs.mkdir(process.env.FLOWRIUM_FEATURE_SCREENSHOTS, { recursive: true });
    await page.mouse.move(900, 85);
    await page.waitForTimeout(550);
    await page.screenshot({ path: path.join(process.env.FLOWRIUM_FEATURE_SCREENSHOTS, name + '.png') });
  }
  try {
    app = await _electron.launch({ args: [root], env, timeout: 45000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('heading', { name: '프로젝트 대시보드', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.side-account i')?.dataset.connected === 'true');
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await foldDock();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      await measure('대시보드 / ' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot('dashboard');
    await page.locator('.pf-card').filter({ hasText: project.name }).click();
    await foldDock();
    const tabs = ['홈', '업무 현황', '팀', 'GitHub', '규칙', '디자인 시안', '회의록', '문서', '프로젝트 설정'];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      for (const name of tabs) {
        await tab(name).click();
        if (name === 'GitHub') {
          await page.locator('.repo-page').waitFor();
          assert.equal(await page.locator('.repo-page').evaluate(node => getComputedStyle(node).display), 'grid', '형상관리 전체 페이지는 행동 버튼 행으로 배치하지 않음');
        }
        if (name === '업무 현황') {
          await page.locator('.workbench section.wb-actions').waitFor();
          assert.equal(await page.locator('.workbench section.wb-actions').evaluate(node => getComputedStyle(node).display), 'block', '새 업무 제목과 카드 묶음을 행동 버튼 행으로 배치하지 않음');
        }
        if (name === '프로젝트 설정') await page.locator('.project-ports').waitFor();
        await measure(name + ' / ' + width);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await tab('팀').click();
    await button('팀 만들기').click();
    await page.getByLabel('팀 이름', { exact: true }).fill('합성 검증 팀');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      await measure('팀 역할 편집 / ' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot('team-form');
    await page.locator('.team-actions').getByRole('button', { name: '취소', exact: true }).click();
    await tab('프로젝트 설정').click();
    await page.locator('.project-details > summary').click();
    await page.getByLabel('프로젝트 목표', { exact: true }).fill('현재 화면에서 실제 사용할 목표와 기한을 확인합니다.');
    await page.locator('.pp-editor').first().locator('summary').click();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      await measure('프로젝트 상세와 포트 편집 / ' + width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot('project-settings');
    await tab('규칙').click();
    await page.locator('.project-ai-actions > summary').click();
    await measure('AI 규칙 작성 폼');
    await button('메모 추가').click();
    await page.getByLabel('메모 제목').fill('화면 검증 기준');
    await page.getByLabel('지시와 메모').fill('문장은 어절을 유지하고 자연스럽게 줄바꿈합니다.');
    await measure('기억 편집 폼');
    await button('메모 저장').click();
    await page.locator('.memory-list button').filter({ hasText: '화면 검증 기준' }).waitFor();
    await measure('기억 저장 목록');
    await screenshot('project-rules');
    await tab('GitHub').click();
    await page.locator('.repo-batch > summary').click();
    await measure('형상관리 통합 실행 펼침');
    await screenshot('repository');
    await navigate('업무 연결 / 비서');
    await page.getByRole('heading', { name: '업무 연결과 비서', exact: true }).waitFor();
    const workflowTabs = page.getByRole('navigation', { name: '업무 연결 화면' });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      for (const name of [/^결정과 보고$/, /^알림 \d+$/, /^대화에 전달$/, /^비서와 예약$/]) {
        await workflowTabs.getByRole('button', { name }).click();
        await measure('업무 연결 / ' + name.source + ' / ' + width);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot('assistant');
    for (const name of ['산출물', '완료', '대시보드']) {
      await navigate(name);
      for (const width of [1440, 800, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
        await measure(name + ' / ' + width);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await button('작업 현황').click();
    await page.getByRole('heading', { name: '작업 현황', exact: true }).waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(360);
      await measure('작업 현황 / ' + width);
    }
    assert.deepEqual(errors, []);
    if (process.env.FLOWRIUM_FEATURE_RESULT) await fs.writeFile(process.env.FLOWRIUM_FEATURE_RESULT, JSON.stringify({ passed: true, samples, errors }, null, 2));
    console.log('기능 화면 / 대시보드 / 프로젝트 9개 탭 / AI 작성과 기억 저장 / 형상관리 펼침 / 결정과 알림·전달·비서 / 산출물·완료·작업현황 / 320~1440px 면 여백과 가로 넘침 검사 통과 / ' + samples.length + '회');
  } catch (error) {
    if (page && !page.isClosed()) {
      await screenshot('failure').catch(() => {});
      console.error('기능 화면 실패 진단', await page.locator('body').innerText().catch(() => ''));
    }
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
