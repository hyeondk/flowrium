const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {createOperationCache} = require('../electron/operation-cache.cjs');
const {readArchive, writeArchive} = require('../electron/codex-transfer-archive.cjs');

async function temporary(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-cache-unit-')));
  t.after(() => fs.rm(dir, {recursive:true, force:true, maxRetries:4, retryDelay:100}));
  return dir;
}

test('작업 캐시는 종료한 작업 폴더만 지우고 동시 작업과 원본은 유지한다', async t => {
  const root = await temporary(t);
  const first = await createOperationCache('flowrium-analysis-',root);
  const second = await createOperationCache('flowrium-analysis-',root);
  const original = path.join(root,'원본.txt');
  await fs.writeFile(original,'사용자 문서');
  await fs.writeFile(path.join(first.directory,'first.txt'),'첫 임시 자료');
  await fs.writeFile(path.join(second.directory,'second.txt'),'다음 임시 자료');
  await Promise.all([first.cleanup(),first.cleanup()]);
  await assert.rejects(fs.access(first.directory),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(second.directory,'second.txt'),'utf8'),'다음 임시 자료');
  assert.equal(await fs.readFile(original,'utf8'),'사용자 문서');
  await second.cleanup();
  assert.deepEqual(await fs.readdir(root),['원본.txt']);
});

test('작업 캐시가 다른 위치를 가리키면 대상과 대체물을 유지한다', async t => {
  const root = await temporary(t);
  const cache = await createOperationCache('flowrium-pr-',root);
  const replacement = path.join(root,'동시에 열린 다른 작업');
  const original = path.join(root,'원래 임시 경로 보존');
  await fs.mkdir(replacement);
  await fs.writeFile(path.join(replacement,'남겨 둘 자료.txt'),'보존');
  await fs.rename(cache.directory,original);
  await fs.symlink(replacement,cache.directory,process.platform==='win32'?'junction':'dir');
  await assert.rejects(cache.cleanup(),/다른 위치/);
  assert.equal(await fs.readFile(path.join(replacement,'남겨 둘 자료.txt'),'utf8'),'보존');
  assert((await fs.lstat(cache.directory)).isSymbolicLink());
  await fs.unlink(cache.directory);
  await fs.rename(original,cache.directory);
  await cache.cleanup();
  await assert.rejects(fs.access(cache.directory),{code:'ENOENT'});
});

test('같은 원문을 소형 압축본 하나로만 보관하고 기존 JSON 원문도 다시 읽는다', async t => {
  const root = await temporary(t);
  const transcript = Buffer.from(JSON.stringify({source:'회의록 원문 😊\n'.repeat(32000)}));
  const sha = createHash('sha256').update(transcript).digest('hex');
  const plain = path.join(root,sha+'.json');
  await Promise.all([writeArchive(plain,transcript),writeArchive(plain,transcript)]);
  assert.deepEqual(await fs.readdir(root),[sha+'.json.gz']);
  assert((await fs.stat(plain+'.gz')).size < transcript.length * 0.1);
  assert.deepEqual(await readArchive(plain),transcript);
  await fs.writeFile(plain,transcript,{flag:'wx'});
  await writeArchive(plain,transcript);
  assert.deepEqual(await readArchive(plain),transcript);
  assert.deepEqual((await fs.readdir(root)).sort(),[sha+'.json',sha+'.json.gz']);
  await fs.unlink(plain);
  await fs.writeFile(plain+'.gz','손상한 압축 자료');
  await assert.rejects(readArchive(plain),/형식과 크기/);
  await assert.rejects(writeArchive(plain,transcript),/형식과 크기/);
});
