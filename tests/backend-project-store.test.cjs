const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Store } = require("../electron/store.cjs");
const { ProjectStore } = require("../electron/project-store.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-portable-"));
  const directory = path.join(root, "로컬 프로젝트");
  await fs.mkdir(directory);
  const store = new Store(path.join(root, "컴퓨터A 설정"));
  await store.load();
  const project = await store.addProject(directory);
  const session = await store.createSession(project.id);
  t.after(async () => {
    await store.queue.catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, directory, store, project, session };
}
function message(value) {
  return {
    id: randomUUID(),
    role: "user",
    text: value,
    createdAt: new Date().toISOString(),
  };
}

test("대화 본문은 선택한 프로젝트에만 저장하고 다른 경로의 컴퓨터에서 복원한다", async (t) => {
  const { root, directory, store, project, session } = await fixture(t);
  const saved = store.session(session.id);
  saved.messages.push(message("프로젝트에서만 보관할 작업 기록"));
  saved.threadId = "이컴퓨터에만있는Codex대화";
  await store.save();
  const local = await fs.readFile(store.file, "utf8");
  assert.equal(local.includes("프로젝트에서만 보관할 작업 기록"), false);
  const files = await fs.readdir(path.join(directory, ".flowrium", "sessions"));
  const records = await Promise.all(
    files.map((name) =>
      fs.readFile(path.join(directory, ".flowrium", "sessions", name), "utf8"),
    ),
  );
  assert.equal(
    records.some((value) => value.includes("프로젝트에서만 보관할 작업 기록")),
    true,
  );
  assert.equal(
    records.some((value) => value.includes("이컴퓨터에만있는Codex대화")),
    false,
  );
  const moved = path.join(root, "다른컴퓨터 경로");
  await fs.cp(directory, moved, { recursive: true });
  const other = new Store(path.join(root, "컴퓨터B 설정"));
  await other.load();
  const restored = await other.addProject(moved);
  assert.equal(restored.id, project.id);
  assert.equal(
    other.session(session.id).messages[0].text,
    "프로젝트에서만 보관할 작업 기록",
  );
  assert.equal(other.session(session.id).threadId, undefined);
  const sameComputer = new Store(path.dirname(store.file));
  await sameComputer.load();
  assert.equal(
    sameComputer.session(session.id).threadId,
    "이컴퓨터에만있는Codex대화",
  );
});

test("이름이 같은 다른 프로젝트는 식별자를 분리하고 동일 프로젝트 복사본은 중복 연결하지 않는다", async (t) => {
  const { root, directory, store, project } = await fixture(t);
  const sibling = path.join(root, "다른상위", path.basename(directory));
  await fs.mkdir(sibling, { recursive: true });
  const second = await store.addProject(sibling);
  assert.equal(second.name, project.name);
  assert.notEqual(second.id, project.id);
  const duplicate = path.join(root, "복사한 원본");
  await fs.cp(directory, duplicate, { recursive: true });
  await assert.rejects(store.addProject(duplicate), /복사본은 동시에 연결/);
});

test("다른 컴퓨터에서 먼저 바뀐 대화는 덮어쓰지 않고 모든 기존 개정을 보존한다", async (t) => {
  const { root, directory, store, project, session } = await fixture(t);
  const other = new Store(path.join(root, "다른설정"));
  await other.load();
  await other.addProject(directory);
  other.session(session.id).title = "다른 컴퓨터의 변경";
  await other.save();
  const history = path.join(directory, ".flowrium", "sessions");
  const names = await fs.readdir(history);
  const before = await Promise.all(
    names.map((name) => fs.readFile(path.join(history, name), "utf8")),
  );
  store.session(session.id).title = "충돌하는 로컬 변경";
  await assert.rejects(store.save(), /동기화 충돌/);
  assert.deepEqual(await fs.readdir(history), names);
  assert.deepEqual(
    await Promise.all(
      names.map((name) => fs.readFile(path.join(history, name), "utf8")),
    ),
    before,
  );
  const restored = await ProjectStore.open(directory);
  assert.equal(restored.saved.get(session.id).title, "다른 컴퓨터의 변경");
  assert.equal(restored.id, project.id);
});

test("같은 부모에서 갈라진 개정과 충돌 사본을 발견하면 원본을 유지한다", async (t) => {
  const { directory, session } = await fixture(t);
  const history = path.join(directory, ".flowrium", "sessions");
  const originalName = (await fs.readdir(history))[0];
  const original = JSON.parse(
    await fs.readFile(path.join(history, originalName), "utf8"),
  );
  for (const title of ["컴퓨터 A", "컴퓨터 B"]) {
    const revision = randomUUID();
    const record = {
      ...original,
      revision,
      parentRevision: original.revision,
      session: { ...original.session, title },
    };
    await fs.writeFile(
      path.join(history, `${session.id}--${revision}.json`),
      JSON.stringify(record),
    );
  }
  const before = await fs.readdir(history);
  await assert.rejects(ProjectStore.open(directory), /동기화 충돌/);
  assert.deepEqual(await fs.readdir(history), before);
  const otherDirectory = path.join(directory, "충돌파일 검증");
  await fs.mkdir(otherDirectory);
  const other = await ProjectStore.open(otherDirectory);
  const conflictName = path.join(other.root, "project (conflicted copy).json");
  await fs.writeFile(conflictName, "{}");
  await assert.rejects(ProjectStore.open(otherDirectory), /동기화 충돌/);
  assert.equal(await fs.readFile(conflictName, "utf8"), "{}");
});

test("파싱 실패와 잘못된 날짜가 있는 프로젝트 기록을 수정하지 않는다", async (t) => {
  const { directory } = await fixture(t);
  const history = path.join(directory, ".flowrium", "sessions");
  const file = path.join(history, (await fs.readdir(history))[0]);
  const record = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, "{broken");
  await assert.rejects(ProjectStore.open(directory), /손상/);
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
  record.session.updatedAt = "유효하지 않은 날짜";
  const invalid = JSON.stringify(record);
  await fs.writeFile(file, invalid);
  await assert.rejects(ProjectStore.open(directory), /대화 형식/);
  assert.equal(await fs.readFile(file, "utf8"), invalid);
});

test("구버전 로컬 기록은 선택 폴더로 이관하고 원본 파일을 변경하지 않는다", async (t) => {
  const { root, directory, project } = await fixture(t);
  const registry = path.join(root, "구버전 설정");
  await fs.mkdir(registry);
  const now = new Date().toISOString();
  const imported = {
    id: randomUUID(),
    projectId: project.id,
    title: "구버전 대화",
    messages: [message("보존할 원본 대화")],
    createdAt: now,
    updatedAt: now,
  };
  const source = JSON.stringify({
    projects: [project],
    sessions: [imported],
    settings: { effort: "medium", theme: "light" },
  });
  const legacyFile = path.join(registry, "workspace.json");
  await fs.writeFile(legacyFile, source);
  const migrated = new Store(registry);
  await migrated.load();
  await migrated.save();
  assert.equal(
    migrated.session(imported.id).messages[0].text,
    "보존할 원본 대화",
  );
  assert.equal(await fs.readFile(legacyFile, "utf8"), source);
  assert.equal(
    (await fs.readFile(migrated.file, "utf8")).includes("보존할 원본 대화"),
    false,
  );
  assert.equal(
    (await ProjectStore.open(directory)).saved.has(imported.id),
    true,
  );
});

test("대화 삭제는 이전 개정을 지우지 않고 삭제 개정으로 복원 상태를 유지한다", async (t) => {
  const { directory, store, session } = await fixture(t);
  const history = path.join(directory, ".flowrium", "sessions");
  const before = await fs.readdir(history);
  await store.deleteSession(session.id);
  const after = await fs.readdir(history);
  assert.equal(
    before.every((name) => after.includes(name)),
    true,
  );
  assert.equal(after.length, before.length + 1);
  assert.equal(
    (await ProjectStore.open(directory)).saved.has(session.id),
    false,
  );
});

test("구버전과 프로젝트에 같은 대화의 다른 내용이 있으면 양쪽 원본을 보존한다", async (t) => {
  const { root, directory, project, session } = await fixture(t);
  const registry = path.join(root, "충돌하는 구버전");
  await fs.mkdir(registry);
  const legacy = JSON.stringify({
    projects: [project],
    sessions: [{ ...session, title: "프로젝트와 다른 로컬 제목" }],
    settings: { effort: "medium", theme: "light" },
  });
  const legacyFile = path.join(registry, "workspace.json");
  await fs.writeFile(legacyFile, legacy);
  const history = path.join(directory, ".flowrium", "sessions");
  const names = await fs.readdir(history);
  const before = await Promise.all(
    names.map((name) => fs.readFile(path.join(history, name), "utf8")),
  );
  await assert.rejects(
    new Store(registry).load(),
    /기존 로컬 기록과 프로젝트 기록이 다릅니다/,
  );
  assert.equal(await fs.readFile(legacyFile, "utf8"), legacy);
  assert.deepEqual(
    await Promise.all(
      names.map((name) => fs.readFile(path.join(history, name), "utf8")),
    ),
    before,
  );
});

test("기록 폴더가 선택 폴더 밖을 가리키는 링크면 외부 위치에 기록을 쓰지 않는다", async (t) => {
  if (process.platform === "win32") {
    t.skip("윈도 심볼릭 링크 권한에 의존하는 검증");
    return;
  }
  const { root } = await fixture(t);
  const project = path.join(root, "링크가 있는 프로젝트");
  const outside = path.join(root, "보호할 다른 폴더");
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(project, ".flowrium"));
  await assert.rejects(ProjectStore.open(project), /다른 위치/);
  assert.deepEqual(await fs.readdir(outside), []);
});
