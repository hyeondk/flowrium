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
function kickoffFields(input) {
  const fields = { name: 140, category: 80, phase: 80, privacy: 80, client: 200, owner: 150, members: 1500, goal: 4000,
    startedAt: 10, dueDate: 10, repository: 300, notes: 8000 };
  const values = {};
  for (const [key, limit] of Object.entries(fields)) values[key] = field(input?.[key] ?? '', limit);
  if (!values.phase) values.phase='킥오프';
  if (!values.privacy) values.privacy='일반';
  if (!values.name) throw new Error('프로젝트 이름을 입력해 주세요.');
  for (const day of [values.startedAt, values.dueDate]) {
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day)) throw invalid();
  }
  if (values.startedAt && values.dueDate && values.startedAt > values.dueDate) throw new Error('목표일이 시작일보다 빠릅니다.');
  if (values.repository && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(values.repository)) {
    throw new Error('GitHub 저장소의 HTTPS 주소를 입력해 주세요.');
  }
  return values;
}
function day(value) { return value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value); }
function relative(value) {
  return typeof value === 'string' && value.length < 1200 && !path.isAbsolute(value) && !value.includes('\\') && !/[:\x00-\x1f]/.test(value) && !value.split('/').some(p => ['..','.git','.flowrium'].includes(p));
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
  if (data.periodGoals !== undefined) {
    if (!Array.isArray(data.periodGoals) || data.periodGoals.length>4000 || data.periodGoals.some(g=>!g ||
      !UUID.test(g.id) || typeof g.done!=="boolean" || !field(g.text,500) ||
      !(g.period==="month"?/^\d{4}-(0[1-9]|1[0-2])$/.test(g.key):g.period==="week" && /^\d{4}-\d{2}-\d{2}$/.test(g.key) &&
      Number.isFinite(Date.parse(g.key)) && new Date(g.key).toISOString().slice(0,10)===g.key))) throw invalid();
  }
  const goals = data.periodGoals || [];
  if (new Set(goals.map(g => g.id)).size !== goals.length || goals.some(g =>
    (g.parent !== undefined && !goals.some(p => p.id === g.parent && p.period === 'month' && g.period === 'week')) ||
    (g.target !== undefined && (!Number.isFinite(g.target) || g.target <= 0)) ||
    (g.current !== undefined && (!Number.isFinite(g.current) || g.current < 0 || g.target === undefined)) ||
    (g.due !== undefined && !day(g.due)) || (g.carriedTo !== undefined && !UUID.test(g.carriedTo)))) throw invalid();
  if (data.schedule !== undefined && (!Array.isArray(data.schedule) || data.schedule.length > 100 || data.schedule.some(e =>
    !e || !UUID.test(e.id) || !Number.isInteger(e.day) || e.day < 0 || e.day > 6 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(e.time) || !field(e.text, 500)))) throw invalid();
  if (data.repositories !== undefined && (!Array.isArray(data.repositories) || data.repositories.length > 32 || new Set(data.repositories.map(r => r.id)).size !== data.repositories.length ||
    new Set(data.repositories.map(r => r.path)).size !== data.repositories.length || data.repositories.some(r => !r || !UUID.test(r.id) || !field(r.name, 100) || !relative(r.path) ||
      (r.github && !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(r.github)) || (r.account && !/^[a-zA-Z0-9-]{1,39}$/.test(r.account)) ||
      (r.base && (typeof r.base !== 'string' || r.base.length > 200 || /[\x00-\x20~^:?*\[\\]/.test(r.base))) || (r.hidden !== undefined && typeof r.hidden !== 'boolean')))) throw invalid();
  if (data.chatCwd !== undefined && !relative(data.chatCwd)) throw invalid();
  if (data.services !== undefined && (!Array.isArray(data.services) || data.services.length>32 || new Set(data.services.map(s=>s.id)).size!==data.services.length || data.services.some(s=>!s||!UUID.test(s.id)||!field(s.name,100)||!relative(s.cwd)||!field(s.command,2000)))) throw invalid();
  if (data.kickoff !== undefined) kickoffFields(data.kickoff);
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
    case 'import': {
      const allowed=['kickoff','periodGoals','owner','goal','dueDate','archivedAt','checklist','repositories','chatCwd','schedule','services'];
      if(!change.data || typeof change.data!=='object')throw invalid();
      for(const key of allowed) if(Object.hasOwn(change.data,key))data[key]=structuredClone(change.data[key]);
      break;
    }
    case 'kickoff': {
      const values = kickoffFields(change.input);
      data.kickoff = values;
      data.owner = values.owner;
      data.goal = values.goal;
      data.dueDate = values.dueDate;
      break;
    }
    case 'details':
      data.owner = field(change.owner, 150);
      data.goal = field(change.goal, 4000);
      data.dueDate = field(change.dueDate, 10);
      break;
    case 'goal-add': {
      data.periodGoals ||= [];
      data.periodGoals.push({id:randomUUID(),period:change.period,key:change.key,text:field(change.text,500),done:false,
        ...(change.parent ? {parent:change.parent} : {}), ...(change.target !== undefined ? {target:change.target,current:0} : {}), ...(change.due ? {due:change.due} : {})});
      break;
    }
    case 'goal-check':
    case 'goal-remove': {
      const index=(data.periodGoals||[]).findIndex(g=>g.id===change.id);
      if(index<0)throw invalid();
      if(change.action==='goal-remove') {
        const [removed] = data.periodGoals.splice(index,1);
        for (const child of data.periodGoals) if(child.parent === removed.id) delete child.parent;
      }
      else { if(typeof change.done!=='boolean')throw invalid(); data.periodGoals[index].done=change.done; }
      break;
    }
    case 'goal-progress': {
      const goal = data.periodGoals?.find(g => g.id === change.id);
      if (!goal || goal.target === undefined || !Number.isFinite(change.current) || change.current < 0) throw invalid();
      goal.current = change.current; break;
    }
    case 'goal-carry': {
      const goal = data.periodGoals?.find(g => g.id === change.id);
      if (!goal || goal.period !== 'week' || goal.carriedTo || !day(change.key) || change.key <= goal.key) throw invalid();
      const next = {...goal,id:randomUUID(),key:change.key,done:false,carriedFrom:goal.id};
      delete next.carriedTo; goal.carriedTo=next.id; data.periodGoals.push(next); break;
    }
    case 'schedule':
      data.schedule = (change.entries || []).map(e => ({id:e.id || randomUUID(),day:e.day,time:e.time,text:field(e.text,500)})); break;
    case 'repositories':
      data.repositories = structuredClone(change.repositories);
      data.chatCwd = change.chatCwd || '.';
      if(change.services !== undefined)data.services=structuredClone(change.services);
      break;
    case 'repository-hide': {
      const repo = data.repositories?.find(r => r.id === change.id);
      if(!repo || typeof change.hidden !== 'boolean') throw invalid();
      repo.hidden = change.hidden; break;
    }
    case 'phase':
      data.kickoff ||= kickoffFields({name:change.name || '프로젝트'});
      if(!['킥오프','진행','유지보수','중단','완료'].includes(change.phase)) throw invalid();
      data.kickoff.phase = change.phase;
      if(change.phase === '완료') data.archivedAt ||= new Date().toISOString(); else data.archivedAt=null;
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
  if (data.kickoff) Object.assign(data.kickoff, { owner: data.owner, goal: data.goal, dueDate: data.dueDate });
  return validate(data);
}
async function readDetails(store, projectId) {
  return latest(await folderFor(store, projectId), projectId);
}
async function updateDetails(store, projectId, previous, change) {
  const folder = await folderFor(store, projectId);
  const current = await latest(folder, projectId);
  if (current.revision !== previous) throw conflict();
  const data = apply({ ...structuredClone(current), revision: randomUUID() }, change);
  if ((change?.action === 'repositories' || change?.action === 'import') && data.repositories) {
    const { inside } = require('./project-repositories.cjs');
    const root = await fs.realpath(store.project(projectId).path);
    for (const repo of data.repositories) await inside(root,repo.path);
    await inside(root,data.chatCwd || '.');
    for(const service of data.services || [])await inside(root,service.cwd);
  }
  try {
    await createJSON(path.join(folder, (previous || 'first') + '.json'), { version: 1, previous, data });
  } catch (error) { if (error.code === 'EEXIST') throw conflict(); throw error; }
  return data;
}
function registerProjectDetails(register, store) {
  register('readProjectDetails', (projectId) => readDetails(store, projectId));
  register('updateProjectDetails', (projectId, previous, change) => updateDetails(store, projectId, previous, change));
}
module.exports = { registerProjectDetails, readDetails, updateDetails, kickoffFields, validateDetails:validate };
