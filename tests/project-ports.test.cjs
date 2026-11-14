const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const { Store } = require('../electron/store.cjs');
const { registerProjectPorts, ProjectPorts, formula, probePort, readAssignment, inspectProjectPorts } = require('../electron/project-ports.cjs');
const { registerProjectDetails } = require('../electron/project-details.cjs');

const free = async port => ({ port, status: 'free', families: [{ family: 'IPv4', status: 'free' }, { family: 'IPv6', status: 'free' }] });
async function fixture(t, options = {}) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-project-ports-'))), profile = path.join(temp, '프로필');
  const store = new Store(profile); await store.load(); const api = {};
  const manager = registerProjectPorts((name, fn) => { api[name] = fn; }, store, { probe: free, ...options });
  async function project(name) { const folder = path.join(temp, name); await fs.mkdir(folder); return store.addProject(folder); }
  t.after(async () => { await manager.shutdown(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 }); });
  return { temp, profile, store, api, manager, project };
}
test('번호 1~99로 다섯 서비스 포트를 계산하고 잘못된 번호는 거부한다', () => {
  assert.deepEqual(formula(1), { web: 2001, admin: 2101, api: 3001, db: 4001, aux: 4101 });
  assert.deepEqual(formula(99), { web: 2099, admin: 2199, api: 3099, db: 4099, aux: 4199 });
  for (const value of [0, 100, 1.5, '1', null]) assert.throws(() => formula(value), /번호와 포트/);
});
test('최초 조회는 번호를 자동 배정하고 다른 프로젝트 및 앱 재시작의 배정을 보존한다', async t => {
  const { project, api, store, profile } = await fixture(t), a = await project('첫 번째'), b = await project('두 번째');
  const [one, two] = await Promise.all([api.readProjectPorts(a.id), api.readProjectPorts(b.id)]);
  assert.deepEqual([one.number,two.number].sort((a,b)=>a-b),[1,2],'동시 요청의 잠금 획득 순서와 무관하게 첫 두 번호를 중복 없이 배정');assert.deepEqual(one.ports,formula(one.number));assert.deepEqual(two.ports,formula(two.number));
  const again = await api.readProjectPorts(a.id); assert.equal(again.revision, one.revision); assert.deepEqual(again.ports, one.ports);
  const nextStore = new Store(profile); await nextStore.load(); const manager = new ProjectPorts(nextStore, { probe: free });
  try { const restored = await manager.read(b.id); assert.equal(restored.number,two.number); assert.equal(restored.revision, two.revision); }
  finally { await manager.shutdown(); }
  assert.equal(store.state.projects.length, 2);
});
test('예약과 이미 사용 중인 포트는 자동 배정에서 건너뛰고 다른 번호를 바꾸지 않는다', async t => {
  const probe = async value => value === 3001 ? { port: value, status: 'listening', families: [{ family: 'IPv4', status: 'listening' }, { family: 'IPv6', status: 'free' }] } : free(value);
  const { project, api } = await fixture(t, { probe }), a = await project('포트 충돌'), b = await project('예약 적용');
  const one = await api.readProjectPorts(a.id); assert.equal(one.number, 2);
  const reserved = await api.projectPortsAction(a.id, { action: 'reservations', revision: null, ports: [2003, 5200] });
  assert.deepEqual(reserved.reservations.ports, [2003, 5200]);
  const two = await api.readProjectPorts(b.id); assert.equal(two.number, 4);
  const next = await api.projectPortsAction(a.id, { action: 'reallocate', revision: one.revision });
  assert.equal(next.number, 5); assert.equal((await api.readProjectPorts(b.id)).number, 4);
});
test('사용자 포트 저장은 중복·다른 배정·예약을 막고 실행 중 포트는 명시 확인 후에만 허용한다', async t => {
  const probe = async value => value === 5100 ? { port: value, status: 'listening', families: [{ family: 'IPv4', status: 'listening' }] } : free(value);
  const { project, api } = await fixture(t, { probe }), a = await project('직접 지정'), b = await project('다른 배정');
  let one = await api.readProjectPorts(a.id); const two = await api.readProjectPorts(b.id);
  const ports = { web: 5100, admin: 5101, api: 5102, db: 5103, aux: 5104 };
  await assert.rejects(api.projectPortsAction(a.id, { action: 'save', revision: one.revision, number: 5, ports }), /사용 중/);
  one = await api.projectPortsAction(a.id, { action: 'save', revision: one.revision, number: 5, ports, allowListening: true });
  assert.equal(one.mode, 'custom'); assert.equal(one.checks.find(row => row.role === 'web').status, 'listening');
  await assert.rejects(api.projectPortsAction(a.id, { action: 'save', revision: one.revision, number: 2, ports, allowListening: true }), /이미 배정/);
  await assert.rejects(api.projectPortsAction(b.id, { action: 'save', revision: two.revision, number: 8, ports, allowListening: true }), /이미 배정/);
  await assert.rejects(api.projectPortsAction(a.id, { action: 'save', revision: one.revision, number: 5, ports: { ...ports, api: ports.web }, allowListening: true }), /서로 달라야/);
  await assert.rejects(api.projectPortsAction(a.id, { action: 'save', revision: one.revision, number: 5, ports: { ...ports, web: 80 } }), /형식/);
  await assert.rejects(api.projectPortsAction(a.id, { action: 'reservations', revision: null, ports: [5100] }), /이미 배정|프로젝트에 배정/);
  assert.equal((await api.readProjectPorts(b.id)).number, 2);
});
test('오래된 개정 저장과 동시 저장을 막으며 배정 해제 뒤 재사용은 명시적으로 수행한다', async t => {
  const { project, api } = await fixture(t), a = await project('개정'), b = await project('재사용');
  const one = await api.readProjectPorts(a.id);
  const outcomes = await Promise.allSettled([1, 2].map(() => api.projectPortsAction(a.id, { action: 'reallocate', revision: one.revision })));
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(row => row.status === 'rejected').length, 1);
  let current = await api.readProjectPorts(a.id); current = await api.projectPortsAction(a.id, { action: 'release', revision: current.revision });
  assert.equal(current.enabled, false); assert.equal((await api.readProjectPorts(a.id)).number, null);
  const next = await api.readProjectPorts(b.id); assert.equal(next.number, 1);
  const restored = await api.projectPortsAction(a.id, { action: 'allocate', revision: current.revision }); assert.equal(restored.number, 2);
});
test('같은 앱 데이터에 연결한 두 관리자의 동시 배정에도 프로젝트 번호를 중복하지 않는다', async t => {
  const { project, api, profile } = await fixture(t), a = await project('동시 첫째'), b = await project('동시 둘째');
  const nextStore = new Store(profile); await nextStore.load(); const other = new ProjectPorts(nextStore, { probe: free });
  try { const [one, two] = await Promise.all([api.readProjectPorts(a.id), other.read(b.id)]); assert.notEqual(one.number, two.number); }
  finally { await other.shutdown(); }
  await assert.rejects(fs.access(path.join(profile, 'project-ports.lock')), { code: 'ENOENT' });
});
test('서로 다른 프로세스가 동시에 배정해도 번호가 겹치지 않으며 종료된 잠금을 회수한다', async t => {
  const { project, profile, api } = await fixture(t), a = await project('프로세스 첫째'), b = await project('프로세스 둘째');
  const code = `const {Store}=require('./electron/store.cjs'),{ProjectPorts}=require('./electron/project-ports.cjs');(async()=>{const store=new Store(process.argv[1]);await store.load();const manager=new ProjectPorts(store,{probe:async port=>({port,status:'free',families:[{family:'IPv4',status:'free'}]})});try{const data=await manager.read(process.argv[2]);console.log(JSON.stringify({pid:process.pid,number:data.number}));}finally{await manager.shutdown()}})().catch(e=>{console.error(e);process.exitCode=1});`;
  const results = await Promise.all([a, b].map(row => exec(process.execPath, ['-e', code, profile, row.id], { cwd: path.resolve(__dirname, '..'), timeout: 15000 })));
  const [one, two] = results.map(row => JSON.parse(row.stdout)); assert.notEqual(one.number, two.number);
  await fs.writeFile(path.join(profile, 'project-ports.lock'), JSON.stringify({ version: 1, token: randomUUID(), pid: one.pid, at: new Date().toISOString() }));
  assert.equal((await api.readProjectPorts(a.id)).number, one.number);
  await assert.rejects(fs.access(path.join(profile, 'project-ports.lock')), { code: 'ENOENT' });
});
test('예약 설정의 오래된 저장과 잘못된 값은 막고 이전 예약 기록은 보존한다', async t => {
  const { project, profile, api } = await fixture(t), a = await project('외부 예약'); await api.readProjectPorts(a.id);
  const one = await api.projectPortsAction(a.id, { action: 'reservations', revision: null, ports: [5100, 5200] });
  await assert.rejects(api.projectPortsAction(a.id, { action: 'reservations', revision: null, ports: [5300] }), /변경/);
  for (const ports of [[1], [65536], [5100, 5100], [5000.5]]) await assert.rejects(api.projectPortsAction(a.id, { action: 'reservations', revision: one.reservations.revision, ports }));
  const two = await api.projectPortsAction(a.id, { action: 'reservations', revision: one.reservations.revision, ports: [5300] });
  assert.deepEqual(two.reservations.ports, [5300]); const backup = await fs.readdir(path.join(profile, 'project-ports-backups')); assert.equal(backup.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile, 'project-ports-backups', backup[0]))).reserved, [5100, 5200]);
  const lock = path.join(profile, 'project-ports.lock'), original = JSON.stringify({ unknown: true }); await fs.writeFile(lock, original);
  await assert.rejects(api.readProjectPorts(a.id), /잠금 파일/); assert.equal(await fs.readFile(lock, 'utf8'), original);
});
test('사용 여부 확인 불가를 빈 포트로 판단하지 않으며 종료 요청은 진행 중인 검사 뒤 완료된다', async t => {
  const { project, api, manager } = await fixture(t, { probe: async value => ({ port: value, status: value === 3001 ? 'unavailable' : 'free', families: [{ family: 'IPv4', status: value === 3001 ? 'unavailable' : 'free' }] }) });
  const a = await project('확인 불가'); assert.equal((await api.readProjectPorts(a.id)).number, 2);
  let release, started; const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { started = resolve; });
  manager.options.probe = async value => { started(); await gate; return free(value); };
  const pending = api.readProjectPorts(a.id); pending.catch(() => {}); await waiting;
  let stopped = false; const stopping = manager.shutdown().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false); release();
  await assert.rejects(pending, /계정이나 잠금/); await stopping; assert.equal(stopped, true); assert.equal(manager.isBusy(), false);
});
test('보관과 복원 및 프로젝트 폴더의 다른 프로필 연결은 기존 번호와 포트를 유지한다', async t => {
  const { project, api, store, temp } = await fixture(t), a = await project('보관할 프로젝트'); const one = await api.readProjectPorts(a.id);
  const details = {}; registerProjectDetails((n, fn) => { details[n] = fn; }, store);
  let detail = await details.readProjectDetails(a.id); detail = await details.updateProjectDetails(a.id, detail.revision, { action: 'archive' });
  assert.equal((await api.readProjectPorts(a.id)).number, one.number);
  await details.updateProjectDetails(a.id, detail.revision, { action: 'resume' }); assert.equal((await api.readProjectPorts(a.id)).revision, one.revision);
  const alternate = new Store(path.join(temp, '다른 컴퓨터')); await alternate.load(); const same = await alternate.addProject(a.path); assert.equal(same.id, a.id);
  const copied = new ProjectPorts(alternate, { probe: free }); try { assert.deepEqual((await copied.read(a.id)).ports, one.ports); } finally { await copied.shutdown(); }
});
test('검사 중 계정 또는 잠금 상태가 바뀌면 배정하지 않는다', async t => {
  let release, checking, owner = 1, allowed = true; const started = new Promise(resolve => { checking = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const { project, api } = await fixture(t, { accountRevision: () => owner, canWrite: () => allowed, probe: async value => { checking(); await gate; return free(value); } });
  const a = await project('중단');
  const pending = api.readProjectPorts(a.id); pending.catch(() => {}); await started;
  owner = 2; allowed = false; release();
  await assert.rejects(pending, /계정이나 잠금/);
  await assert.rejects(fs.access(path.join(a.path, '.flowrium', 'ports', 'first.json')), { code: 'ENOENT' });
});
test('최종 기록 파일을 열거나 예약 저장을 준비하는 동안 잠금이 바뀌면 저장하지 않는다', async t => {
  let allowed = true, owner = 1; const { project, api, profile } = await fixture(t, { accountRevision: () => owner, canWrite: () => allowed });
  const a = await project('최종 저장 취소'), originalOpen = fs.open; let release, entered;
  let gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  fs.open = async function (file, ...args) { const handle = await originalOpen.call(this, file, ...args); if (String(file).endsWith(path.join('ports', 'first.json'))) { entered(); await gate; } return handle; };
  try {
    const pending = api.readProjectPorts(a.id); pending.catch(() => {}); await started; allowed = false; owner++; release(); await assert.rejects(pending, /계정이나 잠금/);
  } finally { fs.open = originalOpen; }
  await assert.rejects(fs.access(path.join(a.path, '.flowrium', 'ports', 'first.json')), { code: 'ENOENT' });
  allowed = true; await api.readProjectPorts(a.id);
  gate = new Promise(resolve => { release = resolve; }); started = new Promise(resolve => { entered = resolve; });
  fs.open = async function (file, ...args) { const handle = await originalOpen.call(this, file, ...args); if (String(file).includes('project-ports.json.') && String(file).endsWith('.tmp')) { entered(); await gate; } return handle; };
  try {
    const pending = api.projectPortsAction(a.id, { action: 'reservations', revision: null, ports: [5200] }); pending.catch(() => {}); await started; allowed = false; owner++; release(); await assert.rejects(pending, /계정이나 잠금/);
  } finally { fs.open = originalOpen; }
  await assert.rejects(fs.access(path.join(profile, 'project-ports.json')), { code: 'ENOENT' });
  assert(!(await fs.readdir(profile)).some(name => name.endsWith('.tmp')));
});
test('접근할 수 없거나 중복된 기록과 심볼릭 링크를 덮어쓰지 않는다', async t => {
  const { project, api, temp } = await fixture(t), a = await project('기록 보존'); await api.readProjectPorts(a.id);
  const folder = path.join(a.path, '.flowrium', 'ports'), original = await fs.readFile(path.join(folder, 'first.json'));
  await fs.writeFile(path.join(folder, 'first (충돌).json'), original); await assert.rejects(api.readProjectPorts(a.id), /변경/);
  assert.deepEqual(await fs.readFile(path.join(folder, 'first.json')), original); await fs.unlink(path.join(folder, 'first (충돌).json'));
  if (process.platform !== 'win32') { const outside = path.join(temp, '원본 포트 기록'); await fs.rename(folder, outside); await fs.symlink(outside, folder); await assert.rejects(api.readProjectPorts(a.id), /다른 위치/); assert.deepEqual(await fs.readFile(path.join(outside, 'first.json')), original); }
});
test('가져온 포트의 사전 검사는 다른 배정과 예약을 알리며 어떤 자료도 변경하지 않는다', async t => {
  const { project, api, store } = await fixture(t), a = await project('기존 프로젝트'); await api.readProjectPorts(a.id);
  const id = randomUUID(), state = await inspectProjectPorts(store, { projectId: id, number: 1 }, { probe: free });
  assert.equal(state.available, false); assert(state.conflicts.some(row => row.kind === 'number')); assert(state.conflicts.some(row => row.kind === 'port'));
  assert.equal((await readAssignment(store, a.id)).number, 1); assert.equal(store.state.projects.length, 1);
});
test('번호가 모두 배정됐으면 중복 번호를 만들지 않는다', async () => {
  const manager = new ProjectPorts({ state: { projects: [] } }, { probe: free });
  const projects = Array.from({ length: 99 }, (_, i) => ({ projectId: randomUUID(), name: String(i + 1), enabled: true, number: i + 1, ports: formula(i + 1) }));
  await assert.rejects(manager.automatic({ projectId: randomUUID(), number: null }, projects, { ports: [] }), /사용 가능한 프로젝트 번호/);
});
test('실제 IPv4 수신 포트를 감지하되 기존 서버를 종료하거나 연결하지 않는다', async t => {
  let received = 0; const server = net.createServer(socket => { received++; socket.destroy(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => server.listening ? new Promise(resolve => server.close(resolve)) : undefined);
  const value = server.address().port, state = await probePort(value);
  assert.equal(state.status, 'listening'); assert(state.families.some(row => row.family === 'IPv4' && row.status === 'listening')); assert.equal(server.listening, true); assert.equal(received, 0);
  await new Promise(resolve => server.close(resolve)); assert.equal((await probePort(value)).status, 'free');
});
test('실제 IPv6 전용 수신 포트를 별도로 감지한다', async t => {
  const server = net.createServer(socket => socket.destroy());
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port: 0, host: '::1', ipv6Only: true }, resolve); }); }
  catch (error) { if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) { t.skip('IPv6 비활성 환경'); return; } throw error; }
  t.after(() => new Promise(resolve => server.close(resolve)));
  const state = await probePort(server.address().port); assert.equal(state.status, 'listening'); assert(state.families.some(row => row.family === 'IPv6' && row.status === 'listening')); assert.equal(server.listening, true);
});
