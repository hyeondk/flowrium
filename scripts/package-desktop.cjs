const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const UNSAFE_SHELL_PATH = /[\0\r\n"'`$;&|<>]/;

function selectPlatform(args, host = process.platform) {
  if (args.length > 1 || args.some((arg) => !["--mac", "--win"].includes(arg)))
    throw new Error("사용법: node scripts/package-desktop.cjs [--mac | --win]");
  const platform =
    args[0] ||
    (host === "darwin" ? "--mac" : host === "win32" ? "--win" : null);
  if (
    !platform ||
    (platform === "--mac" ? host !== "darwin" : host !== "win32")
  )
    throw new Error(
      "Mac 설치 파일은 Mac에서, Windows 설치 파일은 Windows에서 만들어 주세요.",
    );
  return platform;
}

function hasMacSigningKey(config, env = process.env) {
  if (
    env.CSC_LINK?.trim() ||
    env.CSC_NAME?.trim() ||
    (typeof config.mac?.identity === "string" &&
      config.mac.identity.trim() &&
      config.mac.identity !== "-")
  )
    return true;
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === "false") return false;
  const result = spawnSync(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8", timeout: 5000, windowsHide: true },
  );
  return (
    result.status === 0 &&
    /"(?:Developer ID Application|Apple Development|Mac Developer|Apple Distribution|3rd Party Mac Developer Application):/.test(
      result.stdout || "",
    )
  );
}

function buildArguments(platform, architecture, output, adHoc = false) {
  if (
    !["arm64", "x64", "ia32"].includes(architecture) ||
    (platform === "--mac" && architecture === "ia32")
  )
    throw new Error("현재 컴퓨터의 아키텍처를 지원하지 않습니다.");
  if (!path.isAbsolute(output) || UNSAFE_SHELL_PATH.test(output))
    throw new Error(
      "임시 출력 경로에 지원하지 않는 문자가 있습니다. 운영체제의 임시 폴더 설정을 확인해 주세요.",
    );
  return [
    platform,
    `--${architecture}`,
    "--publish",
    "never",
    `--config.directories.output=${output}`,
    ...(adHoc
      ? ["--config.mac.identity=-", "--config.mac.hardenedRuntime=false"]
      : []),
  ];
}

function runBuilder(cli, args, projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    const interrupt = (signal) => child.kill(signal);
    const onInterrupt = () => interrupt("SIGINT");
    const onTerminate = () => interrupt("SIGTERM");
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    const cleanup = () => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0) resolve();
      else
        reject(
          new Error(
            signal
              ? "설치 파일 생성을 중단했습니다."
              : `설치 파일 생성에 실패했습니다. 종료 코드: ${code}`,
          ),
        );
    });
  });
}

async function moveArtifact(source, destination) {
  const staged = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, staged, fs.constants.COPYFILE_EXCL);
    await fs.rename(staged, destination);
    await fs.unlink(source);
  } finally {
    await fs.rm(staged, { force: true });
  }
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(
      "사용법: node scripts/package-desktop.cjs [--mac | --win]\n현재 운영체제와 아키텍처로 빌드하고 설치 파일을 release 폴더에 저장합니다.",
    );
    return;
  }
  const platform = selectPlatform(args);
  const projectRoot = path.resolve(__dirname, "..");
  const config =
    JSON.parse(
      await fs.readFile(path.join(projectRoot, "package.json"), "utf8"),
    ).build || {};
  const builderCli = require.resolve("electron-builder/cli.js", {
    paths: [projectRoot],
  });
  const temporaryParent = os.tmpdir();
  if (UNSAFE_SHELL_PATH.test(temporaryParent))
    throw new Error(
      "운영체제 임시 폴더 경로에 패키징 도구가 지원하지 않는 문자가 있습니다. TMPDIR 또는 TEMP를 일반 문자 경로로 설정한 뒤 다시 실행해 주세요.",
    );
  const temporary = await fs.mkdtemp(
    path.join(temporaryParent, "flowrium-package-"),
  );
  try {
    const output = path.join(temporary, "package");
    const adHoc = platform === "--mac" && !hasMacSigningKey(config);
    const builderArgs = buildArguments(platform, process.arch, output, adHoc);
    console.log(
      `Flowrium 설치 파일 생성 / ${platform === "--mac" ? "Mac" : "Windows"} / ${process.arch}`,
    );
    if (adHoc)
      console.log(
        "로컬 개발용 임시 서명을 사용합니다. 정식 배포용 서명과 공증은 별도로 설정해 주세요.",
      );
    await runBuilder(builderCli, builderArgs, projectRoot);
    const artifacts = (
      await fs.readdir(output, { withFileTypes: true })
    ).filter(
      (entry) =>
        entry.isFile() && /^Flowrium-.+\.(?:dmg|zip|exe)$/i.test(entry.name),
    );
    if (!artifacts.length)
      throw new Error("생성된 Flowrium 설치 파일을 찾지 못했습니다.");
    const release = path.join(projectRoot, "release");
    await fs.mkdir(release, { recursive: true });
    for (const artifact of artifacts) {
      await moveArtifact(
        path.join(output, artifact.name),
        path.join(release, artifact.name),
      );
      console.log(`저장 완료 / release/${artifact.name}`);
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  selectPlatform,
  hasMacSigningKey,
  buildArguments,
  moveArtifact,
};
