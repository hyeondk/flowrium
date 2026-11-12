const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID } = require('./project-store.cjs');
const MAX_OUTPUT = 256 * 1024;
const MAX_SESSIONS = 24;

async function prepareTerminal() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const pkg = path.dirname(require.resolve('node-pty/package.json'));
  // npm 1.1.0 배포 파일에는 macOS spawn-helper의 실행 비트가 빠져 있다.
  await fs.chmod(path.join(pkg, 'prebuilds', 'darwin-arm64', 'spawn-helper'), 0o755);
}
function loadPty() {
  let modulePath = require.resolve('node-pty');
  // Windows의 ConPTY 작업자와 DLL은 실제 파일 경로로 로드한다.
  if (process.platform === 'win32')
    modulePath = modulePath.replace(path.sep + 'app.asar' + path.sep, path.sep + 'app.asar.unpacked' + path.sep);
  return require(modulePath);
}
function sessionInfo(s) {
  return { id: s.id, projectId: s.projectId, title: s.title, startDir: s.startDir, closed: s.closed, exitCode: s.exitCode };
}
function registerTerminal(register, store, { canOpen = () => true, env = process.env } = {}) {
  const sessions = new Map();
  let next = 0, stopping = false;
  function get(projectId, id) {
    store.project(projectId);
    const s = sessions.get(id);
    if (!UUID.test(id) || !s || s.projectId !== projectId) throw new Error('이 프로젝트의 터미널을 찾을 수 없습니다.');
    return s;
  }
  function running(s) {
    if (s.closed) throw new Error('셸이 종료됐습니다. 새 터미널을 열어 주세요.');
  }
  async function close(s) {
    if (s.closed) return;
    try { s.pty.kill(); } catch { /* 종료 이벤트가 먼저 도착할 수 있다. */ }
    const force = setTimeout(() => {
      if (!s.closed) {
        try { process.platform === 'win32' ? s.pty.kill() : s.pty.kill('SIGKILL'); } catch { /* 이미 종료됨 */ }
      }
    }, 1500);
    let deadline;
    try {
      await Promise.race([s.exited, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('셸 종료를 확인하지 못했습니다. 다시 시도해 주세요.')), 8000);
      })]);
    } finally { clearTimeout(force); clearTimeout(deadline); }
  }
  register('terminalList', (projectId) => {
    store.project(projectId);
    return [...sessions.values()].filter((s) => s.projectId === projectId).map(sessionInfo);
  });
  register('terminalOpen', async (projectId, purpose) => {
    if (purpose !== undefined && purpose !== 'github-login') throw new Error('지원하지 않는 터미널 시작 요청입니다.');
    const project = store.project(projectId);
    const cwd = await fs.realpath(project.path);
    if (path.relative(cwd, project.path) !== '' || !(await fs.stat(cwd)).isDirectory())
      throw new Error('프로젝트 폴더 경로가 바뀌었습니다. 원래 폴더를 다시 연결해 주세요.');
    if (stopping || !canOpen()) throw new Error('앱 업데이트 중에는 터미널을 열 수 없습니다.');
    if (sessions.size >= MAX_SESSIONS) throw new Error('열지 않는 터미널을 닫은 뒤 새 터미널을 추가해 주세요.');
    const windows = process.platform === 'win32';
    let shell = windows ? path.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') :
      (env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh');
    let args = windows ? ['-NoLogo'] : ['-l'];
    const runtime = require('./runtime.cjs');
    if (purpose === 'github-login') {
      const binary=runtime.runtimePaths().gh;
      shell=await fs.access(binary).then(()=>binary,()=> 'gh');
      args=['auth','login','--hostname','github.com','--web'];
    }
    const childEnv = { ...runtime.runtimeEnvironment(env), TERM: 'xterm-256color', TERM_PROGRAM: 'Flowrium' };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    let pty;
    try {
      pty = loadPty().spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd, env: childEnv });
    } catch {
      throw new Error('로컬 셸을 실행하지 못했습니다. 셸 설치와 프로젝트 폴더 접근 권한을 확인해 주세요.');
    }
    const s = { id: randomUUID(), projectId, title: purpose === 'github-login' ? 'GitHub 로그인' : path.basename(shell, '.exe') + ' ' + (++next), startDir: cwd,
      pty, data: '', offset: 0, closed: false, exitCode: null };
    s.exited = new Promise((resolve) => {
      pty.onExit(({ exitCode }) => {
        // node-pty 1.1.0 keeps its ConPTY output worker's pipe server listening
        // when the user types exit. Dispose that session's worker after the
        // output stream closes. Calling kill here could target a reused PID.
        if (windows) pty._agent?._conoutSocketWorker?.dispose();
        s.closed = true;
        s.exitCode = exitCode;
        resolve();
      });
    });
    pty.onData((data) => {
      s.offset += data.length;
      s.data = (s.data + data).slice(-MAX_OUTPUT);
    });
    sessions.set(s.id, s);
    return sessionInfo(s);
  });
  register('terminalRead', (projectId, id, offset) => {
    const s = get(projectId, id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > s.offset) throw new Error('터미널 출력 위치가 올바르지 않습니다.');
    const first = s.offset - s.data.length;
    return { data: s.data.slice(Math.max(0, offset - first)), offset: s.offset, truncated: offset < first,
      closed: s.closed, exitCode: s.exitCode };
  });
  register('terminalWrite', (projectId, id, data) => {
    const s = get(projectId, id); running(s);
    if (typeof data !== 'string' || data.length > 65536) throw new Error('한 번에 보낼 터미널 입력이 너무 큽니다.');
    s.pty.write(data);
  });
  register('terminalResize', (projectId, id, cols, rows) => {
    const s = get(projectId, id);
    if (![cols, rows].every((v) => Number.isInteger(v) && v >= 1 && v <= 1000)) throw new Error('터미널 표시 크기가 올바르지 않습니다.');
    if (!s.closed) s.pty.resize(cols, rows);
  });
  register('terminalClose', async (projectId, id) => {
    const s = get(projectId, id);
    await close(s);
    sessions.delete(id);
  });
  return {
    isBusy: () => [...sessions.values()].some((s) => !s.closed),
    shutdown: async () => {
      stopping = true;
      const current = [...sessions.values()];
      await Promise.allSettled(current.map(close));
      sessions.clear();
    },
  };
}
module.exports = { registerTerminal, prepareTerminal };
if (require.main === module && process.argv[2] === '--prepare') {
  prepareTerminal().catch((error) => { console.error(error); process.exitCode = 1; });
}
