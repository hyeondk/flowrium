const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../electron/store.cjs");
const { registerPortfolio } = require("../electron/portfolio.cjs");
const { registerProjectDetails } = require("../electron/project-details.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-portfolio-"));
  t.after(() =>
    fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }),
  );
  const parent = path.join(root, "사용자가 택한 위치");
  await fs.mkdir(parent);
  let picked = parent,
    revealed = "";
  async function profile(name) {
    const store = new Store(path.join(root, name));
    await store.load();
    const api = {},
      register = (name, handler) => {
        api[name] = handler;
      };
    registerPortfolio(register, store, {
      chooseFolder: async () => picked,
      reveal: (file) => {
        revealed = file;
      },
    });
    registerProjectDetails(register, store);
    return { store, api };
  }
  return {
    root,
    parent,
    profile,
    ...(await profile("기기 A")),
    pick: (value) => {
      picked = value;
    },
    revealed: () => revealed,
  };
}
const input = {
  name: "시민 안내서",
  owner: "편집팀",
  goal: "안내서 발간",
  members: "기획 / 조사",
  startedAt: "2026-11-01",
  dueDate: "2026-12-10",
  notes: "첫 검토에서 동선을 확인",
  category: "편집",
  privacy: "일반",
  phase: "진행",
  client: "독자",
  repository: "",
  createFolder: true,
  scaffold: true,
};

test("킥오프에서 선택한 위치에 새 프로젝트를 만들고 목표와 체크리스트, 기간, 자료를 다른 프로필에서도 복원한다", async (t) => {
  const f = await fixture(t);
  const p = await f.api.kickoffProject(input);
  assert.equal(p.path, await fs.realpath(path.join(f.parent, input.name)));
  assert.deepEqual(
    await fs.readdir(path.join(p.path, "docs")).then((x) => x.sort()),
    ["규칙", "디자인", "회의록"].sort(),
  );
  const [card] = await f.api.readPortfolio();
  assert.equal(card.details.kickoff.notes, input.notes);
  assert.equal(card.details.owner, input.owner);
  let d = await f.api.updateProjectDetails(p.id, card.details.revision, {
    action: "goal-add",
    period: "week",
    key: "2026-11-09",
    text: "답사 자료 확인",
  });
  const week = d.periodGoals[0].id;
  d = await f.api.updateProjectDetails(p.id, d.revision, {
    action: "goal-check",
    id: week,
    done: true,
  });
  d = await f.api.updateProjectDetails(p.id, d.revision, {
    action: "goal-add",
    period: "month",
    key: "2026-11",
    text: "초안 공개",
  });
  await assert.rejects(
    f.api.setKickoffDetails(p.id, card.details.revision, {
      ...input,
      goal: "오래된 자료",
    }),
    /변경/,
  );
  const second = await f.profile("기기 B");
  await second.store.addProject(p.path);
  const [copy] = await second.api.readPortfolio();
  assert.equal(copy.details.periodGoals.length, 2);
  assert.equal(copy.details.periodGoals[0].done, true);
  assert.equal(copy.details.kickoff.name, input.name);
  d = await second.api.setKickoffDetails(p.id, copy.details.revision, {
    ...input,
    goal: "배포일 최종 확인",
  });
  assert.equal(d.goal, "배포일 최종 확인");
  d = await second.api.updateProjectDetails(p.id, d.revision, {
    action: "archive",
  });
  assert.ok((await f.api.readPortfolio())[0].details.archivedAt);
  await second.api.updateProjectDetails(p.id, d.revision, { action: "resume" });
  assert.equal((await f.api.readPortfolio())[0].details.archivedAt, null);
});

test("취소·중복·잘못된 경로 및 기간을 거절하고 기존 폴더의 프로젝트 자료를 보존한다", async (t) => {
  const f = await fixture(t);
  f.pick(null);
  assert.equal(await f.api.kickoffProject(input), null);
  assert.deepEqual(f.store.state.projects, []);
  f.pick(f.parent);
  await assert.rejects(
    f.api.kickoffProject({ ...input, name: "../외부" }),
    /이름/,
  );
  await assert.rejects(
    f.api.kickoffProject({ ...input, startedAt: "2026-02-31" }),
    /형식/,
  );
  await assert.rejects(
    f.api.kickoffProject({ ...input, dueDate: "2025-11-01" }),
    /목표일/,
  );
  const p = await f.api.kickoffProject(input);
  await assert.rejects(f.api.kickoffProject(input), /같은 이름/);
  f.pick(p.path);
  await assert.rejects(
    f.api.kickoffProject({ ...input, createFolder: false, goal: "변경" }),
    /상세 정보/,
  );
  await assert.rejects(
    f.api.kickoffProject({
      ...input,
      createFolder: false,
      clone: true,
      repository: "https://github.com/example/demo",
    }),
    /비어/,
  );
  assert.equal((await f.api.readProjectDetails(p.id)).goal, input.goal);
});

test("규칙·디자인·회의록은 선택한 분류 안의 실제 문서만 생성하고 심볼릭 링크·중복·상위경로를 차단한다", async (t) => {
  const f = await fixture(t);
  const p = await f.api.kickoffProject(input);
  await fs.writeFile(path.join(p.path, "AGENTS.md"), "공통 약속");
  const meeting = await f.api.createProjectNote(
    p.id,
    "meetings",
    "착수 회의",
    "담당자와 기간을 확정했습니다.",
  );
  assert.equal(
    await f.api.readProjectNote(p.id, "meetings", meeting.path),
    "담당자와 기간을 확정했습니다.",
  );
  assert.equal(
    (await f.api.listProjectNotes(p.id, "rules"))[0].path,
    "AGENTS.md",
  );
  assert.equal((await f.api.listProjectNotes(p.id, "meetings")).length, 1);
  await f.api.revealProjectNote(p.id, "meetings", meeting.path);
  assert.equal(f.revealed(), path.join(p.path, ...meeting.path.split("/")));
  await assert.rejects(
    f.api.createProjectNote(p.id, "meetings", "착수 회의", "다른 내용"),
    /같은 이름/,
  );
  await assert.rejects(
    f.api.readProjectNote(p.id, "rules", meeting.path),
    /문서 위치/,
  );
  await assert.rejects(
    f.api.readProjectNote(
      p.id,
      "rules",
      "docs/rules/../../.flowrium/project.json",
    ),
    /문서 위치/,
  );
  const design = await f.api.createProjectNote(
    p.id,
    "design",
    "사용자 흐름",
    "홈 → 업무 선택",
  );
  assert.ok(
    (await f.api.listProjectNotes(p.id, "design")).find(
      (n) => n.path === design.path,
    ),
  );
  await fs.writeFile(
    path.join(p.path, "docs", "디자인", "시안.png"),
    Buffer.from([0, 1, 2]),
  );
  await assert.rejects(
    f.api.readProjectNote(p.id, "design", "docs/디자인/시안.png"),
    /파일 위치/,
  );
  if (process.platform !== "win32") {
    const alias = path.join(p.path, "docs", "meetings");
    await fs.symlink(f.parent, alias);
    await assert.rejects(f.api.listProjectNotes(p.id, "meetings"), /위치/);
  }
});

test("통합 주간보고는 직접 선택한 프로젝트의 완료 기록만 읽는다", async (t) => {
  const f = await fixture(t);
  const {
    registerWorkbench,
    workContext,
  } = require("../electron/workbench.cjs");
  registerWorkbench(
    (name, handler) => {
      f.api[name] = handler;
    },
    f.store,
    { reveal: () => {} },
  );
  const projects = [];
  for (const name of ["취재", "편집", "제외"]) {
    const p = await f.api.kickoffProject({ ...input, name });
    projects.push(p);
    const task = await f.api.startWork({
      projectId: p.id,
      kind: "task",
      title: "실제 완료 " + name,
    });
    await f.api.updateWork(task.id, { action: "status", status: "done" });
  }
  const [p, q] = projects;
  const args = {
    projectId: p.id,
    kind: "weekly",
    title: "통합 보고",
    reportProjects: [p.id, q.id],
  };
  const s = await f.api.startWork(args),
    context = await workContext(f.store, s.id);
  assert.match(context, /실제 완료 취재/);
  assert.match(context, /실제 완료 편집/);
  assert.doesNotMatch(context, /실제 완료 제외/);
  await assert.rejects(
    f.api.startWork({ ...args, reportProjects: [p.id, p.id] }),
    /형식/,
  );
  await assert.rejects(f.api.startWork({ ...args, kind: "pause" }), /형식/);
});
