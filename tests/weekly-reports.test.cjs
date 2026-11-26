const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { Store } = require('../electron/store.cjs');
const { startWork, autoSaveWorkArtifact, registerWorkbench } = require('../electron/workbench.cjs');
const { createWeeklyReportFiles } = require('../electron/weekly-reports.cjs');
const { weeklyRows, writeWeeklyWorkbook } = require('../electron/weekly-workbook.cjs');

const reportBody = [
  '## 금주 업무내용',
  '| 구분 | 업무내용 | 날짜 | 비고 |',
  '| --- | --- | --- | --- |',
  '| 서비스 운영 | 알림 설정을 점검했습니다. | 2026-11-25 | 시험 계정 검증 |',
  '| 서비스 운영 | 검색 결과 정렬 반영 | 2026-11-26 | =1+5 & 검토 |',
  '## 차주 업무계획',
  '| 구분 | 업무내용 | 날짜 | 비고 |',
  '| --- | --- | --- | --- |',
  '| 서비스 운영 | 업데이트를 검증할 예정입니다. | 2026-12-01 | |',
  '',
  '## 근거',
  '엑셀 비고에 넣지 않을 근거',
].join('\n');
const Zip = createRequire(require.resolve('pptxgenjs'))('jszip');

test('엑셀 보고가 예시 양식의 두 표와 그룹을 보존하고 날짜와 사용자 문자열을 안전하게 저장한다', async () => {
  const rows = weeklyRows(reportBody, '기본 프로젝트');
  assert.deepEqual(rows.current.map(row => row.work), ['알림 설정을 점검', '검색 결과 정렬 반영']);
  assert.equal(rows.next[0].work, '업데이트를 검증 예정');
  const data = await writeWeeklyWorkbook({ title: '주간업무보고서', from: '2026-11-23', to: '2026-11-27', createdAt:'2026-11-26', ...rows });
  const excel = await Zip.loadAsync(data);
  const sheet = await excel.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(sheet, /<mergeCell ref="B2:H2"\/>/);
  assert.match(sheet, /<mergeCell ref="C5:F5"\/>/);
  assert.match(sheet, /<mergeCell ref="B6:B7"\/>/);
  assert.match(sheet, /금주 업무내용[\s\S]*차주 업무계획/);
  assert.match(sheet, /<c r="G6" s="10"><v>46351<\/v><\/c>/);
  assert.match(sheet, /<t xml:space="preserve">=1\+5 &amp; 검토<\/t>/);
  assert.doesNotMatch(sheet, /<f>|엑셀 비고에 넣지 않을 근거/);
  const styles = await excel.file('xl/styles.xml').async('string');
  assert.match(styles, /numFmtId="164" formatCode="yyyy-mm-dd"/);
  const book = await excel.file('xl/workbook.xml').async('string');
  assert(book.includes("_xlnm.Print_Area"));
});

async function fixture(t) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-weekly-')));
  t.after(() => fs.rm(temp, { recursive:true, force:true, maxRetries:6, retryDelay:100 }));
  const profile = path.join(temp, '프로필');
  const folder = path.join(temp, '프로젝트');
  await fs.mkdir(folder);
  const store = new Store(profile);
  await store.load();
  const project = await store.addProject(folder);
  await store.requestProjectTrust(project.id, async () => true);
  const entry = await startWork(store, { projectId:project.id, title:'보고 샘플', kind:'weekly', from:'2026-11-23', to:'2026-11-27' });
  const session = store.session(entry.id);
  const answer = { id:randomUUID(), role:'assistant', text:reportBody, createdAt:'2026-11-26T01:00:00Z' };
  session.messages.push({ id:randomUUID(), role:'user', text:'보고서를 만들어줘', createdAt:session.createdAt }, answer);
  await store.save();
  const pending = path.join(profile, 'weekly-report-files', session.id + '--' + answer.id + '.xlsx');
  return { temp, folder, profile, store, project, session, answer, pending };
}

test('보고 완료 시 임시 엑셀만 만들고 저장 취소와 재실행 후에도 사용자가 고른 위치에 저장한다', async t => {
  const f = await fixture(t);
  const id = f.session.id, message = f.answer.id;
  const handlers = new Map();
  registerWorkbench((name, handler) => handlers.set(name, handler), f.store, { reveal() {} });
  await assert.rejects(handlers.get('artifactAction')(f.project.id, { action:'create', sessionId:id, format:'md', title:'별도 복사본', body:'원문' }), /임시 엑셀/);
  const legacy = path.join(f.folder, '기존 보고.md');
  await fs.writeFile(legacy, '기존 기록');
  await Promise.all([autoSaveWorkArtifact(f.store, id), autoSaveWorkArtifact(f.store, id)]);
  const original = await fs.readFile(f.pending);
  assert.equal((await Zip.loadAsync(original)).file('xl/workbook.xml').name, 'xl/workbook.xml');
  assert.deepEqual(await fs.readdir(path.dirname(f.pending)), [path.basename(f.pending)]);
  await assert.rejects(fs.access(path.join(f.folder, '산출물')), { code:'ENOENT' });
  assert.equal(await fs.readFile(legacy, 'utf8'), '기존 기록');
  const canceled = createWeeklyReportFiles(f.store, { chooseDestination:async () => null, savePermission:() => () => {} });
  assert.equal(await canceled.save(id, message), false);
  assert.deepEqual(await fs.readFile(f.pending), original);
  const reopened = new Store(f.profile);
  await reopened.load();
  const destination = path.join(f.temp, '사용자 위치.xlsx');
  const files = createWeeklyReportFiles(reopened, {
    chooseDestination:async filename => { assert.equal(filename, '보고 샘플.xlsx'); return destination; },
    savePermission:() => () => {},
  });
  assert.equal((await files.read(id, message)).name, '보고 샘플.xlsx');
  assert.equal(await files.save(id, message), true);
  assert.deepEqual(await fs.readFile(destination), original);
  assert.equal(await files.read(id, message), null);
  await assert.rejects(fs.access(f.pending), { code:'ENOENT' });
  assert.deepEqual((await fs.readdir(f.temp)).sort(), ['사용자 위치.xlsx', '프로젝트', '프로필'].sort());
});

test('임시 보고서는 생성부터 7일 동안 유지되고 만료 정리는 다른 파일과 대화 원문에 영향을 주지 않는다', async t => {
  const f = await fixture(t);
  const id = f.session.id, message = f.answer.id;
  await autoSaveWorkArtifact(f.store, id);
  const manual = path.join(path.dirname(f.pending), '사용자 파일.xlsx');
  await fs.writeFile(manual, '유지');
  const expiry = (await fs.stat(f.pending)).mtimeMs + 7 * 24 * 60 * 60 * 1000;
  let now = expiry - 1;
  const files = createWeeklyReportFiles(f.store, { now:() => now });
  await files.prune();
  assert(await files.read(id, message));
  now = expiry;
  await files.prune();
  assert.equal(await files.read(id, message), null);
  assert.equal(await fs.readFile(manual, 'utf8'), '유지');
  assert.equal(f.store.session(id).messages.at(-1).text, reportBody);
});

test('저장 위치 선택 중 잠기거나 계정이 바뀌면 엑셀 내보내기를 중단하고 다시 저장할 수 있다', async t => {
  const f = await fixture(t);
  const id = f.session.id, message = f.answer.id;
  await autoSaveWorkArtifact(f.store, id);
  let permitted = true;
  const destination = path.join(f.temp, '저장 선택.xlsx');
  const service = createWeeklyReportFiles(f.store, {
    chooseDestination:async () => { permitted = false; return destination; },
    savePermission:() => () => { if (!permitted) throw Error('잠금 상태 변경'); },
  });
  await assert.rejects(service.save(id, message), /잠금 상태 변경/);
  await assert.rejects(fs.access(destination), { code:'ENOENT' });
  assert(await service.read(id, message));
});
