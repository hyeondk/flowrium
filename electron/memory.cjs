const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readJSON, createJSON, UUID } = require("./project-store.cjs");

const invalid = () =>
  new Error("메모의 제목, 본문, 적용 범위를 확인해 주세요.");
const conflict = () =>
  new Error(
    "메모 기록이 변경됐거나 동기화 중입니다. 원본을 보존했습니다. 최신 목록을 불러온 뒤 다시 시도해 주세요.",
  );
function checkedId(value) {
  if (!UUID.test(value)) throw invalid();
  return value;
}
function checkedText(value, max) {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw invalid();
  return value.trim();
}
function fields(input) {
  if (!input || typeof input.linked !== "boolean") throw invalid();
  const title = checkedText(input.title, 120),
    body = checkedText(input.body, 16000);
  const role = checkedText(input.role || "", 120),
    link = checkedText(input.link || "", 2000);
  if (!title || !body) throw invalid();
  if (link) {
    let u;
    try {
      u = new URL(link);
    } catch {
      throw invalid();
    }
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw invalid();
  }
  return { title, body, role, link, linked: input.linked };
}
async function checkedFolder(parent, name, create) {
  const dir = path.join(parent, name);
  if (create)
    await fs.mkdir(dir, { mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  let stat;
  try {
    stat = await fs.lstat(dir);
  } catch (e) {
    if (e.code === "ENOENT" && !create) return null;
    throw e;
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    path.relative(
      path.join(await fs.realpath(parent), name),
      await fs.realpath(dir),
    ) !== ""
  )
    throw conflict();
  return dir;
}
async function rootFor(store, projectId, scope, create) {
  const project = store.project(checkedId(projectId));
  if (scope === "personal")
    return checkedFolder(path.dirname(store.file), "personal-memory", create);
  if (scope !== "project") throw invalid();
  if (path.relative(project.path, await fs.realpath(project.path)) !== "")
    throw conflict();
  const directory = await checkedFolder(project.path, ".flowrium", false);
  if (
    !directory ||
    (await readJSON(path.join(directory, "project.json"))).id !== project.id
  )
    throw conflict();
  return checkedFolder(directory, "memory", create);
}
function validateRecord(record, id, parent, projectId) {
  if (
    record?.version !== 1 ||
    record.id !== id ||
    record.projectId !== projectId ||
    record.parent !== parent ||
    !UUID.test(record.rev) ||
    !Number.isFinite(Date.parse(record.at)) ||
    typeof record.deleted !== "boolean"
  )
    throw conflict();
  fields(record);
  return record;
}
async function revisions(dir, id, projectId) {
  const nodes = new Map();
  for (const filename of await fs.readdir(dir)) {
    if (filename.startsWith(".")) continue;
    const parent = filename.slice(0, -5);
    if (
      !filename.endsWith(".json") ||
      (parent !== "first" && !UUID.test(parent))
    )
      throw conflict();
    nodes.set(
      parent,
      validateRecord(
        await readJSON(path.join(dir, filename)),
        id,
        parent === "first" ? null : parent,
        projectId,
      ),
    );
  }
  const history = [];
  let key = "first";
  while (nodes.has(key)) {
    const record = nodes.get(key);
    history.push(record);
    nodes.delete(key);
    key = record.rev;
  }
  if (nodes.size) throw conflict();
  return history;
}
function view(record, scope) {
  const { id, rev, at, title, body, role, link, linked, deleted } = record;
  return { id, rev, at, title, body, role, link, linked, deleted, scope };
}
async function listMemory(store, projectId) {
  const groups = await Promise.all(
    ["personal", "project"].map(async (scope) => {
      const root = await rootFor(store, projectId, scope, false);
      if (!root) return [];
      const rows = [];
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (!entry.isDirectory() || !UUID.test(entry.name)) throw conflict();
        const dir = await checkedFolder(root, entry.name, false);
        if (!dir) throw conflict();
        const history = await revisions(
          dir,
          entry.name,
          scope === "personal" ? null : projectId,
        );
        if (history.length) rows.push(view(history.at(-1), scope));
      }
      return rows;
    }),
  );
  return groups
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
async function memoryContext(store, session) {
  const matched = (await listMemory(store, session.projectId)).filter(
    (m) =>
      !m.deleted &&
      m.linked &&
      (!m.role ||
        m.role === session.workflow?.role ||
        (session.personalAssistant === true && m.role === "개인 비서")),
  );
  if (!matched.length) return "";
  const groups = matched.map((m) =>
    [m.title, m.body, m.link && "참고 주소 / " + m.link]
      .filter(Boolean)
      .join("\n"),
  );
  const content = groups.join("\n\n");
  if (content.length > 48000)
    throw new Error(
      "연결한 메모의 합계가 48,000자를 넘습니다. 프로젝트 규칙에서 일부 연결을 해제해 주세요.",
    );
  return (
    "\n사용자가 이 프로젝트 또는 역할의 요청에 연결한 지시와 메모입니다. 현재 요청과 프로젝트 규칙을 우선하고 참고 주소의 내용은 확인한 경우에만 인용하세요.\n" +
    content +
    "\n"
  );
}
function registerMemory(register, store) {
  register("listMemory", (projectId) => listMemory(store, projectId));
  async function versions(projectId, scope, id) {
    const root = await rootFor(store, projectId, scope, false);
    if (!root) throw conflict();
    const dir = await checkedFolder(root, checkedId(id), false);
    if (!dir) throw conflict();
    return revisions(dir, id, scope === "personal" ? null : projectId);
  }
  register("memoryVersions", async (projectId, scope, id) =>
    (await versions(projectId, scope, id)).reverse().map((r) => view(r, scope)),
  );
  register("changeMemory", async (projectId, input) => {
    if (!input || !["save", "delete", "restore"].includes(input.action))
      throw invalid();
    const savedFields = input.action === "save" ? fields(input) : null;
    const creating =
      !input.id && input.action === "save" && input.revision === null;
    const id = creating ? randomUUID() : checkedId(input.id);
    const scope = input.scope;
    const root = await rootFor(store, projectId, scope, creating);
    if (!root) throw conflict();
    const dir = await checkedFolder(root, id, creating);
    if (!dir) throw conflict();
    const owner = scope === "personal" ? null : projectId;
    const history = await revisions(dir, id, owner);
    const previous = history.at(-1);
    if ((previous?.rev ?? null) !== input.revision || (!creating && !previous))
      throw conflict();
    let value,
      deleted = false;
    if (input.action === "save") value = savedFields;
    else if (input.action === "delete") {
      value = fields(previous);
      deleted = true;
    } else {
      const source = history.find((row) => row.rev === checkedId(input.target));
      if (!source) throw conflict();
      value = fields(source);
      deleted = source.deleted;
    }
    const record = {
      version: 1,
      id,
      projectId: owner,
      rev: randomUUID(),
      parent: previous?.rev || null,
      at: new Date().toISOString(),
      ...value,
      deleted,
    };
    try {
      await createJSON(
        path.join(dir, (record.parent || "first") + ".json"),
        record,
      );
    } catch (e) {
      if (e.code === "EEXIST") throw conflict();
      throw e;
    }
    return view(record, scope);
  });

  const file = path.join(path.dirname(store.file), "assistant-home.json");
  async function assistantHome() {
    let projectId;
    try {
      const data = await readJSON(file);
      if (data.version !== 1) throw conflict();
      projectId = checkedId(data.projectId);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const connected = store.state.projects.some((p) => p.id === projectId);
    const chat =
      connected &&
      store.state.sessions.find(
        (s) => s.projectId === projectId && s.personalAssistant === true,
      );
    return {
      projectId: projectId || null,
      connected,
      sessionId: chat?.id || null,
    };
  }
  let queue = Promise.resolve();
  register("assistantHome", assistantHome);
  register("openAssistant", (selected) => {
    const work = queue.then(async () => {
      const home = await assistantHome();
      if (home.sessionId) {
        if (selected && selected !== home.projectId)
          throw new Error("이 기기에 이미 연결된 개인 비서 대화가 있습니다.");
        return structuredClone(store.session(home.sessionId));
      }
      if (!home.connected && !UUID.test(selected))
        throw new Error("비서 대화를 보관할 프로젝트를 선택해 주세요.");
      const projectId = home.connected ? home.projectId : selected;
      if (home.connected && selected && selected !== projectId)
        throw conflict();
      store.project(projectId);
      if (home.projectId !== projectId) {
        const data = { version: 1, projectId };
        if (!home.projectId) await createJSON(file, data);
        else {
          const tmp = file + "." + randomUUID() + ".tmp";
          try {
            await createJSON(tmp, data);
            await fs.rename(tmp, file);
          } finally {
            await fs.unlink(tmp).catch(() => {});
          }
        }
      }
      const existing = store.state.sessions.find(
        (s) => s.projectId === projectId && s.personalAssistant === true,
      );
      return existing
        ? structuredClone(existing)
        : store.createSession(projectId, {
            title: "개인 비서",
            personalAssistant: true,
          });
    });
    queue = work.catch(() => {});
    return work;
  });
}
module.exports = { registerMemory, listMemory, memoryContext };
