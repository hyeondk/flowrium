"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const vitePath = path.join(
  path.dirname(require.resolve("vite/package.json")),
  "bin",
  "vite.js",
);
const port = 5173;
const url = `http://127.0.0.1:${port}`;
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
let electron;
let closing = false;
let serverReady = false;
let serverOutput = "";
const vite = spawn(
  process.execPath,
  [vitePath, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["inherit", "pipe", "inherit"], env: environment },
);
vite.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  serverOutput = `${serverOutput}${chunk}`.slice(-8192);
  serverReady = serverOutput.includes(`${url}/`);
});

function close(code = 0) {
  if (closing) return;
  closing = true;
  vite.kill();
  electron?.kill();
  process.exitCode = code;
}

vite.on("error", (error) => {
  console.error(`개발 서버를 시작하지 못했습니다: ${error.message}`);
  close(1);
});
vite.on("exit", (code) => {
  if (!closing) close(code || 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => close());

(async () => {
  for (let attempt = 0; attempt < 100 && !closing; attempt += 1) {
    try {
      const response = serverReady
        ? await fetch(url, { signal: AbortSignal.timeout(500) })
        : null;
      if (response?.ok) {
        if (closing) return;
        electron = spawn(require("electron"), [root], {
          cwd: root,
          stdio: "inherit",
          env: { ...environment, ELECTRON_RENDERER_URL: url },
        });
        electron.on("error", (error) => {
          console.error(`Flowrium을 시작하지 못했습니다: ${error.message}`);
          close(1);
        });
        electron.on("exit", (code) => close(code || 0));
        return;
      }
    } catch {
      /* 서버 준비를 기다립니다. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!closing) {
    console.error("개발 서버가 제한 시간 안에 준비되지 않았습니다.");
    close(1);
  }
})();
