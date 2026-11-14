const { samePath } = require('./path-boundary.cjs');
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { publicMessage } = require("./errors.cjs");
const {
  ProjectStore,
  validateSession,
  validateDate,
  UUID,
} = require("./project-store.cjs");

const DEFAULT_SETTINGS = { effort: "medium", theme: "light" };
const MAX_TEXT = 200_000;
function text(value, label, max = MAX_TEXT) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new Error(`${label} 값이 올바르지 않습니다.`);
  return value.trim();
}
function settings(input, current = DEFAULT_SETTINGS) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("설정 형식이 올바르지 않습니다.");
  const next = { ...current };
  for (const key of Object.keys(input)) {
    if (!["codexPath", "model", "effort", "theme", "chatDefaults"].includes(key))
      throw new Error("지원하지 않는 설정입니다.");
    const value = input[key];
    if (key === "effort" && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value))
      throw new Error("추론 강도를 확인해 주세요.");
    if (key === "theme" && !["dark", "light"].includes(value))
      throw new Error("화면 테마를 확인해 주세요.");
    if (key === "codexPath" || key === "model") {
      if (value === "" || value == null) {
        delete next[key];
        continue;
      }
      text(value, key === "model" ? "모델" : "실행 파일 경로", 4096);
      if (key === "codexPath" && !path.isAbsolute(value))
        throw new Error("실행 파일의 절대 경로를 입력해 주세요.");
    }
    next[key] = key === "chatDefaults" ? require("./chat-preferences.cjs").preferences(value) : value;
  }
  return next;
}
function validateProject(project) {
  if (
    !project ||
    !UUID.test(project.id) ||
    typeof project.name !== "string" ||
    !project.name.trim() ||
    project.name.length > 300 ||
    typeof project.path !== "string" ||
    !path.isAbsolute(project.path) ||
    !validateDate(project.createdAt)
  )
    throw new Error("저장된 프로젝트 형식이 올바르지 않습니다.");
}
class Store {
  constructor(directory) {
    this.file = path.join(directory, "workspace-v2.json");
    this.legacyFile = path.join(directory, "workspace.json");
    this.state = {
      projects: [],
      sessions: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    this.queue = Promise.resolve();
    this.repositories = new Map();
    this.conversations = new (require('./conversation-store.cjs').ConversationStore)(directory);
  }
  async load() {
    try {
      let raw;
      let legacy = false;
      try {
        raw = await this.readRegistry(this.file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        try {
          raw = await this.readRegistry(this.legacyFile);
          legacy = true;
        } catch (oldError) {
          if (oldError.code !== "ENOENT") throw oldError;
          return this.state;
        }
      }
      if (
        !raw ||
        !Array.isArray(raw.projects) ||
        (legacy ? !Array.isArray(raw.sessions) : raw.version !== 2)
      )
        throw new Error("저장된 작업 공간 형식이 올바르지 않습니다.");
      const projectIds = new Set();
      for (const project of raw.projects) {
        validateProject(project);
        if (projectIds.has(project.id))
          throw new Error("중복된 프로젝트 식별자가 있습니다.");
        projectIds.add(project.id);
      }
      const sessionIds = new Set();
      if (legacy)
        for (const session of raw.sessions) {
          if (
            !session ||
            !projectIds.has(session.projectId) ||
            sessionIds.has(session.id)
          )
            throw new Error(
              "저장된 대화의 프로젝트를 찾을 수 없거나 식별자가 중복됩니다.",
            );
          validateSession(session, session.projectId);
          sessionIds.add(session.id);
        }
      const next = {
        projects: [],
        sessions: [],
        settings: settings(raw.settings || {}),
      };
      for (const project of raw.projects) {
        try {
          await fs.stat(project.path);
        } catch (error) {
          if (error.code === "ENOENT") {
            next.projects.push(project);
            continue;
          }
          throw error;
        }
        const repository = await ProjectStore.open(project.path, project.id);
        if (next.projects.some((item) => item.id === repository.id))
          throw new Error(
            "동일한 프로젝트 식별자가 여러 연결 폴더에 있습니다. 복사본을 동시에 연결할 수 없습니다.",
          );
        const portableProject = {
          ...project,
          id: repository.id,
          createdAt: repository.createdAt,
        };
        if (legacy) {
          const imported = raw.sessions
            .filter((session) => session.projectId === project.id)
            .map((session) => {
              const value = { ...session, projectId: repository.id };
              delete value.threadId;
              return value;
            });
          for (const session of imported) {
            const existing = repository.saved.get(session.id);
            if (
              existing &&
              JSON.stringify(existing) !== JSON.stringify(session)
            )
              throw new Error(
                "기존 로컬 기록과 프로젝트 기록이 다릅니다. 원본을 덮어쓰지 않았습니다. 필요한 대화를 내보낸 뒤 기록을 확인해 주세요.",
              );
          }
          await repository.commit([
            ...repository.saved.values(),
            ...imported.filter((session) => !repository.saved.has(session.id)),
          ]);
        }
        this.repositories.set(repository.id, repository);
        next.projects.push(portableProject);
        for (const saved of repository.saved.values()) {
          if(saved.scope)throw Error('프로젝트 기록에 개인 대화가 섞여 있습니다. 원본은 보존했습니다.');
          const session = structuredClone(saved);
          session.compacting=false;
          const binding = raw.localThreads?.[session.id];
          const legacySession = legacy
            ? raw.sessions.find(
                (item) =>
                  item.id === session.id && item.projectId === project.id,
              )
            : null;
          if (legacySession?.threadId)
            session.threadId = legacySession.threadId;
          else if (
            binding?.revision === repository.heads.get(session.id) &&
            typeof binding.threadId === "string"
          )
            session.threadId = binding.threadId;
          next.sessions.push(session);
        }
      }
      next.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.state = next;
    } catch (error) {
      throw new Error(
        `작업 기록을 불러오지 못했습니다. 원본 파일은 보존됩니다. ${publicMessage(error)}`,
      );
    }
    return this.state;
  }
  async readRegistry(file) {
    if ((await fs.stat(file)).size > 32 * 1024 * 1024)
      throw new Error("저장된 작업 공간이 허용 크기를 초과했습니다.");
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  snapshot() {
    return structuredClone({...this.state,conversationProjects:this.conversations.projects(),sessions:this.visibleSessions()});
  }
  visibleSessions(){return [...this.state.sessions,...this.conversations.sessions()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  peekSession(id){return this.state.sessions.find(s=>s.id===id)||this.conversations.peekSession(id);}
  isCurrentConversation(id){return this.conversations.isCurrent(id);}
  syncConversationOwner(){return this.conversations.sync();}
  save() {
    const snapshot = structuredClone(this.state),conversationSnapshots=this.conversations.snapshots();
    const write = async () => {
      const localThreads = {};
      for (const project of snapshot.projects) {
        const sessions = snapshot.sessions.filter(
          (session) => session.projectId === project.id,
        );
        const repository = this.repositories.get(project.id);
        if (!repository) {
          if (sessions.length)
            throw new Error("프로젝트 폴더를 다시 연결한 뒤 저장해 주세요.");
          continue;
        }
        await repository.commit(sessions);
        for (const session of sessions)
          if (session.threadId)
            localThreads[session.id] = {
              threadId: session.threadId,
              revision: repository.heads.get(session.id),
            };
      }
      const data = JSON.stringify(
        {
          version: 2,
          projects: snapshot.projects,
          settings: snapshot.settings,
          localThreads,
        },
        null,
        2,
      );
      await this.conversations.commit(conversationSnapshots);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, data, { mode: 0o600 });
        await fs.rename(temp, this.file);
      } finally {
        await fs.rm(temp, { force: true });
      }
    };
    this.queue = this.queue.then(write, write).catch((error) => {
      throw new Error(
        publicMessage(
          error,
          "작업 기록을 저장하지 못했습니다. 저장 폴더를 확인해 주세요.",
        ),
      );
    });
    return this.queue;
  }
  async addProject(directory) {
    const canonical = await fs.realpath(text(directory, "프로젝트 경로", 4096));
    if(await this.conversations.isManagedPath(canonical))throw Error('개인 대화 저장소는 프로젝트로 연결할 수 없습니다.');
    if (!(await fs.stat(canonical)).isDirectory())
      throw new Error("폴더를 선택해 주세요.");
    const existing = this.state.projects.find((project) =>
      process.platform === "win32"
        ? project.path.toLowerCase() === canonical.toLowerCase()
        : samePath(project.path, canonical),
    );
    if (existing && this.repositories.has(existing.id))
      return structuredClone(existing);
    const repository = await ProjectStore.open(canonical);
    if([...repository.saved.values()].some(session=>session.scope))throw Error('개인 대화 저장소는 프로젝트로 가져올 수 없습니다.');
    const sameIdentity = this.state.projects.find(
      (project) => project.id === repository.id && !samePath(project.path, canonical),
    );
    if (sameIdentity) {
      try {
        await fs.stat(sameIdentity.path);
      } catch (error) {
        if (error.code === "ENOENT") {
          sameIdentity.path = canonical;
          sameIdentity.name = path.basename(canonical);
          this.repositories.set(repository.id, repository);
          this.state.sessions.push(
            ...[...repository.saved.values()].map((value) =>
              structuredClone(value),
            ),
          );
          await this.save();
          return structuredClone(sameIdentity);
        }
        throw error;
      }
      throw new Error(
        "이 프로젝트는 다른 경로에 이미 연결돼 있습니다. 같은 프로젝트의 복사본은 동시에 연결할 수 없습니다.",
      );
    }
    const project = existing || {
      id: repository.id,
      name: path.basename(canonical) || canonical,
      path: canonical,
      createdAt: repository.createdAt,
    };
    if (existing && existing.id !== repository.id)
      throw new Error(
        "프로젝트 식별자가 변경됐습니다. 기존 연결과 원본 기록을 먼저 확인해 주세요.",
      );
    this.repositories.set(project.id, repository);
    if (!existing) this.state.projects.push(project);
    const imported = [...repository.saved.values()].map((value) =>
      structuredClone(value),
    );
    this.state.sessions.push(...imported);
    try {
      await this.save();
    } catch (error) {
      if (!existing)
        this.state.projects = this.state.projects.filter(
          (item) => item.id !== project.id,
        );
      this.state.sessions = this.state.sessions.filter(
        (item) => !imported.some((record) => record.id === item.id),
      );
      this.repositories.delete(project.id);
      throw error;
    }
    return structuredClone(project);
  }
  project(id) {
    const project = this.state.projects.find((p) => p.id === id)||this.conversations.findProject(id);
    if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
    return project;
  }
  session(id) {
    const session = this.state.sessions.find((s) => s.id === id)||this.conversations.findSession(id);
    if (!session) throw new Error("대화를 찾을 수 없습니다.");
    return session;
  }
  async createSession(projectId, extra = {}) {
    const project=this.project(projectId),pool=this.conversations.poolForProject(projectId),target=pool?.sessions||this.state.sessions;
    if(pool&&(extra.workflow||extra.personalAssistant||extra.scope&&extra.scope!==project.conversationScope))throw Error('프로젝트 업무는 프로젝트 대화에서 시작해 주세요.');
    const now = new Date().toISOString();
    let id = randomUUID();
    if (extra.personalAssistant === true) {
      const hex = createHash("sha256").update("flowrium:personal-assistant:" + projectId).digest("hex");
      id = [hex.slice(0,8),hex.slice(8,12),"8"+hex.slice(13,16),"a"+hex.slice(17,20),hex.slice(20,32)].join("-");
      const existing = target.find(entry => entry.id === id);
      if (existing && !existing.personalAssistant) throw new Error("비서 대화 식별자가 다른 대화와 겹칩니다. 기존 대화를 확인해 주세요.");
      if (existing) return structuredClone(existing);
    }
    const session = {
      id,
      projectId,
      ...(pool&&{scope:project.conversationScope}),
      title: extra.title || "새로운 작업",
      ...(extra.personalAssistant === true && { personalAssistant: true }),
      ...(extra.workflow && { workflow: extra.workflow }),
      ...(extra.threadId && {threadId:extra.threadId}),
      ...(extra.preferences && {preferences:structuredClone(extra.preferences)}),
      ...(extra.context && {context:structuredClone(extra.context)}),
      ...(extra.applicationTools && {applicationTools:true}),
      messages: extra.messages || [],
      createdAt: now,
      updatedAt: now,
    };
    target.unshift(session);
    try {
      await this.save();
    } catch (error) {
      target.splice(target.indexOf(session),1);
      throw error;
    }
    return structuredClone(session);
  }
  async deleteSession(id) {
    const session = this.session(id);
    const target=this.conversations.poolForProject(session.projectId)?.sessions||this.state.sessions;
    const index = target.indexOf(session);
    target.splice(index, 1);
    try {
      await this.save();
    } catch (error) {
      target.splice(
        Math.min(index, target.length),
        0,
        session,
      );
      throw error;
    }
  }
  async restoreSession(snapshot) {
    const project=this.project(snapshot.projectId),pool=this.conversations.poolForProject(project.id),target=pool?.sessions||this.state.sessions;
    validateSession(snapshot,project.id);
    if((pool&&snapshot.scope!==project.conversationScope)||(!pool&&snapshot.scope))throw Error('복원할 대화의 저장 범위를 확인해 주세요.');
    if(this.peekSession(snapshot.id))throw Error('같은 대화가 이미 있습니다. 기존 대화를 보존했습니다.');
    const session=structuredClone(snapshot);session.compacting=false;
    for(const queued of session.queuedMessages||[])if(['queued','sending'].includes(queued.status))queued.status='cancelled';
    target.unshift(session);
    try{await this.save();}catch(error){target.splice(target.indexOf(session),1);throw error;}
    return structuredClone(session);
  }
  async disconnectProject(id) {
    const project=this.state.projects.find(p=>p.id===id);if(!project)throw Error('연결한 프로젝트를 선택해 주세요.');
    const previousProjects=this.state.projects,previousSessions=this.state.sessions;
    this.state.projects=previousProjects.filter(p=>p.id!==id);this.state.sessions=previousSessions.filter(s=>s.projectId!==id);
    try{await this.save();}catch(error){this.state.projects=previousProjects;this.state.sessions=previousSessions;throw error;}
    this.repositories.delete(id);
    return structuredClone(project);
  }
  async saveSettings(input) {
    const previous = this.state.settings;
    const next = settings(input, previous);
    this.state.settings = next;
    try {
      await this.save();
    } catch (error) {
      if (this.state.settings === next) this.state.settings = previous;
      throw error;
    }
    return { ...this.state.settings };
  }
}
module.exports = { Store, settings, text };
