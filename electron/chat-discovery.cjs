const { samePath } = require('./path-boundary.cjs');
const path = require('node:path');
const { UUID, createJSON, readJSON, projectDirectory } = require('./project-store.cjs');
const { isSubagent, readThread } = require('./codex-transfer-data.cjs');
const { importedSession } = require('./codex-transfer-record.cjs');
const { materialize } = require('./codex-transfer-attachments.cjs');

function known(runtime, id) {
  return runtime.store.visibleSessions().some(session=>[session.threadId,session.sourceThreadId,
    session.codexLink?.sourceThreadId,session.desktopThread?.threadId].includes(id));
}

async function link(runtime, project, row, context) {
  const {store,controller} = runtime;
  const guard = () => {
    runtime.guard(context.owner,context.revision,context.epoch);
    if (!store.state.projects.includes(project) || known(runtime,row.id) || controller.trashRuntime.isBusy())
      throw Error('연결할 프로젝트나 대화의 상태가 바뀌었습니다.');
  };
  guard();
  if (runtime.isBusy()) return false;
  const finish = runtime.beginRefresh();
  runtime.busy = true;
  try {
    const thread=await readThread(runtime.client,row.id,project.path);
    guard();
    const data=await runtime.snapshot(row.id,project.path,false,context,thread);
    guard();
    if (!data.messages.some(message=>message.role==='user')) return false;
    const archivePath=await runtime.archive(project,data);
    const media=await materialize(store,project,data,guard,{resolveHistoryBase:id=>runtime.historyThread(id,data,context)});
    data.messages=media.messages;
    const session=importedSession({project,data,targetId:row.id,mode:'linked',ownerHash:context.owner,deviceHash:await runtime.device(),archivePath});
    if ((await controller.trashRuntime.excludedThreadIds()).has(row.id)) return false;
    guard();
    store.state.sessions.unshift(session);
    try {await store.save();}
    catch(error){store.state.sessions=store.state.sessions.filter(item=>item!==session);throw error;}
    runtime.guard(context.owner,context.revision,context.epoch);
    controller.emitEvent({type:'session',sessionId:session.id,session:structuredClone(session)});
    return true;
  } finally {runtime.busy=false;finish();}
}

async function discoveryState(runtime, context, key) {
  const since = Math.floor(Date.now()/1000);
  const device = await runtime.device();
  const directory = path.join(runtime.base, 'codex-discovery');
  await projectDirectory(directory);
  const file = path.join(directory, context.owner + '-' + context.revision + '-' + device + '.json');
  try { await createJSON(file, {since}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const saved = await readJSON(file);
  const registeredSince = Number.isSafeInteger(saved.since) && saved.since > 0 ? Math.min(since, saved.since) : since;
  runtime.guard(context.owner,context.revision,context.epoch);
  return {key, since, registeredSince, cursor:null, retry:new Map()};
}

async function discoverProjectThreads(rows,context,runtime,page={}) {
  const {store,controller}=runtime;
  if (!controller.trashRuntime || runtime.isBusy() || controller.trashRuntime.isBusy()) return;
  const key=JSON.stringify([context.owner,context.revision,context.epoch]);
  if (runtime.discovery?.key!==key) {
    // Older local history does not carry a verified account identity. It can
    // still be explicitly linked in Settings. Never adopt another account's history.
    runtime.discovery=await discoveryState(runtime,context,key);
  }
  const state=runtime.discovery, now=Date.now();
  for (const [id,until] of state.retry) if (until<=now) state.retry.delete(id);
  let batch=rows;
  if (page.nextCursor && state.cursor && page.params) {
    const next=await runtime.client.request('thread/list',{...page.params,cursor:state.cursor});
    if (!Array.isArray(next.data)) throw Error('Codex 대화 목록을 읽지 못했습니다.');
    batch=rows.concat(next.data);
    state.cursor=next.nextCursor && next.nextCursor!==state.cursor && next.data.some(r=>r.updatedAt>=state.registeredSince)?next.nextCursor:null;
  } else state.cursor=page.nextCursor || null;
  const excluded=await controller.trashRuntime.excludedThreadIds();
  let count=0;
  for (const row of batch) {
    if (count>=4) break;
    if (!row || !UUID.test(row.id) || !(row.createdAt>=state.registeredSince) || typeof row.cwd!=='string' || !row.cwd ||
        row.ephemeral || isSubagent(row) || /^flowrium(?:_|$)/i.test(row.originator || '') ||
        excluded.has(row.id) || state.retry.has(row.id) || known(runtime,row.id)) continue;
    const matching=store.state.projects.filter(p=>samePath(p.path,row.cwd));
    if (matching.length!==1) continue;
    const binding=matching[0].codexNameLink;
    if (binding && (binding.owner!==context.owner || row.projectId && row.projectId!==binding.id)) continue;
    // While the app was closed, trust the account's previously registered
    // project ID as well as the folder. Older path-only history needs selection.
    if (row.createdAt<state.since && (!binding || binding.id!==row.projectId)) continue;
    count++;
    try {if (!(await link(runtime,matching[0],row,context))) state.retry.set(row.id,now+4000);}
    catch(error) {
      runtime.guard(context.owner,context.revision,context.epoch);
      state.retry.set(row.id,now+30_000);
      if (!(controller.trashRuntime.isBusy() || known(runtime,row.id))) throw error;
    }
  }
}
module.exports={discoverProjectThreads};
