const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { stripVTControlCharacters } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { registerTerminal } = require('../electron/terminal.cjs');

const windows = process.platform === 'win32';
const supported = windows || process.platform === 'darwin';
const print = (left, right) => windows ? "Write-Output ('" + left + "' + '" + right + "')" : "printf '%s%s\\n' '" + left + "' '" + right + "'";
async function fixture(t, options) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-pty-')));
  const project = { id: randomUUID(), path: path.join(temp, '프로젝트') }, other = { id: randomUUID(), path: temp };
  await fs.mkdir(project.path); await fs.mkdir(path.join(project.path, 'sub'));
  const api = {};
  const env = { ...process.env, ...(windows ? {} : { SHELL: '/bin/zsh', HOME: temp, ZDOTDIR: temp }) };
  const manager = registerTerminal((name, action) => { api[name] = action; }, {
    project(id) { if (id === project.id) return project; if (id === other.id) return other; throw Error('프로젝트 없음'); },
  }, { env, ...options });
  t.after(async () => { await manager.shutdown(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 4 }); });
  async function text(s) { return stripVTControlCharacters((await api.terminalRead(project.id, s.id, 0)).data); }
  async function wait(s, phrase) {
    for (let n = 0; n < 180; n++) { const value = await text(s); if (value.includes(phrase)) return value; await delay(80); }
    throw new Error('셸 응답이 도착하지 않았습니다: ' + phrase);
  }
  return { api, project, other, text, wait, manager };
}
test('운영체제 가상 터미널 두 개의 입출력, 독립 작업 폴더, 크기 변경과 종료', { skip: !supported }, async (t) => {
  const { api, project, other, wait, text, manager } = await fixture(t);
  const first = await api.terminalOpen(project.id), second = await api.terminalOpen(project.id);
  assert.notEqual(first.id, second.id); assert.ok(manager.isBusy());
  assert.equal(api.terminalList(other.id).length, 0);
  assert.throws(() => api.terminalWrite(other.id, first.id, 'exit\r'), /이 프로젝트의 터미널/);
  api.terminalResize(project.id, first.id, 112, 28);
  const tty = windows ? "if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) { " + print('FLOW_', 'TTY') + " }" :
    "if [[ -t 0 && -t 1 ]]; then " + print('FLOW_', 'TTY') + "; fi";
  api.terminalWrite(project.id, first.id, tty + '\r');
  await wait(first, 'FLOW_TTY');
  api.terminalWrite(project.id, first.id, 'cd sub\r');
  const check = windows ? "if ((Split-Path -Leaf (Get-Location).Path) -eq 'sub') { " + print('FLOW_', 'SUB') + " }" :
    'if [[ "$PWD" = */sub ]]; then ' + print('FLOW_', 'SUB') + '; fi';
  api.terminalWrite(project.id, first.id, check + '\r');
  await wait(first, 'FLOW_SUB');
  api.terminalWrite(project.id, second.id, print('SECOND_', 'SHELL') + '\r');
  await wait(second, 'SECOND_SHELL');
  assert.equal((await text(second)).includes('FLOW_SUB'), false);
  await api.terminalClose(project.id, first.id);
  assert.deepEqual(api.terminalList(project.id).map((s) => s.id), [second.id]);
  api.terminalWrite(project.id, second.id, 'exit 7\r');
  for (let n = 0; n < 120 && !api.terminalRead(project.id, second.id, 0).closed; n++) await delay(60);
  assert.equal(api.terminalRead(project.id, second.id, 0).exitCode, 7);
  assert.equal(manager.isBusy(), false);
  await api.terminalClose(project.id, second.id);
});
test('업데이트 중 셸 시작과 비정상 크기 입력을 차단한다', { skip: !supported }, async (t) => {
  let permitted = false;
  const { api, project } = await fixture(t, { canOpen: () => permitted });
  await assert.rejects(api.terminalOpen(project.id), /업데이트/);
  permitted = true;
  const s = await api.terminalOpen(project.id);
  assert.throws(() => api.terminalResize(project.id, s.id, 0, 1000), /크기/);
  assert.throws(() => api.terminalRead(project.id, s.id, -1), /위치/);
  assert.throws(() => api.terminalWrite(project.id, s.id, 'a'.repeat(65537)), /입력/);
});
