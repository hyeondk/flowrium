const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../electron/store.cjs");
const { Controller } = require("../electron/controller.cjs");
const { registerMemory, memoryContext } = require("../electron/memory.cjs");
const { setTimeout: delay } = require("node:timers/promises");

function apiFor(store) {
  const api = {};
  registerMemory((k, v) => (api[k] = v), store);
  return api;
}
async function setup(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-memory-"));
  t.after(() =>
    fs.rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 100,
    }),
  );
  const store = new Store(path.join(tmp, "기기"));
  await store.load();
  const projects = [];
  for (const name of ["첫 번째 프로젝트", "두 번째 프로젝트"]) {
    const dir = path.join(tmp, name);
    await fs.mkdir(dir);
    projects.push(await store.addProject(dir));
  }
  return { tmp, store, projects, api: apiFor(store) };
}
const note = {
  action: "save",
  scope: "project",
  revision: null,
  title: "검토 지침",
  body: "기록한 메모문장",
  role: "",
  link: "https://example.com/source",
  linked: true,
};

test("프로젝트 또는 기기 전체/역할 대상 메모를 새 Codex 요청에 전달하고 삭제·연결 해제와 복구를 반영한다", async (t) => {
  const {
      projects: [a, b],
      store,
      api,
    } = await setup(t),
    session = await store.createSession(a.id);
  assert.deepEqual(await api.listMemory(a.id), []);
  await assert.rejects(
    fs.access(path.join(a.path, ".flowrium", "memory")),
    (e) => e.code === "ENOENT",
  );
  const local = await api.changeMemory(a.id, note);
  await api.changeMemory(a.id, {
    ...note,
    scope: "personal",
    body: "기기 공통 근거",
    role: "개인 비서",
  });
  const linked = await memoryContext(store, session);
  assert.match(linked, /기록한 메모문장/);
  assert.match(linked, /https:\/\/example.com/);
  assert(!linked.includes("기기 공통 근거"));
  assert.equal(await memoryContext(store, { projectId: b.id }), "");
  const personal = await memoryContext(store, {
    projectId: b.id,
    personalAssistant: true,
  });
  assert.match(personal, /기기 공통 근거/);
  assert(!personal.includes("기록한 메모문장"));
  const changed = await api.changeMemory(a.id, {
    ...local,
    action: "save",
    revision: local.rev,
    linked: false,
    body: "수정된 내용",
  });
  assert.equal(await memoryContext(store, session), "");
  const removed = await api.changeMemory(a.id, {
    action: "delete",
    scope: "project",
    id: local.id,
    revision: changed.rev,
  });
  const versions = await api.memoryVersions(a.id, "project", local.id);
  assert.deepEqual(
    versions.map((v) => v.rev),
    [removed.rev, changed.rev, local.rev],
  );
  const restored = await api.changeMemory(a.id, {
    action: "restore",
    scope: "project",
    id: local.id,
    revision: removed.rev,
    target: local.rev,
  });
  assert.equal(restored.deleted, false);
  assert.equal(restored.body, local.body);
  assert.equal(restored.linked, true);
  assert.notEqual(restored.rev, local.rev);
  await assert.rejects(
    api.changeMemory(a.id, { ...note, link: "file:///etc/passwd" }),
    /제목/,
  );
});
test("이전 변경을 덮어쓰지 않고 동시 수정 및 프로젝트 경로 외부의 기록을 거부한다", async (t) => {
  const {
    projects: [a, b],
    tmp,
    store,
    api,
  } = await setup(t);
  const row = await api.changeMemory(a.id, note);
  const results = await Promise.allSettled(
    ["1", "2"].map((body) =>
      api.changeMemory(a.id, {
        ...row,
        action: "save",
        revision: row.rev,
        body,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(
    api.changeMemory(b.id, { ...row, action: "save", revision: row.rev }),
    /동기화/,
  );
  if (process.platform !== "win32") {
    const away = path.join(tmp, "foreign");
    await fs.mkdir(away);
    await fs.symlink(away, path.join(b.path, ".flowrium", "memory"));
    await assert.rejects(api.listMemory(b.id), /동기화/);
    await assert.rejects(api.changeMemory(b.id, note), /동기화/);
    assert.deepEqual(await fs.readdir(away), []);
  }
  const copy = path.join(tmp, "복구된 프로젝트");
  await fs.cp(a.path, copy, { recursive: true });
  const fresh = new Store(path.join(tmp, "별도 기기"));
  await fresh.load();
  await fresh.addProject(copy);
  const next = apiFor(fresh);
  assert.equal((await next.listMemory(a.id))[0].id, row.id);
  assert.equal((await next.memoryVersions(a.id, "project", row.id)).length, 2);
  assert.equal(store.state.sessions.length, 0);
});
test("한 번 고른 보관 프로젝트의 단일 비서 대화를 반복/동시에 열고 명시 요청 때만 저장된 메모를 턴에 반영한다", async (t) => {
  const {
    tmp,
    store,
    projects: [a, b],
    api,
  } = await setup(t);
  assert.deepEqual(await api.assistantHome(), {
    projectId: null,
    connected: false,
    sessionId: null,
  });
  await assert.rejects(api.openAssistant(), /보관할 프로젝트/);
  await api.changeMemory(a.id, note);
  const [one, two] = await Promise.all([
    api.openAssistant(a.id),
    api.openAssistant(a.id),
  ]);
  assert.equal(one.id, two.id);
  assert.equal(one.messages.length, 0);
  assert.equal(store.state.sessions.length, 1);
  await assert.rejects(api.openAssistant(b.id), /이미 연결/);
  const controller = new Controller(store, {
    descriptor: {
      command: process.execPath,
      prefix: [path.join(__dirname, "backend-fake-codex.cjs")],
      node: true,
      label: "시험 Codex",
    },
  });
  t.after(() => controller.shutdown());
  let prompt;
  const original = controller.client.request.bind(controller.client);
  controller.client.request = (method, params, ...rest) => {
    if (method === "turn/start") prompt = params.input[0].text;
    return original(method, params, ...rest);
  };
  await controller.send({ sessionId: one.id, mode: "plan", text: "지시 확인" });
  for (let i = 0; i < 250 && controller.runs.size; i++) await delay(10);
  assert.match(prompt, /기록한 메모문장/);
  assert.match(prompt, /개인 비서 대화/);
  assert.equal(store.session(one.id).title, "개인 비서");
  const reopened = new Store(path.join(tmp, "기기"));
  await reopened.load();
  assert.equal((await apiFor(reopened).openAssistant()).id, one.id);
  const other = new Store(path.join(tmp, "다른 기기"));
  await other.load();
  await other.addProject(a.path);
  const imported = await apiFor(other).openAssistant(a.id);
  assert.equal(imported.id, one.id);
  assert.equal(imported.messages.length, 2);
});
