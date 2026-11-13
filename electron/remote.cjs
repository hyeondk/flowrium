const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  { spawn } = require("node:child_process"),
  { randomBytes, timingSafeEqual, createHash } = require("node:crypto");
const allowed = new Set([
  "startWork",
  "send",
  "interrupt",
  "readTeams",
  "openTeamNode",
  "updateWork",
  "approval",
  "answerInput",
  "readWorkbench",
  "readWorkArtifact",
  "saveTeam", "directTeam", "changeTeamRun", "workflowAction", "mobileWorkflowState",
  "mobileSettings", "saveMobileSettings", "readAccountUsage", "readChatAttachment",
  "listQueuedMessages", "cancelQueuedMessage", "resumeQueuedMessages", "webPushState", "webPushAction",
]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function mobileSummary(s) {
  const { id, projectId, title, createdAt, updatedAt } = s;
  return {
    id,
    projectId,
    title,
    createdAt,
    updatedAt,
    messageCount: s.messages.length,
    lastMessageId: s.messages.at(-1)?.id,
    messages: [],
    workflow: s.workflow && {
      kind: s.workflow.kind,
      teamSlot: s.workflow.teamSlot && { mode: s.workflow.teamSlot.mode },
    },
    preferences: s.preferences && {
      model: s.preferences.model,
      effort: s.preferences.effort,
    },
  };
}
function mobileMessages(s, params) {
  const limit = Number(params.get("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return { code: 400, value: { error: "메시지 조회 개수는 1~100개입니다." } };
  const items = s.messages;
  let end = items.length;
  if (params.has("before")) {
    const parts = params.get("before").split(":");
    if (
      parts.length !== 2 ||
      !/^\d{1,12}$/.test(parts[0]) ||
      !uuid.test(parts[1])
    )
      return {
        code: 400,
        value: { error: "이전 메시지 위치가 올바르지 않습니다." },
      };
    end = Number(parts[0]);
    if (items[end]?.id !== parts[1])
      return {
        code: 409,
        value: {
          error: "대화 기록이 변경됐습니다. 최근 기록을 다시 열어 주세요.",
        },
      };
  }
  let start = end,
    bytes = 0;
  const messages = [];
  while (start > 0 && end - start < limit) {
    const m = items[start - 1],
      visible = m.role === "assistant" || m.role === "user";
    const size = visible ? Buffer.byteLength(m.text) : 0;
    if (messages.length && bytes + size > 512 * 1024) break;
    start--;
    if (visible) {
      messages.push({
        id: m.id,
        createdAt: m.createdAt,
        role: m.role,
        text: m.text,
        index: start,
        attachments: m.attachments,
      });
      bytes += size;
    }
  }
  return {
    code: 200,
    value: {
      id: s.id,
      messages: messages.reverse(),
      start,
      end,
      total: items.length,
      updatedAt: s.updatedAt,
      lastMessageId: items.at(-1)?.id,
      before: start > 0 ? start + ":" + items[start].id : null,
    },
  };
}
function mobileInput(event) {
  const { type, requestId, sessionId, isBlocking } = event;
  const base = { type, requestId, sessionId, isBlocking: Boolean(isBlocking) };
  if (
    event.desktopOnly ||
    !Array.isArray(event.questions) ||
    !event.questions.length ||
    event.questions.some(
      (q) =>
        !q || q.isSecret !== false || !q.id || typeof q.question !== "string",
    )
  )
    return { ...base, desktopOnly: true };
  return {
    ...base,
    questions: event.questions.map(
      ({ id, header, question, options, isOther }) => ({
        id,
        header,
        question,
        isOther: Boolean(isOther),
        options: Array.isArray(options)
          ? options.map(({ label, description }) => ({ label, description }))
          : [],
      }),
    ),
  };
}
function registerRemote(
  register,
  {
    store,
    controller,
    handlers,
    isLocked,
    version,
    guard = (_name, action) => action(),
    tunnelFactory = spawn,
    accountRevision = () => 0,
    onContextChanged = () => {},
    now = Date.now,
  },
) {
  const answeredInputs = new Set();
  const handoffs = new Map();
  const scopeId = () => key ? createHash("sha256").update(key).digest("hex") : "";
  const checkScope = (scope, owner) => {
    if (!server?.listening || scope !== scopeId() || owner !== connectionOwner || owner !== String(accountRevision()) || isLocked())
      throw Error("휴대폰 연결을 다시 확인해 주세요.");
  };
  const originAllowed = (req, local) => req.headers.origin === publicOrigin || req.headers.origin === "http://" + local;
  async function readBody(req, max = 2 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw Error("요청 크기가 너무 큽니다.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function workflowView(value) {
    const {version,revision,preferences,notifications,reminders,deliveries,reports,projects,sessions}=value;
    return {version,revision,preferences,notifications,reminders,deliveries,reports,projects,sessions,
      proposals:(value.proposals||[]).map(p=>{const {id,revision,kind,title,body,sourceId,targetId,projectId,status,createdAt,hidden,snoozedUntil,result,preview}=p;return {id,revision,kind,title,body,sourceId,targetId,projectId,status,createdAt,hidden,snoozedUntil,result,preview};}),
      pending:(value.pending || []).map(e => e.type === "input" ? mobileInput(e) : e).filter(e => e.type === "input" || e.type === "approval")};
  }
  async function mobileCall(method, args) {
    if (method === "mobileSettings") {
      const connection = await handlers.get("connect")?.();
      return {model:store.state.settings.model,effort:store.state.settings.effort,chatDefaults:store.state.settings.chatDefaults,
        models:(connection?.models || []).map(({id,displayName,supportedReasoningEfforts,defaultReasoningEffort}) => ({id,displayName,supportedReasoningEfforts,defaultReasoningEffort}))};
    }
    if (method === "saveMobileSettings") {
      const input = args[0];
      if (args.length !== 1 || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["model","effort","chatDefaults"].includes(k)))
        throw Error("모바일에서 바꿀 수 없는 설정입니다.");
      if (input.chatDefaults && (typeof input.chatDefaults !== "object" || Array.isArray(input.chatDefaults) || Object.keys(input.chatDefaults).some(k => !["answerLength","testing","askNext","autoCompact","compactAt"].includes(k))))
        throw Error("실행 권한은 데스크톱에서 바꿔 주세요.");
      const result = await handlers.get("saveSettings")(input);
      return {model:result.model,effort:result.effort,chatDefaults:result.chatDefaults};
    }
    if (method === "mobileWorkflowState") return workflowView(await handlers.get("workflowState")());
    if (method === "workflowAction") {
      const input = args[0];
      if (args.length !== 1 || !input || !["preferences","send","request","propose","approve","reject","hide","restore","snooze","bulk","read","readSession","clearNotifications","reportNow","collect","recommend","reminderAdd","reminderCancel","retryDelivery"].includes(input.action))
        throw Error("지원하지 않는 비서 작업입니다.");
      if (input.action === "preferences" && Object.keys(input.value || {}).some(k => !["enabled","aiReports","intervalMinutes","startHour","endHour","weekdays","timezone","projectId"].includes(k)))
        throw Error("연결 서비스 설정은 데스크톱에서 바꿔 주세요.");
    }
    if (method === "changeTeamRun" && !["automation","dispatch","pause","resume","stop","reopen","report","raiseLimit","finishStopped","answer","instruct","ask","explain","reassign","message","stopNode","completeNode","retry"].includes(args[2]?.action))
      throw Error("지원하지 않는 팀 작업입니다.");
    if (method === "directTeam") {
      const input = args[4];
      if (!input || typeof input !== "object" || Object.keys(input).some(k => !["strategy","assignments","isolate","autoReport","budget","minutes","leadModel","autoDispatch","autoPM","autoQA","autoIntegrate","maxQaRounds","maxPMRounds","integrationRoleIndex"].includes(k)))
        throw Error("팀 실행 옵션을 확인해 주세요.");
    }
    const handler = handlers.get(method);
    if (!handler) throw Error("이 앱 버전에서 사용할 수 없는 작업입니다.");
    const result = await handler(...args);
    return method === "workflowAction" && result?.pending ? workflowView(result) : result;
  }
  let sequence = 0;
  let connectionOwner = "";
  let server,
    tunnel,
    key,
    publicOrigin,
    status = "",
    running = new Set(),
    approvals = new Map();
  const state = () => ({
    enabled: !!server,
    localUrl: server?.listening
      ? "http://127.0.0.1:" + server.address().port + "/#key=" + key
      : undefined,
    url: publicOrigin ? publicOrigin + "/#key=" + key : undefined,
    message: status || undefined,
  });
  function update(event) {
    if (event.type === "approval" || event.type === "input")
      approvals.set(event.requestId, event);
    if (event.type === "input") answeredInputs.delete(event.requestId);
    if (event.type === "inputResolved") approvals.delete(event.requestId);
    if (event.type === "done") {
      running.delete(event.sessionId);
      for (const [id, a] of approvals)
        if (a.sessionId === event.sessionId) approvals.delete(id);
    }
    if (event.type === "status" && event.sessionId)
      running.add(event.sessionId);
  }
  async function readPending() {
    const pending = handlers.get("securityPending");
    const events = pending ? await pending() : [...approvals.values()];
    const ids = new Set(
      events.filter((e) => e.type === "input").map((e) => e.requestId),
    );
    for (const id of answeredInputs)
      if (!ids.has(id)) answeredInputs.delete(id);
    return events;
  }
  function authorized(req) {
    if (!key || !server?.listening || connectionOwner !== String(accountRevision())) return false;
    const actual = req.headers.authorization || "",
      expected = "Bearer " + key;
    const a = Buffer.from(actual),
      b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const json = (res, code, value) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  async function handle(req, res) {
    const local = "127.0.0.1:" + server.address().port;
    const hostname = req.headers.host;
    if (
      hostname !== local &&
      hostname !== (publicOrigin && new URL(publicOrigin).host)
    ) {
      res.writeHead(400).end();
      return;
    }
    const u = new URL(req.url, "http://" + local);
    if (u.pathname === "/api/mobile/handoff" && req.method === "POST") {
      try {
        if (!originAllowed(req,local) || req.headers["content-type"]?.split(";")[0] !== "application/json") throw Error("허용되지 않은 연결 요청입니다.");
        const input = JSON.parse((await readBody(req,4096)).toString("utf8"));
        if (typeof input.handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.handoff)) throw Error("연결 주소를 확인해 주세요.");
        const id = createHash("sha256").update(input.handoff).digest("hex"), record = handoffs.get(id);
        handoffs.delete(id);
        if (!record || record.expiresAt <= now()) throw Error("만료됐거나 이미 사용한 연결 주소입니다.");
        checkScope(record.scopeId,record.owner);
        json(res,200,{key});
      } catch (e) {json(res,400,{error:require("./errors.cjs").publicMessage(e)});}
      return;
    }
    if (u.pathname.startsWith("/api/")) {
      if (!authorized(req)) {
        json(res, 401, { error: "데스크톱에서 새 연결 주소를 받아 주세요." });
        return;
      }
      if (isLocked()) {
        json(res, 403, {
          error: "데스크톱 Flowrium이 잠겨 있습니다.",
          locked: true,
        });
        return;
      }
      const requestScope = scopeId(), requestOwner = String(accountRevision());
      if (u.pathname === "/api/mobile/attachments" && req.method === "POST") {
        try {
          if (!originAllowed(req,local) || req.headers["content-type"]?.split(";")[0] !== "application/octet-stream") throw Error("첨부 요청 형식을 확인해 주세요.");
          const projectId=u.searchParams.get("projectId"), name=u.searchParams.get("name"), type=u.searchParams.get("type");
          const bytes=await readBody(req,20*1024*1024);checkScope(requestScope,requestOwner);
          const handler=handlers.get("addChatAttachments");if(!handler)throw Error("첨부를 사용할 수 없는 앱 버전입니다.");
          const result=await guard("addChatAttachments",()=>handler(projectId,[{name,type,bytes}]));
          checkScope(requestScope,requestOwner);json(res,200,{result});
        } catch(e) {json(res,400,{error:require("./errors.cjs").publicMessage(e)});}
        return;
      }
      if (u.pathname === "/api/mobile/state" && req.method === "GET") {
        try {
          const value = await guard("bootstrap", async () => {
            const snapshot = store.state,
              connection = await controller.connectionStatus();
            const requests = await readPending();
            return {
              projects: snapshot.projects.map((p) => ({
                id: p.id,
                name: p.name,
                createdAt: p.createdAt,
              })),
              sessions: snapshot.sessions.map(mobileSummary),
              settings: {
                model: snapshot.settings.model,
                effort: snapshot.settings.effort,
              },
              version,
              pushAvailable: !!handlers.get("webPushAction"),
              connection: {
                available: connection.available,
                authenticated: connection.authenticated,
                accountLabel: connection.accountLabel,
              },
              running: [...controller.runs.keys()],
              approvals: requests
                .filter(
                  (e) =>
                    e.type === "approval" ||
                    (e.type === "input" && !answeredInputs.has(e.requestId)),
                )
                .map((e) => (e.type === "input" ? mobileInput(e) : e)),
            };
          });
          if (isLocked()) {
            json(res, 403, {
              locked: true,
              error: "데스크톱 Flowrium이 잠겨 있습니다.",
            });
            return;
          }
          checkScope(requestScope,requestOwner);
          json(res, 200, value);
        } catch {
          json(res, 403, {
            locked: true,
            error: "데스크톱 Flowrium에서 계정과 잠금을 확인해 주세요.",
          });
        }
        return;
      }
      const sessionRoute = /^\/api\/mobile\/sessions\/([^/]+)$/.exec(
        u.pathname,
      );
      if (sessionRoute && req.method === "GET") {
        try {
          const result = await guard("bootstrap", () => {
            const record =
              uuid.test(sessionRoute[1]) &&
              store.state.sessions.find((s) => s.id === sessionRoute[1]);
            return record
              ? mobileMessages(record, u.searchParams)
              : { code: 404, value: { error: "대화를 찾을 수 없습니다." } };
          });
          if (isLocked()) {
            json(res, 403, {
              locked: true,
              error: "데스크톱 Flowrium이 잠겨 있습니다.",
            });
            return;
          }
          checkScope(requestScope,requestOwner);
          json(res, result.code, result.value);
        } catch {
          json(res, 403, {
            locked: true,
            error: "데스크톱 Flowrium에서 계정과 잠금을 확인해 주세요.",
          });
        }
        return;
      }
      if (u.pathname === "/api/mobile/call" && req.method === "POST") {
        const origin = req.headers.origin;
        if (origin !== publicOrigin && origin !== "http://" + local) {
          json(res, 403, { error: "허용되지 않은 요청 출처입니다." });
          return;
        }
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
          json(res, 415, { error: "요청 형식을 확인해 주세요." });
          return;
        }
        try {
          const input = JSON.parse((await readBody(req)).toString("utf8"));
          checkScope(requestScope,requestOwner);
          if (
            !allowed.has(input.method) ||
            !Array.isArray(input.args) ||
            input.args.length > 5
          )
            throw Error("지원하지 않는 모바일 작업입니다.");
          if (isLocked()) throw Error("데스크톱 Flowrium이 잠겨 있습니다.");
          const handler = handlers.get(input.method);
          if (input.method === "approval" || input.method === "answerInput") {
            const id = input.args[0]?.requestId,
              isAnswer = input.method === "answerInput";
            if (input.args.length !== 1 || typeof id !== "string" || !id)
              throw Error("요청 식별자를 확인해 주세요.");
            const pending = await readPending();
            const found = pending.find(
              (event) =>
                event.requestId === id &&
                event.type === (isAnswer ? "input" : "approval"),
            );
            if (!found || (isAnswer && answeredInputs.has(id)))
              throw Error("이미 처리됐거나 해당 유형의 대기 요청이 없습니다.");
            if (isAnswer && mobileInput(found).desktopOnly) {
              json(res, 403, {
                error: "이 질문에는 데스크톱에서 답해 주세요.",
              });
              return;
            }
            if (isAnswer) answeredInputs.add(id);
            try {
              const result = await guard(input.method, () =>
                handler(input.args[0]),
              );
              approvals.delete(id);
              if (isLocked()) {
                json(res, 403, {
                  locked: true,
                  error: "데스크톱 Flowrium이 잠겨 있습니다.",
                });
                return;
              }
              json(res, 200, { result });
            } catch (error) {
              if (isAnswer) answeredInputs.delete(id);
              throw error;
            }
            return;
          }
          const result = await guard(input.method, () => mobileCall(input.method,input.args));
          checkScope(requestScope,requestOwner);
          json(res, 200, { result });
        } catch (e) {
          json(res, 400, { error: require("./errors.cjs").publicMessage(e) });
        }
        return;
      }
      json(res, 404, { error: "모바일 경로를 찾을 수 없습니다." });
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/style.css": "style.css",
      "/sw.js": "sw.js",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/icon.png": "../../assets/flowrium.png",
    };
    const name = files[u.pathname];
    if (!name) {
      res.writeHead(404).end();
      return;
    }
    try {
      const content = await fs.readFile(path.join(__dirname, "mobile", name));
      res.writeHead(200, {
        "Content-Type": name.endsWith(".html")
          ? "text/html; charset=utf-8"
          : name.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : name.endsWith(".png") ? "image/png" : name.endsWith(".webmanifest") ? "application/manifest+json" : "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(content);
    } catch {
      res.writeHead(503).end("모바일 화면을 준비하고 있습니다.");
    }
  }
  async function stop() {
    sequence++;
    const child = tunnel;
    const active = server;
    tunnel = null;
    server = null;
    key = null;
    connectionOwner = "";
    publicOrigin = undefined;
    onContextChanged();
    status = "";
    running.clear();
    approvals.clear();
    answeredInputs.clear();
    handoffs.clear();
    const closed = active
      ? new Promise((resolve) => {
          active.closeAllConnections();
          active.close(resolve);
        })
      : Promise.resolve();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
    await closed;
    return state();
  }
  register("remoteAccess", () => state());
  register("stopRemoteAccess", stop);
  register("startRemoteAccess", async () => {
    if (server && connectionOwner !== String(accountRevision())) await stop();
    if (server) return state();
    if (!controller.status.authenticated)
      throw Error("먼저 이 컴퓨터에서 ChatGPT 계정을 연결해 주세요.");
    const attempt = ++sequence;
    connectionOwner = String(accountRevision());
    key = randomBytes(32).toString("base64url");
    onContextChanged();
    server = http.createServer((req, res) =>
      handle(req, res).catch(() => {
        if (!res.headersSent)
          json(res, 500, { error: "모바일 요청을 처리하지 못했습니다." });
        else res.end();
      }),
    );
    const ownServer = server;
    try {
      await new Promise((resolve, reject) => {
        ownServer.once("error", reject);
        ownServer.listen(0, "127.0.0.1", resolve);
      });
      if (attempt !== sequence || server !== ownServer) {
        ownServer.close();
        throw Error("휴대폰 연결 준비가 취소됐습니다.");
      }
      for (const run of controller.runs.values()) running.add(run.sessionId);
      let command = "cloudflared",
        env = { ...process.env };
      try {
        const runtime = require("./runtime.cjs");
        env = runtime.runtimeEnvironment();
        const paths = runtime.runtimePaths();
        if (paths.cloudflared) command = paths.cloudflared;
      } catch {}
      tunnel = tunnelFactory(
        command,
        [
          "tunnel",
          "--url",
          "http://127.0.0.1:" + server.address().port,
          "--no-autoupdate",
        ],
        { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const spawned = tunnel;
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(
                "HTTPS 터널을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.",
              ),
            ),
          35000,
        );
        let output = "";
        let candidate;
        let connected = false;
        const line = (chunk) => {
          output = (output + chunk.toString()).slice(-16000);
          const match = output.match(
            /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
          );
          if (match) candidate = match[0];
          if (output.includes("Registered tunnel connection")) connected = true;
          if (
            candidate &&
            connected &&
            attempt === sequence &&
            tunnel === spawned &&
            server === ownServer
          ) {
            publicOrigin = candidate;
            clearTimeout(timer);
            resolve();
          }
        };
        spawned.stdout.on("data", line);
        spawned.stderr.on("data", line);
        spawned.once("error", () => {
          clearTimeout(timer);
          reject(
            Error(
              "cloudflared 실행 파일을 찾지 못했습니다. 공식 cloudflared를 설치한 뒤 다시 시도해 주세요.",
            ),
          );
        });
        spawned.once("exit", () => {
          clearTimeout(timer);
          if (tunnel === spawned) {
            publicOrigin = undefined;
            onContextChanged();
            status =
              "휴대폰 연결이 끊겼습니다. 연결을 종료한 뒤 다시 켜 주세요.";
          }
          reject(Error("HTTPS 터널이 종료됐습니다."));
        });
      });
      await ready;
      if (attempt !== sequence || server !== ownServer)
        throw Error("휴대폰 연결이 취소됐습니다.");
      checkScope(scopeId(),connectionOwner);
      ownServer.unref();
      return state();
    } catch (e) {
      if (attempt === sequence) await stop();
      else ownServer.close();
      throw e;
    }
  });
  controller.on("event", update);
  return {
    stopAccess: stop,
    state,
    getLink: state,
    pushContext: () => ({enabled:!!server?.listening && !!publicOrigin && !isLocked() && connectionOwner === String(accountRevision()),origin:publicOrigin,scopeId:scopeId()}),
    issueLink: ({ttlMinutes=15}={}) => {
      const scope=scopeId(),owner=String(accountRevision());checkScope(scope,owner);
      if(!publicOrigin)throw Error("휴대폰 HTTPS 연결을 먼저 켜 주세요.");
      if(![5,15,60].includes(ttlMinutes))throw Error("연결 유효 시간은 5분 / 15분 / 60분 중에서 고르세요.");
      for(const [id,record]of handoffs)if(record.expiresAt<=now())handoffs.delete(id);
      if(handoffs.size>=100)throw Error("사용하지 않은 연결 주소가 많습니다. 잠시 후 다시 시도하세요.");
      const nonce=randomBytes(32).toString("base64url"),expiresAt=now()+ttlMinutes*60000;
      handoffs.set(createHash("sha256").update(nonce).digest("hex"),{scopeId:scope,owner,expiresAt});
      return {url:publicOrigin+"/#handoff="+nonce,expiresAt,scopeId:scope};
    },
    shutdown: async () => {
      controller.off("event", update);
      await stop();
    },
  };
}
module.exports = { registerRemote };
