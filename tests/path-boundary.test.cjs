const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { samePath, relativePath } = require('../electron/path-boundary.cjs');
const run = promisify(execFile);

test('macOS 경로 비교만 한글 정규화를 허용하고 다른 경계와 Linux의 서로 다른 이름을 보존한다', () => {
  const base = path.resolve('합성 프로젝트');
  const composed = base.normalize('NFC'), decomposed = base.normalize('NFD');
  assert.equal(samePath(composed, decomposed, 'darwin'), true);
  assert.equal(relativePath(composed, path.join(decomposed, '문서'), 'darwin'), '문서');
  assert.equal(samePath(composed, path.resolve('다른 프로젝트'), 'darwin'), false);
  assert.equal(relativePath(composed, composed + '의 사본', 'darwin').startsWith('..'), true);
  assert.equal(samePath(composed, decomposed, 'linux'), composed === decomposed);
  assert.equal(samePath(composed, composed + path.sep + '..' + path.sep + '다른 프로젝트', 'darwin'), false);
});

test('Node에서 등록한 한글 프로젝트를 Electron 런타임으로 다시 열어 첫 작업 폴더와 상세 변경을 확인한다', { skip: process.platform !== 'darwin' }, async () => {
  const { Store } = require('../electron/store.cjs');
  const qa = path.resolve(__dirname, '../.flowrium-tmp/qa-261115_02');
  await fs.mkdir(qa, { recursive: true });
  const temp = await fs.mkdtemp(path.join(qa, 'path-runtime-'));
  try {
    const profile = path.join(temp, 'profile'), folder = path.join(temp, '합성 프로젝트');
    await fs.mkdir(folder);
    const store = new Store(profile);
    await store.load();
    const project = await store.addProject(folder);
    await store.createSession(project.id, { title: '합성 첫 업무' });
    const script = path.join(temp, 'runtime-check.cjs');
    await fs.writeFile(script, [
      "const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');",
      "const root=process.argv[2],profile=process.argv[3],id=process.argv[4],folder=process.argv[5];",
      "const {Store}=require(root+'/electron/store.cjs'),{readDetails,updateDetails}=require(root+'/electron/project-details.cjs'),{resolveProjectDirectory,inside}=require(root+'/electron/project-repositories.cjs'),{listMemory}=require(root+'/electron/memory.cjs');",
      "(async()=>{const store=new Store(profile);await store.load();const project=store.project(id);const originalPath=project.path;assert.equal((await readDetails(store,id)).revision,null);assert.equal((await store.addProject(folder)).id,id);assert.equal(store.state.projects.length,1);assert.equal(store.project(id).path,originalPath);",
      "const updated=await updateDetails(store,id,null,{action:'add',text:'한글 경로 첫 작업'});assert(updated.revision);assert.equal((await readDetails(store,id)).checklist[0].text,'한글 경로 첫 작업');await resolveProjectDirectory(store,project);await listMemory(store,id);",
      "const outside=path.join(path.dirname(folder),'다른 폴더');await fs.mkdir(outside);const alias=path.join(folder,'연결 폴더');await fs.symlink(outside,alias);await assert.rejects(inside(await fs.realpath(folder),'연결 폴더'));await assert.rejects(inside(await fs.realpath(folder),'../다른 폴더'));",
      "const link=path.join(path.dirname(folder),'프로젝트 별칭');await fs.symlink(folder,link);store.project(id).path=link;await assert.rejects(readDetails(store,id),/다른 위치/);store.project(id).path=originalPath;assert.equal((await readDetails(store,id)).revision,updated.revision);console.log('한글 경로 / 기존 연결 재사용 / 상세 저장 / 작업 폴더 / 기억 / 다른 폴더와 심볼릭 링크 차단 통과');})().catch(error=>{console.error(error);process.exitCode=1;});",
    ].join('\n'));
    const result = await run(require('electron'), [script, path.resolve(__dirname, '..'), profile, project.id, folder], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000,
    });
    assert.match(result.stdout, /심볼릭 링크 차단 통과/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  }
});
