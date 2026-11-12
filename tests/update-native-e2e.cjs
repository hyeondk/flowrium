// 공개 앱의 설치 경로와 충돌하지 않도록 정상 교체 검증은 일회용 호스팅 러너에서 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { DesktopUpdater, artifactSuffix } = require('../electron/updater.cjs');
const run = promisify(execFile);
const version = require('../package.json').version;
const previous = '0.1.2';
const fixture = process.argv.includes('--unsigned-fixture');
const unsigned = fixture || process.argv.includes('--expect-unsigned');
const mac = process.platform === 'darwin';
const powershell = (script, env = {}) => run('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { env: { ...process.env, ...env }, timeout: 240000 });

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function macFixture(bundle, fixtureVersion) {
  const contents = path.join(bundle, 'Contents');
  const bin = path.join(contents, 'MacOS', 'Flowrium');
  await fs.mkdir(path.dirname(bin), { recursive: true });
  await fs.copyFile('/bin/sleep', bin);
  await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.hyeondk.flowrium</string>
<key>CFBundleShortVersionString</key><string>${fixtureVersion}</string>
<key>CFBundleVersion</key><string>${fixtureVersion}</string>
<key>CFBundleExecutable</key><string>Flowrium</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  return bin;
}
async function installPreviousWindows(folder) {
  const url = 'https://github.com/hyeondk/flowrium/releases/download/v0.1.2/Flowrium-0.1.2-win-x64.exe';
  const previousHash = 'ff7b59fc1a309a0906b5335cec606bd6ea2450ab9ba54ea641ac16cbbc064ddf';
  const file = path.join(path.dirname(folder), 'previous-installer.exe');
  const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
  assert.ok(response.ok, '이전 공개 설치 파일 다운로드 실패');
  await pipeline(response.body, createWriteStream(file, { flags: 'wx' }));
  assert.equal(await digest(file), previousHash);
  await powershell(`$ErrorActionPreference = 'Stop'
    $installer = Start-Process -FilePath $env:INSTALLER -ArgumentList ('/S /currentuser /D=' + $env:FOLDER) -PassThru -Wait
    if ($installer.ExitCode -ne 0) { exit $installer.ExitCode }`, { INSTALLER: file, FOLDER: folder });
  const binary = path.join(folder, 'Flowrium.exe');
  assert.equal((await powershell('[Diagnostics.FileVersionInfo]::GetVersionInfo($env:BINARY).ProductVersion',
    { BINARY: binary })).stdout.trim().split(/[+ ]/)[0].split('.').slice(0, 3).join('.'), previous);
  return binary;
}
async function processIds(executable) {
  if (mac) {
    const output = (await run('/bin/ps', ['-axo', 'pid=,comm='])).stdout;
    return output.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      return match && match[2] === executable ? [Number(match[1])] : [];
    });
  }
  const { stdout } = await powershell(`Get-Process -Name Flowrium -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $env:BINARY -and $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id }
    exit 0`, { BINARY: executable });
  return stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}
async function waitFor(operation, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await operation();
    if (value) return value;
    await delay(500);
  }
  throw new Error(message);
}
async function main() {
  const suffix = artifactSuffix(process.platform, process.arch);
  assert.ok(suffix, '지원되는 운영체제와 아키텍처에서 실행해 주세요.');
  if (unsigned) assert.ok(mac, '임시 서명 거절 검증은 macOS 전용입니다.');
  else assert.ok(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
    '실제 설치 및 재실행은 격리된 GitHub 호스팅 러너에서 실행합니다.');
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-native-update-')));
  const installed = path.join(temporary, 'installed apps', mac ? 'Flowrium.app' : 'Flowrium');
  const userData = path.join(temporary, 'profile');
  const assetName = 'Flowrium-' + version + '-' + suffix;
  let binary, oldProcess, restartedPid;
  try {
    await fs.mkdir(path.dirname(installed), { recursive: true });
    const file = fixture ? path.join(temporary, assetName) : path.resolve('release', assetName);
    if (fixture) {
      const source = path.join(temporary, 'new', 'Flowrium.app');
      await macFixture(source, version);
      await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', source, file]);
    }
    const sha = await digest(file);
    const size = (await fs.stat(file)).size;
    const url = 'https://github.com/hyeondk/flowrium/releases/download/v' + version + '/';
    const sums = Buffer.from(sha + '  ' + assetName + '\n');
    const manifest = { tag_name: 'v' + version, draft: false, prerelease: false,
      assets: [[assetName, size, sha], ['SHA256SUMS.txt', sums.length, createHash('sha256').update(sums).digest('hex')]]
        .map(([name, size, hash]) => ({ name, size, digest: 'sha256:' + hash, browser_download_url: url + name })) };
    binary = mac ? await macFixture(installed, previous) : await installPreviousWindows(installed);
    const before = await digest(binary);
    oldProcess = spawn(binary, mac ? ['300'] : [], { stdio: 'ignore' });
    await new Promise((resolve, reject) => { oldProcess.once('spawn', resolve); oldProcess.once('error', reject); });
    if (!mac) await waitFor(async () => (await processIds(binary)).includes(oldProcess.pid),
      90000, '이전 설치 버전의 창이 열리지 않았습니다.');
    const updater = new DesktopUpdater({
      app: { isPackaged: true, getPath: () => userData, getVersion: () => previous,
        quit: () => {
          if (mac) oldProcess.kill();
          else void powershell('(Get-Process -Id ([int]$env:OLD_PID)).CloseMainWindow()', { OLD_PID: String(oldProcess.pid) })
            .catch(() => oldProcess.kill());
        } },
      parentPid: oldProcess.pid, execPath: binary,
      fetchImpl: async (target) => {
        if (target === url + 'SHA256SUMS.txt') return new Response(sums);
        if (target === url + assetName) return new Response(createReadStream(file));
        assert.equal(target, 'https://api.github.com/repos/hyeondk/flowrium/releases/latest');
        return Response.json(manifest);
      },
    });
    assert.equal((await updater.check()).status, 'available');
    const result = await updater.install();
    if (unsigned) {
      assert.equal(result.status, 'error');
      assert.match(result.message, /Developer ID/);
      assert.equal(await digest(binary), before);
      assert.equal(oldProcess.exitCode, null);
      assert.equal(oldProcess.signalCode, null);
      assert.equal((await fs.readdir(path.dirname(installed))).some((s) => s.startsWith('.flowrium-update-')), false);
      console.log('임시 서명 ZIP 차단 / 기존 설치 및 실행 프로세스 보존 확인');
      return;
    }
    assert.equal(result.status, 'installing', result.message);
    restartedPid = await waitFor(async () => {
      const ids = await processIds(binary);
      return ids.find((pid) => pid !== oldProcess.pid);
    }, 180000, '업데이트 이후 새 앱 프로세스가 실행되지 않았습니다.');
    const actual = mac ? (await run('/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents', 'Info.plist')])).stdout.trim() :
      (await powershell('[Diagnostics.FileVersionInfo]::GetVersionInfo($env:BINARY).ProductVersion',
        { BINARY: binary })).stdout.trim().split(/[+ ]/)[0].split('.').slice(0, 3).join('.');
    assert.equal(actual, version);
    await waitFor(async () => !(await fs.readdir(mac ? path.dirname(installed) : path.join(userData, 'updates')))
      .some((entry) => entry.startsWith('.flowrium-update-')), 15000, '설치 임시 파일 정리가 완료되지 않았습니다.');
    console.log('실제 설치 파일 교체 / 새 버전 재실행 확인', previous, '→', actual);
  } finally {
    if (restartedPid) {
      if (mac) process.kill(restartedPid, 'SIGTERM');
      else await run('taskkill.exe', ['/PID', String(restartedPid), '/T', '/F']).catch(() => {});
    }
    if (oldProcess && oldProcess.exitCode === null && oldProcess.signalCode === null) oldProcess.kill();
    if (!mac && binary) {
      const uninstaller = path.join(installed, 'Uninstall Flowrium.exe');
      await powershell(`if (Test-Path -LiteralPath $env:UNINSTALLER) {
        Start-Process -FilePath $env:UNINSTALLER -ArgumentList '/S /currentuser' -Wait
      }`, { UNINSTALLER: uninstaller }).catch(() => {});
    }
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
