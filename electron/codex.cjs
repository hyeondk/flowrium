const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");

async function isFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
async function resolveCodex(configured, options = {}) {
  if (configured && !(await isFile(configured)))
    throw new Error(
      "지정한 Codex 실행 파일을 찾지 못했습니다. 설정에서 경로를 확인해 주세요.",
    );
  const platform = options.platform || process.platform;
  const resources = options.resourcesPath || process.resourcesPath || "";
  const nativeName = platform === "win32" ? "codex.exe" : "codex";
  const candidates = [];
  if (configured) candidates.push(configured);
  if (resources) candidates.push(path.join(resources, "codex", nativeName));
  try {
    const architecture = options.arch || process.arch;
    const triple = {
      "darwin-arm64": "aarch64-apple-darwin",
      "win32-x64": "x86_64-pc-windows-msvc",
      "win32-arm64": "aarch64-pc-windows-msvc",
      "linux-x64": "x86_64-unknown-linux-musl",
      "linux-arm64": "aarch64-unknown-linux-musl",
    }[`${platform}-${architecture}`];
    const packageFile = require.resolve(
      `@openai/codex-${platform}-${architecture}/package.json`,
    );
    const native = path
      .join(
        path.dirname(packageFile),
        "vendor",
        triple || "",
        "bin",
        nativeName,
      )
      .replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`,
      );
    if (await isFile(native)) candidates.push(native);
  } catch {
    /* Fall back to an installed executable or the npm entry point. */
  }
  if (platform === "darwin")
    candidates.push(
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    );
  for (const dir of (process.env.PATH || "").split(path.delimiter))
    if (dir)
      candidates.push(path.join(dir, nativeName), path.join(dir, "codex.cmd"));
  candidates.push(path.join(os.homedir(), ".local", "bin", nativeName));
  for (const candidate of candidates) {
    if (!(await isFile(candidate))) continue;
    if (/\.(?:cmd|bat)$/i.test(candidate)) {
      const js = path.join(
        path.dirname(candidate),
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js",
      );
      if (await isFile(js))
        return {
          command: options.nodePath || process.execPath,
          prefix: [js],
          label: candidate,
          node: true,
        };
      if (configured === candidate)
        throw new Error(
          "명령 실행기 대신 codex.exe 또는 설치 폴더의 codex.js를 지정해 주세요.",
        );
      continue;
    }
    if (/\.[cm]?js$/i.test(candidate))
      return {
        command: options.nodePath || process.execPath,
        prefix: [candidate],
        label: candidate,
        node: true,
      };
    return { command: candidate, prefix: [], label: candidate, node: false };
  }
  // The npm package locates its native executable for the current operating system.
  try {
    const js = require.resolve("@openai/codex/bin/codex.js");
    const unpacked = js.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`,
    );
    const target = (await isFile(unpacked)) ? unpacked : js;
    return {
      command: options.nodePath || process.execPath,
      prefix: [target],
      label: "Flowrium 내장 Codex",
      node: true,
    };
  } catch {
    return null;
  }
}

class CodexClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.proc = null;
    this.pending = new Map();
    this.approvals = new Map();
    this.inputs = new Map();
    this.tools = new Map();
    this.counter = 0;
    this.starting = null;
    this.ready = false;
    this.intentionalClose = false;
    this.descriptor = null;
  }
  async start(configured) {
    if (this.ready && this.proc) return;
    if (this.starting) return this.starting;
    this.starting = this._start(configured).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async _start(configured) {
    const descriptor =
      this.options.descriptor || (await resolveCodex(configured, this.options));
    if (!descriptor)
      throw new Error(
        "Codex 실행 파일을 찾지 못했습니다. 설정에서 실행 파일 경로를 지정하거나 Codex를 설치해 주세요.",
      );
    this.descriptor = descriptor;
    this.intentionalClose = false;
    const env = {
      ...process.env,
      ...(descriptor.node ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    };
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    delete env.OPENAI_BASE_URL;
    const proc = (this.options.spawn || spawn)(
      descriptor.command,
      [...descriptor.prefix, "app-server", "-c", 'model_provider="openai"', "-c", "features.default_mode_request_user_input=true",...Object.entries(this.options.configOverrides||{}).flatMap(([key,value])=>["-c",key+"="+JSON.stringify(value)])],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, env },
    );
    this.proc = proc;
    let buffer = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) {
        this._fail(new Error("Codex 응답 크기가 허용 범위를 초과했습니다."));
        proc.kill();
        return;
      }
      for (;;) {
        const end = buffer.indexOf("\n");
        if (end < 0) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          this._message(JSON.parse(line));
        } catch {
          /* Ignore non-protocol startup output. */
        }
      }
    });
    // Drain diagnostics without persisting credentials or verbose logs.
    proc.stderr.on("data", () => {});
    proc.stdin.on("error", () => {});
    proc.once("error", (error) => {
      if (this.proc === proc)
        this._fail(new Error(`Codex를 실행하지 못했습니다. ${error.message}`));
    });
    proc.once("exit", (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.ready = false;
      this._fail(
        new Error(
          this.intentionalClose
            ? "Codex 연결을 종료했습니다."
            : `Codex 연결이 종료됐습니다. 종료 상태: ${code ?? signal ?? "알 수 없음"}`,
        ),
      );
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "flowrium", title: "Flowrium", version: require("../package.json").version },
        capabilities: {experimentalApi:true},
      });
      this.notify("initialized");
      this.ready = true;
    } catch (error) {
      proc.kill();
      throw error;
    }
  }
  _fail(error) {
    this.ready = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.approvals.clear();
    this.inputs.clear();
    this.tools.clear();
    this.emit("disconnect", error);
  }
  _write(message) {
    if (!this.proc || this.proc.stdin.destroyed || !this.proc.stdin.writable)
      throw new Error("Codex 연결이 없습니다. 다시 연결해 주세요.");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method, params = {}, timeout = 30_000) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex 요청 시간이 초과됐습니다. (${method})`);
        error.code = "RPC_TIMEOUT";
        reject(error);
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method, params = {}) {
    this._write({ method, params });
  }
  _message(message) {
    if (!message || typeof message !== "object") return;
    if ("id" in message && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const error = new Error(
          `Codex 요청을 처리하지 못했습니다. ${message.error.message || "알 수 없는 오류"}`,
        );
        error.rpcCode = message.error.code;
        error.rpcMessage = message.error.message;
        pending.reject(error);
      } else pending.resolve(message.result || {});
      return;
    }
    if (message.method && "id" in message) {
      if(message.method === "item/tool/call") {
        const requestId=randomUUID(); this.tools.set(requestId,message);
        this.emit("tool",{requestId,params:message.params||{}});return;
      }
      if (message.method === "item/tool/requestUserInput") {
        let params;
        try { params = require("./input-request.cjs").questionParams(message.params); }
        catch (error) { this._write({ id:message.id,error:{code:-32602,message:error.message} }); return; }
        const requestId = randomUUID();
        this.inputs.set(requestId,{ id:message.id,params });
        this.emit("input", { requestId, params });
        return;
      }
      const supported = [
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
        "execCommandApproval",
        "applyPatchApproval",
      ];
      if (!supported.includes(message.method)) {
        this._write({
          id: message.id,
          error: {
            code: -32601,
            message: "이 입력 방식은 Flowrium에서 지원하지 않습니다.",
          },
        });
        this.emit("unsupported", message);
        return;
      }
      const requestId = randomUUID();
      this.approvals.set(requestId, message);
      this.emit("approval", {
        requestId,
        method: message.method,
        params: message.params || {},
      });
      return;
    }
    if (message.method) this.emit("notification", message);
  }
  answerTool(requestId,result) {
    const request=this.tools.get(requestId);if(!request)return;
    this.tools.delete(requestId);
    if(this.ready)this._write({id:request.id,result});
  }
  resolveInput(requestId, cancelled = false) {
    const request = this.inputs.get(requestId);
    if (!request) return;
    try {
      if (cancelled && this.ready) this._write({id:request.id,error:{code:-32800,message:"입력 요청이 종료됐습니다."}});
    } finally {
      this.inputs.delete(requestId);
      this.emit("inputResolved",{requestId,threadId:request.params.threadId});
    }
  }
  answerInput(requestId, answers) {
    const request = this.inputs.get(requestId);
    if (!request) throw new Error("이 질문은 이미 종료됐습니다.");
    const result = require("./input-request.cjs").responseFor(request.params.questions,answers);
    this._write({id:request.id,result});
    this.resolveInput(requestId);
  }
  decide(requestId, decision) {
    const request = this.approvals.get(requestId);
    if (!request) throw new Error("이 승인 요청은 이미 종료됐습니다.");
    const accepted = decision === "accept";
    let result = { decision: accepted ? "accept" : "decline" };
    if (request.method === "item/permissions/requestApproval")
      result = {
        permissions: accepted ? request.params?.permissions || {} : {},
        scope: "turn",
      };
    if (
      request.method === "execCommandApproval" ||
      request.method === "applyPatchApproval"
    )
      result = { decision: accepted ? "approved" : "denied" };
    this._write({ id: request.id, result });
    this.approvals.delete(requestId);
  }
  close() {
    this.intentionalClose = true;
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      this._fail(new Error("Codex 연결을 종료했습니다."));
      proc.stdin.end();
      const timer = setTimeout(() => {
        if (proc.exitCode === null) proc.kill();
      }, 1500);
      timer.unref();
    }
  }
}
module.exports = { CodexClient, resolveCodex };
