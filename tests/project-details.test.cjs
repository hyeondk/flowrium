const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../electron/store.cjs");
const { registerProjectDetails } = require("../electron/project-details.cjs");

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-project-details-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const projectPath = path.join(temp, "독립 & 프로젝트");
  await fs.mkdir(projectPath);
  async function connect(profile) {
    const store = new Store(path.join(temp, profile)); await store.load();
    const project = await store.addProject(projectPath);
    const api = {};
    registerProjectDetails((name, fn) => { api[name] = fn; }, store);
    return { api, project };
  }
  return { ...(await connect("컴퓨터1")), connect, projectPath, temp };
}
test("프로젝트 목표·담당자·기한과 체크리스트·보관 상태를 다른 컴퓨터에서 복원하고 재개한다", async (t) => {
  const { api, project, connect } = await fixture(t);
  const read = () => api.readProjectDetails(project.id);
  const initial = await read();
  assert.equal(initial.revision, null);
  let d = await api.updateProjectDetails(project.id, null, { action: "details", owner: "검토 담당", goal: "공개 전 검증", dueDate: "2028-02-29" });
  d = await api.updateProjectDetails(project.id, d.revision, { action: "add", text: "최종 점검" });
  d = await api.updateProjectDetails(project.id, d.revision, { action: "check", id: d.checklist[0].id, done: true });
  d = await api.updateProjectDetails(project.id, d.revision, { action: "archive" });
  assert.ok(d.archivedAt);
  const next = await connect("컴퓨터2");
  assert.deepEqual(await next.api.readProjectDetails(project.id), d);
  d = await next.api.updateProjectDetails(project.id, d.revision, { action: "resume" });
  assert.equal(d.archivedAt, null);
  assert.equal(d.checklist[0].done, true);
  d = await next.api.updateProjectDetails(project.id, d.revision, { action: "remove", id: d.checklist[0].id });
  assert.equal((await read()).checklist.length, 0);
});
test("오래된 수정본과 존재하지 않는 날짜를 차단하며 동시 저장 시 한 건만 반영한다", async (t) => {
  const { api, project } = await fixture(t);
  await assert.rejects(api.updateProjectDetails(project.id, null, { action: "details", owner: "", goal: "", dueDate: "2027-02-29" }), /형식/);
  const results = await Promise.allSettled([1, 2].map((i) => api.updateProjectDetails(project.id, null, { action: "add", text: String(i) })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(api.updateProjectDetails(project.id, null, { action: "archive" }), /변경/);
  assert.equal((await api.readProjectDetails(project.id)).checklist.length, 1);
});
test("충돌 파일과 프로젝트 밖을 가리키는 상세 기록을 덮어쓰지 않는다", async (t) => {
  const { api, project, projectPath, temp } = await fixture(t);
  await api.updateProjectDetails(project.id, null, { action: "archive" });
  const dir = path.join(projectPath, ".flowrium", "details");
  const source = await fs.readFile(path.join(dir, "first.json"));
  await fs.writeFile(path.join(dir, "first (충돌).json"), source);
  await assert.rejects(api.readProjectDetails(project.id), /변경/);
  assert.deepEqual(await fs.readFile(path.join(dir, "first.json")), source);
  if (process.platform !== "win32") {
    await fs.rename(dir, path.join(temp, "원본"));
    await fs.symlink(path.join(temp, "원본"), dir);
    await assert.rejects(api.readProjectDetails(project.id), /다른 위치/);
  }
});
