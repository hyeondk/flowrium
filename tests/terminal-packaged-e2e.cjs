const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');

async function main() {
  const win = process.platform === 'win32';
  assert.ok(win || process.platform === 'darwin');
  const input = process.argv[2] || (win ? 'release/win-unpacked/Flowrium.exe' : 'release/mac-arm64/Flowrium.app');
  const executable = path.resolve(win ? input : path.join(input, 'Contents', 'MacOS', 'Flowrium'));
  const resources = win ? path.join(path.dirname(executable), 'resources') : path.resolve(path.dirname(executable), '../Resources');
  const native = path.join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds');
  assert.deepEqual((await fs.readdir(native)).filter((s) => !s.startsWith('.')), [process.platform + '-' + process.arch]);
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-pty-packaged-')));
  const profile = path.join(temporary, 'profile'), project = path.join(temporary, '시험 프로젝트');
  let app;
  try {
    await fs.mkdir(project);
    await fs.mkdir(path.join(project, 'sub'));
    const env = { ...process.env, CODEX_HOME: path.join(temporary, 'codex'),
      ...(win ? {} : { HOME: temporary, ZDOTDIR: temporary, SHELL: '/bin/zsh' }) };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile], env, timeout: 45000 });
    const selectedProfile = await app.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(path.relative(profile, selectedProfile), '', '개인 계정의 앱 프로필과 격리돼야 합니다.');
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    const click = (name) => page.getByRole('button', { name, exact: true }).click();
    await click('프로젝트 폴더 선택'); await click('터미널'); await click('터미널 추가');
    const textbox = page.locator('.xterm-helper-textarea');
    async function send(command) {
      await textbox.focus();
      await page.keyboard.type(command); await page.keyboard.press('Enter');
    }
    const output = (a, b) => win ? "Write-Output ('" + a + "' + '" + b + "')" : "printf '%s%s\\n' '" + a + "' '" + b + "'";
    const waitOutput = (fragment) => page.waitForFunction((expected) => {
      const rows = document.querySelector('.xterm-rows');
      return !!rows && rows.textContent.includes(expected);
    }, fragment, { timeout: 22000 });
    // 화면 재생 및 셸 초기화가 끝나 실제 키 입력을 수신할 때까지 기다린다.
    await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.trim());
    await send(win ? "if (-not [Console]::IsInputRedirected) { " + output('FIRST_', 'PTY') + " }" :
      'if test -t 0 && test -t 1; then ' + output('FIRST_', 'PTY') + '; fi');
    await waitOutput('FIRST_PTY');
    await send('cd sub'); await send(output('MOVED_', 'OK')); await waitOutput('MOVED_OK');
    await click('터미널 추가'); await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('.terminal-tabs button');
      const rows = document.querySelector('.xterm-rows')?.textContent || '';
      return tabs.length === 2 && tabs[1].getAttribute('aria-pressed') === 'true' && rows.trim() && !rows.includes('MOVED_OK');
    });
    await send(output('SECOND_', 'PTY')); await waitOutput('SECOND_PTY');
    assert.equal(await page.locator('.xterm-rows').textContent().then((s) => s.includes('FIRST_PTY')), false);
    await page.locator('.terminal-tabs button').first().click(); await waitOutput('FIRST_PTY');
    await send(win ? "if ((Split-Path -Leaf (Get-Location).Path) -eq 'sub') { " + output('KEPT_', 'DIR') + " }" :
      'if test "${PWD##*/}" = sub; then ' + output('KEPT_', 'DIR') + '; fi');
    await waitOutput('KEPT_DIR');
    await click('터미널 종료'); await waitOutput('SECOND_PTY');
    await send('exit 7'); await page.getByText('종료 코드 7', { exact: true }).waitFor();
    await click('탭 닫기'); await page.getByText('프로젝트 폴더에서 터미널을 열어 명령을 실행하세요.').waitFor();
    console.log('패키지 터미널 검증 통과 / 플랫폼별 N-API / 가상 터미널 키 입력과 출력 / 독립 탭 / 작업 폴더 복원 / 셸 종료');
  } finally {
    if (app) await app.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
