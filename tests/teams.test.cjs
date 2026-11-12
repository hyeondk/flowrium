const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { Store } = require('../electron/store.cjs');
const { Controller } = require('../electron/controller.cjs');
const { registerTeams } = require('../electron/teams.cjs');

const roles = [
  { name: '기획자', mode: 'plan', instruction: '기능을 설계해 주세요.' },
  { name: '구현자', mode: 'build', instruction: '기능을 구현해 주세요.' },
  { name: '검토자', mode: 'review', instruction: '기능을 검토해 주세요.' },
];
const descriptor = { command: process.execPath, node: true, label: '검증용 Codex',
  prefix: [path.join(__dirname, 'backend-fake-codex.cjs')] };
function connect(store, options) {
  const controller = new Controller(store, { descriptor });
  const api = {};
  registerTeams((name, method) => { api[name] = method; }, store, controller, options);
  return { controller, api };
}
async function fixture(t, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-teams-'));
  const projectFolder = path.join(root, '내 & 프로젝트');
  await fs.mkdir(projectFolder);
  const store = new Store(path.join(root, '설정'));
  await store.load();
  const project = await store.addProject(projectFolder);
  const { controller, api } = connect(store, options);
  t.after(async () => { await controller.shutdown(); await fs.rm(root, { recursive: true, force: true }); });
  return { store, controller, api, project, root };
}
async function finished(api, projectId, id) {
  for (let n = 0; n < 100; n++) {
    const run = (await api.readTeams(projectId)).runs.find((r) => r.id === id);
    if (run && run.roles.every((role) => ['completed', 'failed'].includes(role.status))) return run;
    await delay(30);
  }
  throw new Error('팀 실행 종료 결과를 확인할 수 없습니다.');
}
test('역할 3개를 독립 Codex 세션에서 실행하고 다른 컴퓨터에서 팀과 최초 결과를 다시 연다', async (t) => {
  const { store, api, project, root, controller } = await fixture(t);
  const team = await api.saveTeam(project.id, { name: '출시팀', roles });
  const request = randomUUID();
  const [one, duplicate] = await Promise.all([api.runTeam(project.id, team.id, '작업 요청', request),
    api.runTeam(project.id, team.id, '작업 요청', request)]);
  assert.equal(one.id, duplicate.id);
  const done = await finished(api, project.id, request);
  assert.deepEqual(done.roles.map((role) => role.status), ['completed','completed','completed']);
  assert.deepEqual(done.roles.map((role) => role.summary), ['확인한 결과입니다. / readOnly',
    '확인한 결과입니다. / workspaceWrite','확인한 결과입니다. / readOnly']);
  assert.equal(new Set(store.state.sessions.map((s) => s.threadId)).size, 3);
  assert.equal((await api.readTeams(project.id)).runs.length, 1);
  assert.equal(store.state.sessions.length, 3);
  const role = await api.openTeamRole(project.id, done.id, 1);
  assert.equal(role.workflow.teamSlot.mode, 'build');
  assert.equal(role.workflow.role, '구현자');
  await controller.send({ sessionId: role.id, mode: 'review', text: '추가 요청' });
  for (let i = 0; i < 200 && controller.runs.has(role.id); i++) await delay(15);
  assert.equal((await api.readTeams(project.id)).runs[0].roles[1].summary, '확인한 결과입니다. / workspaceWrite');
  const other = new Store(path.join(root, '다른 컴퓨터'));
  await other.load(); await other.addProject(project.path);
  const next = connect(other);
  try {
    const board = await next.api.readTeams(project.id);
    assert.deepEqual(board.runs[0], done);
    assert.deepEqual(board.teams[0], team);
    const reopened = await next.api.openTeamRole(project.id, done.id, 1);
    assert.equal(reopened.threadId, undefined);
    assert.equal(reopened.messages.at(-1).text, '확인한 결과입니다. / readOnly');
    await next.api.removeTeam(project.id, team.id, team.revision);
    assert.equal((await next.api.readTeams(project.id)).teams.length, 0);
    assert.deepEqual((await next.api.readTeams(project.id)).runs[0], done);
  } finally { await next.controller.shutdown(); }
});

test('한 역할의 시작 실패가 성공한 역할의 결과를 지우지 않는다', async (t) => {
  const { controller, project, api } = await fixture(t);
  const send = controller.send.bind(controller);
  controller.send = async (input) => { if (input.mode === 'build') throw new Error('구현 담당자가 시작되지 않았습니다.'); return send(input); };
  const team = await api.saveTeam(project.id, { name: '검증팀', roles });
  const run = await api.runTeam(project.id, team.id, '점검', randomUUID());
  const done = await finished(api, project.id, run.id);
  assert.deepEqual(done.roles.map((r) => r.status), ['completed', 'failed', 'completed']);
  assert.equal(done.roles[1].summary, '구현 담당자가 시작되지 않았습니다.');
});
test('잘못된 역할, 이전 수정본, 진행 중 업데이트 및 다른 프로젝트 접근을 검증한다', async (t) => {
  const { project, api, store, root } = await fixture(t, { canRun: () => false });
  await assert.rejects(api.saveTeam(project.id, { name: '잘못된 팀', roles: [roles[0], roles[0]] }), /다른 이름/);
  const team = await api.saveTeam(project.id, { name: '처음 팀', roles });
  const updated = await api.saveTeam(project.id, { ...team, name: '새 이름' });
  await assert.rejects(api.removeTeam(project.id, team.id, team.revision), /충돌/);
  assert.equal((await api.readTeams(project.id)).teams[0].name, updated.name);
  await assert.rejects(api.runTeam(project.id, team.id, '요청', randomUUID()), /업데이트/);
  assert.equal((await api.readTeams(project.id)).runs.length, 0);
  await fs.mkdir(path.join(root, '별도프로젝트'));
  const other = await store.addProject(path.join(root, '별도프로젝트'));
  assert.deepEqual(await api.readTeams(other.id), { teams: [], runs: [] });
  await assert.rejects(api.runTeam(other.id, team.id, '요청', randomUUID()), /찾을 수 없습니다/);
});
