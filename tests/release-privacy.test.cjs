const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const asar = require('@electron/asar');
const { verify, prepareMarkers, sensitivePath, buildPolicy, Matcher } = require('../scripts/verify-release-privacy.cjs');
const { archive } = require('./installer-fixtures.cjs');

const run = promisify(execFile);
const checker = path.resolve(__dirname, '../scripts/verify-release-privacy.cjs');
const packageData = () => ({ name: 'flowrium', version: '1.0.0', build: {
  files: ['dist/**/*', 'electron/**/*', 'assets/flowrium.png', 'package.json'],
  extraResources: [{ from: '.flowrium-tmp/runtime', to: 'runtime', filter: ['**/*'] }],
} });
async function write(root, name, text) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  return file;
}
async function temporary(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-release-privacy-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}
async function repository(t) {
  const temp = await temporary(t), root = path.join(temp, 'repo');
  await fs.mkdir(root);
  await write(root, 'package.json', JSON.stringify(packageData()));
  await run('git', ['init', '--quiet'], { cwd: root });
  return { temp, root, stage: () => run('git', ['add', '--all'], { cwd: root }) };
}
async function cli(args) {
  try {
    const result = await run(process.execPath, [checker, ...args], { encoding: 'utf8' });
    return { status: 0, output: result.stdout + result.stderr };
  } catch (error) {
    return { status: error.code, output: (error.stdout || '') + (error.stderr || '') };
  }
}

test('공개 코드의 경로 예시 / 합성 검사 / 글꼴 출처는 개인정보 파일로 오인하지 않는다', async t => {
  const { root, stage } = await repository(t);
  await write(root, 'electron/import.cjs', "const sample = '.codex/auth.json'; const drafts = '.flowrium/composer-drafts';");
  await write(root, 'tests/example.test.cjs', "const fake = 'synthetic-private-conversation';");
  await write(root, 'docs/fonts/sources.json', '{"source":"https://example.invalid/font"}');
  await write(root, '.env.example', 'SYNTHETIC_PLACEHOLDER=');
  await stage();
  const result = await verify({ root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked.git, 5);
  assert.equal(sensitivePath('docs/fonts/sources.json'), false);
  for (const name of ['state.json', 'profiles/local/state.json', '.codex/auth.json', '.flowrium/codex-source/thread.json', 'codex-transfers/chat.json', 'profiles/local/state.sqlite-wal']) assert.equal(sensitivePath(name), true);
  assert.equal(buildPolicy(packageData()), true);
  assert.equal(buildPolicy({ build: { files: ['**/*'] } }), false);
  assert.equal(buildPolicy({ build: { files: ['dist/**/*'], extraResources: [{ from: '.flowrium-tmp', to: 'extra' }] } }), false);
});

test('실제 개인정보 경로 / 사용자 저장소 / 넓은 패키징 규칙을 막고 로그에는 원문을 남기지 않는다', async t => {
  const { temp, root, stage } = await repository(t);
  const secretName = 'synthetic-sensitive-folder';
  await write(root, `.flowrium/codex-source/${secretName}/thread.json`, '{}');
  await write(root, 'profiles/local/state.sqlite', '합성 저장소');
  await write(root, '.codex/auth.json', '{"placeholder":"합성 값"}');
  await write(root, 'package.json', JSON.stringify({ build: { files: ['**/*'] } }));
  await stage();
  const result = await verify({ root });
  assert.equal(result.ok, false);
  assert.equal(result.findings.sensitivePaths, 3);
  assert.equal(result.findings.buildPolicy, 1);
  const output = await cli(['--root', root]);
  assert.equal(output.status, 1);
  assert.doesNotMatch(output.output, new RegExp(secretName));
  assert.equal(output.output.includes(temp), false);
  assert.equal(output.output.includes('.codex/auth.json'), false);
  const rejected = await cli(['--unknown', secretName]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.output.includes(secretName), false);
});

test('개인 마커는 한글 정규화 / 주소 인코딩 / JSON / 청크 경계를 검사하며 로그에서 숨긴다', async t => {
  const { temp, root, stage } = await repository(t);
  const marker = '/synthetic-user/고유한 검증 대화 8675309';
  const thread = 'synthetic-thread-unique-1039';
  const windows = 'Z:\\synthetic-person\\private-chat-4891';
  const markers = await write(temp, 'private-markers.json', JSON.stringify({ paths: [marker, windows], threadIds: [thread], snippets: [] }));
  const unicode = [...thread].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const forms = [marker, marker.normalize('NFD'), encodeURI(marker), encodeURIComponent(marker).toLowerCase(), JSON.stringify(windows), unicode];
  for (let index = 0; index < forms.length; index++) await write(root, `electron/fixture-${index}.js`, forms[index]);
  await write(root, `electron/${thread}.js`, '');
  const split = Buffer.from(marker.normalize('NFD'));
  await write(root, 'electron/boundary.js', Buffer.concat([Buffer.alloc(65536 - 11, 32), split]));
  await stage();
  const result = await verify({ root, markers });
  assert.equal(result.ok, false);
  assert.equal(result.markers, 3);
  assert.equal(result.findings.markerFiles, 7);
  assert.equal(result.findings.markerMatches, 7);
  assert.equal(result.findings.markerPaths, 1);
  const output = await cli(['--root', root, '--markers', markers]);
  assert.equal(output.status, 1);
  for (const value of [marker, thread, windows, temp, 'private-markers.json', 'fixture-']) assert.equal(output.output.includes(value), false);
  assert.throws(() => prepareMarkers({ paths: ['short'] }));
  assert.throws(() => prepareMarkers({ tokens: [thread] }));
  const matcher = new Matcher(prepareMarkers({ snippets: [thread] }));
  for (let index = 0; index < unicode.length; index += 7) matcher.write(Buffer.from(unicode.slice(index, index + 7)));
  assert.equal(matcher.end(), 1);
});

test('앱 묶음 / 목록 밖의 풀린 자료 / 소스 압축까지 읽기 전용으로 검사한다', async t => {
  const temp = await temporary(t), app = path.join(temp, 'app'), resources = path.join(temp, 'resources');
  await fs.mkdir(resources);
  // 실제 패키징 도구와 같이 build 설정을 제거한 앱 메타데이터를 사용한다.
  await write(app, 'package.json', JSON.stringify({ name: 'flowrium', version: '1.0.0' }));
  await write(app, 'dist/index.html', '<h1>합성 앱</h1>');
  const marker = 'synthetic-only-conversation-9876';
  const markers = await write(temp, 'private-markers.json', JSON.stringify({ snippets: [marker] }));
  const asarFile = path.join(resources, 'app.asar');
  await asar.createPackage(app, asarFile);
  const sourceFile = await write(temp, 'source.tar.gz', archive([
    { name: 'Flowrium-test/package.json', body: JSON.stringify(packageData()) },
    { name: 'Flowrium-test/docs/fonts/sources.json', body: '{}' },
  ]));
  let result = await verify({ git: false, resources, source: sourceFile, markers });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.checked.asar, 2);
  assert.equal(result.checked.source, 2);
  const before = await fs.readFile(asarFile);
  await write(resources, 'app.asar.unpacked/codex-transfers/private.json', marker);
  await write(resources, 'runtime/bin/synthetic-binary', Buffer.alloc(8 * 1024 * 1024 + 1));
  await write(temp, 'source.tar.gz', archive([
    { name: 'Flowrium-test/package.json', body: JSON.stringify(packageData()) },
    { name: 'Flowrium-test/.codex/auth.json', body: '{}' },
    { name: 'Flowrium-test/chat.md', body: encodeURIComponent(marker) },
  ]));
  result = await verify({ git: false, resources, source: sourceFile, markers });
  assert.equal(result.ok, false);
  assert.ok(result.findings.sensitivePaths >= 2);
  assert.equal(result.findings.markerFiles, 2);
  assert.equal(result.skippedVendorBinaries, 1);
  assert.deepEqual(await fs.readFile(asarFile), before);
  assert.equal(await fs.readFile(path.join(resources, 'app.asar.unpacked/codex-transfers/private.json'), 'utf8'), marker);
  const output = await cli(['--no-git', '--resources', resources, '--source', sourceFile, '--markers', markers]);
  assert.equal(output.status, 1);
  for (const value of [temp, marker, 'private.json', 'auth.json']) assert.equal(output.output.includes(value), false);
  await write(temp, 'source.tar.gz', Buffer.from('손상된 합성 묶음'));
  const malformed = await verify({ git: false, source: sourceFile });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.findings.unreadable, 1);
});
