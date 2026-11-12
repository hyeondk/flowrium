const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { Store } = require("../electron/store.cjs");
const { registerWorkbench, workContext, startWork } = require("../electron/workbench.cjs");
const kinds = require("../electron/work-kinds.json");

async function setup(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-work-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));
  const folder = path.join(tmp, "선택한 폴더 & 파일");
  await fs.mkdir(folder);
  const store = new Store(path.join(tmp, "profile"));
  await store.load();
  const project = await store.addProject(folder);
  const api = {};
  const running = new Set();
  let revealed;
  registerWorkbench((key, fn) => { api[key] = fn; }, store, { isRunning: (id) => running.has(id), reveal: (file) => { revealed = file; } });
  const work = (kind, title = kinds[kind].label, other = {}) => api.startWork({ projectId: project.id, kind, title, ...other });
  const add = async (s, role, body) => {
    const message = { id: randomUUID(), role, text: body, createdAt: new Date().toISOString() };
    store.session(s.id).messages.push(message);
    await store.save();
    return message;
  };
  return { api, project, folder, tmp, store, running, revealed: () => revealed, work, add };
}
test("기능별 역할 대화가 별도로 생기고 현재 프로젝트에서 선택한 대화만 새 역할에 인계된다", async (t) => {
  const { work, store, add, project, tmp, api } = await setup(t);
  const all = [];
  for (const kind of Object.keys(kinds)) {
    const s = await work(kind, kind + " 업무", { role: kind + " 담당", brief: kind + " 기준" });
    assert.equal(s.title, kind + " 업무");
    assert.equal(s.workflow.kind, kind);
    const context = await workContext(store, s.id);
    assert.ok(context.includes(kind + " 담당") && context.includes(kind + " 기준"));
    all.push(s);
  }
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  await add(all[1], "assistant", "인계할 조사 결과");
  const created = await work("document", "결과 정리", { sourceSessionId: all[1].id });
  await add(all[1], "assistant", "인계 후 원문에서 추가한 내용");
  const ctx = await workContext(store, created.id);
  assert.match(ctx, /인계할 조사 결과/);
  assert.doesNotMatch(ctx, /인계 후 원문/);
  const other = path.join(tmp, "별개 프로젝트");
  await fs.mkdir(other);
  const p = await store.addProject(other);
  await assert.rejects(api.startWork({ projectId: p.id, title: "분리", kind: "task", sourceSessionId: created.id }), /같은 프로젝트/);
  await assert.rejects(work("weekly", "기간 오류", { from: "2026-09-31" }), /형식/);
  const team = await startWork(store, { projectId: project.id, title: "팀 작업", kind: "task" }, { runId: randomUUID(), index: 0, mode: "review" });
  assert.equal(team.workflow.teamSlot.mode, "review");
  assert.equal((await work("task", "외부 입력", { teamSlot: team.workflow.teamSlot })).workflow.teamSlot, undefined);
});
test("새 업무·기존 대화의 검토/완료 근거/재개, 연속 항목 변경 및 다른 컴퓨터 복원", async (t) => {
  const { api, store, project, work, add, running, folder, tmp } = await setup(t);
  const old = await store.createSession(project.id);
  assert.equal(old.workflow, undefined);
  assert.equal(await workContext(store, old.id), "");
  await add(old, "assistant", "실제로 완료한 납품 내역");
  await Promise.all(["체크 1", "체크 2"].map((text) => api.updateWork(old.id, { action: "add", text })));
  const item = store.session(old.id).workflow.checklist[0];
  await api.updateWork(old.id, { action: "toggle", id: item.id });
  assert.equal(store.session(old.id).workflow.checklist[0].done, true);
  await api.updateWork(old.id, { action: "remove", id: store.session(old.id).workflow.checklist[1].id });
  await api.updateWork(old.id, { action: "status", status: "review" });
  running.add(old.id);
  await assert.rejects(api.updateWork(old.id, { action: "status", status: "done" }), /답변이 끝난/);
  running.clear();
  const finished = await api.updateWork(old.id, { action: "status", status: "done" });
  assert.equal(finished.workflow.completion.summary, "실제로 완료한 납품 내역");
  const weekly = await work("weekly", "보고");
  assert.match(await workContext(store, weekly.id), /실제로 완료한 납품 내역/);
  const earlier = await work("weekly", "이전 보고", { from: "2022-01-01", to: "2022-01-02" });
  assert.doesNotMatch(await workContext(store, earlier.id), /실제로 완료한 납품 내역/);
  const otherFolder = path.join(tmp, "다른 컴퓨터 폴더");
  await fs.cp(folder, otherFolder, { recursive: true });
  const restored = new Store(path.join(tmp, "second-profile"));
  await restored.load();
  await restored.addProject(otherFolder);
  assert.deepEqual(restored.session(old.id).workflow, finished.workflow);
  const reopened = await api.updateWork(old.id, { action: "status", status: "active" });
  assert.equal(reopened.workflow.completion, undefined);
});
test("저장소는 프로젝트의 실제 변경과 제목·커밋 날짜를 읽고 .flowrium을 목록에서 제외한다", async (t) => {
  const { api, folder, project } = await setup(t);
  assert.equal((await api.readWorkbench(project.id)).git.available, false);
  const git = (...args) => execFileSync("git", ["-C", folder, "-c", "user.name=Flowrium", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  git("init", "-q");
  await fs.writeFile(path.join(folder, "기획.md"), "기획 본문");
  git("add", "기획.md"); git("commit", "-qm", "기획 문서 작성");
  await fs.appendFile(path.join(folder, "기획.md"), " 수정");
  const { git: result } = await api.readWorkbench(project.id);
  assert.equal(result.available, true);
  assert.deepEqual(result.changes, [{ code: "M", path: "기획.md" }]);
  assert.equal(result.commits[0].subject, "기획 문서 작성");
  assert.ok(Number.isFinite(Date.parse(result.commits[0].at)));
});
test("답변 산출물 실제 파일, 원본 연결, 중복 저장과 외부 경로 차단", async (t) => {
  const { api, store, project, work, add, running, folder, tmp, revealed } = await setup(t);
  const s = await work("research", "../확인할: 조사");
  const m = await add(s, "assistant", "공개 조사 결과");
  const input = await add(s, "user", "원문");
  await assert.rejects(api.saveWorkArtifact(s.id, input.id), /저장할 답변/);
  running.add(s.id);
  await assert.rejects(api.saveWorkArtifact(s.id, m.id), /답변이 끝난/);
  running.clear();
  const file = await api.saveWorkArtifact(s.id, m.id);
  assert.equal(file.sessionId, s.id);
  assert.match(await api.readWorkArtifact(project.id, file.path), /공개 조사 결과/);
  assert.equal((await api.saveWorkArtifact(s.id, m.id)).existing, true);
  await api.revealWorkArtifact(project.id, file.path);
  assert.equal(path.relative(project.path, revealed()).split(path.sep).join("/"), file.path);
  const v = await api.readWorkbench(project.id);
  assert.equal(v.artifacts[0].sessionId, s.id);
  await fs.writeFile(revealed(), "사용자 수정");
  await assert.rejects(api.saveWorkArtifact(s.id, m.id), /수정됐습니다/);
  assert.equal(await fs.readFile(revealed(), "utf8"), "사용자 수정");
  await assert.rejects(api.readWorkArtifact(project.id, "docs/../.flowrium/project.json"), /산출물/);
  await assert.rejects(api.readWorkArtifact(project.id, "docs/tool.exe"), /산출물/);
  if (process.platform !== "win32") {
    await fs.symlink(tmp, path.join(folder, "docs"));
    await assert.rejects(api.readWorkArtifact(project.id, "docs/바깥.md"), /가리키는/);
    assert.equal((await api.readWorkbench(project.id)).artifacts.length, 1);
  }
  assert.ok(store.session(s.id).messages.length);
});

test("문서 선택·드롭은 안전한 프로젝트 폴더에만 추가하며 기존 자료와 금지한 파일 이름은 보존한다", async (t) => {
  const { api, project } = await setup(t);
  const file = { name: "기존 문서.txt", body: new Uint8Array(Buffer.from("첫 버전")) };
  const first = await api.importWorkFiles(project.id, [file]);
  assert.equal(first.added.length, 1);
  const next = await api.importWorkFiles(project.id, [
    { ...file, body: new Uint8Array(Buffer.from("두번째 내용")) }, { ...file, name: "../외부.md" }, { ...file, name: "동작.cmd" },
  ]);
  assert.equal(next.added.length, 0);
  assert.equal(next.skipped.length, 3);
  assert.equal(await api.readWorkArtifact(project.id, first.added[0].path), "첫 버전");
});
