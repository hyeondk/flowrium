const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID, readJSON, createJSON, projectDirectory } = require('./project-store.cjs');
const { startWork } = require('./workbench.cjs');
const { publicMessage } = require('./errors.cjs');

const invalid = () => new Error('팀 이름과 역할 설정을 확인해 주세요.');
const conflict = () => new Error('팀 기록의 동기화가 완료되지 않았거나 다른 변경과 충돌했습니다. 프로젝트 기록을 확인해 주세요.');
const statuses = ['completed', 'failed', 'interrupted'];
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value.trim();
}
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid();
  return value;
}
function teamDefinition(input) {
  const name = text(input?.name, 80);
  if (!Array.isArray(input.roles) || input.roles.length < 2 || input.roles.length > 8) throw invalid();
  const roles = input.roles.map((role) => {
    if (!['plan', 'build', 'review'].includes(role?.mode)) throw invalid();
    return { name: text(role.name, 80), instruction: text(role.instruction, 2000), mode: role.mode,
      ...(role.model && { model: text(role.model, 200) }), ...(role.persona && { persona: text(role.persona, 600) }) };
  });
  if (new Set(roles.map((role) => role.name)).size !== roles.length)
    throw new Error('각 역할을 구분할 수 있게 다른 이름을 입력해 주세요.');
  return { name, roles };
}
async function directory(folder, create = true) {
  if (create) await projectDirectory(folder);
  if (!(await fs.lstat(folder)).isDirectory() || path.relative(folder, await fs.realpath(folder)) !== '')
    throw new Error('팀 기록 폴더가 프로젝트 밖의 위치를 가리킵니다.');
  return folder;
}
async function folders(store, projectId) {
  const project = store.project(id(projectId));
  const root = await directory(project.path, false);
  const projectRoot = await directory(path.join(root, '.flowrium'), false);
  const metadata = await read(path.join(projectRoot, 'project.json'));
  if (metadata.id !== project.id) throw conflict();
  const rootTeams = await directory(path.join(projectRoot, 'teams'));
  const teams = await directory(path.join(rootTeams, 'definitions'));
  const runs = await directory(path.join(rootTeams, 'runs'));
  return { teams, runs };
}
async function read(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > 160000) throw conflict();
  return readJSON(file);
}
async function readDefinitions(teams) {
  const heads = new Map(), revisions = new Map(), parents = new Set();
  for (const name of await fs.readdir(teams)) {
    if (!name.endsWith('.json')) continue;
    const item = await read(path.join(teams, name));
    if (name !== id(item.revision) + '.json' || !UUID.test(item.id) || item.version !== 1 ||
      (item.previous !== null && !UUID.test(item.previous))) throw conflict();
    if (item.team !== null) item.team = teamDefinition(item.team);
    revisions.set(item.revision, item);
    if (item.previous) parents.add(item.previous);
  }
  for (const item of revisions.values()) {
    if (item.previous && revisions.get(item.previous)?.id !== item.id) throw conflict();
    if (!parents.has(item.revision)) {
      if (heads.has(item.id)) throw conflict();
      heads.set(item.id, item);
    }
  }
  if (new Set([...revisions.values()].map((item) => item.id)).size !== heads.size) throw conflict();
  return heads;
}
function definition(item) { return { id: item.id, revision: item.revision, ...item.team }; }
function sessionFor(store, projectId, runId, index) {
  return store.state.sessions.find((s) => s.projectId === projectId &&
    s.workflow?.teamSlot?.runId === runId && s.workflow.teamSlot.index === index);
}
function roleSummary(session, status) {
  const secondTurn = session?.messages.findIndex((m, i) => i > 0 && m.role === 'user') ?? -1;
  const messages = session?.messages.slice(0, secondTurn === -1 ? undefined : secondTurn) || [];
  return (messages.findLast((m) => m.role === (status === 'completed' ? 'assistant' : 'system'))?.text ||
    (status === 'completed' ? '응답이 완료됐습니다.' : '실행이 중단됐습니다.')).slice(0, 800);
}
async function readRun(runs, runId) {
  const file = path.join(runs, id(runId) + '.json');
  const data = await read(file);
  if (data.version !== 1 || data.id !== runId || !UUID.test(data.teamId) ||
      typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) throw conflict();
  return { ...teamDefinition(data), id: runId, teamId: data.teamId, createdAt: data.createdAt, prompt: text(data.prompt, 12000) };
}
async function execution(store, controller, pending, projectId, runs, data) {
  const roles = await Promise.all(data.roles.map(async (role, index) => {
    const s = sessionFor(store, projectId, data.id, index);
    let status, summary;
    try {
      const result = await read(path.join(runs, data.id + '-' + index + '.result.json'));
      if (!statuses.includes(result.status) || typeof result.summary !== 'string') throw conflict();
      ({ status, summary } = result);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const active = pending.has(data.id) || (s && controller.runs.has(s.id));
      status = active ? 'running' : 'interrupted';
      summary = active ? '역할 대화를 실행하고 있습니다.' : '종료 전에 실행 결과를 기록하지 못했습니다.';
    }
    return { ...role, status, summary, ...(s && { sessionId: s.id }) };
  }));
  return { ...data, roles };
}
function registerTeams(register, store, controller, { canRun = () => true } = {}) {
  const queues = new Map(), pending = new Set();
  function serial(project, fn) {
    const next = (queues.get(project) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(project, next);
    return next.finally(() => { if (queues.get(project) === next) queues.delete(project); });
  }
  async function saveResult(runs, runId, index, status, summary) {
    await createJSON(path.join(runs, id(runId) + '-' + index + '.result.json'), { status, summary })
      .catch((e) => { if (e.code !== 'EEXIST') throw e; });
  }
  controller.on('event', (event) => {
    if (event.type !== 'done') return;
    const session = store.state.sessions.find((s) => s.id === event.sessionId);
    const slot = session?.workflow?.teamSlot;
    if (!slot || session.messages.filter((m) => m.role === 'user').length !== 1) return;
    const status = statuses.includes(event.status) ? event.status : 'failed';
    void serial(session.projectId, async () => {
      const { runs } = await folders(store, session.projectId);
      try { await fs.access(path.join(runs, slot.runId + '.json')); } catch(e) { if (e.code === 'ENOENT') return; throw e; }
      await saveResult(runs, slot.runId, slot.index, status, roleSummary(session, status));
    }).catch((error) => controller.emitEvent({ type: 'error', sessionId: session.id,
      text: publicMessage(error, '팀 실행 결과를 보존하지 못했습니다. 역할 대화에서 확인해 주세요.') }));
  });
  const directed = require('./teams-directed.cjs').registerDirected(register, {
    store, controller, canRun, serial, folders, readDefinitions, definition, teamDefinition,
  });
  register('readTeams', (projectId) => serial(projectId, async () => {
    const { teams, runs } = await folders(store, projectId);
    const heads = await readDefinitions(teams);
    const history = [];
    for (const file of await fs.readdir(runs)) {
      if (!file.endsWith('.json') || /^[0-9a-f-]{36}-[0-7]\.result\.json$/i.test(file)) continue;
      const run = await readRun(runs, file.slice(0, -5));
      history.push(await execution(store, controller, pending, projectId, runs, run));
    }
    return { teams: [...heads.values()].filter((item) => item.team).map(definition).sort((a,b) => a.name.localeCompare(b.name, 'ko')),
      runs: [...history, ...await directed.list(projectId, runs)].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) };
  }));
  async function modify(projectId, teamId, revision, value) {
    const { teams } = await folders(store, projectId);
    const heads = await readDefinitions(teams);
    const existing = heads.get(teamId);
    if (existing ? !existing.team || existing.revision !== revision : revision !== null) throw conflict();
    const change = { version: 1, id: teamId, revision: randomUUID(), previous: revision, team: value };
    await createJSON(path.join(teams, change.revision + '.json'), change);
    return definition(change);
  }
  register('saveTeam', (projectId, input) => serial(projectId, () => {
    const team = teamDefinition(input);
    return modify(projectId, input.id ? id(input.id) : randomUUID(), input.id ? id(input.revision) : null, team);
  }));
  register('removeTeam', (projectId, teamId, revision) => serial(projectId, async () => {
    await modify(projectId, id(teamId), id(revision), null);
  }));
  register('runTeam', (projectId, teamId, input, requestId) => serial(projectId, async () => {
    const prompt = text(input, 12000), runId = id(requestId);
    const { teams, runs } = await folders(store, projectId);
    let existing;
    try { existing = await readRun(runs, runId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (existing.teamId !== teamId || existing.prompt !== prompt) throw conflict();
      return execution(store, controller, pending, projectId, runs, existing);
    }
    const template = (await readDefinitions(teams)).get(id(teamId));
    if (!template?.team) throw new Error('실행할 팀을 찾을 수 없습니다.');
    if (!canRun()) throw new Error('앱 업데이트를 마친 뒤 팀을 실행해 주세요.');
    const data = { ...teamDefinition(template.team), id: runId, teamId, prompt, createdAt: new Date().toISOString() };
    await createJSON(path.join(runs, runId + '.json'), { version: 1, ...data });
    pending.add(runId);
    try {
      const dispatched = await Promise.allSettled(data.roles.map(async (role, index) => {
        try {
          const session = await startWork(store, { projectId, kind: 'task', role: role.name, brief: role.instruction,
            title: (data.name + ' / ' + role.name).slice(0, 160) }, { runId, index, mode: role.mode });
          if (!canRun()) throw new Error('앱 업데이트 중에 팀 실행이 중단됐습니다.');
          await controller.send({ sessionId: session.id, text: prompt, mode: role.mode });
        } catch (error) {
          await saveResult(runs, runId, index, 'failed', publicMessage(error, '이 역할을 시작하지 못했습니다.'));
        }
      }));
      const failed = dispatched.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    } finally { pending.delete(runId); }
    return execution(store, controller, pending, projectId, runs, data);
  }));
  register('openTeamRole', async (projectId, runId, index) => {
    const { runs } = await folders(store, projectId);
    const run = await readRun(runs, runId);
    if (!Number.isInteger(index) || index < 0 || index >= run.roles.length) throw invalid();
    const session = sessionFor(store, projectId, runId, index);
    if (!session) throw new Error('역할 대화가 삭제됐거나 시작되지 않았습니다. 실행 기록에서 결과를 확인해 주세요.');
    return structuredClone(session);
  });
  return { isBusy: () => pending.size > 0 || directed.isBusy() };
}
module.exports = { registerTeams };
