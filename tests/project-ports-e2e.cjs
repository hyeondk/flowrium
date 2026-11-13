const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { formula, probePort } = require('../electron/project-ports.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-ports-ui-'));
  let app, page, server; let received = 0; const errors = [];
  try {
    const profile = path.join(temp, '검증 프로필'), folder = path.join(temp, '포트표 검증 프로젝트'), otherFolder = path.join(temp, '기존 배정 프로젝트');
    await fs.mkdir(folder); await fs.mkdir(otherFolder);
    const store = new Store(profile); await store.load();
    await store.saveSettings({ codexPath: path.join(__dirname, 'backend-fake-codex.cjs'), theme: 'light' });
    const project = await store.addProject(folder), other = await store.addProject(otherFolder);
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    async function launch() {
      app = await _electron.launch({ args: [root], env, timeout: 45000 }); page = await app.firstWindow();
      page.setDefaultTimeout(16000); page.on('pageerror', error => errors.push(error.message)); await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('heading', { name: '프로젝트 대시보드', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.side-account i')?.dataset.connected === 'true');
      await app.evaluate(({ clipboard }) => { clipboard.writeText = text => { globalThis.flowriumPortCopied = text; }; });
    }
    async function openPorts() {
      await page.locator('.pf-card').filter({ hasText: project.name }).click();
      await page.getByRole('navigation', { name: '프로젝트 상세 탭' }).getByRole('button', { name: '프로젝트 설정', exact: true }).click();
      await page.getByRole('region', { name: '자동 포트표', exact: true }).waitFor();
      await page.getByRole('switch', { name: '프로젝트 포트 배정', exact: true }).waitFor();
    }
    const portsPanel = () => page.getByRole('region', { name: '자동 포트표', exact: true });
    const state = () => page.evaluate(id => window.flowrium.readProjectPorts(id), project.id);
    const button = name => portsPanel().getByRole('button', { name, exact: true });
    async function waitState(predicate) {
      const deadline = Date.now() + 16000;
      while (Date.now() < deadline) { const result = await state(); if (predicate(result)) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw Error('프로젝트 포트 저장 결과를 확인하지 못했습니다.');
    }
    await launch(); await openPorts();
    let current = await state(); assert.deepEqual(current.ports, formula(current.number));
    assert.equal(await portsPanel().locator('tbody').first().locator('tr').count(), 5);
    const second = await page.evaluate(id => window.flowrium.readProjectPorts(id), other.id); assert.notEqual(second.number, current.number);
    await button('새로고침').click(); await button('새로고침').waitFor({ state: 'visible' });
    await button('웹 주소 복사').click(); assert.equal(await app.evaluate(() => globalThis.flowriumPortCopied), `http://localhost:${current.ports.web}`);
    await button('환경변수 복사').click(); assert.equal(await app.evaluate(() => globalThis.flowriumPortCopied), Object.entries(current.ports).map(([role, value]) => `PORT_${role.toUpperCase()}=${value}`).join('\n'));
    await portsPanel().getByText('번호와 포트 직접 설정', { exact: true }).click();
    const number = portsPanel().getByLabel('프로젝트 번호', { exact: true }); await number.fill('50'); await number.focus(); await number.hover(); await page.mouse.wheel(0, 120);
    assert.equal(await number.inputValue(), '50'); assert.equal(await number.evaluate(element => document.activeElement === element), true);
    await page.waitForTimeout(150); await portsPanel().getByLabel('포트 입력 방식').selectOption('custom');
    let values;
    for (let attempt = 0; attempt < 25; attempt++) {
      server = net.createServer(socket => { received++; socket.destroy(); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const first = server.address().port;
      if (first <= 65531) { const checks = await Promise.all([1, 2, 3, 4].map(offset => probePort(first + offset))); if (checks.every(row => row.status === 'free')) { values = { web: first, admin: first + 1, api: first + 2, db: first + 3, aux: first + 4 }; break; } }
      await new Promise(resolve => server.close(resolve)); server = undefined;
    }
    assert(values, '검증용 포트를 확보해야 합니다.');
    const labels = { web: '웹', admin: '관리자', api: 'API', db: '데이터베이스', aux: '보조 서버' };
    for (const [role, value] of Object.entries(values)) await portsPanel().getByLabel(labels[role] + ' 포트', { exact: true }).fill(String(value));
    const previous = current.revision; await button('포트 설정 저장').click();
    await portsPanel().getByRole('alert').filter({ hasText: '사용 중이거나' }).waitFor(); assert.equal((await state()).revision, previous); assert.equal(server.listening, true); assert.equal(received, 0);
    await portsPanel().getByRole('switch', { name: '이미 실행 중인 서버 포트 사용', exact: true }).click(); await button('포트 설정 저장').click();
    current = await waitState(result => result.number === 50); assert.deepEqual(current.ports, values); assert.equal(current.mode, 'custom'); assert.equal(current.checks[0].status, 'listening'); assert.equal(server.listening, true); assert.equal(received, 0);
    await portsPanel().getByText('전체 프로젝트 포트표', { exact: true }).click(); assert.equal(await portsPanel().locator('.pp-all tbody tr').count(), 2);
    await portsPanel().getByText('자동 배정에서 제외할 외부 예약 포트', { exact: true }).click();
    const reservedNumber = [99, 98, 97].find(value => value !== second.number), reservation = formula(reservedNumber).web;
    await portsPanel().getByLabel('외부 예약 포트', { exact: true }).fill(String(reservation)); await button('예약 포트 저장').click();
    await waitState(result => result.reservations.ports.includes(reservation));
    await button('다음 빈 번호로 재배정').click(); current = await waitState(result => result.number !== 50); assert.notEqual(current.number, second.number); assert.notEqual(current.number, reservedNumber);
    assert.equal((await page.evaluate(id => window.flowrium.readProjectPorts(id), other.id)).revision, second.revision);
    await portsPanel().getByRole('switch', { name: '프로젝트 포트 배정', exact: true }).click(); await waitState(result => !result.enabled);
    await portsPanel().getByText('이 프로젝트의 포트 배정이 해제됐습니다.', { exact: false }).waitFor();
    await portsPanel().getByRole('switch', { name: '프로젝트 포트 배정', exact: true }).click(); current = await waitState(result => result.enabled);
    const savedRevision = current.revision; await app.close(); app = undefined; await launch(); await openPorts(); current = await state(); assert.equal(current.revision, savedRevision); assert.deepEqual(current.reservations.ports, [reservation]);
    await portsPanel().getByText('번호와 포트 직접 설정', { exact: true }).click();
    const dimensions = [];
    for (const width of [1440, 800, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(330);
      dimensions.push(await portsPanel().evaluate(element => ({ width: innerWidth, document: document.documentElement.scrollWidth, panel: element.clientWidth, scroll: element.scrollWidth })));
    }
    assert(dimensions.every(row => row.document <= row.width + 1 && row.scroll <= row.panel + 1), JSON.stringify(dimensions));
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(350); await page.mouse.move(1100, 100);
    if (process.env.FLOWRIUM_PORTS_SCREENSHOT) {
      await fs.mkdir(path.dirname(process.env.FLOWRIUM_PORTS_SCREENSHOT), { recursive: true });
      await portsPanel().evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' })); await page.waitForTimeout(350);
      await page.screenshot({ path: process.env.FLOWRIUM_PORTS_SCREENSHOT });
    }
    assert.deepEqual(errors, []);
    console.log('실제 앱 자동 포트표 / 자동 배정 / 주소와 환경변수 복사 / 숫자 스크롤 안정성 / 수신 충돌과 명시 허용 / 외부 예약 / 재배정 / 전체 표 / 스위치 / 재시작 보존 / 반응형 검증 통과');
  } catch (error) { if (page && !page.isClosed()) console.error('실패 시 실제 화면', await page.locator('body').innerText().catch(() => '')); throw error; }
  finally {
    if (app) await app.close().catch(() => {});
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
