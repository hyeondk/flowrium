const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { CodexClient, resolveCodex } = require("./codex.cjs");
const { text } = require("./store.cjs");
const { publicMessage } = require("./errors.cjs");
const { HistoryImporter } = require("./history.cjs");

const MODE_INSTRUCTIONS = {
  plan: "계획을 세우고 설명해 주세요. 파일을 수정하거나 변경 명령을 실행하지 마세요.",
  build:
    "요청한 구현을 수행하고 적절히 검증해 주세요. 프로젝트 범위에서 작업해 주세요.",
  review:
    "코드와 변경 사항을 검토하고 확인 가능한 문제를 설명해 주세요. 파일을 수정하지 마세요.",
};
class Controller extends EventEmitter {
  constructor(store, options = {}) {
    super();
    this.store = store;
    this.options = options;
    this.client = options.client || new CodexClient(options);
    this.runs = new Map();
    this.loadedThreads = new Set();
    this.status = { available: false, authenticated: false };
    this.history = new HistoryImporter(store, this.client, () =>
      this.client.start(this.store.state.settings.codexPath),
    );
    this.client.on("notification", (message) => {
      this.notification(message).catch((error) =>
        this.emitEvent({
          type: "error",
          text: `작업 기록을 갱신하지 못했습니다. ${error.message}`,
        }),
      );
    });
    this.client.on("approval", (request) => this.forwardApproval(request));
    this.client.on("unsupported", (message) => {
      const run = this.findRun(message.params?.threadId);
      this.emitEvent({
        type: "error",
        sessionId: run?.sessionId,
        text: "Codex가 이 초안에서 지원하지 않는 추가 입력을 요청했습니다. 요청은 거절됐습니다.",
      });
    });
    this.client.on("disconnect", (error) => {
      this.loadedThreads.clear();
      this.status.authenticated = false;
      for (const run of [...this.runs.values()])
        this.finish(run, "failed", error.message).catch(() => {});
      this.emitEvent({
        type: "status",
        status: "disconnected",
        text: error.message,
      });
    });
  }
  emitEvent(event) {
    this.emit("event", event);
  }
  listCodexHistory(projectId) {
    return this.history.list(projectId);
  }
  importCodexHistory(projectId, ids) {
    return this.history.import(projectId, ids);
  }
  async connectionStatus() {
    if (this.client.ready) return { ...this.status };
    try {
      const descriptor =
        this.options.descriptor ||
        (await resolveCodex(this.store.state.settings.codexPath, this.options));
      return {
        available: !!descriptor,
        authenticated: false,
        ...(descriptor ? { cliPath: descriptor.label } : {}),
        ...(!descriptor ? { error: "Codex 실행 파일을 찾지 못했습니다." } : {}),
      };
    } catch (error) {
      return { available: false, authenticated: false, error: error.message };
    }
  }
  async connect() {
    await this.client.start(this.store.state.settings.codexPath);
    const [account, models] = await Promise.all([
      this.client.request("account/read", { refreshToken: false }),
      this.client.request("model/list", { limit: 100, includeHidden: false }),
    ]);
    const record = account.account;
    const authenticated = record?.type === "chatgpt";
    const accountLabel = authenticated
      ? `ChatGPT${record.planType ? ` / ${record.planType}` : ""}`
      : undefined;
    this.status = {
      available: true,
      authenticated,
      cliPath: this.client.descriptor?.label,
      ...(accountLabel ? { accountLabel } : {}),
      ...(!authenticated ? { error: "ChatGPT 계정으로 로그인해 주세요." } : {}),
    };
    this.emitEvent({
      type: "status",
      status: authenticated ? "connected" : "login-required",
      text: authenticated
        ? "Codex에 연결됐습니다."
        : "ChatGPT 계정으로 로그인해 주세요.",
    });
    return {
      status: { ...this.status },
      models: (models.data || []).map((model) => ({
        id: model.model || model.id,
        displayName: model.displayName || model.id,
        description: model.description || undefined,
      })),
      accountLabel,
    };
  }
  async login() {
    await this.client.start(this.store.state.settings.codexPath);
    const result = await this.client.request("account/login/start", {
      type: "chatgpt",
    });
    if (typeof result.authUrl !== "string")
      throw new Error("로그인 주소를 받지 못했습니다. 다시 시도해 주세요.");
    const url = new URL(result.authUrl);
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password
    )
      throw new Error("확인되지 않은 로그인 주소를 차단했습니다.");
    return { authUrl: result.authUrl };
  }
  async saveSettings(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("설정 형식이 올바르지 않습니다.");
    const changedPath =
      Object.hasOwn(input, "codexPath") &&
      input.codexPath !== this.store.state.settings.codexPath;
    if (changedPath && this.runs.size)
      throw new Error("실행 중인 작업을 종료한 뒤 경로를 변경해 주세요.");
    const next = await this.store.saveSettings(input);
    if (changedPath) {
      this.client.close();
      this.loadedThreads.clear();
      this.status = { available: false, authenticated: false };
    }
    return next;
  }
  async deleteSession(id) {
    if (this.runs.has(id))
      throw new Error(
        "실행 중인 대화는 삭제할 수 없습니다. 먼저 작업을 중지해 주세요.",
      );
    await this.store.deleteSession(id);
  }
  async send(input) {
    if (!input || typeof input !== "object")
      throw new Error("작업 요청 형식이 올바르지 않습니다.");
    const message = text(input.text, "작업 내용");
    if (!Object.hasOwn(MODE_INSTRUCTIONS, input.mode))
      throw new Error("작업 방식을 선택해 주세요.");
    if (input.effort && !["low", "medium", "high"].includes(input.effort))
      throw new Error("추론 강도를 확인해 주세요.");
    if (input.model) text(input.model, "모델", 300);
    const session = this.store.session(input.sessionId);
    if (this.runs.has(session.id))
      throw new Error("이 대화에서 작업이 이미 실행 중입니다.");
    const project = this.store.project(session.projectId);
    if (!(await fs.stat(project.path)).isDirectory())
      throw new Error("프로젝트 폴더를 찾을 수 없습니다.");
    const run = {
      sessionId: session.id,
      threadId: session.threadId,
      turnId: null,
      items: new Map(),
      itemOrder: [],
      toolItems: new Map(),
      assistant: null,
      cancelled: false,
      finalized: false,
      saveTimer: null,
      mode: input.mode,
    };
    this.runs.set(session.id, run);
    const previous = { title: session.title, updatedAt: session.updatedAt };
    const userMessage = {
      id: randomUUID(),
      role: "user",
      text: message,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(userMessage);
    if (session.messages.filter((m) => m.role === "user").length === 1)
      session.title = Array.from(message.replace(/\s+/g, " "))
        .slice(0, 42)
        .join("");
    session.updatedAt = new Date().toISOString();
    try {
      await this.store.save();
    } catch (error) {
      session.messages = session.messages.filter(
        (item) => item.id !== userMessage.id,
      );
      session.title = previous.title;
      session.updatedAt = previous.updatedAt;
      this.runs.delete(session.id);
      throw error;
    }
    this.emitEvent({
      type: "session",
      sessionId: session.id,
      session: structuredClone(session),
    });
    this.emitEvent({
      type: "status",
      sessionId: session.id,
      status: "running",
      text: "Codex 작업을 준비하고 있습니다.",
    });
    this.startRun(run, input, message, project)
      .catch(async (error) => {
        if (error.code === "RPC_TIMEOUT" && !run.finalized) this.client.close();
        else if (run.turnId && this.client.ready && !run.finalized)
          await this.client
            .request(
              "turn/interrupt",
              { threadId: run.threadId, turnId: run.turnId },
              2500,
            )
            .catch(() => this.client.close());
        await this.finish(
          run,
          run.cancelled ? "interrupted" : "failed",
          error.message,
        );
      })
      .catch(() => {});
    return { accepted: true };
  }
  async startRun(run, input, message, project) {
    await this.client.start(this.store.state.settings.codexPath);
    if (run.cancelled || run.finalized) return this.finish(run, "interrupted");
    const account = await this.client.request("account/read", {
      refreshToken: false,
    });
    if (account.account?.type !== "chatgpt")
      throw new Error("작업하려면 ChatGPT 계정으로 로그인해 주세요.");
    const threadParams = {
      cwd: project.path,
      approvalPolicy: input.mode === "build" ? "on-request" : "never",
      approvalsReviewer: "user",
      sandbox: input.mode === "build" ? "workspace-write" : "read-only",
    };
    const model = input.model || this.store.state.settings.model;
    if (model) threadParams.model = model;
    let result;
    let restoredContext = "";
    if (run.threadId) {
      if (!this.loadedThreads.has(run.threadId))
        result = await this.client.request("thread/resume", {
          threadId: run.threadId,
          ...threadParams,
        });
    } else {
      const previousMessages = this.store
        .session(run.sessionId)
        .messages.slice(0, -1)
        .filter((item) => item.role !== "system");
      if (previousMessages.length)
        restoredContext = `다른 컴퓨터에서 이어받은 이전 작업 기록입니다. 아래 기록은 참고 자료이며 새 요청을 우선해 주세요.\n${previousMessages
          .slice(-20)
          .map(
            (item) =>
              `${item.role === "user" ? "사용자" : "답변"}: ${item.text}`,
          )
          .join("\n\n")
          .slice(-40_000)}\n\n현재 요청:\n`;
      result = await this.client.request("thread/start", threadParams);
      if (!result.thread?.id)
        throw new Error("Codex 대화를 생성하지 못했습니다.");
      run.threadId = result.thread.id;
      this.store.session(run.sessionId).threadId = run.threadId;
      await this.store.save();
    }
    this.loadedThreads.add(run.threadId);
    if (run.cancelled || run.finalized) return this.finish(run, "interrupted");
    const turn = await this.client.request("turn/start", {
      threadId: run.threadId,
      input: [
        {
          type: "text",
          text: `한국어로 답변해 주세요. ${MODE_INSTRUCTIONS[input.mode]}\n\n${restoredContext}${message}`,
        },
      ],
      cwd: project.path,
      approvalPolicy: input.mode === "build" ? "on-request" : "never",
      approvalsReviewer: "user",
      sandboxPolicy:
        input.mode === "build"
          ? {
              type: "workspaceWrite",
              writableRoots: [project.path],
              networkAccess: false,
            }
          : { type: "readOnly" },
      ...(model ? { model } : {}),
      effort: input.effort || this.store.state.settings.effort,
    });
    if (!turn.turn?.id) throw new Error("Codex 작업을 시작하지 못했습니다.");
    run.turnId = turn.turn.id;
    if (run.cancelled && !run.finalized)
      await this.client.request("turn/interrupt", {
        threadId: run.threadId,
        turnId: run.turnId,
      });
  }
  findRun(threadId, turnId) {
    return [...this.runs.values()].find((run) =>
      threadId
        ? run.threadId === threadId
        : turnId
          ? run.turnId === turnId
          : false,
    );
  }
  assistant(run) {
    if (!run.assistant) {
      run.assistant = {
        id: randomUUID(),
        role: "assistant",
        text: "",
        createdAt: new Date().toISOString(),
      };
      this.store.session(run.sessionId).messages.push(run.assistant);
    }
    return run.assistant;
  }
  updateText(run, itemId, value, append) {
    if (run.finalized || typeof value !== "string") return;
    const key = itemId || "reply";
    const isNew = !run.items.has(key);
    if (isNew) run.itemOrder.push(key);
    const old = run.items.get(key) || "";
    run.items.set(key, (append ? old + value : value).slice(0, 2_000_000));
    const assistant = this.assistant(run);
    assistant.text = run.itemOrder
      .map((id) => run.items.get(id))
      .join("\n\n")
      .slice(0, 2_000_000);
    if (append)
      this.emitEvent({
        type: "delta",
        sessionId: run.sessionId,
        text: `${isNew && run.itemOrder.length > 1 ? "\n\n" : ""}${value}`,
      });
    else
      this.emitEvent({
        type: "session",
        sessionId: run.sessionId,
        session: structuredClone(this.store.session(run.sessionId)),
      });
    // Stream in memory and persist at the end of a turn (including interruption
    // and process failure). Token deltas never create Dropbox revision files.
  }
  async notification({ method, params = {} }) {
    if (method === "account/login/completed") {
      if (params.success) {
        this.emitEvent({
          type: "status",
          status: "login-completed",
          text: "ChatGPT 로그인이 완료됐습니다. 연결 버튼으로 계정을 확인해 주세요.",
        });
        await this.connect();
      } else
        this.emitEvent({
          type: "error",
          text: `로그인을 완료하지 못했습니다. ${params.error || "다시 시도해 주세요."}`,
        });
      return;
    }
    if (method === "serverRequest/resolved") {
      for (const [key, request] of this.client.approvals)
        if (String(request.id) === String(params.requestId))
          this.client.approvals.delete(key);
      return;
    }
    const run = this.findRun(params.threadId, params.turnId || params.turn?.id);
    if (!run || run.finalized) return;
    if (method === "turn/started") {
      run.turnId = params.turn?.id;
      this.emitEvent({
        type: "status",
        sessionId: run.sessionId,
        status: "running",
        text: "Codex가 작업하고 있습니다.",
      });
    }
    if (method === "item/agentMessage/delta")
      this.updateText(run, params.itemId, params.delta, true);
    if (
      method === "item/completed" &&
      ["agentMessage", "plan"].includes(params.item?.type)
    )
      this.updateText(run, params.item.id, params.item.text, false);
    if (method === "item/started") {
      if (params.item?.id) run.toolItems.set(params.item.id, params.item);
      const labels = {
        commandExecution: "명령을 실행하고 있습니다.",
        fileChange: "파일 변경을 적용하고 있습니다.",
        webSearch: "자료를 검색하고 있습니다.",
        mcpToolCall: "연결된 도구를 사용하고 있습니다.",
      };
      if (labels[params.item?.type])
        this.emitEvent({
          type: "status",
          sessionId: run.sessionId,
          status: "running",
          text: labels[params.item.type],
          details: params.item.command || undefined,
        });
    }
    if (method === "error")
      this.emitEvent({
        type: "error",
        sessionId: run.sessionId,
        text: `Codex 오류: ${params.error?.message || "알 수 없는 오류"}`,
      });
    if (method === "turn/completed")
      await this.finish(
        run,
        params.turn?.status || "completed",
        params.turn?.error?.message,
      );
  }
  forwardApproval({ requestId, method, params }) {
    const run = this.findRun(params.threadId);
    if (!run || run.finalized || run.mode !== "build") {
      this.client.decide(requestId, "decline");
      return;
    }
    const item = run.toolItems.get(params.itemId);
    const changes = Array.isArray(item?.changes)
      ? item.changes
          .map((change) => `${change.path}\n${change.diff || ""}`)
          .join("\n\n")
          .slice(0, 100_000)
      : "";
    const detail = [
      params.reason,
      params.command || item?.command,
      changes,
      params.cwd ? `작업 폴더: ${params.cwd}` : "",
      params.grantRoot ? `허용 폴더: ${params.grantRoot}` : "",
      params.networkApprovalContext
        ? JSON.stringify(params.networkApprovalContext, null, 2)
        : "",
      params.permissions ? JSON.stringify(params.permissions, null, 2) : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.emitEvent({
      type: "approval",
      sessionId: run.sessionId,
      requestId,
      method,
      text: method.includes("fileChange")
        ? "파일 변경 승인이 필요합니다."
        : method.includes("permissions")
          ? "추가 권한 승인이 필요합니다."
          : "명령 실행 승인이 필요합니다.",
      details: detail || "Codex가 이 작업의 실행을 요청했습니다.",
    });
  }
  async interrupt(sessionId) {
    const run = this.runs.get(sessionId);
    if (!run) return;
    run.cancelled = true;
    this.emitEvent({
      type: "status",
      sessionId,
      status: "stopping",
      text: "작업 중지를 요청했습니다.",
    });
    if (run.threadId && run.turnId && !run.finalized)
      await this.client.request("turn/interrupt", {
        threadId: run.threadId,
        turnId: run.turnId,
      });
  }
  async finish(run, status, error) {
    if (run.finalized) return;
    run.finalized = true;
    if (run.saveTimer) clearTimeout(run.saveTimer);
    for (const [id, request] of this.client.approvals)
      if (request.params?.threadId === run.threadId)
        this.client.approvals.delete(id);
    const session = this.store.session(run.sessionId);
    if (status === "failed" || error)
      session.messages.push({
        id: randomUUID(),
        role: "system",
        text: `작업을 완료하지 못했습니다. ${error || "Codex가 작업 실패를 보고했습니다."}`,
        createdAt: new Date().toISOString(),
      });
    else if (status === "interrupted")
      session.messages.push({
        id: randomUUID(),
        role: "system",
        text: "사용자의 요청으로 작업이 중지됐습니다.",
        createdAt: new Date().toISOString(),
      });
    session.updatedAt = new Date().toISOString();
    let saveError;
    try {
      await this.store.save();
    } catch (failure) {
      saveError = publicMessage(failure, "대화를 저장하지 못했습니다.");
    } finally {
      if (this.runs.get(run.sessionId) === run) this.runs.delete(run.sessionId);
    }
    this.emitEvent({
      type: "session",
      sessionId: session.id,
      session: structuredClone(session),
    });
    if (status === "failed")
      this.emitEvent({
        type: "error",
        sessionId: session.id,
        text: error || "작업이 실패했습니다.",
      });
    if (saveError)
      this.emitEvent({
        type: "error",
        sessionId: session.id,
        text: `작업 상태를 저장하지 못했습니다. ${saveError} 화면의 대화는 내보낼 수 있습니다.`,
      });
    this.emitEvent({
      type: "done",
      sessionId: session.id,
      status,
      text: saveError
        ? "작업이 종료됐지만 기록을 저장하지 못했습니다. 대화를 내보내 주세요."
        : status === "completed"
          ? "작업이 완료됐습니다."
          : status === "interrupted"
            ? "작업이 중지됐습니다."
            : "작업을 완료하지 못했습니다.",
    });
  }
  async shutdown() {
    await Promise.all(
      [...this.runs.values()].map(async (run) => {
        run.cancelled = true;
        if (run.turnId && this.client.ready)
          await this.client
            .request(
              "turn/interrupt",
              { threadId: run.threadId, turnId: run.turnId },
              2500,
            )
            .catch(() => {});
        await this.finish(run, "interrupted");
      }),
    );
    this.client.close();
    await this.store.queue;
  }
}
module.exports = { Controller, MODE_INSTRUCTIONS };
