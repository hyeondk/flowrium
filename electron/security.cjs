const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { EventEmitter } = require("node:events");
const scrypt = promisify(crypto.scrypt);
const DEFAULTS = Object.freeze({
  idleMinutes: 0,
  lockAfterPause: true,
  lockOnSuspend: true,
  notifyApproval: false,
  notifyDone: false,
  preventSleep: false,
});
const idleChoices = [0, 5, 10, 15, 30, 60];
const publicWhileLocked = new Set(["securityState", "unlockSecurity"]);
const accountCommands = new Set([
  "readDrafts",
  "writeDrafts",
  "addChatAttachments", "readChatAttachment", "listQueuedMessages", "cancelQueuedMessage", "resumeQueuedMessages",
  "workflowAction", "exportMemory", "previewMemoryImport", "applyMemoryImport", "moveMemory",
  "portfolioAction", "repositoryFlow", "artifactAction", "storageAction", "analyzeSystemProcesses", "stopSystemProcesses",
  "configureMacPim", "prepareMacEvent", "commitMacEvent", "prepareGoogleEvent", "commitGoogleEvent", "importGoogleFile",
  "configureLinkDelivery", "connectKakao", "disconnectKakao", "sendKakaoLink", "sendLinkMail", "checkLinkMail", "webPushAction",
  "configureVoicePreferences", "configureVoice", "allowVoiceCapture", "transcribeVoice", "cancelVoiceCapture", "speakVoice",
  "connect",
  "login",
  "send",
  "runTeam",
  "directTeam",
  "changeTeamRun",
  "editConversation",
  "listCodexHistory",
  "importCodexHistory",
  "saveSettings",
  "readAccountUsage",
]);
const lockedError = () =>
  new Error("화면이 잠겼습니다. 잠금을 해제한 뒤 다시 시도해 주세요.");
function validatePrefs(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("보안 설정 형식을 확인해 주세요.");
  for (const [name, value] of Object.entries(input)) {
    if (
      !Object.hasOwn(DEFAULTS, name) ||
      (name === "idleMinutes"
        ? !idleChoices.includes(value)
        : typeof value !== "boolean")
    )
      throw new Error("잠금 시간과 알림 설정 값을 확인해 주세요.");
  }
  return { ...DEFAULTS, ...input };
}
class Security extends EventEmitter {
  constructor(directory, now = Date.now) {
    super();
    this.file = path.join(directory, "security.json");
    this.data = {
      version: 1,
      preferences: { ...DEFAULTS },
      failures: 0,
      retryAt: 0,
    };
    this.locked = false;
    this.reason = "";
    this.epoch = 0;
    this.accountRevision = 0;
    this.accountRequests = 0;
    this.loggingOut = false;
    this.queue = Promise.resolve();
    this.now = now;
    this.unlockedAt = now();
  }
  async load() {
    let disk;
    try {
      if (!(await fs.lstat(this.file)).isFile()) throw new Error();
      disk = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw new Error(
        "이 기기의 보안 설정을 읽지 못했습니다. 보안 설정 파일을 복구한 뒤 앱을 다시 열어 주세요.",
      );
    }
    if (
      disk?.version !== 1 ||
      !Number.isSafeInteger(disk.failures) ||
      disk.failures < 0 ||
      !Number.isSafeInteger(disk.retryAt) ||
      disk.retryAt < 0 ||
      (disk.pin !== undefined &&
        (!/^[a-f0-9]{32}$/.test(disk.pin?.salt) ||
          !/^[a-f0-9]{64}$/.test(disk.pin?.hash)))
    )
      throw new Error(
        "보안 설정 파일이 손상됐습니다. 기존 설정을 복구한 뒤 앱을 다시 열어 주세요.",
      );
    if (
      disk.accountRevision !== undefined &&
      (!Number.isSafeInteger(disk.accountRevision) || disk.accountRevision < 0)
    )
      throw new Error("계정 구분 설정을 확인해 주세요.");
    this.data = { ...disk, preferences: validatePrefs(disk.preferences) };
    this.accountRevision = disk.accountRevision || 0;
    if (disk.pin) this.lock("startup");
  }
  async save(next) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + "." + crypto.randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(next), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(temporary, this.file);
      this.data = next;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }
  serial(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  state() {
    return {
      loaded: true,
      locked: this.locked,
      hasPin: Boolean(this.data.pin),
      retryAt: this.data.retryAt,
      reason: this.reason,
      accountRevision: this.accountRevision,
      ...(!this.locked && { preferences: { ...this.data.preferences } }),
    };
  }
  changed() {
    const state = this.state();
    this.emit("state", state);
    return state;
  }
  lock(reason = "manual") {
    if (!this.data.pin) {
      if (reason === "manual")
        throw new Error("먼저 이 기기의 잠금 번호를 설정해 주세요.");
      return this.state();
    }
    this.epoch += 1;
    if (!this.locked || this.reason !== reason) {
      this.locked = true;
      this.reason = reason;
      this.changed();
    }
    return this.state();
  }
  async verified(input) {
    if (!this.data.pin) return;
    if (this.data.retryAt > this.now())
      throw new Error(
        "잠금 번호를 여러 번 틀렸습니다. 잠시 후 다시 시도해 주세요.",
      );
    let valid = false;
    if (typeof input === "string" && /^[0-9]{4}$/.test(input)) {
      const digest = await scrypt(input, this.data.pin.salt, 32);
      valid = crypto.timingSafeEqual(
        digest,
        Buffer.from(this.data.pin.hash, "hex"),
      );
    }
    if (!valid) {
      const failures = this.data.failures + 1;
      const delay =
        failures < 5 ? 0 : Math.min(900, 30 * 2 ** Math.min(5, failures - 5));
      await this.save({
        ...this.data,
        failures,
        retryAt: delay ? this.now() + delay * 1000 : 0,
      });
      this.changed();
      throw new Error(
        delay
          ? "잠금 번호를 여러 번 틀렸습니다. 잠시 후 다시 시도해 주세요."
          : "잠금 번호가 일치하지 않습니다.",
      );
    }
  }
  unlock(pin) {
    const epoch = this.epoch;
    return this.serial(async () => {
      if (!this.locked) return this.state();
      await this.verified(pin);
      if (this.data.failures)
        await this.save({ ...this.data, failures: 0, retryAt: 0 });
      if (epoch !== this.epoch) throw lockedError();
      this.locked = false;
      this.reason = "";
      this.unlockedAt = this.now();
      this.epoch += 1;
      return this.changed();
    });
  }
  setPin(current, next) {
    const epoch = this.epoch;
    return this.serial(async () => {
      if (this.locked || epoch !== this.epoch) throw lockedError();
      if (
        next !== null &&
        (typeof next !== "string" || !/^[0-9]{4}$/.test(next))
      )
        throw new Error("새 잠금 번호는 숫자 4자리로 입력해 주세요.");
      await this.verified(current);
      const data = { ...this.data, failures: 0, retryAt: 0 };
      if (next === null) delete data.pin;
      else {
        const salt = crypto.randomBytes(16).toString("hex");
        data.pin = {
          salt,
          hash: (await scrypt(next, salt, 32)).toString("hex"),
        };
      }
      if (this.locked || epoch !== this.epoch) throw lockedError();
      await this.save(data);
      return this.changed();
    });
  }
  preferences(input) {
    const epoch = this.epoch;
    return this.serial(async () => {
      if (this.locked || epoch !== this.epoch) throw lockedError();
      validatePrefs(input);
      await this.save({
        ...this.data,
        preferences: { ...this.data.preferences, ...input },
      });
      return this.changed();
    });
  }
  accountOwner(account, force = false) {
    const identifier =
      account?.type === "chatgpt"
        ? String(account.email || account.accountId || "")
            .trim()
            .toLowerCase()
        : "";
    const owner = identifier
      ? crypto
          .createHash("sha256")
          .update("flowrium-account:" + identifier)
          .digest("hex")
      : "signed-out";
    return this.serial(async () => {
      if (!force && this.data.accountOwner === owner) return false;
      const changed = force || this.data.accountOwner !== undefined;
      const revision = this.accountRevision + (changed ? 1 : 0);
      await this.save({
        ...this.data,
        accountOwner: owner,
        accountRevision: revision,
      });
      this.accountRevision = revision;
      if (changed) this.changed();
      return changed;
    });
  }
  async guard(method, action) {
    if (publicWhileLocked.has(method)) return action();
    if (this.locked) throw lockedError();
    const epoch = this.epoch;
    const accountOp = accountCommands.has(method);
    if (accountOp && this.loggingOut)
      throw new Error("로그아웃을 마친 뒤 다시 시도해 주세요.");
    if (accountOp) this.accountRequests += 1;
    try {
      const result = await action();
      if (
        method !== "lockSecurity" &&
        method !== "logoutSecurity" &&
        (this.locked || epoch !== this.epoch)
      )
        throw lockedError();
      return result;
    } catch (e) {
      if (
        (this.locked || epoch !== this.epoch) &&
        method !== "lockSecurity" &&
        method !== "logoutSecurity"
      )
        throw lockedError();
      throw e;
    } finally {
      if (accountOp) this.accountRequests -= 1;
    }
  }
}

function usageView(response, now = Date.now()) {
  const multi = response?.rateLimitsByLimitId;
  const limits =
    multi && Object.keys(multi).length
      ? Object.entries(multi)
      : [["codex", response?.rateLimits]];
  const buckets = [];
  for (const [id, limit] of limits.slice(0, 50)) {
    if (!limit || typeof limit !== "object") continue;
    const windows = [];
    for (const key of ["primary", "secondary"]) {
      const row = limit[key];
      if (!Number.isFinite(row?.usedPercent)) continue;
      windows.push({
        key,
        usedPercent: Math.min(100, Math.max(0, row.usedPercent)),
        minutes:
          Number.isSafeInteger(row.windowDurationMins) &&
          row.windowDurationMins > 0
            ? row.windowDurationMins
            : null,
        resetsAt:
          Number.isSafeInteger(row.resetsAt) &&
          row.resetsAt > 0 &&
          row.resetsAt < 8640000000000
            ? row.resetsAt * 1000
            : null,
      });
    }
    buckets.push({
      name: String(limit.limitName || limit.limitId || id).slice(0, 120),
      windows,
      plan:
        typeof limit.planType === "string" ? limit.planType.slice(0, 60) : null,
      ...(limit.credits &&
        typeof limit.credits.hasCredits === "boolean" && {
          credits: {
            unlimited: limit.credits.unlimited === true,
            balance:
              typeof limit.credits.balance === "string"
                ? limit.credits.balance.slice(0, 50)
                : null,
          },
        }),
    });
  }
  return {
    checkedAt: now,
    buckets,
    allowed:
      typeof response?.ordinaryUsageAllowed === "boolean"
        ? response.ordinaryUsageAllowed
        : null,
  };
}

function registerSecurity(
  register,
  security,
  {
    controller,
    busy,
    powerMonitor,
    powerSaveBlocker,
    Notification,
    ready,
    focus,
  },
) {
  const approvals = new Map();
  let accountRevision = security.accountRevision;
  function onSecurityState(state) {
    if (state.locked || state.accountRevision !== accountRevision) controller.cancelStructuredAnalyses?.();
    if (state.accountRevision !== accountRevision) {
      accountRevision = state.accountRevision;
      for (const id of controller.client.inputs?.keys() || []) {
        try { controller.client.resolveInput(id,true); } catch { /* 끊어진 연결에도 질문 원문을 남기지 않는다. */ }
        approvals.delete(id);
      }
    }
    syncPower();
  }
  let blocker;
  const syncPower = () => {
    const needed =
      security.data.preferences.preventSleep && controller.runs.size > 0;
    if (needed && blocker === undefined)
      blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!needed && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
    }
  };
  function pending() {
    const events = [...controller.runs.values()]
      .filter((r) => !r.finalized)
      .map((r) => ({
        type: "status",
        sessionId: r.sessionId,
        status: r.cancelled ? "stopping" : "running",
        text: r.cancelled
          ? "작업 중지를 요청했습니다."
          : "Codex가 작업하고 있습니다.",
      }));
    for (const [id, event] of approvals) {
      if (
        (event.type === "input" ? controller.client.inputs?.has(id) : controller.client.approvals.has(id)) &&
        controller.runs.has(event.sessionId)
      )
        events.push(event);
      else approvals.delete(id);
    }
    return events;
  }
  function observe(event) {
    if (event.type === "approval" || event.type === "input") approvals.set(event.requestId, event);
    if (event.type === "inputResolved") approvals.delete(event.requestId);
    if (event.type === "done") {
      for (const [id, q] of approvals)
        if (q.sessionId === event.sessionId) approvals.delete(id);
      if (
        event.status === "completed" &&
        security.data.preferences.lockAfterPause &&
        controller.store.state.sessions.find((s) => s.id === event.sessionId)
          ?.workflow?.kind === "pause"
      )
        security.lock("workday");
    }
    syncPower();
    const pref = security.data.preferences;
    const approval = ["input","approval"].includes(event.type) && pref.notifyApproval;
    const done =
      event.type === "done" &&
      event.status !== "interrupted" &&
      pref.notifyDone;
    if ((approval || done) && Notification.isSupported()) {
      try {
        const n = new Notification({
          title: "Flowrium",
          body: event.type === "input" ? "답변을 기다리는 질문이 있습니다." : approval
            ? "승인을 기다리는 작업이 있습니다."
            : event.status === "completed"
              ? "작업을 완료했습니다."
              : "작업 결과를 확인해 주세요.",
        });
        n.on("click", focus);
        n.show();
      } catch {
        /* 운영체제의 알림 차단은 작업 완료나 승인 대기를 변경하지 않는다. */
      }
    }
  }
  register("securityState", async () => {
    await ready?.();
    return security.state();
  });
  register("lockSecurity", () => security.lock());
  register("unlockSecurity", (pin) => security.unlock(pin));
  register("setSecurityPin", (current, next) => security.setPin(current, next));
  register("setSecurityPreferences", (prefs) => security.preferences(prefs));
  register("securityPending", pending);
  register("readAccountUsage", async () => {
    await controller.client.start(controller.store.state.settings.codexPath);
    const account = await controller.client.request("account/read", {
      refreshToken: false,
    });
    if (account.account?.type !== "chatgpt")
      throw new Error("ChatGPT 계정으로 로그인한 뒤 사용량을 조회해 주세요.");
    return usageView(
      await controller.client.request("account/rateLimits/read", {}),
    );
  });
  register("logoutSecurity", async () => {
    if (security.loggingOut || security.accountRequests || busy())
      throw new Error(
        "진행 중인 작업과 계정 요청을 마친 뒤 로그아웃해 주세요.",
      );
    security.loggingOut = true;
    try {
      await controller.client.start(controller.store.state.settings.codexPath);
      if (controller.loginId) {
        const cancelled = await controller.client.request(
          "account/login/cancel",
          { loginId: controller.loginId },
        );
        if (cancelled.status === "notCancelable")
          throw new Error("진행 중인 로그인을 마친 뒤 로그아웃해 주세요.");
        controller.loginId = null;
      }
      await controller.client.request("account/logout", {});
      controller.status = {
        available: true,
        authenticated: false,
        cliPath: controller.client.descriptor?.label,
      };
      controller.loadedThreads.clear();

      await security.accountOwner(null, true);
      controller.emitEvent({
        type: "status",
        status: "login-required",
        text: "ChatGPT 계정에서 로그아웃했습니다.",
      });
      return security.data.pin ? security.lock("logout") : security.changed();
    } finally {
      security.loggingOut = false;
    }
  });
  function onSuspend() {
    if (security.data.preferences.lockOnSuspend) security.lock("suspend");
  }
  function checkIdle() {
    const minutes = security.data.preferences.idleMinutes;
    if (
      !security.locked &&
      minutes &&
      security.now() - security.unlockedAt >= minutes * 60000 &&
      powerMonitor.getSystemIdleTime() >= minutes * 60
    )
      security.lock("idle");
  }
  const idleTimer = setInterval(checkIdle, 10000);
  idleTimer.unref();
  powerMonitor.on("suspend", onSuspend);
  powerMonitor.on("lock-screen", onSuspend);
  security.on("state", onSecurityState);
  controller.on("event", observe);
  return {
    checkIdle,
    stop() {
      clearInterval(idleTimer);
      powerMonitor.off("suspend", onSuspend);
      powerMonitor.off("lock-screen", onSuspend);
      security.off("state", onSecurityState);
      controller.off("event", observe);
      if (blocker !== undefined) powerSaveBlocker.stop(blocker);
    },
  };
}
module.exports = { Security, registerSecurity, usageView };
