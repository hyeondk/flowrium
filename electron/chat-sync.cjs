const D = require('./codex-transfer-data.cjs');
const { UUID } = require('./project-store.cjs');

function bindNative(runtime, session, threadId, cwd) {
  if (!threadId || session.codexLink) return;
  if (session.desktopThread?.threadId === threadId && session.desktopThread.ownerHash !== runtime.owner()) {
    throw Error('이 대화에 연결한 계정으로 로그인해 주세요.');
  }
  session.desktopThread = { threadId, cwd, ownerHash: runtime.owner() };
}

function deferred(runtime, session) {
  const c = runtime.controller;
  return runtime.isBusy() || c.runs.has(session.id) || c.editingSessions.has(session.id) || session.compacting;
}

async function connection(runtime, session, context) {
  if (!session.threadId || session.codexLink?.mode === 'copy') throw Error('같은 대화로 연결한 뒤 다시 확인해 주세요.');
  const link = session.codexLink;
  if (link) {
    require('./codex-transfer-link.cjs').validateLink(link);
    if (link.ownerHash !== context.owner || link.sourceThreadId !== session.threadId || link.deviceHash !== await runtime.device()) {
      throw Error('이 대화를 연결한 계정과 기기를 확인해 주세요.');
    }
    return runtime.store.project(session.projectId).path;
  }
  if (session.desktopThread?.ownerHash !== context.owner || session.desktopThread.threadId !== session.threadId) {
    throw Error('이 기기에서 대화를 한 번 이어 쓴 뒤 확인해 주세요.');
  }
  return session.desktopThread.cwd;
}

function guardSession(runtime, session, id, context) {
  runtime.guard(context.owner, context.revision, context.epoch);
  if (runtime.store.session(session.id) !== session || session.threadId !== id) throw Error('대화가 변경되었습니다. 다시 확인해 주세요.');
}

const unfinished = status => status === 'inProgress' || status === 'in_progress';

async function probe(runtime, session, context, cwd) {
  const thread = await D.readThread(runtime.client, session.threadId, cwd);
  if (D.active(thread)) return { active: true };
  let newest;
  try {
    const page = await runtime.client.request('thread/turns/list', { threadId: thread.id, sortDirection: 'desc', limit: 1, itemsView: 'notLoaded' });
    if (!Array.isArray(page.data)) throw Error('최근 작업 기록을 확인하지 못했습니다.');
    newest = page.data[0];
  } catch (error) {
    if (error.rpcCode !== -32601 && !/(?:does not support|unsupported).*(?:pagination|method)/i.test(error.rpcMessage || '')) throw error;
    // 이전 서버는 메타데이터에 최근 작업의 종료 여부가 없으므로 전체 기록에서 확인합니다.
    return { thread };
  }
  guardSession(runtime, session, thread.id, context);
  if (unfinished(newest?.status)) return { active: true };
  return { thread, stamp: JSON.stringify([thread.updatedAt, thread.name, newest?.id, newest?.status, newest?.completedAt]) };
}

function mergeNative(local, incoming) {
  const localById=new Map(local.map(m=>[m.id,m]));
  const byTurn=Map.groupBy(incoming,m=>m.turnId), localByTurn=new Map(), matches=new Map();
  let lastTurn;
  for(const message of local){
    if(message.role==='user' && message.turnId)lastTurn=message.turnId;
    const turn=message.turnId || (message.role==='assistant' && lastTurn);
    if(!turn)continue;
    const group=localByTurn.get(turn)||[];group.push(message);localByTurn.set(turn,group);
  }
  for(const [turn,saved] of localByTurn){
    const source=byTurn.get(turn)||[];
    require('./codex-transfer-merge.cjs').matchExchanges(saved,source,matches);
  }
  const result=[];
  for(const item of incoming){
    const old=localById.get(item.id);
    const merged=matches.has(item.id)?matches.get(item.id):old?{...old,...item,...(require('./chat-long-request.cjs').retainsRequest(old,item)&&{text:old.text}),createdAt:old.createdAt}:item;
    if(merged)result.push(merged);
  }
  const preserved=new Set(result.map(m=>m.id));
  for(const own of local){
    if(preserved.has(own.id))continue;
    let at=result.length;
    while(at>0 && result[at-1].createdAt>own.createdAt)at--;
    result.splice(at,0,own);
  }
  return result;
}

async function refreshNative(runtime, session, cwd, context, thread) {
  const id = session.threadId;
  if (deferred(runtime, session)) return { sync: 'deferred' };
  const snapshot = await runtime.snapshot(id, cwd, false, context, thread);
  guardSession(runtime, session, id, context);
  if (snapshot.active) return { sync: 'active' };
  if (deferred(runtime,session)) return { sync: 'deferred' };
  const finishRefresh=runtime.beginRefresh();
  runtime.busy=true;
  try {
    let incoming=snapshot.messages;
    const remoteIds=new Set(snapshot.messages.map(m=>m.id));
    const ownedTurns=new Set(session.messages.filter(m=>m.role==='user'&&!remoteIds.has(m.id)).map(m=>m.turnId));
    const externalUsers=new Set(snapshot.messages.filter(m=>m.role==='user'&&!ownedTurns.has(m.turnId)).map(m=>m.id));
    const attachments=snapshot.attachments.filter(a=>externalUsers.has(D.stable('codex-message:'+id+':'+a.key+':0')));
    if(attachments.length){
      const project=runtime.store.project(session.projectId);
      const media=await require('./codex-transfer-attachments.cjs').materialize(runtime.store,project,{...snapshot,attachments},
        ()=>guardSession(runtime,session,id,context),{resolveHistoryBase:key=>runtime.historyThread(key,snapshot,context)});
      incoming=media.messages;
    }
    guardSession(runtime, session, id, context);
    const merged=mergeNative(session.messages,incoming);
    const title = snapshot.thread.name?.trim().slice(0,300) || session.title;
    if(title===session.title && JSON.stringify(merged)===JSON.stringify(session.messages))return {sync:'current'};
    const oldMessages = session.messages, oldDate = session.updatedAt, oldTitle = session.title;
    session.title = title;
    session.messages = merged;
    session.updatedAt = [oldDate, D.at(snapshot.thread.updatedAt)].sort().at(-1);
    try { await runtime.store.save(); } catch (error) {
      session.messages = oldMessages; session.updatedAt = oldDate; session.title = oldTitle;
      throw error;
    }
    guardSession(runtime, session, id, context);
    runtime.controller.emitEvent({ type: 'session', sessionId: session.id, session: structuredClone(session) });
    return { sync: 'current' };
  } finally { runtime.busy = false; finishRefresh(); }
}

async function sync(runtime, sessionId, force = false) {
  const session = runtime.store.session(D.id(sessionId));
  if (deferred(runtime, session)) return { sync: 'deferred' };
  if (!session.threadId && session.codexLink?.mode==='linked') {
    await runtime.refresh(session.id,{background:true});
    if (deferred(runtime,session)) return {sync:'deferred'};
  }
  const id = session.threadId;
  const context = await runtime.ready(true);
  const cwd = await connection(runtime, session, context);
  guardSession(runtime, session, id, context);
  const latest = await probe(runtime, session, context, cwd);
  guardSession(runtime, session, id, context);
  if (latest.active) return { sync: 'active' };
  if (deferred(runtime, session)) return { sync: 'deferred' };
  runtime.syncStamps ??= new Map();
  const key = context.owner + ':' + session.id + ':' + id;
  if (!force && latest.stamp && !session.codexLink?.activeAtImport && runtime.syncStamps.get(key) === latest.stamp) return { sync: 'current' };
  if (session.codexLink) {
    try { await runtime.refresh(session.id, { externalFinished: true }); }
    catch (error) {
      if (error.code === 'THREAD_ACTIVE') return { sync: 'active' };
      throw error;
    }
  } else {
    const result = await refreshNative(runtime, session, cwd, context, latest.thread);
    if (result.sync !== 'current') return result;
  }
  if (latest.stamp) {
    runtime.syncStamps.set(key, latest.stamp);
    if (runtime.syncStamps.size > 64) runtime.syncStamps.delete(runtime.syncStamps.keys().next().value);
  }
  return { sync: 'current' };
}

async function openDesktop(runtime, sessionId) {
  const context = await runtime.ready(true), session = runtime.store.session(D.id(sessionId)), id = session.threadId;
  if (!UUID.test(id) || deferred(runtime, session)) throw Error('작업이 끝난 로컬 대화를 선택해 주세요.');
  const cwd = await connection(runtime, session, context);
  await D.readThread(runtime.client, id, cwd);
  guardSession(runtime, session, id, context);
  if (deferred(runtime, session)) throw Error('현재 작업을 마친 뒤 데스크톱에서 이어가세요.');
  if (!runtime.options.openDesktopThread) throw Error('데스크톱 앱 연결을 사용할 수 없습니다.');
  await runtime.options.openDesktopThread('codex://threads/' + id);
  return { opened: true };
}

// Read title metadata for the sidebar too. Only an attached session in the
// current account and on this device may receive a title from the catalog.
async function listingTitles(runtime, context) {
  const sessions = (runtime.store.visibleSessions?.() || runtime.store.state.sessions).filter(session =>
    session.threadId && !session.pendingThreadName && !deferred(runtime,session) &&
    (session.codexLink?.mode === 'linked' && session.codexLink.ownerHash === context.owner ||
     !session.codexLink && session.desktopThread?.ownerHash === context.owner));
  if (!sessions.length) return {};
  const previousTitles = new Map(sessions.map(session => [session.id,session.title]));
  const hosts = new Map();
  for (const session of sessions) {
    try { hosts.set(session.threadId,{session,cwd:await connection(runtime,session,context)}); }
    catch { /* A portable copy from another device has no shared local thread. */ }
  }
  const titles = {};
  for (const archived of [false,true]) {
    if (!hosts.size) break;
    let cursor;
    const cursors = new Set();
    do {
      const result = await runtime.client.request('thread/list',{archived,limit:100,sortKey:'updated_at',
        sortDirection:'desc',sourceKinds:['appServer','cli','vscode','unknown'],useStateDbOnly:true,...(cursor?{cursor}:{})});
      runtime.guard(context.owner,context.revision,context.epoch);
      if (!Array.isArray(result.data)) throw Error('Codex 대화 목록을 확인할 수 없습니다.');
      for (const row of result.data) {
        const target = hosts.get(row.id);
        if (!target || typeof row.cwd !== 'string' || !require('./path-boundary.cjs').samePath(row.cwd,target.cwd)) continue;
        hosts.delete(row.id);
        if (typeof row.name === 'string' && row.name.trim()) titles[target.session.id] = row.name.trim().slice(0,300);
      }
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw Error('Codex 대화 목록의 다음 페이지를 확인할 수 없습니다.');
      if (cursor) cursors.add(cursor);
    } while (cursor && hosts.size);
  }
  const changed = [];
  for (const session of sessions) {
    const name = titles[session.id];
    if (!name || session.title===name || session.title!==previousTitles.get(session.id) || deferred(runtime,session) || session.pendingThreadName) continue;
    guardSession(runtime,session,session.threadId,context);
    changed.push({session,previous:session.title,name});
    session.title = name;
  }
  if (changed.length) {
    try { await runtime.store.save(); }
    catch(error){for(const {session,previous,name} of changed)if(session.title===name)session.title=previous;throw error;}
    runtime.guard(context.owner,context.revision,context.epoch);
  }
  return Object.fromEntries(sessions.map(session=>[session.id,session.title]));
}

async function rename(runtime, session, name) {
  if (!session.threadId || session.codexLink?.mode === 'copy' || !session.codexLink && !session.desktopThread) return;
  if (!runtime) throw Error('Codex 연결을 확인한 뒤 대화 이름을 다시 저장해 주세요.');
  const context = await runtime.ready(true), id = session.threadId;
  const cwd = await connection(runtime,session,context);
  await D.readThread(runtime.client,id,cwd);
  guardSession(runtime,session,id,context);
  await runtime.client.request('thread/name/set',{threadId:id,name});
  guardSession(runtime,session,id,context);
}

module.exports = { probe, bindNative, sync, openDesktop, mergeNative, listingTitles, rename };
