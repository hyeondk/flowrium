const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {FollowupPreference} = require('../electron/followup-preference.cjs');
const {Store} = require('../electron/store.cjs');

const first = '0:' + 'a'.repeat(64);
const second = '1:' + 'b'.repeat(64);
const reset = '0:' + 'b'.repeat(64);
const preferenceFile = 'followup-preference-v1.json';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-followup-preference-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  const preference = new FollowupPreference(directory);
  await preference.load();
  return {directory, file:path.join(directory, preferenceFile), preference};
}

test('추천 동의는 계정과 세대에만 적용하고 작업 공간 파일을 바꾸지 않는다', async t => {
  const {directory, preference} = await fixture(t);
  assert.equal(preference.enabled(first), false);
  const workspace = new Store(directory);
  await workspace.load();
  await workspace.saveSettings({theme:'dark'});
  const workspaceFile = path.join(directory, 'workspace-v2.json');
  const original = await fs.readFile(workspaceFile, 'utf8');

  assert.equal(await preference.set(first, true), true);
  assert.equal(preference.enabled(first), true);
  assert.equal(preference.enabled(reset), false);
  assert.equal(preference.enabled(second), false);
  const reopened = new FollowupPreference(directory);
  await reopened.load();
  assert.equal(reopened.enabled(first), true);
  assert.equal(await reopened.set(second, true), true);
  assert.equal(await reopened.set(first, false), false, '이전 계정의 요청으로 새 계정의 동의를 취소할 수 없음');
  assert.equal(reopened.enabled(second), true);
  assert.equal(reopened.enabled(first), false);
  await reopened.set(second, false);
  const afterDisable = new FollowupPreference(directory);
  await afterDisable.load();
  assert.equal(afterDisable.enabled(second), false);
  assert.equal(await fs.readFile(workspaceFile, 'utf8'), original);
});

test('읽을 수 없는 기록과 잘못된 키는 기본 해제로 처리한다', async t => {
  const {directory, file, preference} = await fixture(t);
  for (const contents of ['{깨진 내용', JSON.stringify({version:2,accountKey:first}),
    JSON.stringify({version:1,accountKey:first}) + ' '.repeat(1024)]) {
    await fs.writeFile(file, contents);
    await preference.load();
    assert.equal(preference.enabled(first), false);
  }
  if (process.platform !== 'win32') {
    const other = path.join(directory, 'other.json');
    await fs.writeFile(other, JSON.stringify({version:1,accountKey:first}));
    await fs.unlink(file);
    await fs.symlink(other, file);
    await preference.load();
    assert.equal(preference.enabled(first), false);
  }
  await assert.rejects(preference.set('0:잘못된 값', true), /모델 추천 설정/);
  await assert.rejects(preference.set(first, 'true'), /모델 추천 설정/);
});

test('끄기 요청은 지연된 쓰기 전에도 추천을 차단하고 원자 저장을 마친다', async t => {
  const {directory, file, preference} = await fixture(t);
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  const rename = fs.rename;
  let writing = true;
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === file && writing) {
      entered.resolve();
      await resume.promise;
    }
    return rename(source, target);
  });
  const enable = preference.set(first, true);
  await entered.promise;
  assert.equal(preference.enabled(first), false, '명시 동의는 파일에 먼저 저장됨');
  const disable = preference.set(first, false);
  assert.equal(preference.enabled(first), false);
  writing = false;
  resume.resolve();
  await Promise.all([enable, disable]);
  assert.equal(preference.enabled(first), false);
  await preference.set(first, true);
  const lastDisable = preference.set(first, false);
  assert.equal(preference.enabled(first), false, '꺼짐을 요청한 직후 모델 사용 중지');
  await lastDisable;
  const reopened = new FollowupPreference(directory);
  await reopened.load();
  assert.equal(reopened.enabled(first), false);
  assert.deepEqual(await fs.readdir(directory), [preferenceFile]);
});

test('쓰기 실패 후 임시 파일을 없애고 다음 변경을 다시 저장한다', async t => {
  const {directory, file, preference} = await fixture(t);
  const rename = fs.rename;
  let reject = true;
  t.mock.method(fs, 'rename', async (source, target) => {
    if (target === file && reject) throw Error('합성 쓰기 실패');
    return rename(source, target);
  });
  await assert.rejects(preference.set(first, true), /저장하지 못했습니다/);
  assert.equal(preference.enabled(first), false);
  assert.deepEqual(await fs.readdir(directory), []);
  reject = false;
  await preference.set(first, true);
  assert.equal(preference.enabled(first), true);
  assert.deepEqual(await fs.readdir(directory), [preferenceFile]);
});
