const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  { spawn } = require("node:child_process"),
  { randomBytes, timingSafeEqual } = require("node:crypto");
const allowed = new Set([
  "startWork",
  "send",
  "interrupt",
  "readTeams",
  "openTeamNode",
  "updateWork",
  "approval",
  "readWorkbench",
  "readWorkArtifact",
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
  },
) {
  let sequence = 0;
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
    if (event.type === "approval") approvals.set(event.requestId, event);
    if (event.type === "done") {
      running.delete(event.sessionId);
      for (const [id, a] of approvals)
        if (a.sessionId === event.sessionId) approvals.delete(id);
    }
    if (event.type === "status" && event.sessionId)
      running.add(event.sessionId);
  }
  function authorized(req) {
    if (!key || !server?.listening) return false;
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
      if (u.pathname === "/api/mobile/state" && req.method === "GET") {
        try {
          const value = await guard("bootstrap", async () => {
            const snapshot = store.state,
              connection = await controller.connectionStatus();
            const pending = handlers.get("securityPending");
            const requests = pending
              ? await pending()
              : [...approvals.values()];
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
              connection: {
                available: connection.available,
                authenticated: connection.authenticated,
                accountLabel: connection.accountLabel,
              },
              running: [...controller.runs.keys()],
              approvals: requests,
            };
          });
          if (isLocked()) {
            json(res, 403, {
              locked: true,
              error: "데스크톱 Flowrium이 잠겨 있습니다.",
            });
            return;
          }
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
          const chunks = [];
          let total = 0;
          for await (const chunk of req) {
            total += chunk.length;
            if (total > 2 * 1024 * 1024)
              throw Error("요청 크기가 너무 큽니다.");
            chunks.push(chunk);
          }
          const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (
            !allowed.has(input.method) ||
            !Array.isArray(input.args) ||
            input.args.length > 4
          )
            throw Error("지원하지 않는 모바일 작업입니다.");
          if (isLocked()) throw Error("데스크톱 Flowrium이 잠겨 있습니다.");
          const handler = handlers.get(input.method);
          if (!handler)
            throw Error("이 앱 버전에서 사용할 수 없는 작업입니다.");
          if (input.method === "approval") {
            const id = input.args[0]?.requestId;
            const pending = handlers.get("securityPending");
            const requests = pending
              ? await pending()
              : [...approvals.values()];
            if (!requests.some((v) => v.requestId === id))
              throw Error("이 승인 요청은 이미 처리됐습니다.");
            const result = await handler(...input.args);
            approvals.delete(id);
            json(res, 200, { result });
            return;
          }
          const result = await guard(input.method, () =>
            handler(...input.args),
          );
          if (isLocked()) throw Error("데스크톱 Flowrium이 잠겨 있습니다.");
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
            : "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
    publicOrigin = undefined;
    status = "";
    running.clear();
    approvals.clear();
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
    if (server) return state();
    if (!controller.status.authenticated)
      throw Error("먼저 이 컴퓨터에서 ChatGPT 계정을 연결해 주세요.");
    const attempt = ++sequence;
    key = randomBytes(32).toString("base64url");
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
        const line = (chunk) => {
          const match = chunk
            .toString()
            .match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (
            match &&
            attempt === sequence &&
            tunnel === spawned &&
            server === ownServer
          ) {
            publicOrigin = match[0];
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
            status =
              "휴대폰 연결이 끊겼습니다. 연결을 종료한 뒤 다시 켜 주세요.";
          }
          reject(Error("HTTPS 터널이 종료됐습니다."));
        });
      });
      await ready;
      if (attempt !== sequence || server !== ownServer)
        throw Error("휴대폰 연결이 취소됐습니다.");
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
    shutdown: async () => {
      controller.off("event", update);
      await stop();
    },
  };
}
module.exports = { registerRemote };
