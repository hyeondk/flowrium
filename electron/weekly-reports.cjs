const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { samePath, relativePath } = require('./path-boundary.cjs');
const { createOperationCache } = require('./operation-cache.cjs');
const { publishNewFile, UUID } = require('./project-store.cjs');
const { weeklyRows, writeWeeklyWorkbook } = require('./weekly-workbook.cjs');

const sevenDays = 7 * 24 * 60 * 60 * 1000;
const pendingName = /^[a-f0-9-]{36}--[a-f0-9-]{36}\.xlsx$/i;
const reportsByStore = new WeakMap();

function createWeeklyReportFiles(store, { now = Date.now, chooseDestination, savePermission } = {}) {
  async function directory(create = false) {
    const root = path.join(await fs.realpath(path.dirname(store.file)), 'weekly-report-files');
    if (create) await fs.mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    try {
      const stat = await fs.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fs.realpath(root), root))
        throw Error('임시 보고서 폴더의 위치를 확인해 주세요.');
      return root;
    } catch (error) {
      if (error.code === 'ENOENT' && !create) return null;
      throw error;
    }
  }

  function answerFor(sessionId, answerId) {
    if (!UUID.test(sessionId || '') || !UUID.test(answerId || '')) throw Error('저장할 보고서를 선택하세요.');
    const session = store.session(sessionId);
    const answer = session.messages.find(message => message.id === answerId && message.role === 'assistant' && message.text.trim());
    if (session.workflow?.kind !== 'weekly' || !answer) throw Error('이 대화에서 작성한 업무보고를 찾지 못했습니다.');
    return { session, answer };
  }

  function fileName(session) {
    const base = session.title.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
    const title = Array.from(base).slice(0, 60).join('') || '주간업무보고';
    return (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(title) ? '주간업무보고 ' + title : title) + '.xlsx';
  }

  async function reportStat(file) {
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return stat?.isFile() && !stat.isSymbolicLink() ? stat : null;
  }

  async function forget(file, expected) {
    const current = await reportStat(file);
    if (current && current.dev === expected.dev && current.ino === expected.ino && current.mtimeMs === expected.mtimeMs)
      await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }

  async function locate(sessionId, answerId) {
    const { session } = answerFor(sessionId, answerId);
    const root = await directory();
    if (!root) return null;
    const file = path.join(root, sessionId + '--' + answerId + '.xlsx');
    const stat = await reportStat(file);
    if (!stat) return null;
    const expires = stat.mtimeMs + sevenDays;
    if (expires <= now()) {
      await forget(file, stat);
      return null;
    }
    return { file, root, stat, session, info: { name: fileName(session), expiresAt: new Date(expires).toISOString() } };
  }

  async function prune() {
    const root = await directory();
    if (!root) return;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isFile() || !pendingName.test(entry.name)) continue;
      const file = path.join(root, entry.name);
      const stat = await reportStat(file);
      if (stat && stat.mtimeMs + sevenDays <= now()) await forget(file, stat);
    }
  }

  async function generate(sessionId, answerId) {
    const { session, answer } = answerFor(sessionId, answerId);
    const root = await directory(true);
    const file = path.join(root, sessionId + '--' + answerId + '.xlsx');
    if (await reportStat(file)) return;
    const { from, to } = session.workflow;
    const day = new Date(answer.createdAt);
    const createdAt = [day.getFullYear(), day.getMonth() + 1, day.getDate()].map(value => String(value).padStart(2, '0')).join('-');
    const project = store.project(session.projectId);
    const rows = weeklyRows(answer.text, session.workflow.reportProjects?.length > 1 ? '공통' : project.name);
    const data = await writeWeeklyWorkbook({ title: session.title, from, to, createdAt, ...rows });
    const cache = await createOperationCache('.flowrium-weekly-', root);
    try {
      const staged = path.join(cache.directory, 'report.xlsx');
      const handle = await fs.open(staged, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally { await handle.close(); }
      try { await publishNewFile(staged, file); }
      catch (error) { if (error.code !== 'EEXIST' || !(await reportStat(file))) throw error; }
    } finally { await cache.cleanup(); }
  }

  async function save(sessionId, answerId) {
    if (!chooseDestination || !savePermission) throw Error('데스크톱 앱에서 저장 위치를 선택하세요.');
    const verifyPermission = savePermission();
    const report = await locate(sessionId, answerId);
    if (!report) throw Error('보고서 보관이 끝났습니다. 보고서를 다시 작성해 주세요.');
    verifyPermission();
    const chosen = await chooseDestination(report.info.name);
    if (!chosen) return false;
    verifyPermission();
    if (!path.isAbsolute(chosen) || path.extname(chosen).toLowerCase() !== '.xlsx') throw Error('엑셀 파일 이름으로 저장하세요.');
    const current = await locate(sessionId, answerId);
    if (!current || current.stat.dev !== report.stat.dev || current.stat.ino !== report.stat.ino)
      throw Error('보고서 보관이 끝났습니다. 보고서를 다시 작성해 주세요.');
    const destinationDirectory = await fs.realpath(path.dirname(chosen));
    const inside = relativePath(report.root, destinationDirectory);
    if (!inside || (!path.isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + path.sep)))
      throw Error('보고서를 보관할 다른 폴더를 선택하세요.');
    const destination = path.join(destinationDirectory, path.basename(chosen));
    const handle = await fs.open(report.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let data;
    try {
      const opened = await handle.stat();
      if (opened.dev !== report.stat.dev || opened.ino !== report.stat.ino || opened.mtimeMs !== report.stat.mtimeMs || opened.size > 4 * 1024 * 1024)
        throw Error('보관한 보고서가 변경되었습니다.');
      data = await handle.readFile();
    } finally { await handle.close(); }
    const cache = await createOperationCache('.flowrium-weekly-', destinationDirectory);
    try {
      const temp = path.join(cache.directory, 'report.xlsx');
      await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
      verifyPermission();
      if (report.session !== store.session(sessionId)) throw Error('대화가 변경되었습니다. 보고서를 다시 선택하세요.');
      await fs.rename(temp, destination);
    } finally { await cache.cleanup(); }
    await forget(report.file, report.stat);
    return true;
  }

  return { generate, prune, read: async (id, message) => (await locate(id, message))?.info ?? null, save };
}

function weeklyReportFiles(store) {
  if (!reportsByStore.has(store)) reportsByStore.set(store, createWeeklyReportFiles(store));
  return reportsByStore.get(store);
}

function registerWeeklyReportFiles(register, store, options) {
  const storage = createWeeklyReportFiles(store, options);
  reportsByStore.set(store, storage);
  register('readWeeklyReportFile', (id, answerId) => storage.read(id, answerId));
  register('saveWeeklyReportFile', (id, answerId) => storage.save(id, answerId));
  const cleanup = () => storage.prune().catch(error => console.warn('주간업무보고 만료 정리', error.code || error.name));
  void cleanup();
  setInterval(cleanup, 60 * 1000).unref();
}

module.exports = { createWeeklyReportFiles, registerWeeklyReportFiles, weeklyReportFiles };
