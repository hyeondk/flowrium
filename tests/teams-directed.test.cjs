const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { Store } = require("../electron/store.cjs");
const { Controller } = require("../electron/controller.cjs");
const { registerTeams } = require("../electron/teams.cjs");

const roles = [
  { name: "조사 담당", mode: "plan", instruction: "원본 자료를 조사합니다." },
  { name: "검토 담당", mode: "review", instruction: "근거를 검토합니다." },
];
const picks = roles.map((v, index) => ({
  index,
  title: v.name + " 과업",
  task: index ? "조사 근거를 검토하세요." : "요구 사항을 조사하세요.",
  steps: ["근거 확인"],
}));
function connect(store) {
  const controller = new Controller(store, {
    descriptor: {
      command: process.execPath,
      node: true,
      label: "시험 연결",
      prefix: [path.join(__dirname, "backend-fake-codex.cjs")],
    },
  });
  const api = {};
  registerTeams((k, v) => (api[k] = v), store, controller);
  return { controller, api };
}
async function setup(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-directed-")),
    folder = path.join(tmp, "업무 & 보관");
  await fs.mkdir(folder);
  const store = new Store(path.join(tmp, "설정"));
  await store.load();
  const p = await store.addProject(folder),
    { controller, api } = connect(store);
  t.after(async () => {
    await controller.shutdown();
    await fs.rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const team = await api.saveTeam(p.id, { name: "프로젝트 팀", roles });
  const create = (options, goal = "공동 목표") =>
    api.directTeam(p.id, team.id, goal, randomUUID(), options);
  const change = (r, c) =>
    api.changeTeamRun(p.id, r.id, c, r.directed.revision);
  const wait = async (id, fn) => {
    let r;
    for (let i = 0; i < 240; i++) {
      r = (await api.readTeams(p.id)).runs.find((x) => x.id === id);
      if (r && fn(r.directed)) return r;
      await delay(20);
    }
    throw Error(
      "팀 대기 시간 초과 " + JSON.stringify(r?.directed).slice(0, 2500),
    );
  };
  return {
    tmp,
    folder,
    store,
    project: p,
    controller,
    api,
    create,
    change,
    wait,
  };
}
test("팀장은 명시 요청 시 실제 Codex 채널에서 배정안을 만들고 사용자가 고른 담당자만 실행하여 보고서를 보관한다", async (t) => {
  const { tmp, folder, store, project, api, create, change, wait } =
    await setup(t);
  let r = await create({ strategy: "plan", autoReport: true });
  r = await wait(r.id, (d) => d.phase === "draft");
  assert.equal(r.directed.nodes.length, 2);
  assert.equal(store.state.sessions.length, 1);
  const initial = r;
  const pick = { ...picks[0], task: "사용자가 직접 고친 업무" };
  r = await change(r, { action: "dispatch", assignments: [pick] });
  await assert.rejects(
    change(initial, { action: "dispatch", assignments: [pick] }),
    /변경/,
  );
  r = await wait(r.id, (d) => d.phase === "done");
  assert.equal(store.state.sessions.length, 2);
  assert.equal(r.directed.nodes[0].task, pick.task);
  assert.equal(r.directed.nodes[0].status, "done");
  assert.equal(r.directed.nodes[0].stepsDone, 1);
  const report = await fs.readFile(
    path.join(folder, r.directed.artifactPath),
    "utf8",
  );
  assert.match(report, /팀 결과 보고/);
  const lead = await api.openTeamNode(project.id, r.id, -1);
  assert.equal(lead.messages.filter((m) => m.role === "user").length, 2);
  const worker = await api.openTeamNode(project.id, r.id, 0);
  assert.notEqual(lead.threadId, worker.threadId);
  const copy = path.join(tmp, "다른 컴퓨터");
  await fs.cp(folder, copy, { recursive: true });
  const other = new Store(path.join(tmp, "또다른 설정"));
  await other.load();
  await other.addProject(copy);
  const restored = connect(other);
  try {
    const run = (await restored.api.readTeams(project.id)).runs[0];
    assert.deepEqual(run, r);
    assert.equal(
      (await restored.api.openTeamNode(project.id, r.id, 0)).threadId,
      undefined,
    );
    assert.equal(
      await fs.readFile(path.join(copy, run.directed.artifactPath), "utf8"),
      report,
    );
  } finally {
    await restored.controller.shutdown();
  }
});
test("수동 배정은 모델 호출 전에 멈추고 역할에서 실제로 발생한 질문은 같은 대화의 답으로 이어진다", async (t) => {
  const { store, create, change, wait } = await setup(t);
  let r = await create({ strategy: "manual" });
  assert.equal(store.state.sessions.length, 0);
  r = await change(r, {
    action: "dispatch",
    assignments: [{ ...picks[0], task: "결정질문시험" }],
  });
  r = await wait(r.id, (d) => d.phase === "decisions");
  assert.equal(r.directed.decisions[0].question, "어느 자료를 우선할까요?");
  const id = r.directed.nodes[0].sessionId;
  r = await change(r, {
    action: "answer",
    decisionId: r.directed.decisions[0].id,
    text: "내부 자료",
  });
  r = await wait(r.id, (d) => d.phase === "review");
  assert.equal(r.directed.decisions[0].answer, "내부 자료");
  assert.equal(r.directed.nodes[0].sessionId, id);
  assert.equal(
    store.session(id).messages.filter((m) => m.role === "user").length,
    2,
  );
  assert.equal(store.state.sessions.length, 1);
});
test("일시정지 중 전달된 추가 지시, 새 담당자 재배정 및 완료 목록 삭제", async (t) => {
  const { controller, store, create, change, wait, api, project } =
    await setup(t);
  let r = await create({ strategy: "manual" });
  r = await change(r, {
    action: "dispatch",
    assignments: [{ ...picks[0], task: "대기검증" }],
  });
  r = await change(r, { action: "pause" });
  assert.equal(r.directed.phase, "paused");
  r = await change(r, {
    action: "instruct",
    index: 0,
    text: "재개하면 검토 목록 작성",
  });
  assert.equal(r.directed.nodes[0].queue.length, 1);
  await wait(r.id, () => controller.runs.size === 0);
  r = await change(r, { action: "resume" });
  assert.equal(r.directed.nodes[0].queue.length, 0);
  assert.match(
    store
      .session(r.directed.nodes[0].sessionId)
      .messages.filter((m) => m.role === "user")
      .at(-1).text,
    /재개하면 검토 목록/,
  );
  r = await change(r, { action: "stopNode", index: 0 });
  r = await wait(
    r.id,
    (d) => d.phase === "review" && controller.runs.size === 0,
  );
  r = await change(r, {
    action: "reassign",
    index: 0,
    toIndex: 1,
    text: "검토 담당자가 과업을 마무리하세요.",
  });
  r = await wait(
    r.id,
    (d) =>
      d.phase === "review" &&
      d.nodes.some((n) => n.index === 1 && n.status === "done"),
  );
  assert.notEqual(r.directed.nodes[0].sessionId, r.directed.nodes[1].sessionId);
  r = await change(r, { action: "stop" });
  r = await change(r, { action: "finishStopped" });
  assert.equal(r.directed.phase, "done");
  await change(r, { action: "deleteRun" });
  assert.equal((await api.readTeams(project.id)).runs.length, 0);
});
test("실행 중 기록을 새 기기에서 열어도 모델을 자동 호출하지 않고 실패한 역할만 재시도할 수 있다", async (t) => {
  const { tmp, folder, store, project, controller, create, change, wait } =
    await setup(t);
  const original = controller.send.bind(controller);
  let fail = true;
  controller.send = async (input, ...rest) => {
    if (fail && input.mode === "review") throw Error("시험 역할 시작 실패");
    return original(input, ...rest);
  };
  let r = await create({ strategy: "manual" });
  r = await change(r, {
    action: "dispatch",
    assignments: [{ ...picks[0], task: "대기검증" }, picks[1]],
  });
  assert.equal(r.directed.nodes[1].status, "failed");
  const moved = path.join(tmp, "복원");
  await fs.cp(folder, moved, { recursive: true });
  const another = new Store(path.join(tmp, "복원 기기"));
  await another.load();
  await another.addProject(moved);
  const fresh = connect(another);
  try {
    assert.equal(
      (await fresh.api.readTeams(project.id)).runs[0].directed.phase,
      "paused",
    );
    assert.equal(fresh.controller.runs.size, 0);
  } finally {
    await fresh.controller.shutdown();
  }
  fail = false;
  r = await change(r, { action: "retry", index: 1 });
  r = await wait(r.id, (d) => d.nodes[1].status === "done");
  assert.equal(
    store
      .session(r.directed.nodes[1].sessionId)
      .messages.filter((m) => m.role === "user").length,
    1,
  );
  await change(r, { action: "stop" });
});
test("토큰 한도에서 실제 턴을 일시정지하고 한도를 늘려야 역할이 재개된다", async (t) => {
  const { controller, create, change, wait } = await setup(t);
  let r = await create({ strategy: "manual", budget: 100 });
  r = await change(r, {
    action: "dispatch",
    assignments: [{ ...picks[0], task: "대기검증" }],
  });
  const id = r.directed.nodes[0].sessionId;
  await wait(r.id, () => !!controller.runs.get(id)?.turnId);
  const run = controller.runs.get(id);
  controller.client.emit("notification", {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: run.threadId,
      turnId: run.turnId,
      tokenUsage: { last: { totalTokens: 110 } },
    },
  });
  r = await wait(r.id, (d) => d.phase === "paused" && !controller.runs.has(id));
  assert.equal(r.directed.tokens, 110);
  assert.equal(r.directed.decisions.at(-1).node, -2);
  r = await change(r, { action: "raiseLimit" });
  assert.equal(r.directed.budget, 165);
  assert.equal(r.directed.phase, "running");
  assert.equal(r.directed.nodes[0].sessionId, id);
  await change(r, { action: "stop" });
});
test("검수 담당자가 반려하면 보완 결정 후 기존 구현과 검수 대화를 순서대로 다시 실행한다", async (t) => {
  const { api, project, store, change, wait } = await setup(t);
  const team = await api.saveTeam(project.id, {
    name: "구현 검수",
    roles: [
      { name: "구현", mode: "build", instruction: "구현하세요." },
      roles[1],
    ],
  });
  let r = await api.directTeam(
    project.id,
    team.id,
    "구현 후 검수",
    randomUUID(),
    { strategy: "manual" },
  );
  r = await change(r, {
    action: "dispatch",
    assignments: [
      { ...picks[0], task: "구현보완시험" },
      { ...picks[1], targetIndex: 0, task: "검수반려시험" },
    ],
  });
  r = await wait(r.id, (d) => d.phase === "decisions");
  assert.equal(r.directed.nodes[0].status, "interrupted");
  assert.equal(r.directed.nodes[1].status, "waiting");
  const decision = r.directed.decisions.at(-1);
  assert.equal(decision.node, 0);
  r = await change(r, {
    action: "answer",
    decisionId: decision.id,
    text: "보완 후 재검수",
  });
  r = await wait(r.id, (d) => d.phase === "review");
  assert.deepEqual(
    r.directed.nodes.map((n) => n.status),
    ["done", "done"],
  );
  for (const n of r.directed.nodes)
    assert.equal(
      store.session(n.sessionId).messages.filter((m) => m.role === "user")
        .length,
      2,
    );
});
