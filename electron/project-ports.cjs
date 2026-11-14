const { relativePath } = require('./path-boundary.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { UUID, projectDirectory, readJSON, createJSON } = require('./project-store.cjs');

const ROLES = ['web', 'admin', 'api', 'db', 'aux'];
const BASES = { web: 2000, admin: 2100, api: 3000, db: 4000, aux: 4100 };
const queues = new Map();
const copy = value => structuredClone(value);
const invalid = () => Error('프로젝트 번호와 포트 형식을 확인해 주세요.');
const stale = () => Error('포트 설정이 변경됐습니다. 새로고침한 뒤 다시 저장해 주세요.');
const contextChanged = () => Error('계정이나 잠금 상태가 바뀌었습니다. 포트 설정을 다시 열어 주세요.');
function number(value) { if (!Number.isInteger(value) || value < 1 || value > 99) throw invalid(); return value; }
function port(value) { if (!Number.isInteger(value) || value < 1024 || value > 65535) throw invalid(); return value; }
function formula(value) { number(value); return Object.fromEntries(ROLES.map(role => [role, BASES[role] + value])); }
function portValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== ROLES.length || ROLES.some(role => !Object.hasOwn(value, role))) throw invalid();
  const values = Object.fromEntries(ROLES.map(role => [role, port(value[role])]));
  if (new Set(Object.values(values)).size !== ROLES.length) throw Error('한 프로젝트의 서비스 포트는 서로 달라야 합니다.');
  return values;
}
function reservations(value) {
  if (!Array.isArray(value) || value.length > 4096 || new Set(value).size !== value.length) throw Error('예약 포트는 중복 없이 4096개까지 지정할 수 있습니다.');
  return value.map(port).sort((a, b) => a - b);
}
function blank(id) { return { projectId: id, revision: null, enabled: true, number: null, mode: 'automatic', ports: null, updatedAt: null }; }
function validateAssignment(data, id) {
  if (!data || data.projectId !== id || !UUID.test(data.revision) || typeof data.enabled !== 'boolean' || !['automatic', 'custom'].includes(data.mode) || typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw invalid();
  if (Object.keys(data).some(key => !['projectId', 'revision', 'enabled', 'number', 'mode', 'ports', 'updatedAt'].includes(key))) throw invalid();
  if (data.number === null) { if (data.ports !== null || data.enabled) throw invalid(); }
  else {
    number(data.number); const values = portValues(data.ports);
    if (!data.enabled || (data.mode === 'automatic' && ROLES.some(role => values[role] !== formula(data.number)[role]))) throw invalid();
  }
  return data;
}
function bindAddress(value, family, host) {
  return new Promise(resolve => {
    const server = net.createServer(socket => socket.destroy());
    let finished = false;
    const finish = (status, code) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ family, status, ...(code && { code }) }); };
    const timer = setTimeout(() => { try { server.close(); } catch {} finish('unavailable', 'TIMEOUT'); }, 400);
    server.once('error', error => finish(error.code === 'EADDRINUSE' ? 'listening' : ['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code) ? 'unsupported' : 'unavailable', error.code || 'UNKNOWN'));
    server.once('listening', () => server.close(error => finish(error ? 'unavailable' : 'free', error?.code)));
    try { server.listen({ host, port: value, exclusive: true, ...(family === 'IPv6' && { ipv6Only: true }) }); }
    catch (error) { finish('unavailable', error.code || 'UNKNOWN'); }
  });
}
async function bindPort(value, family) {
  const addresses = new Set(family === 'IPv4' ? ['127.0.0.1', '0.0.0.0'] : ['::1', '::']);
  for (const [name, entries] of Object.entries(os.networkInterfaces())) for (const entry of entries || []) {
    if (entry.family !== family) continue;
    addresses.add(family === 'IPv6' && entry.scopeid && !entry.address.includes('%') ? entry.address + '%' + (process.platform === 'win32' ? entry.scopeid : name) : entry.address);
  }
  let free = false, unavailable, unsupported;
  for (const host of addresses) {
    const result = await bindAddress(value, family, host);
    if (result.status === 'listening') return result;
    if (result.status === 'free') free = true;
    else if (result.status === 'unavailable') unavailable ||= result;
    else unsupported ||= result;
  }
  return unavailable || { family, status: free ? 'free' : 'unsupported', ...(!free && unsupported?.code && { code: unsupported.code }) };
}
async function probePort(value) {
  port(value);
  const families = [await bindPort(value, 'IPv4'), await bindPort(value, 'IPv6')];
  const status = families.some(row => row.status === 'listening') ? 'listening' : families.some(row => row.status === 'unavailable') || families.every(row => row.status === 'unsupported') ? 'unavailable' : 'free';
  return { port: value, status, families };
}
async function projectFolder(store, id, create = false) {
  if (typeof id !== 'string' || !UUID.test(id)) throw invalid();
  const project = store.state.projects.find(item => item.id === id);
  if (!project || project.conversationScope) throw Error('등록한 프로젝트의 포트표만 사용할 수 있습니다.');
  if (relativePath(project.path, await fs.realpath(project.path))) throw Error('프로젝트 경로가 변경됐습니다. 원본을 보존했습니다.');
  const root = path.join(project.path, '.flowrium'); await projectDirectory(root);
  if ((await readJSON(path.join(root, 'project.json'))).id !== id) throw Error('프로젝트 식별자가 변경됐습니다. 원본을 보존했습니다.');
  const folder = path.join(root, 'ports');
  try { const stat = await fs.lstat(folder); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('포트 기록 폴더가 다른 위치를 가리킵니다. 원본을 보존했습니다.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; if (!create) return null; await projectDirectory(folder); }
  if (relativePath(root, await fs.realpath(folder)) !== 'ports') throw Error('포트 기록 위치가 변경됐습니다. 원본을 보존했습니다.');
  return folder;
}
async function readAssignment(store, id) {
  const folder = await projectFolder(store, id);
  if (!folder) return blank(id);
  const names = await fs.readdir(folder); if (names.length > 10000) throw Error('포트 기록이 너무 많습니다. 원본을 보존했습니다.');
  const records = new Map();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -5);
    if (key !== 'first' && !UUID.test(key)) throw stale();
    const record = await readJSON(path.join(folder, name));
    if (record.version !== 1 || record.previous !== (key === 'first' ? null : key)) throw stale();
    records.set(key, validateAssignment(record.data, id));
  }
  let current = blank(id), count = 0;
  while (records.has(current.revision || 'first') && count <= records.size) { current = records.get(current.revision || 'first'); count++; }
  if (count !== records.size) throw stale();
  return current;
}
async function createPortRecord(file, value, beforeWrite) {
  let handle;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    beforeWrite();
    await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync();
  } catch (error) {
    if (handle) { await handle.close().catch(() => {}); handle = null; await fs.rm(file, { force: true }).catch(() => {}); }
    throw error;
  } finally { if (handle) await handle.close(); }
}
async function writeAssignment(store, current, next, beforeWrite) {
  const folder = await projectFolder(store, current.projectId, true);
  if ((await readAssignment(store, current.projectId)).revision !== current.revision) throw stale();
  const data = validateAssignment({ ...next, projectId: current.projectId, revision: randomUUID(), updatedAt: new Date().toISOString() }, current.projectId);
  try { await createPortRecord(path.join(folder, (current.revision || 'first') + '.json'), { version: 1, previous: current.revision, data }, beforeWrite); }
  catch (error) { if (error.code === 'EEXIST') throw stale(); throw error; }
  return data;
}
async function profileDirectory(store) { const folder = path.dirname(store.file); await projectDirectory(folder); return fs.realpath(folder); }
async function readSettings(store) {
  const file = path.join(await profileDirectory(store), 'project-ports.json');
  try {
    const data = await readJSON(file);
    if (data.version !== 1 || !UUID.test(data.revision) || Object.keys(data).some(key => !['version', 'revision', 'reserved'].includes(key))) throw invalid();
    return { revision: data.revision, ports: reservations(data.reserved) };
  } catch (error) { if (error.code === 'ENOENT') return { revision: null, ports: [] }; throw error; }
}
async function writeSettings(store, previous, values, beforeWrite) {
  const folder = await profileDirectory(store), file = path.join(folder, 'project-ports.json');
  const current = await readSettings(store); if (current.revision !== previous) throw stale();
  const data = { version: 1, revision: randomUUID(), reserved: reservations(values) };
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await createJSON(temporary, data);
    beforeWrite();
    if (current.revision) { const backup = path.join(folder, 'project-ports-backups'); await projectDirectory(backup); await createJSON(path.join(backup, randomUUID() + '.json'), { version: 1, revision: current.revision, reserved: current.ports }); }
    if ((await readSettings(store)).revision !== previous) throw stale();
    beforeWrite();
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return { revision: data.revision, ports: data.reserved };
}
async function lockProfile(store, work) {
  const folder = await profileDirectory(store), lock = path.join(folder, 'project-ports.lock');
  const previous = queues.get(folder) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const token = randomUUID(), deadline = Date.now() + 10000;
    while (true) {
      if (Date.now() > deadline) throw Error('다른 창에서 포트 설정을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
      try { await createJSON(lock, { version: 1, token, pid: process.pid, at: new Date().toISOString() }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try {
          const stat = await fs.lstat(lock);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('포트 설정 잠금 위치를 확인해 주세요. 원본을 보존했습니다.');
          try { owner = await readJSON(lock); }
          catch (error) { if (Date.now() - stat.mtimeMs > 1000) throw error; await new Promise(resolve => setTimeout(resolve, 40)); continue; }
        } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (owner.version !== 1 || !UUID.test(owner.token) || !Number.isSafeInteger(owner.pid) || owner.pid < 1) throw Error('포트 설정 잠금 파일을 확인해 주세요. 원본을 보존했습니다.');
        let alive = true; try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (!alive) {
          try { const again = await readJSON(lock); if (again.token === owner.token) await fs.unlink(lock); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          continue;
        }
        if (Date.now() > deadline) throw Error('다른 창에서 포트 설정을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }
    try { return await work(); }
    finally { const value = await readJSON(lock).catch(() => null); if (value?.token === token) await fs.unlink(lock).catch(() => {}); }
  });
  queues.set(folder, task); try { return await task; } finally { if (queues.get(folder) === task) queues.delete(folder); }
}
class ProjectPorts {
  constructor(store, options = {}) { this.store = store; this.options = options; this.stopping = false; this.tasks = new Set(); }
  context() { const owner = this.options.accountRevision?.(); this.assertContext(owner); return owner; }
  assertContext(owner) { if (this.stopping || this.options.canWrite?.() === false || owner !== this.options.accountRevision?.()) throw contextChanged(); }
  async catalog() { return Promise.all(this.store.state.projects.map(async project => ({ ...await readAssignment(this.store, project.id), name: project.name }))); }
  sync() { return this.catalog(); }
  conflicts(current, projects, settings) {
    if (!current.enabled || !current.ports) return [];
    const result = [];
    for (const other of projects) {
      if (other.projectId === current.projectId || !other.enabled || !other.ports) continue;
      if (other.number === current.number) result.push({ kind: 'number', projectId: other.projectId, projectName: other.name });
      for (const role of ROLES) if (Object.values(other.ports).includes(current.ports[role])) result.push({ kind: 'port', role, port: current.ports[role], projectId: other.projectId, projectName: other.name });
    }
    for (const role of ROLES) if (settings.ports.includes(current.ports[role])) result.push({ kind: 'reserved', role, port: current.ports[role] });
    return result;
  }
  async checks(values) { return values ? Promise.all(ROLES.map(async role => ({ role, ...await (this.options.probe || probePort)(values[role]) }))) : []; }
  async response(current, projects, settings, owner) {
    const checks = await this.checks(current.ports); this.assertContext(owner);
    const warnings = [];
    if (checks.some(row => row.families.some(f => f.status === 'unsupported'))) warnings.push('이 환경에서 비활성화된 주소 체계의 사용 여부는 확인할 수 없습니다.');
    if (checks.some(row => row.status === 'unavailable')) warnings.push('일부 포트의 사용 여부를 확인하지 못했습니다. 시스템의 제외 포트나 접근 권한을 확인하세요.');
    return { ...copy(current), checks, checkedAt: new Date().toISOString(), conflicts: this.conflicts(current, projects, settings), projects: copy(projects), reservations: copy(settings), warnings };
  }
  async available(projectId, numberValue, values, projects, settings, allowListening = false) {
    const proposed = { projectId, enabled: true, number: numberValue, ports: values };
    if (this.conflicts(proposed, projects, settings).length) return false;
    const checks = await this.checks(values);
    return checks.every(row => row.status === 'free' || (allowListening && row.status === 'listening'));
  }
  async automatic(current, projects, settings, reallocate = false) {
    const deadline = Date.now() + 10000;
    for (let n = 1; n <= 99; n++) {
      if (Date.now() > deadline) throw Error('포트 확인 시간이 길어지고 있습니다. 시스템 상태를 확인한 뒤 다시 배정하세요.');
      if (reallocate && n === current.number) continue;
      const values = formula(n);
      if (await this.available(current.projectId, n, values, projects, settings)) return { ...current, enabled: true, number: n, mode: 'automatic', ports: values };
    }
    throw Error('사용 가능한 프로젝트 번호가 없습니다. 다른 프로젝트 배정과 예약 포트, 실제 사용 중인 포트를 확인하세요.');
  }
  task(work) { const promise = work(); this.tasks.add(promise); promise.finally(() => this.tasks.delete(promise)).catch(() => {}); return promise; }
  read(id) { return this.task(async () => {
    const owner = this.context();
    return lockProfile(this.store, async () => {
      this.assertContext(owner); let current = await readAssignment(this.store, id);
      const settings = await readSettings(this.store), projects = await this.catalog();
      if (current.revision === null) { const next = await this.automatic(current, projects, settings); this.assertContext(owner); current = await writeAssignment(this.store, current, next, () => this.assertContext(owner)); }
      return this.response(current, projects.map(row => row.projectId === id ? { ...current, name: row.name } : row), settings, owner);
    });
  }); }
  action(id, input) { return this.task(async () => {
    const owner = this.context();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    return lockProfile(this.store, async () => {
      this.assertContext(owner); let current = await readAssignment(this.store, id);
      let settings = await readSettings(this.store); const projects = await this.catalog();
      if (input.action === 'check') return this.response(current, projects, settings, owner);
      if (input.action === 'reservations') {
        if (input.revision !== settings.revision) throw stale(); const values = reservations(input.ports);
        if (projects.some(p => p.enabled && p.ports && Object.values(p.ports).some(v => values.includes(v)))) throw Error('프로젝트에 배정된 포트는 외부 예약 포트로 지정할 수 없습니다. 먼저 해당 프로젝트를 재배정하세요.');
        this.assertContext(owner); settings = await writeSettings(this.store, settings.revision, values, () => this.assertContext(owner));
      } else {
        if (input.revision !== current.revision) throw stale(); let next;
        if (input.action === 'allocate' || input.action === 'reallocate') next = await this.automatic(current, projects, settings, input.action === 'reallocate');
        else if (input.action === 'release') next = { ...current, enabled: false, number: null, ports: null };
        else if (input.action === 'save' || input.action === 'import') {
          const n = number(input.number), values = input.ports === undefined && input.action === 'import' ? formula(n) : portValues(input.ports);
          if (input.allowListening !== undefined && typeof input.allowListening !== 'boolean') throw invalid();
          if (!(await this.available(id, n, values, projects, settings, input.allowListening))) throw Error('이미 배정·예약·사용 중이거나 확인할 수 없는 포트입니다. 번호와 포트를 다시 확인하세요.');
          next = { ...current, enabled: true, number: n, mode: ROLES.every(role => values[role] === formula(n)[role]) ? 'automatic' : 'custom', ports: values };
        } else throw invalid();
        this.assertContext(owner); current = await writeAssignment(this.store, current, next, () => this.assertContext(owner));
      }
      const fresh = projects.map(row => row.projectId === id ? { ...current, name: row.name } : row);
      return this.response(current, fresh, settings, owner);
    });
  }); }
  async shutdown() { this.stopping = true; await Promise.allSettled([...this.tasks]); }
  isBusy() { return this.tasks.size > 0; }
}
function registerProjectPorts(register, store, options = {}) {
  const manager = new ProjectPorts(store, options);
  register('readProjectPorts', id => manager.read(id));
  register('projectPortsAction', (id, input) => manager.action(id, input));
  return manager;
}
async function importProjectPorts(store, id, input, options = {}) {
  const manager = new ProjectPorts(store, options);
  return manager.action(id, { action: 'import', revision: (await readAssignment(store, id)).revision, ...input });
}
async function inspectProjectPorts(store, input, options = {}) {
  if (!input || !UUID.test(input.projectId)) throw invalid();
  const manager = new ProjectPorts(store, options), owner = manager.context();
  const n = number(input.number), values = input.ports === undefined ? formula(n) : portValues(input.ports);
  const projects = await manager.catalog(), settings = await readSettings(store);
  const conflicts = manager.conflicts({ projectId: input.projectId, enabled: true, number: n, ports: values }, projects, settings);
  const checks = await manager.checks(values); manager.assertContext(owner);
  return { conflicts, checks, available: !conflicts.length && checks.every(row => row.status === 'free'), checkedAt: new Date().toISOString(), reservations: settings };
}
module.exports = { registerProjectPorts, ProjectPorts, formula, probePort, readAssignment, validateAssignment, importProjectPorts, inspectProjectPorts, ROLES };
