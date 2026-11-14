const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const {newer,nativeVersion,displayVersion,parseReleaseTag}=require('./version.cjs');

const repository = 'https://github.com/hyeondk/flowrium';
const latest = 'https://api.github.com/repos/hyeondk/flowrium/releases/latest';
const apiHosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com',
  'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
const maxPackage = 2 * 1024 ** 3;
function errorText(error) {
  if (error?.name === 'TimeoutError') return '업데이트 서버 응답 시간이 초과됐습니다. 다시 시도해 주세요.';
  if (error?.name === 'AbortError') return '업데이트 다운로드를 중단했습니다.';
  if (error?.code === 'ENOSPC') return '업데이트를 위한 저장 공간이 부족합니다.';
  if (error?.code === 'EACCES' || error?.code === 'EROFS') return '설치 폴더에 쓸 수 없습니다. 앱의 설치 위치를 확인해 주세요.';
  if (error?.cmd) return '운영체제에서 업데이트 파일을 준비하지 못했습니다. 기존 앱에서 다시 시도해 주세요.';
  if (typeof error?.message === 'string' && /[가-힣]/.test(error.message)) return error.message;
  return '업데이트 정보를 읽지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
}

function artifactSuffix(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'mac-' + arch + '.zip';
  if (platform === 'win32' && arch === 'x64') return 'win-x64.exe';
  return null;
}
function selectRelease(data, current, suffix) {
  if (!data || data.draft !== false || data.prerelease !== false) return null;
  const version = parseReleaseTag(data.tag_name);
  if (!version || !newer(version,current)) return null;
  const filename = 'Flowrium-' + version + '-' + suffix;
  function pick(name, limit) {
    const matches = (data.assets || []).filter((item) => item.name === name);
    const expected = repository + '/releases/download/' + data.tag_name + '/' + name;
    if (matches.length !== 1 || matches[0].browser_download_url !== expected)
      throw new Error('이 버전의 설치 파일 또는 검증 목록이 아직 준비되지 않았습니다.');
    const { size, digest } = matches[0];
    if (!Number.isSafeInteger(size) || size <= 0 || size > limit)
      throw new Error('배포 파일 크기를 확인할 수 없습니다.');
    if (digest != null && !/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new Error('배포 파일의 검증 정보가 올바르지 않습니다.');
    return { name, size, url: expected, sha: digest?.slice(7) };
  }
  return { version, asset: pick(filename, maxPackage), sums: pick('SHA256SUMS.txt', 512 * 1024) };
}

async function request(fetchImpl, url, signal) {
  for (let step = 0; step < 6; step++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !apiHosts.has(target.hostname) || target.port ||
        target.username || target.password) throw new Error('허용되지 않은 업데이트 주소입니다.');
    const response = await fetchImpl(target.href, { redirect: 'manual', signal, headers: {
      'User-Agent': 'Flowrium-Updater', Accept: target.hostname === 'api.github.com' ?
        'application/vnd.github+json' : 'application/octet-stream' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) break;
    url = new URL(location, target).href;
  }
  throw new Error('업데이트 다운로드 주소를 확인하지 못했습니다.');
}
async function consume(response, limit, visit) {
  if (!response.ok || !response.body) throw new Error('GitHub 응답을 읽지 못했습니다 (' + response.status + ').');
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new Error('다운로드한 데이터가 예상 크기를 초과했습니다.');
    await visit(Buffer.from(chunk), bytes);
  }
  return bytes;
}
async function readSmall(response, limit) {
  const chunks = [];
  await consume(response, limit, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks);
}
function checksum(data, name) {
  const matches = data.split(/\r?\n/).map((line) => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line))
    .filter((match) => match && match[2] === name);
  if (matches.length !== 1) throw new Error('설치 파일의 SHA-256 검증값을 확인할 수 없습니다.');
  return matches[0][1].toLowerCase();
}

async function installLocation(platform, execPath) {
  if (platform === 'darwin') {
    const bundle = path.resolve(path.dirname(execPath), '../..');
    if (path.basename(bundle) !== 'Flowrium.app' || /\/AppTranslocation\//.test(bundle)) {
      throw new Error('Flowrium을 응용 프로그램 폴더에 복사한 뒤 다시 실행해 주세요.');
    }
    return bundle;
  }
  if (platform === 'win32' && path.basename(execPath).toLowerCase() === 'flowrium.exe') return execPath;
  throw new Error('설치한 Flowrium에서 업데이트할 수 있습니다.');
}
async function makeStage(platform, target, userData) {
  const base = platform === 'darwin' ? path.dirname(target) : path.join(userData, 'updates');
  if (platform !== 'darwin') await fs.mkdir(base, { recursive: true, mode: 0o700 });
  try {
    return await fs.mkdtemp(path.join(base, '.flowrium-update-'));
  } catch {
    throw new Error('설치 폴더에 쓸 수 없습니다. 쓰기 가능한 폴더에 Flowrium을 설치한 뒤 다시 시도해 주세요.');
  }
}
async function prepareMac(file, stage, version, target, signal) {
  const unpacked = path.join(stage, 'unpacked');
  await fs.mkdir(unpacked);
  await execute('/usr/bin/ditto', ['-x', '-k', file, unpacked], { signal });
  const bundle = path.join(unpacked, 'Flowrium.app');
  if (!(await fs.lstat(bundle)).isDirectory()) throw new Error('설치 파일에서 Flowrium 앱을 찾을 수 없습니다.');
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const value = async (key) => (await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist])).stdout.trim();
  if (await value('CFBundleIdentifier') !== 'io.github.hyeondk.flowrium' ||
      await value('CFBundleShortVersionString') !== nativeVersion(version) || await value('CFBundleExecutable') !== 'Flowrium')
    throw new Error('업데이트의 앱 식별자 또는 버전이 올바르지 않습니다.');
  const { stdout: format } = await execute('/usr/bin/file', ['-b', path.join(bundle, 'Contents', 'MacOS', 'Flowrium')]);
  if (!/Mach-O.*\barm64(?:e)?\b/.test(format)) throw new Error('Apple Silicon용 실행 파일을 찾을 수 없습니다.');
  try {
    const developerID = '=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists';
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement', developerID, bundle]);
    const assessment = await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle]);
    if (!/^source=Notarized Developer ID$/m.test(assessment.stderr)) throw new Error('공증 확인 실패');
  } catch {
    throw new Error('macOS에서 새 앱의 Developer ID 서명과 Apple 공증을 확인하지 못했습니다. 기존 앱을 계속 사용할 수 있습니다.');
  }
  const team = async (app) => (await execute('/usr/bin/codesign', ['-dv', '--verbose=4', app]))
    .stderr.match(/^TeamIdentifier=([A-Z0-9]{10})$/m)?.[1];
  const previousTeam = await team(target);
  if (previousTeam && await team(bundle) !== previousTeam)
    throw new Error('새 버전의 앱 서명자가 기존 설치와 일치하지 않습니다.');
  await fs.unlink(file);
  return bundle;
}
const launchFlag = '--flowrium-update-token=';
const launchToken = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const launchAcknowledgements = new Map();
function receiptBase(userData, token) {
  return path.join(userData, '.flowrium-launch-' + token);
}
// 새 프로세스가 기존 앱에서 발행한 티켓과 같은 설치본일 때만 준비 단계를 기록한다.
async function acknowledgeUpdateLaunch(app, phase, argv = process.argv) {
  if (!app.isPackaged || !['starting', 'ready'].includes(phase)) return false;
  const token = argv.find((arg) => typeof arg === 'string' && arg.startsWith(launchFlag))?.slice(launchFlag.length);
  if (!token || !launchToken.test(token)) return false;
  const base = receiptBase(app.getPath('userData'), token);
  const version=nativeVersion(app.getVersion()),executable=app.getPath('exe');
  const key=JSON.stringify([base,phase,version,executable]);
  if(launchAcknowledgements.has(key))return launchAcknowledgements.get(key);
  const pending=(async()=>{try {
    const ticket = JSON.parse(await fs.readFile(base + '.json', 'utf8'));
    if (ticket.version !== version || typeof ticket.executable !== 'string') return false;
    const [expected, actual] = await Promise.all([ticket.executable, executable].map(exe => fs.stat(exe, { bigint: true })));
    if (!expected.isFile() || !actual.isFile() || expected.dev !== actual.dev || expected.ino !== actual.ino) return false;
    if (actual.ino === 0n && path.relative(await fs.realpath(ticket.executable), await fs.realpath(executable)) !== '') return false;
    const pid = String(process.pid);
    if (phase === 'ready' && (await fs.readFile(base + '.starting', 'utf8')).trim() !== pid) return false;
    try { await fs.writeFile(base + '.' + phase, pid, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return true;
  } catch { return false; }})();
  launchAcknowledgements.set(key,pending);
  const acknowledged=await pending;
  if(!acknowledged&&launchAcknowledgements.get(key)===pending)launchAcknowledgements.delete(key);
  return acknowledged;
}
async function cleanReceipt(base) {
  await Promise.all(['.json', '.starting', '.ready'].map((ext) => fs.rm(base + ext, { force: true }).catch(() => {})));
}
async function launchWindowsHelper(command, args, env, receipt, resultPath) {
  const diagnostic = resultPath + '.startup.txt';
  const output = await fs.open(diagnostic, 'w', 0o600);
  let child;
  try {
    child = spawn(command, args, { detached:true, windowsHide:true, env, stdio:['ignore',output.fd,output.fd] });
    await new Promise((resolve,reject) => { child.once('error',reject); child.once('spawn',resolve); });
  } finally { await output.close(); }
  const expires = Date.now()+20000;
  try {
    while (Date.now()<expires && child.exitCode===null && child.signalCode===null) {
      const acknowledged = await fs.readFile(receipt+'.helper','utf8').catch(e => e.code==='ENOENT'?'':Promise.reject(e));
      if (acknowledged.trim()===String(child.pid)) { child.unref(); return; }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Windows 업데이트 도우미가 시작되지 않았습니다. 기존 앱을 계속 사용하거나 다운로드 페이지에서 설치할 수 있습니다. 종료 코드 / '+String(child.exitCode));
  } catch(e) {
    if (child.exitCode===null && child.signalCode===null) child.kill();
    throw e;
  }
}
async function handoff({ platform, file, stage, version, target, parentPid, resultPath, signal, sha256 }) {
  let command, args;
  const env = { ...process.env };
  version=nativeVersion(version);
  const token = randomUUID();
  const receipt = receiptBase(path.dirname(resultPath), token);
  const executable = platform === 'darwin' ? path.join(target, 'Contents', 'MacOS', 'Flowrium') : target;
  if (platform === 'darwin') {
    const prepared = await prepareMac(file, stage, version, target, signal);
    const script = path.join(stage, 'install.sh');
    await fs.writeFile(script, await fs.readFile(path.join(__dirname, 'update-helpers', 'mac.sh')), { mode: 0o600 });
    command = '/bin/sh';
    args = [script, String(parentPid), stage, target, prepared, resultPath, token, receipt];
  } else {
    const source = await fs.readFile(path.join(__dirname, 'update-helpers', 'Flowrium.Update.exe'));
    const directory = path.join(path.dirname(resultPath),'update-helper');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const hash=createHash('sha256').update(source).digest('hex');
    command=path.join(directory,hash+'.exe');
    try { await fs.writeFile(command,source,{flag:'wx',mode:0o700}); }
    catch (e) {
      if(e.code!=='EEXIST' || createHash('sha256').update(await fs.readFile(command)).digest('hex')!==hash) throw e;
    }
    for(const name of await fs.readdir(directory)) {
      if (/^[0-9a-f]{64}\.exe$/.test(name) && name!==hash+'.exe') await fs.unlink(path.join(directory,name)).catch(()=>{});
    }
    await fs.writeFile(resultPath + '.log', '', { mode: 0o600 });
    args = [];
    Object.assign(env, { FLOWRIUM_UPDATE_PID: String(parentPid), FLOWRIUM_UPDATE_STAGE: stage,
      FLOWRIUM_UPDATE_FILE: file, FLOWRIUM_UPDATE_SHA256: sha256, FLOWRIUM_UPDATE_TARGET: target, FLOWRIUM_UPDATE_VERSION: version,
      FLOWRIUM_UPDATE_RESULT: resultPath, FLOWRIUM_UPDATE_TOKEN: token, FLOWRIUM_UPDATE_RECEIPT: receipt });
  }
  signal.throwIfAborted();
  await fs.writeFile(receipt + '.json', JSON.stringify({ version, executable }), { flag: 'wx', mode: 0o600 });
  try {
    if (platform==='win32') {
      await launchWindowsHelper(command,args,env,receipt,resultPath);
      return;
    }
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) {
    await cleanReceipt(receipt);
    if (platform==='win32') await fs.rm(receipt+'.helper',{force:true});
    throw error;
  }
}

class DesktopUpdater extends EventEmitter {
  constructor({ app, isBusy = () => false, platform = process.platform, arch = process.arch,
    fetchImpl = globalThis.fetch, execPath = process.execPath, parentPid = process.pid,
    transfer = handoff }) {
    super();
    Object.assign(this, { app, isBusy, platform, arch, fetchImpl, execPath, parentPid, transfer });
    this.suffix = artifactSuffix(platform, arch);
    this.state = { status: 'idle', currentVersion: displayVersion(app.getVersion()), message: '새 버전을 확인할 수 있습니다.' };
    this.timers = [];
  }
  getState() { return { ...this.state }; }
  set(status, message, extra = {}) {
    this.state = { status, currentVersion: displayVersion(this.app.getVersion()),
      ...(this.candidate ? { latestVersion: this.candidate.version } : {}), message, ...extra };
    this.emit('state', this.getState());
    return this.getState();
  }
  isInstalling() { return ['downloading', 'installing'].includes(this.state.status); }
  get resultPath() { return path.join(this.app.getPath('userData'), 'last-update-result.txt'); }
  async start() {
    if (!this.app.isPackaged || !this.suffix) {
      this.set('unsupported', '자동 업데이트는 설치한 macOS 및 Windows 앱에서 사용할 수 있습니다.');
      return;
    }
    if (this.timers.length) return;
    const first = setTimeout(() => void this.check(), 6000);
    const periodic = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
    this.timers.push(first, periodic);
    for (const timer of this.timers) timer.unref();
    try {
      const result = (await fs.readFile(this.resultPath, 'utf8')).trim();
      await fs.unlink(this.resultPath);
      if (result === 'failed') {
        clearTimeout(first);
        this.set('error', '지난 업데이트에서 새 앱이 준비되지 않았습니다. 새 버전을 다시 확인하거나 다운로드 페이지에서 설치 파일을 받을 수 있습니다.', { launchFailed: true });
      }
    } catch { /* 첫 실행에는 이전 결과가 없습니다. */ }
  }
  stop() { this.timers.forEach(clearTimeout); this.timers = []; }
  async check() {
    if (this.operation) return this.operation;
    if (this.isInstalling()) return this.getState();
    if (!this.app.isPackaged || !this.suffix)
      return this.set('unsupported', '자동 업데이트는 설치한 macOS 및 Windows 앱에서 사용할 수 있습니다.');
    this.operation = this.query().catch((error) => this.set('error', errorText(error)))
      .finally(() => { this.operation = null; });
    return this.operation;
  }
  async query() {
    this.candidate = null;
    this.set('checking', '새 버전을 확인하고 있습니다.');
    const response = await request(this.fetchImpl, latest, AbortSignal.timeout(25000));
    if (response.status !== 404) {
      const bytes = await readSmall(response, 2 * 1024 * 1024);
      this.candidate = selectRelease(JSON.parse(bytes.toString('utf8')), this.app.getVersion(), this.suffix);
    }
    if (this.candidate) return this.set('available', '새 버전 ' + this.candidate.version + '을 설치할 수 있습니다.');
    return this.set('current', '현재 설치된 버전이 최신입니다.');
  }
  async install() {
    if (this.operation) return this.operation;
    if (this.isInstalling() || !this.candidate) return this.getState();
    const busy = this.isBusy();
    if (busy) return this.set('available', typeof busy === 'string' ? busy : '실행 중인 작업을 마친 뒤 업데이트해 주세요.');
    this.operation = this.downloadAndInstall(this.candidate).catch((error) => this.set('error', errorText(error)))
      .finally(() => { this.operation = null; });
    return this.operation;
  }
  async downloadAndInstall({ version, asset, sums }) {
    this.set('downloading', '업데이트를 다운로드하고 있습니다.', { progress: 0 });
    const target = await installLocation(this.platform, this.execPath);
    const userData = this.app.getPath('userData');
    await fs.mkdir(userData, { recursive: true, mode: 0o700 });
    const stage = await makeStage(this.platform, target, userData);
    let launched = false;
    try {
      const signal = AbortSignal.timeout(15 * 60 * 1000);
      const sumBytes = await readSmall(await request(this.fetchImpl, sums.url, signal), sums.size);
      if (sumBytes.length !== sums.size || sums.sha && createHash('sha256').update(sumBytes).digest('hex') !== sums.sha)
        throw new Error('검증 목록의 크기 또는 SHA-256 값이 일치하지 않습니다.');
      const expected = checksum(sumBytes.toString('utf8'), asset.name);
      if (asset.sha && asset.sha !== expected) throw new Error('배포된 SHA-256 값이 서로 일치하지 않습니다.');
      const file = path.join(stage, asset.name);
      const output = await fs.open(file, 'wx', 0o600);
      const hash = createHash('sha256');
      let count;
      try {
        count = await consume(await request(this.fetchImpl, asset.url, signal), asset.size, async (chunk, size) => {
          await output.writeFile(chunk);
          hash.update(chunk);
          const progress = Math.floor(size / asset.size * 100);
          if (this.state.progress !== progress) this.set('downloading', '업데이트를 다운로드하고 있습니다.', { progress });
        });
        await output.sync();
      } finally { await output.close(); }
      if (count !== asset.size || expected !== hash.digest('hex'))
        throw new Error('설치 파일의 크기 또는 SHA-256 값이 일치하지 않습니다. 다시 다운로드해 주세요.');
      const busy = this.isBusy();
      if (busy) return this.set('available', typeof busy === 'string' ? busy : '실행 중인 작업을 마친 뒤 업데이트해 주세요.');
      this.set('installing', '업데이트를 설치한 뒤 Flowrium을 다시 엽니다.', { progress: 100 });
      await this.transfer({ platform: this.platform, file, stage, version, target, parentPid: this.parentPid,
        resultPath: this.resultPath, signal, sha256:expected });
      launched = true;
      this.readyToQuit = true;
      this.app.quit();
      return this.getState();
    } finally {
      if (!launched) await fs.rm(stage, { recursive: true, force: true });
    }
  }
}

module.exports = { acknowledgeUpdateLaunch, DesktopUpdater, newer, selectRelease, checksum, artifactSuffix, handoff };
