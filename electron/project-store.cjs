const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = (value) => structuredClone(value);
function validateDate(value) {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    Number.isFinite(Date.parse(value))
  );
}
function validateSession(session, projectId) {
  if (
    !session ||
    !UUID.test(session.id) ||
    session.projectId !== projectId ||
    typeof session.title !== "string" ||
    !session.title.trim() ||
    session.title.length > 300 ||
    !validateDate(session.createdAt) ||
    !validateDate(session.updatedAt) ||
    !Array.isArray(session.messages)
  )
    throw new Error("저장된 대화 형식이 올바르지 않습니다. 원본은 보존됩니다.");
  if (
    session.threadId != null &&
    (typeof session.threadId !== "string" ||
      !session.threadId ||
      session.threadId.length > 300)
  )
    throw new Error("저장된 Codex 대화 식별자가 올바르지 않습니다.");
  if (
    session.sourceThreadId != null &&
    (typeof session.sourceThreadId !== "string" ||
      !session.sourceThreadId ||
      session.sourceThreadId.length > 300)
  )
    throw new Error("가져온 대화의 원본 식별자가 올바르지 않습니다.");
  if (session.preferences !== undefined) require("./chat-preferences.cjs").preferences(session.preferences);
  if (session.workflow !== undefined) require("./workbench.cjs").validateWorkflow(session.workflow);
  const ids = new Set();
  for (const message of session.messages) {
    if (
      !message ||
      !UUID.test(message.id) ||
      ids.has(message.id) ||
      !["user", "assistant", "system"].includes(message.role) ||
      typeof message.text !== "string" ||
      message.text.length > 2_000_000 ||
      !validateDate(message.createdAt)
    )
      throw new Error(
        "저장된 메시지 형식이 올바르지 않습니다. 원본은 보존됩니다.",
      );
    ids.add(message.id);
  }
}
function conflict() {
  return new Error(
    "다른 컴퓨터의 변경 또는 동기화 충돌을 발견했습니다. 원본은 보존했습니다. 대화를 내보낸 뒤 프로젝트 폴더의 변경 사항을 확인하고 다시 연결해 주세요.",
  );
}
async function readJSON(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      "프로젝트 기록은 선택한 폴더 안의 일반 파일이어야 합니다. 원본은 보존됩니다.",
    );
  if (stat.size > 32 * 1024 * 1024)
    throw new Error(
      "프로젝트 기록이 허용 크기를 초과했습니다. 원본은 보존됩니다.",
    );
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(
        "프로젝트 기록을 읽지 못했습니다. 동기화가 진행 중이거나 파일이 손상됐습니다. 원본은 보존됩니다.",
      );
    throw error;
  }
}
async function createJSON(file, value) {
  // Exclusive creation ensures that neither another computer's revision nor an
  // existing source file is replaced. Every update gets a fresh revision UUID.
  let handle;
  const data = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(data, "utf8") > 32 * 1024 * 1024)
    throw new Error(
      "대화 기록이 허용 크기에 도달했습니다. 현재 대화를 내보내고 새 대화를 시작해 주세요.",
    );
  try {
    handle = await fs.open(file, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      handle = null;
      await fs.rm(file, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

class ProjectStore {
  constructor(directory, metadata) {
    this.directory = directory;
    this.root = path.join(directory, ".flowrium");
    this.history = path.join(this.root, "sessions");
    this.id = metadata.id;
    this.createdAt = metadata.createdAt;
    this.heads = new Map();
    this.saved = new Map();
  }
  static async open(directory, preferredId) {
    const root = path.join(directory, ".flowrium");
    const metadataFile = path.join(root, "project.json");
    if (!(await fs.stat(directory)).isDirectory())
      throw new Error("프로젝트 폴더를 찾을 수 없습니다.");
    await projectDirectory(root);
    const files = await fs.readdir(root);
    if (
      files.some(
        (name) => /project.*\.json$/i.test(name) && name !== "project.json",
      )
    )
      throw conflict();
    let metadata;
    try {
      metadata = await readJSON(metadataFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      metadata = {
        version: 1,
        id: UUID.test(preferredId || "") ? preferredId : randomUUID(),
        createdAt: new Date().toISOString(),
      };
      try {
        await createJSON(metadataFile, metadata);
      } catch (writeError) {
        if (writeError.code !== "EEXIST") throw writeError;
        metadata = await readJSON(metadataFile);
      }
    }
    if (
      !metadata ||
      metadata.version !== 1 ||
      !UUID.test(metadata.id) ||
      !validateDate(metadata.createdAt)
    )
      throw new Error(
        "프로젝트 식별 파일의 형식을 확인해 주세요. 원본은 보존됩니다.",
      );
    const store = new ProjectStore(directory, metadata);
    await projectDirectory(store.history);
    await store.refresh();
    return store;
  }
  async inspect() {
    await projectDirectory(this.root);
    await projectDirectory(this.history);
    const metadata = await readJSON(path.join(this.root, "project.json"));
    const rootFiles = await fs.readdir(this.root);
    if (
      metadata.id !== this.id ||
      metadata.version !== 1 ||
      rootFiles.some(
        (name) => /project.*\.json$/i.test(name) && name !== "project.json",
      )
    )
      throw conflict();
    const records = new Map();
    for (const name of await fs.readdir(this.history)) {
      if (!name.endsWith(".json")) continue;
      const match = /^([0-9a-f-]{36})--([0-9a-f-]{36})\.json$/i.exec(name);
      if (!match || !UUID.test(match[1]) || !UUID.test(match[2]))
        throw conflict();
      const record = await readJSON(path.join(this.history, name));
      if (
        !record ||
        record.version !== 1 ||
        record.projectId !== this.id ||
        record.sessionId !== match[1] ||
        record.revision !== match[2] ||
        !UUID.test(record.sessionId) ||
        !UUID.test(record.revision) ||
        (record.parentRevision !== null && !UUID.test(record.parentRevision)) ||
        typeof record.deleted !== "boolean"
      )
        throw new Error(
          "프로젝트 기록 형식이 올바르지 않습니다. 원본은 보존됩니다.",
        );
      if (!record.deleted) validateSession(record.session, this.id);
      if (!record.deleted && record.session.id !== record.sessionId)
        throw new Error("대화 식별자가 일치하지 않습니다. 원본은 보존됩니다.");
      records.set(record.revision, record);
    }
    const parents = new Set();
    const allSessions = new Set();
    for (const record of records.values()) {
      allSessions.add(record.sessionId);
      if (record.parentRevision) {
        const parent = records.get(record.parentRevision);
        if (!parent || parent.sessionId !== record.sessionId)
          throw new Error(
            "프로젝트 기록의 동기화가 아직 끝나지 않았습니다. 원본을 유지한 채 나중에 다시 연결해 주세요.",
          );
        parents.add(record.parentRevision);
      }
    }
    const heads = new Map();
    for (const record of records.values())
      if (!parents.has(record.revision)) {
        if (heads.has(record.sessionId)) throw conflict();
        heads.set(record.sessionId, record);
      }
    if (heads.size !== allSessions.size)
      throw new Error(
        "프로젝트 기록의 연결 구조가 올바르지 않습니다. 원본은 보존됩니다.",
      );
    return heads;
  }
  async refresh() {
    const heads = await this.inspect();
    this.heads = new Map(
      [...heads].map(([id, record]) => [id, record.revision]),
    );
    this.saved = new Map(
      [...heads]
        .filter(([, record]) => !record.deleted)
        .map(([id, record]) => [id, copy(record.session)]),
    );
    return [...this.saved.values()].map(copy);
  }
  async commit(sessions) {
    const target = new Map(
      sessions.map((session) => {
        validateSession(session, this.id);
        const portable = copy(session);
        delete portable.threadId;
        return [session.id, portable];
      }),
    );
    const changes = [];
    for (const [id, session] of target)
      if (JSON.stringify(this.saved.get(id)) !== JSON.stringify(session))
        changes.push({ id, session });
    for (const id of this.saved.keys())
      if (!target.has(id)) changes.push({ id, session: null });
    if (!changes.length) return;
    const actual = await this.inspect();
    for (const change of changes)
      if (
        (actual.get(change.id)?.revision || null) !==
        (this.heads.get(change.id) || null)
      )
        throw conflict();
    for (const change of changes) {
      const revision = randomUUID();
      const record = {
        version: 1,
        projectId: this.id,
        sessionId: change.id,
        revision,
        parentRevision: this.heads.get(change.id) || null,
        deleted: !change.session,
        ...(change.session ? { session: copy(change.session) } : {}),
      };
      await createJSON(
        path.join(this.history, `${change.id}--${revision}.json`),
        record,
      );
      this.heads.set(change.id, revision);
      if (change.session) this.saved.set(change.id, copy(change.session));
      else this.saved.delete(change.id);
    }
    // A second scan reports a concurrently synchronized fork. Both immutable
    // revisions remain intact for manual reconciliation.
    await this.inspect();
  }
}
async function projectDirectory(directory) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        "프로젝트 기록 폴더가 다른 위치를 가리킵니다. 선택한 폴더 안의 저장 위치를 확인해 주세요.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(directory, { recursive: true });
  }
}
module.exports = { ProjectStore, validateSession, validateDate, UUID, readJSON, createJSON, projectDirectory };
