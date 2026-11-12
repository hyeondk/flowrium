"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const pkg = require("../package.json");

async function verifyFreshAccount(binary, profile) {
  const environment = { ...process.env, CODEX_HOME: profile };
  for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_ACCESS_TOKEN"])
    delete environment[name];
  const child = spawn(binary, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env: environment,
  });
  child.stderr.resume();
  const lines = readline.createInterface({ input: child.stdout });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("새 설치 계정 상태 확인 시간이 초과됐습니다.")),
        20000,
      );
      const finish = (error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      child.once("error", () =>
        finish(new Error("번들 Codex 앱 서버를 시작하지 못했습니다.")),
      );
      child.once("exit", () =>
        finish(new Error("계정 상태 확인 전에 앱 서버가 종료됐습니다.")),
      );
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.error && [1, 2].includes(message.id)) {
          finish(new Error("새 설치 계정 상태 조회가 실패했습니다."));
          return;
        }
        if (message.id === 1 && message.result) {
          child.stdin.write(
            `${JSON.stringify({ method: "initialized", params: {} })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({ id: 2, method: "account/read", params: { refreshToken: false } })}\n`,
          );
        }
        if (message.id === 2 && message.result) {
          if (message.result.account !== null)
            finish(new Error("새 설치 검증에 로그인된 계정이 감지됐습니다."));
          else finish();
        }
      });
      child.stdin.write(
        `${JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "flowrium_release_check", title: "Flowrium", version: pkg.version } } })}\n`,
      );
    });
    console.log(
      "독립 설치 확인 / 공식 앱 서버 초기화 정상 / ChatGPT 미로그인 상태",
    );
  } finally {
    lines.close();
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

(async () => {
  const platform = process.platform;
  const arch = process.arch;
  const targets = {
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const target = targets[`${platform}-${arch}`];
  if (!target)
    throw new Error(
      "Mac arm64 / Windows x64 실행기에서 검증해 주세요.",
    );
  const resources = process.argv[2] ? path.resolve(process.argv[2]) :
    path.resolve(process.platform === "darwin" ? "release/mac-arm64/Flowrium.app/Contents/Resources" : "release/win-unpacked/resources");
  if (!fs.existsSync(path.join(resources, "app.asar")))
    throw new Error(
      "검증할 앱 패키지를 찾지 못했습니다. 먼저 현재 운영체제용 패키지를 만들어 주세요.",
    );
  await require("./prepare-runtime.cjs").verifyRuntime(path.join(resources,"runtime"));
  const packageName = `codex-${platform}-${arch}`;
  const openai = path.join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "@openai",
  );
  const nativePackages = (await fsp.readdir(openai)).filter((name) =>
    /^codex-(?:darwin|win32|linux)-/.test(name),
  );
  if (nativePackages.length !== 1 || nativePackages[0] !== packageName)
    throw new Error(
      "대상과 다른 운영체제 또는 CPU의 Codex가 번들에 들어 있습니다.",
    );
  const binary = path.join(
    openai,
    packageName,
    "vendor",
    target,
    "bin",
    platform === "win32" ? "codex.exe" : "codex",
  );
  const version = spawnSync(binary, ["--version"], {
    shell: false,
    encoding: "utf8",
    timeout: 15000,
  });
  if (
    version.error ||
    version.status !== 0 ||
    version.stdout.trim() !== `codex-cli ${pkg.dependencies["@openai/codex"]}`
  )
    throw new Error(
      "번들 Codex 실행 파일의 실행 또는 버전 확인에 실패했습니다.",
    );
  const archive = path.join(resources, "app.asar");
  const files = asar
    .listPackage(archive)
    .map((file) => file.replaceAll("\\", "/"));
  const permittedRoots = new Set(["dist", "electron", "assets", "package.json", "node_modules"]);
  const unexpected = files.find(file => !permittedRoots.has(file.split("/")[1]));
  if (unexpected) throw new Error("실행에 필요 없는 파일이 패키지에 들어 있습니다. " + unexpected);
  const forbidden =
    /(?:^|\/)(?:\.flowrium|\.codex|\.env(?:\.[^/]*)?|auth\.json|config\.toml|deploy_key|workspace\.json)(?:\/|$)/i;
  if (files.some((file) => forbidden.test(file)))
    throw new Error(
      "패키지 안에 개인 인증 또는 프로젝트 기록 경로가 있습니다.",
    );
  for (const file of files.filter((name) =>
    /^\/(?:electron\/.*\.(?:cjs|js)|dist\/.*\.(?:html|css|js))$/.test(name),
  )) {
    const content = asar
      .extractFile(archive, path.normalize(file.replace(/^\/+/, "")))
      .toString("utf8");
    // Gmail's documented user alias is an API path, not a local account directory.
    const localPaths = content.replaceAll("https://gmail.googleapis.com/gmail/v1/users/me/", "");
    if (/\/Users\/[^/\s"']+\/|[A-Z]:\\\\?Users\\\\?[^\\\s"']+\\/i.test(localPaths))
      throw new Error("앱 소스 안에 특정 사용자의 절대 경로가 있습니다. / " + file);
  }
  console.log(
    `번들 검증 완료 / ${platform} / ${arch} / ${version.stdout.trim()} / 인증과 프로젝트 기록 파일 없음`,
  );
  const profile = await fsp.mkdtemp(path.join(require("node:os").tmpdir(), "flowrium-fresh-account-"));
  try {
    await verifyFreshAccount(binary, profile);
  } finally {
    await fsp.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
