const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy = (value) => structuredClone(value);
const DEFAULT_JSON_BYTES=32*1024*1024,SESSION_REVISION_BYTES=128*1024*1024;
function jsonLimit(options){const limit=options?.maxBytes??DEFAULT_JSON_BYTES;if(!Number.isSafeInteger(limit)||limit<1||limit>SESSION_REVISION_BYTES)throw Error('기록 파일의 읽기·쓰기 한도를 확인해 주세요.');return limit;}
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
    (session.pendingThreadName !== undefined && (typeof session.pendingThreadName !== 'string' ||
      session.pendingThreadName !== session.title)) ||
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
  if (session.personalAssistant !== undefined && session.personalAssistant !== true) throw new Error("개인 비서 대화 형식이 올바르지 않습니다.");
  if(session.desktopThread!==undefined){
    const link=session.desktopThread;
    if(!link || typeof link.threadId!=='string' || !link.threadId || link.threadId.length>300 || typeof link.cwd!=='string' || !path.isAbsolute(link.cwd) || !/^[a-f0-9]{64}$/.test(link.ownerHash))throw Error('로컬 대화 연결 정보를 확인해 주세요.');
  }
  if(session.codexLink!==undefined)require("./codex-transfer-link.cjs").validateLink(session.codexLink);
  if(session.scope!==undefined&&!['general','integrated'].includes(session.scope))throw Error('대화 종류를 확인해 주세요.');
  if (session.preferences !== undefined) require("./chat-preferences.cjs").preferences(session.preferences);
  if (session.workflow !== undefined) require("./workbench.cjs").validateWorkflow(session.workflow);
  if(session.queuedMessages!==undefined)require("./chat-queue.cjs").validateQueue(session.queuedMessages);
  if(session.completedContinuationId!==undefined&&!UUID.test(session.completedContinuationId))throw Error('완료한 후속 작업의 답변 식별자를 확인해 주세요.');
  if(session.context!==undefined && (!session.context || !Number.isFinite(session.context.used)||!Number.isFinite(session.context.total)||!Number.isFinite(session.context.max)||!Number.isFinite(session.context.percent)))throw Error("문맥 사용량 정보를 확인해 주세요.");
  const ids = new Set();
  for (const message of session.messages) {
    if (
      !message ||
      !UUID.test(message.id) ||
      ids.has(message.id) ||
      !["user", "assistant", "system"].includes(message.role) ||
      typeof message.text !== "string" ||
      message.text.length > require("./mobile/chat-input.js").maxChatInput ||
      !validateDate(message.createdAt)
    )
      throw new Error(
        "저장된 메시지 형식이 올바르지 않습니다. 원본은 보존됩니다.",
      );
    if(message.sourceOnly!==undefined && (message.sourceOnly!==true || !message.requestSource))throw Error('긴 요청 원문 참조를 확인해 주세요.');
    if(message.requestSource!==undefined) {
      const [source]=require("./chat-attachments.cjs").checkedAttachments([message.requestSource]);
      if(message.role!=="user" || source.name!=="request.txt" || source.type!=="text/plain")throw Error("긴 요청 원문 정보를 확인해 주세요.");
    }
    if(message.attachments!==undefined)require("./chat-attachments.cjs").checkedAttachments(message.attachments);
    if (message.workSteps !== undefined && (!Array.isArray(message.workSteps) || message.workSteps.some(step =>
      !step || typeof step.id !== 'string' || !step.id || step.id.length > 300 ||
      typeof step.label !== 'string' || !step.label || step.label.length > 200 ||
      !['running','completed','failed','interrupted'].includes(step.state) || !validateDate(step.createdAt)
    ))) throw Error('저장된 작업 과정 형식을 확인해 주세요.');
    if(message.turnId!==undefined&&(typeof message.turnId!=="string"||message.turnId.length>300||!message.turnId))throw Error("메시지의 실행 식별자를 확인해 주세요.");
    if(message.reaction!==undefined&&message.reaction!=='like')throw Error('메시지 반응 형식을 확인해 주세요.');
    ids.add(message.id);
  }
}
function conflict() {
  return new Error(
    "다른 컴퓨터의 변경 또는 동기화 충돌을 발견했습니다. 원본은 보존했습니다. 대화를 내보낸 뒤 프로젝트 폴더의 변경 사항을 확인하고 다시 연결해 주세요.",
  );
}
async function readJSON(file,options={}) {
  const limit=jsonLimit(options);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      "프로젝트 기록은 선택한 폴더 안의 일반 파일이어야 합니다. 원본은 보존됩니다.",
    );
  if (stat.size > limit)
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
async function createJSON(file, value,options={}) {
  const limit=jsonLimit(options);
  // Exclusive creation ensures that neither another computer's revision nor an
  // existing source file is replaced. Every update gets a fresh revision UUID.
  let handle;
  const data = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(data, "utf8") > limit)
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

function portableSession(session) {
  const {threadId, desktopThread, requestReaderThreadId, ...portable} = session;
  return portable;
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
    this.revisionHeaders = new Map();
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
  async readRevision(file, sessionId, revision) {
    const record = await readJSON(file, {maxBytes:SESSION_REVISION_BYTES});
    if (
      !record ||
      record.version !== 1 ||
      record.projectId !== this.id ||
      record.sessionId !== sessionId ||
      record.revision !== revision ||
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
    return record;
  }
  async inspect(includeBodies = true) {
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
      const file = path.join(this.history, name);
      const stat = await fs.lstat(file, {bigint:true});
      if (!stat.isFile() || stat.isSymbolicLink()) throw conflict();
      const fingerprint = [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
      let header = this.revisionHeaders.get(name);
      if (header?.fingerprint !== fingerprint) {
        // Keep only ancestry in memory. A long chat can have gigabytes of
        // previous revisions while its current body is a small fraction of that.
        const {revision, sessionId, parentRevision, deleted} = await this.readRevision(file, match[1], match[2]);
        header = {revision, sessionId, parentRevision, deleted, name, fingerprint};
      }
      records.set(header.revision, header);
    }
    this.revisionHeaders = new Map([...records.values()].map(header => [header.name, header]));
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
    if (includeBodies) {
      for (const [id, header] of heads) {
        const record = await this.readRevision(path.join(this.history,header.name), id, header.revision);
        if (record.parentRevision !== header.parentRevision || record.deleted !== header.deleted) throw conflict();
        heads.set(id, record);
      }
    }
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
  async commit(sessions, options = {}) {
    const target = new Map(
      sessions.map((session) => {
        validateSession(session, this.id);
        return [session.id, copy(options.local ? session : portableSession(session))];
      }),
    );
    const changes = [];
    for (const [id, session] of target) {
      const saved=this.saved.get(id);
      const previous=saved && !options.local ? portableSession(saved) : saved;
      if (JSON.stringify(previous) !== JSON.stringify(session))
        changes.push({ id, session });
    }
    for (const id of this.saved.keys())
      if (!target.has(id)) changes.push({ id, session: null });
    if (!changes.length) return;
    const actual = await this.inspect(false);
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
        {maxBytes:SESSION_REVISION_BYTES},
      );
      this.heads.set(change.id, revision);
      if (change.session) this.saved.set(change.id, copy(change.session));
      else this.saved.delete(change.id);
    }
    // A second scan reports a concurrently synchronized fork. Both immutable
    // revisions remain intact for manual reconciliation.
    await this.inspect(false);
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
module.exports = { ProjectStore, portableSession, validateSession, validateDate, UUID, readJSON, createJSON, projectDirectory, DEFAULT_JSON_BYTES, SESSION_REVISION_BYTES };
