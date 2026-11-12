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
async function macFixture(bundle, fixtureVersion, exitImmediately = false) {
  const contents = path.join(bundle, 'Contents');
  const bin = path.join(contents, 'MacOS', 'Flowrium');
  await fs.mkdir(path.dirname(bin), { recursive: true });
  const source = path.join(path.dirname(bundle), 'fixture.c');
  // Apple 시스템 실행 파일을 복사해 다시 서명하면 macOS 버전과 CPU 하위 유형에 따라
  // 시작 단계에서 죽을 수 있다. 검증 러너 CPU에서 직접 만든 작은 앱을 사용한다.
  await fs.writeFile(source, `#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (${exitImmediately ? 1 : 0}) return 1;
  if (argc == 2 && !strcmp(argv[1], "--hold")) {
    puts("FLOWRIUM_FIXTURE_READY"); fflush(stdout);
    for (;;) pause();
  }
  return 0;
}`);
  try { await run('/usr/bin/cc', [source, '-o', bin]); }
  finally { await fs.rm(source, { force: true }); }
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
// 기동 즉시 종료되는 앱으로 교체 후 기존 번들이 복원되는지 실제 LaunchServices로 검증한다.
// 정식 업데이트의 서명/공증 검증은 아래 DesktopUpdater 경로에서 별도로 수행한다.
async function verifyMacRollback(temporary) {
  const root = path.join(temporary, '복원 검증');
  const installed = path.join(root, 'Flowrium.app');
  const stage = path.join(root, 'staging');
  const prepared = path.join(stage, 'new', 'Flowrium.app');
  await fs.mkdir(path.dirname(prepared), { recursive: true });
  const old = await macFixture(installed, '0.1.2');
  const before = await digest(old);
  await macFixture(prepared, version, true);
  const token = require('node:crypto').randomUUID();
  const receipt = path.join(root, 'receipt');
  const result = path.join(root, 'result');
  await fs.writeFile(receipt + '.json', '{}');
  await assert.rejects(run('/bin/sh', [path.join(__dirname, '..', 'electron', 'update-helpers', 'mac.sh'),
    '2147483647', stage, installed, prepared, result, token, receipt], { timeout: 150000 }),
    (err) => err.code === 1);
  assert.equal(await digest(old), before);
  assert.equal((await fs.readFile(result, 'utf8')).trim(), 'failed');
  for (const f of [stage, receipt + '.json']) await assert.rejects(fs.access(f), { code: 'ENOENT' });
  console.log('macOS 실행 요청 직후 종료된 새 앱 감지 / 기존 앱 복원 / 검증 자료 정리 확인');
}
// 확인 신호를 기록하는 최소 네이티브 앱을 통해 같은 교체 도우미의 성공 경로도 검사한다.
async function verifyMacReady(temporary) {
  const root = path.join(temporary, '준비 검증');
  const installed = path.join(root, 'Flowrium.app');
  const stage = path.join(root, 'staging');
  const prepared = path.join(stage, 'new', 'Flowrium.app');
  await fs.mkdir(path.dirname(prepared), { recursive: true });
  await macFixture(installed, previous);
  const executable = await macFixture(prepared, version);
  const receipt = path.join(root, 'receipt');
  const token = require('node:crypto').randomUUID();
  const source = path.join(root, 'ready.c');
  const stamp = path.join(root, 'started-pid');
  const marker = (file) => `f = fopen(${JSON.stringify(file)}, "w"); if (!f) return 3; fprintf(f,"%d",getpid()); fclose(f);`;
  await fs.writeFile(source, `#include <stdio.h>
#include <unistd.h>
#include <string.h>
int main(int argc, char** argv) {
  int valid=0; for(int i=1;i<argc;i++) if(!strcmp(argv[i],"--flowrium-update-token=${token}")) valid=1;
  if(!valid) return 2;
  FILE* f; ${marker(stamp)} ${marker(receipt + '.starting')} ${marker(receipt + '.ready')}
  sleep(8); return 0;
}`);
  await run('/usr/bin/cc', [source, '-o', executable]);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', prepared]);
  const expected = await digest(executable);
  await fs.writeFile(receipt + '.json', '{}');
  try {
    await run('/bin/sh', [path.join(__dirname, '..', 'electron', 'update-helpers', 'mac.sh'),
      '2147483647', stage, installed, prepared, path.join(root, 'result'), token, receipt], { timeout: 145000 });
    assert.equal(await digest(path.join(installed, 'Contents', 'MacOS', 'Flowrium')), expected);
    for (const f of [stage, receipt + '.json', receipt + '.ready', path.join(root, 'result')])
      await assert.rejects(fs.access(f), { code: 'ENOENT' });
  } finally {
    const pid = Number(await fs.readFile(stamp, 'utf8').catch(() => 0));
    if (pid > 0) {
      const command = await run('/bin/ps', ['-p', String(pid), '-o', 'command=']).catch(() => null);
      if (command?.stdout.includes('--flowrium-update-token=' + token)) process.kill(pid, 'SIGTERM');
    }
  }
  console.log('macOS 교체 도우미 / 실제 네이티브 프로세스의 준비 확인 후 이전 번들 정리 통과');
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
  const snapshot = await windowsSnapshot(executable);
  return snapshot.processes.filter(p => p.Path && path.relative(executable, p.Path) === '' && p.Window > 0)
    .map(p => Number(p.Id));
}
async function updateTrace(userData) {
  const file = path.join(userData, 'last-update-result.txt.log');
  const content = await fs.readFile(file, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e));
  return content.trim().split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; } // 다음 폴링에서 작성이 끝난 줄을 읽는다.
  });
}
async function windowsSnapshot(binary) {
  const code = `$p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match '^(Flowrium.*|smartscreen|consent)$' -or $_.MainWindowTitle -match 'Security Warning|Windows protected|Open File'
  } | Select-Object Id,ProcessName,Path,MainWindowTitle,@{Name='Window';Expression={$_.MainWindowHandle.ToInt64()}})
  $v = if (Test-Path -LiteralPath $env:BINARY) { [Diagnostics.FileVersionInfo]::GetVersionInfo($env:BINARY).ProductVersion }
  [pscustomobject]@{version=$v;target=$env:BINARY;processes=$p} | ConvertTo-Json -Depth 3 -Compress`;
  return JSON.parse((await powershell(code, { BINARY: binary })).stdout.trim());
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
  // Windows는 기존 앱과 새 앱의 동일한 임시 프로필 사용을 확인한다.
  // Mac 정식 번들의 기본 프로필 검증은 비어 있는 일회용 호스팅 러너에서만 실행한다.
  const userData = mac && !unsigned
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Flowrium') : path.join(temporary, 'profile');
  const assetName = 'Flowrium-' + version + '-' + suffix;
  let binary, oldProcess, oldPid, oldApp, quitRequest, restartedPid;
  try {
    if (mac) { await verifyMacRollback(temporary); await verifyMacReady(temporary); }
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
    if (mac) {
      oldProcess = spawn(binary, ['--hold'], { stdio: ['ignore','pipe','ignore'] });
      oldPid = oldProcess.pid;
      let ready = '';
      oldProcess.stdout.on('data', chunk => { ready += chunk.toString(); });
      let startError;
      oldProcess.once('error', error => { startError = error; });
      await waitFor(() => {
        if (startError) throw startError;
        assert.equal(oldProcess.exitCode, null); assert.equal(oldProcess.signalCode, null);
        return ready.includes('FLOWRIUM_FIXTURE_READY');
      }, 10000, '기존 검증 앱에서 기동 신호가 오지 않았습니다.');
    } else {
      const { _electron } = require('playwright');
      const env = { ...process.env, CODEX_HOME: path.join(temporary, 'codex') };
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
      oldApp = await _electron.launch({ executablePath: binary, args: ['--user-data-dir=' + userData], env, timeout: 60000 });
      oldProcess = oldApp.process();
      const oldWindow = await oldApp.firstWindow();
      await oldWindow.waitForLoadState('domcontentloaded');
      const old = await oldApp.evaluate(({ app, BrowserWindow }) => ({
        pid: process.pid, version: app.getVersion(), profile: app.getPath('userData'), exe: app.getPath('exe'),
        nativeWindow: BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.getNativeWindowHandle().some(Boolean)),
      }));
      assert.equal(old.version, previous);
      assert.equal(path.relative(userData, old.profile), '');
      assert.equal(path.relative(binary, old.exe), '');
      assert.equal(old.nativeWindow, true);
      oldPid = old.pid;
      console.log('이전 설치 및 실제 창 확인', previous, oldPid, binary, '/ 실행기', oldProcess.pid);
    }
    const updater = new DesktopUpdater({
      app: { isPackaged: true, getPath: () => userData, getVersion: () => previous,
        quit: () => {
          if (mac) oldProcess.kill();
          else quitRequest = oldApp.evaluate(({ app }) => {
            // 버튼으로 업데이트하는 현재 버전과 동일하게 Electron의 정상 종료를 요청한다.
            setTimeout(() => app.quit(), 50);
          });
        } },
      parentPid: oldPid, execPath: binary,
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
    if (!mac) {
      await quitRequest;
      await waitFor(() => oldProcess.exitCode !== null || oldProcess.signalCode !== null, 35000, '이전 Electron 프로세스가 정상 종료되지 않았습니다.');
      console.log('이전 프로세스 종료 확인', oldProcess.pid, oldProcess.exitCode);
      let printed = 0;
      const ready = await waitFor(async () => {
        const records = await updateTrace(userData);
        for (const record of records.slice(printed)) console.log('업데이트 도우미 /', record.step, JSON.stringify(record.detail));
        printed = records.length;
        const failure = records.find(r => r.step === 'failed');
        if (failure) throw new Error('업데이트 도우미 실패 / ' + JSON.stringify(failure.detail));
        return records.find(r => r.step === 'app-ready');
      }, 420000, '설치 또는 새 앱 준비 신호가 제한 시간 안에 도착하지 않았습니다.');
      restartedPid = ready.detail.appPid;
      assert.notEqual(restartedPid, oldPid);
      await waitFor(async () => (await processIds(binary)).includes(restartedPid), 30000, '준비 신호를 보낸 새 앱의 실제 창 확인 실패');
    } else {
      restartedPid = await waitFor(async () => (await processIds(binary)).find(pid => pid !== oldProcess.pid),
        180000, '업데이트 이후 새 앱 프로세스가 실행되지 않았습니다.');
    }
    const actual = mac ? (await run('/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', path.join(installed, 'Contents', 'Info.plist')])).stdout.trim() :
      (await powershell('[Diagnostics.FileVersionInfo]::GetVersionInfo($env:BINARY).ProductVersion',
        { BINARY: binary })).stdout.trim().split(/[+ ]/)[0].split('.').slice(0, 3).join('.');
    assert.equal(actual, version);
    await waitFor(async () => !(await fs.readdir(mac ? path.dirname(installed) : path.join(userData, 'updates')))
      .some((entry) => entry.startsWith('.flowrium-update-')), 15000, '설치 임시 파일 정리가 완료되지 않았습니다.');
    assert.equal(await fs.readFile(updater.resultPath, 'utf8').catch(e => e.code === 'ENOENT' ? '' : Promise.reject(e)), '',
      '업데이트 도우미가 새 앱 준비 실패를 기록했습니다.');
    await waitFor(async () => !(await fs.readdir(userData)).some(entry => entry.startsWith('.flowrium-launch-')),
      5000, '새 프로세스가 확인한 기동 티켓이 정리되지 않았습니다.');
    console.log('실제 설치 파일 교체 / 새 버전 재실행 확인', previous, '→', actual);
  } catch (error) {
    if (!mac && binary) {
      console.error('Windows 검증 실패 시점', JSON.stringify(await windowsSnapshot(binary).catch(e => ({ error: e.message }))));
      const records = await updateTrace(userData).catch(() => []);
      console.error('업데이트 전체 기록', JSON.stringify(records));
      // 실패한 일회용 러너에서 시험 도우미/복구 창이 정리 작업을 가로막지 않게 한다.
      const helper = records.find(r => r.step === 'helper-start')?.helperPid;
      if (helper) await run('taskkill.exe', ['/PID', String(helper), '/T', '/F']).catch(() => {});
    }
    throw error;
  } finally {
    if (restartedPid) {
      if (mac) process.kill(restartedPid, 'SIGTERM');
      else await run('taskkill.exe', ['/PID', String(restartedPid), '/T', '/F']).catch(() => {});
    }
    if (oldApp && oldProcess.exitCode === null && oldProcess.signalCode === null) await oldApp.close().catch(() => {});
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
