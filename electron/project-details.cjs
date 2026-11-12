const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { projectDirectory, createJSON, readJSON, UUID } = require('./project-store.cjs');

const invalid = () => new Error('프로젝트 상세 정보의 형식을 확인해 주세요.');
const conflict = () => new Error('다른 위치에서 프로젝트 상세 정보를 변경했습니다. 새로고침한 뒤 다시 수정해 주세요.');
function blank(projectId) {
  return { projectId, revision: null, owner: '', goal: '', dueDate: '', archivedAt: null, checklist: [] };
}
function field(value, max) {
  if (typeof value !== 'string' || value.length > max) throw invalid();
  return value.trim();
}
function validate(data) {
  if (!UUID.test(data.projectId) || !UUID.test(data.revision)) throw invalid();
  field(data.owner, 150); field(data.goal, 4000);
  if (data.dueDate !== '' && (typeof data.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate) ||
      !Number.isFinite(Date.parse(data.dueDate)) || new Date(data.dueDate).toISOString().slice(0, 10) !== data.dueDate)) throw invalid();
  if (data.archivedAt !== null && (typeof data.archivedAt !== 'string' || !Number.isFinite(Date.parse(data.archivedAt)))) throw invalid();
  if (!Array.isArray(data.checklist) || data.checklist.length > 250 ||
      !data.checklist.every((item) => item && UUID.test(item.id) && !!field(item.text, 500) && typeof item.done === 'boolean') ||
      new Set(data.checklist.map((item) => item.id)).size !== data.checklist.length) throw invalid();
  return data;
}
async function folderFor(store, projectId) {
  if (typeof projectId !== 'string' || !UUID.test(projectId)) throw invalid();
  const project = store.project(projectId);
  if (path.relative(project.path, await fs.realpath(project.path)) !== '') throw conflict();
  const root = path.join(project.path, '.flowrium');
  await projectDirectory(root);
  const metadata = await readJSON(path.join(root, 'project.json'));
  if (metadata.id !== projectId) throw conflict();
  const folder = path.join(root, 'details');
  await projectDirectory(folder);
  return folder;
}
async function latest(folder, projectId) {
  const records = new Map();
  for (const name of await fs.readdir(folder)) {
    if (!name.endsWith('.json')) continue;
    const previous = name.slice(0, -5);
    if (previous !== 'first' && !UUID.test(previous)) throw conflict();
    const record = await readJSON(path.join(folder, name));
    if (record.version !== 1 || record.previous !== (previous === 'first' ? null : previous) || record.data?.projectId !== projectId) throw conflict();
    records.set(previous, validate(record.data));
  }
  let current = blank(projectId);
  let visited = 0;
  while (records.has(current.revision || 'first') && visited <= records.size) {
    current = records.get(current.revision || 'first');
    visited++;
  }
  if (visited !== records.size) throw conflict();
  return current;
}
function apply(data, change) {
  switch (change?.action) {
    case 'details':
      data.owner = field(change.owner, 150);
      data.goal = field(change.goal, 4000);
      data.dueDate = field(change.dueDate, 10);
      break;
    case 'archive': data.archivedAt ||= new Date().toISOString(); break;
    case 'resume': data.archivedAt = null; break;
    case 'add': {
      const text = field(change.text, 500);
      if (!text) throw invalid();
      data.checklist.push({ id: randomUUID(), text, done: false }); break;
    }
    case 'check':
    case 'remove': {
      const index = data.checklist.findIndex((item) => item.id === change.id);
      if (index < 0) throw new Error('체크리스트 항목을 찾을 수 없습니다.');
      if (change.action === 'remove') data.checklist.splice(index, 1);
      else {
        if (typeof change.done !== 'boolean') throw invalid();
        data.checklist[index].done = change.done;
      }
      break;
    }
    default: throw invalid();
  }
  return validate(data);
}
function registerProjectDetails(register, store) {
  register('readProjectDetails', async (projectId) => latest(await folderFor(store, projectId), projectId));
  register('updateProjectDetails', async (projectId, previous, change) => {
    const folder = await folderFor(store, projectId);
    const current = await latest(folder, projectId);
    if (current.revision !== previous) throw conflict();
    const data = apply({ ...current, revision: randomUUID() }, change);
    try {
      // 이전 리비전 하나에는 후속 파일을 하나만 기록할 수 있다.
      await createJSON(path.join(folder, (previous || 'first') + '.json'), { version: 1, previous, data });
    } catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error; }
    return data;
  });
}
module.exports = { registerProjectDetails };
