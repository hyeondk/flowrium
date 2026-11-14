const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const qa = path.join(root, '.flowrium-tmp', 'qa-261115_03');
  await fs.mkdir(qa, { recursive: true });
  const temp = await fs.realpath(await fs.mkdtemp(path.join(qa, 'navigation-profile-')));
  const baseline = process.argv.includes('--baseline');
  const installedStyle = process.argv.includes('--installed-style');
  let app, page;
  const errors = [], measurements = [];
  try {
    const profile = path.join(temp, 'profile'), store = new Store(profile);
    await store.load();
    for (let i = 0; i < 32; i++) {
      const folder = path.join(temp, `화면 검증 ${String(i + 1).padStart(2, '0')} / 긴 프로젝트 이름`.replace(' / ', ' '));
      await fs.mkdir(folder);
      await store.addProject(folder);
    }
    await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs'), theme: 'light' });
    const env = { ...process.env, CODEX_HOME: path.join(temp, 'codex') };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    if (baseline || installedStyle) {
      assert.equal(process.platform, 'darwin', '설치본 재현은 Mac에서 실행');
      delete env.FLOWRIUM_USER_DATA;
      app = await _electron.launch({ executablePath: '/Applications/Flowrium.app/Contents/MacOS/Flowrium', args: ['--user-data-dir=' + profile], env, timeout: 45000 });
    } else {
      env.FLOWRIUM_USER_DATA = profile;
      app = await _electron.launch({ args: [root], env, timeout: 45000 });
    }
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.locator('.workspace-side').waitFor();
    if (installedStyle) {
      const css = await fs.readFile(path.join(root, 'src', 'workspace-sidebar.css'), 'utf8');
      await page.addInitScript(content => document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style'); style.textContent = content; document.head.append(style);
      }, { once: true }), css);
      await page.addStyleTag({ content: css });
    }
    assert.equal(path.relative(await fs.realpath(profile), await fs.realpath(await app.evaluate(({ app }) => app.getPath('userData')))), '', '개인 사용자 자료와 분리');
    await page.mouse.move(30, 140);
    await page.waitForTimeout(360);
    await page.evaluate(() => document.fonts.ready);
    const measure = () => page.evaluate(() => {
      const side = document.querySelector('.workspace-side'), nav = side.querySelector('nav');
      const project = side.querySelector('.side-projects'), list = side.querySelector('.side-project-list');
      const box = e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
      return { width: innerWidth, height: innerHeight, expanded: side.dataset.expanded, pinned: side.dataset.pinned, documentOverflow: document.documentElement.scrollWidth - innerWidth, nav: { ...box(nav), scrollTop: nav.scrollTop, scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight }, project: box(project), list: { ...box(list), scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight }, groups: [...side.querySelectorAll('.side-group')].map(e => ({ label: e.getAttribute('aria-label'), ...box(e) })), rows: [...side.querySelectorAll('nav>.side-row,.side-group>.side-row')].map(e => ({ label: e.getAttribute('aria-label'), ...box(e), iconLeft: e.querySelector('svg').getBoundingClientRect().left, iconWidth: e.querySelector('svg').getBoundingClientRect().width })), account: box(side.querySelector('.side-account')), surface: box(side.querySelector('.sidebar-surface')), logo: box(side.querySelector('.side-brand img')), brandRow: box(side.querySelector('.side-brand-row')) };
    });
    const first = await measure();
    if (baseline) {
      assert.ok(first.list.bottom > first.groups[0].top + 8, '기존 설치본에서 프로젝트 목록과 보관 그룹 겹침 재현');
      await page.screenshot({ path: path.join(qa, 'navigation-before.png'), animations: 'disabled' });
      await fs.writeFile(path.join(qa, 'navigation-before.json'), JSON.stringify({ result: 'reproduced', version: await app.evaluate(({ app }) => app.getVersion()), measurement: first }, null, 2));
      console.log('기존 설치본의 긴 프로젝트 목록 / 보관 그룹 겹침 재현');
      return;
    }
    const closeDock = async () => {
      const dock = page.locator('.conversation-dock');
      if (await dock.count()) {
        await dock.getByRole('button', { name: '대화함 접기', exact: true }).click();
        await dock.waitFor({ state: 'detached' });
      }
    };
    await closeDock();
    const checkLogo = m => {
      const logoCenter = m.logo.left + m.logo.width / 2;
      const targetCenter = m.expanded === 'true' ? m.rows[0].iconLeft + m.rows[0].iconWidth / 2 : m.surface.left + m.surface.width / 2;
      assert.ok(Math.abs(logoCenter - targetCenter) < 1, `${m.width}×${m.height} 로고 가로 중심 ${logoCenter} / 기준 ${targetCenter}`);
      assert.ok(Math.abs(m.logo.top + m.logo.height / 2 - (m.brandRow.top + m.brandRow.height / 2)) < 1, `${m.width}×${m.height} 브랜드 행의 세로 중심`);
    };
    const checkLayout = m => {
      checkLogo(m);
      assert.ok(m.list.bottom <= m.groups[0].top + 1, `${m.width}×${m.height} 프로젝트와 보관 그룹 분리`);
      assert.ok(m.groups[0].bottom <= m.groups[1].top + 1, `${m.width}×${m.height} 보관과 도구 그룹 분리`);
      assert.ok(m.nav.bottom <= m.account.top + 1, `${m.width}×${m.height} 탐색 스크롤과 계정 영역 분리`);
      assert.ok(m.account.bottom <= m.surface.bottom + 1, `${m.width}×${m.height} 계정 영역 경계`);
      assert.ok(m.rows.every(r => r.height >= 24), `${m.width}×${m.height} 조밀한 메뉴 행의 최소 클릭 높이`);
      assert.ok(m.rows.every(r => Math.abs(r.iconLeft - m.rows[0].iconLeft) < 1), `${m.width}×${m.height} 메뉴 아이콘 왼쪽 시작점`);
      assert.ok(m.documentOverflow <= 1, `${m.width}×${m.height} 문서 가로 넘침 없음`);
    };
    for (const [width, height] of [[1440, 1000], [1440, 800], [1024, 640], [800, 480]]) {
      await page.setViewportSize({ width, height });
      await page.mouse.move(30, 140);
      await page.waitForTimeout(360);
      await page.locator('.workspace-side nav').evaluate(e => { e.scrollTop = 0; });
      await page.locator('.side-project-list').evaluate(e => { e.scrollTop = 0; });
      const m = await measure();
      checkLayout(m);
      if (width === 1440 && height === 800) await page.screenshot({ path: path.join(qa, installedStyle ? 'navigation-isolated-style.png' : 'navigation-after.png'), animations: 'disabled' });
      const stable = [];
      await page.mouse.move(m.list.right - 16, Math.min(m.list.top + 32, m.nav.bottom - 8));
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(120);
      assert.ok((await measure()).list.scrollTop > 0, `${width}×${height} 휠로 프로젝트 목록 스크롤`);
      await page.mouse.move(m.nav.right - 12, m.nav.bottom - 12);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(120);
      for (const delay of [0, 32, 450]) {
        if (delay) await page.waitForTimeout(delay);
        stable.push(await measure());
      }
      assert.ok(stable.every(s => Math.abs(s.nav.scrollTop - stable[0].nav.scrollTop) < 1 && Math.abs(s.list.scrollTop - stable[0].list.scrollTop) < 1), `${width}×${height} 스크롤 정지 뒤 위치 유지`);
      assert.ok(stable[2].rows.at(-1).bottom <= stable[2].nav.bottom + 1 && stable[2].rows.at(-1).top >= stable[2].nav.top - 1, `${width}×${height} 마지막 로그아웃 메뉴 접근`);
      assert.ok(stable[2].list.scrollTop > 0, `${width}×${height} 긴 프로젝트 목록 내부 스크롤`);
      measurements.push({ initial: m, scrollStable: stable.map(s => ({ nav: s.nav.scrollTop, list: s.list.scrollTop })), lastRow: stable[2].rows.at(-1) });
      await page.mouse.move(width - 60, 90);
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.workspace-side').getAttribute('data-expanded'), 'false', '마우스 이탈 뒤 자동 접힘');
      const collapsed = await measure(); checkLogo(collapsed);
      measurements.at(-1).collapsedLogo = { logo: collapsed.logo, surface: collapsed.surface, brandRow: collapsed.brandRow };
      if (width === 1440 && height === 1000) {
        await page.locator('.workspace-side nav').evaluate(e => { e.scrollTop = 0; });
        const beforeHover = await measure(), frames = [];
        await page.mouse.move(30, 140);
        for (const delay of [0, 32, 120, 280]) {
          if (delay) await page.waitForTimeout(delay);
          const frame = await measure();
          assert.ok(frame.rows.every((r, i) => Math.abs(r.top - beforeHover.rows[i].top) < 1), '메뉴 펼침 중 모든 기존 아이콘의 세로 클릭 좌표 유지');
          assert.ok(Math.abs(frame.nav.scrollTop - beforeHover.nav.scrollTop) < 1, '메뉴 펼침 중 탐색 스크롤 위치 유지');
          frames.push({ expanded: frame.expanded, navScrollTop: frame.nav.scrollTop, rowTops: frame.rows.map(r => r.top) });
        }
        await page.mouse.move(width - 60, 90);
        await page.waitForTimeout(600);
        assert.equal(await page.locator('.workspace-side').getAttribute('data-expanded'), 'false');
        await page.getByRole('button', { name: '완료', exact: true }).click();
        await page.locator('.main-shell[data-view=archive]').waitFor();
        await page.getByRole('button', { name: '대시보드', exact: true }).click();
        await page.locator('.main-shell[data-view=dashboard]').waitFor();
        measurements.at(-1).hoverStableFrames = frames;
        measurements.at(-1).collapsedImmediateArchiveClickPassed = true;
        await page.mouse.move(width - 60, 90);
        await page.waitForTimeout(600);
        await page.locator('.workspace-side').getByRole('button', { name: '프로젝트 추가', exact: true }).click();
        await page.locator('.main-shell[data-view=kickoff]').waitFor({ timeout: 3000 });
        await page.getByRole('button', { name: '대시보드', exact: true }).click();
        await page.locator('.main-shell[data-view=dashboard]').waitFor();
        measurements.at(-1).collapsedImmediateProjectAddClickPassed = true;
      }
    }
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.mouse.move(30, 140);
    await page.waitForTimeout(320);
    await page.getByRole('button', { name: '메뉴 고정', exact: true }).click();
    await page.mouse.move(900, 90);
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.workspace-side').getAttribute('data-expanded'), 'true', '메뉴 고정 뒤 펼침 유지');
    checkLayout(await measure());
    await page.reload();
    await page.locator('.workspace-side[data-pinned=true]').waitFor();
    assert.equal(await page.locator('.workspace-side').getAttribute('data-expanded'), 'true', '메뉴 고정 복원');
    await page.getByRole('button', { name: '메뉴 자동 접기', exact: true }).click();
    await closeDock();
    for (const [width, height] of [[390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
      await page.locator('.workspace-side.is-open').waitFor();
      await page.waitForTimeout(340);
      const m = await measure();
      checkLayout(m);
      assert.ok(m.surface.left >= 0 && m.surface.right <= width + 1, '모바일 메뉴 가로 경계');
      await page.locator('.workspace-side nav').evaluate(e => { e.scrollTop = e.scrollHeight; });
      const end = await measure();
      assert.ok(end.rows.at(-1).bottom <= end.nav.bottom + 1, '모바일 마지막 메뉴 접근');
      measurements.push({ mobile: m, lastRow: end.rows.at(-1) });
      await page.getByRole('button', { name: '메뉴 닫기', exact: true }).click({ position: { x: width - 20, y: 80 } });
      await page.locator('.workspace-side.is-open').waitFor({ state: 'detached' });
    }
    assert.deepEqual(errors, [], '렌더러 오류 없음');
    await fs.writeFile(path.join(qa, installedStyle ? 'navigation-isolated-style.json' : 'navigation-after.json'), JSON.stringify({ result: 'passed', isolatedStyle: installedStyle, measurements }, null, 2));
    console.log('왼쪽 메뉴 32개 프로젝트 / 네 가지 창 크기 / 짧은 높이 / 호버 / 고정과 복원 / 모바일 두 폭 / 그룹 겹침 없음 / 스크롤 정지 안정 통과');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(qa, 'navigation-failure.png'), animations: 'disabled' }).catch(() => {});
      console.error('실패 시 탐색 영역', await page.locator('.workspace-side').evaluate(e => ({ expanded: e.dataset.expanded, pinned: e.dataset.pinned, text: e.innerText, navScrollTop: e.querySelector('nav')?.scrollTop })).catch(() => null));
    }
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
