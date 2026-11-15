const { samePath } = require('./path-boundary.cjs');
const { pages } = require('./history.cjs');
const { readDetails, updateDetails } = require('./project-details.cjs');

function orderedIds(projects, order) {
  const ids = new Set(projects.map(project => project.id));
  const listed = order.filter(id => ids.delete(id));
  return [...listed, ...ids];
}

function rootMatches(project, row) {
  return row.roots?.some(root => typeof root.path === 'string' && samePath(root.path,project.path));
}
function matchProjects(projects, remote) {
  const matches = new Map();
  const keys = new Set();
  for (const project of projects) {
    const candidates = remote.filter(row => rootMatches(project,row));
    if (candidates.length !== 1 || candidates[0].roots.length !== 1) continue;
    const row = candidates[0];
    // A multi-root project can cover several local cards. Never rename or move
    // somebody else's card by treating that ambiguous association as one-to-one.
    if (keys.has(row.id)) {
      for (const [key, value] of matches) if (value.id === row.id) matches.delete(key);
    } else {
      keys.add(row.id);
      matches.set(project.id, row);
    }
  }
  return matches;
}

function withRemoteOrder(order, matches) {
  const ordered = order.filter(id => matches.has(id)).sort((a, b) => matches.get(a).position - matches.get(b).position);
  let index = 0;
  return order.map(id => matches.has(id) ? ordered[index++] : id);
}

async function catalog(store, getRuntime, verifiedContext) {
  const runtime = getRuntime?.();
  if (!runtime?.controller?.status?.authenticated) return;
  const context = verifiedContext || await runtime.ready(true);
  const guard = () => runtime.guard(context.owner, context.revision, context.epoch);
  guard();
  let remote=[], status="supported";
  try {
    remote = await pages(runtime.client, 'project/list', {limit:100, sortKey:'position', sortDirection:'asc'});
  } catch (error) {
    if (error.rpcCode===-32601 || /experimentalApi|experimental api|not supported/i.test(error.rpcMessage||'')) status='unsupported';
    else status='unavailable';
  }
  guard();
  return {guard, runtime, remote, status, matches:matchProjects(store.state.projects, remote), context};
}

function nameStatus(project,source) {
  if (!source) return project.pendingCodexName?'queued':'offline';
  if (project.pendingCodexName && project.pendingCodexName.owner!==source.context.owner)return 'differentAccount';
  if (source.status!=='supported') return source.status;
  if (source.matches.has(project.id)) {
    const row=source.matches.get(project.id),pending=project.pendingCodexName;
    if(source.runtime.projectNameUnsupported?.has('update'))return 'unsupported';
    if(row.name?.length>140)return 'longName';
    if(pending && pending.id!==row.id)return 'differentAccount';
    if(pending && row.name!==pending.before && row.name!==pending.name)return 'conflict';
    return 'linked';
  }
  return source.remote.some(row=>rootMatches(project,row)) ? 'ambiguous' : source.runtime.projectNameUnsupported?.has('create') ? 'unsupported' : 'local';
}

async function renameProject(store,getRuntime,project,name) {
  const source=await catalog(store,getRuntime);
  const status=nameStatus(project,source);
  if (status==='unavailable') throw Error('Codex 프로젝트 목록을 읽지 못했습니다. 이름을 저장하려면 다시 시도해 주세요.');
  if (status==='offline' || status==='queued') {
    const last=project.codexNameLink;
    if(last)return {pending:{owner:last.owner,id:last.id,before:last.name,name}};
    return;
  }
  if (status==='ambiguous' || status==='unsupported') return;
  if (status==='differentAccount')throw Error('이름 변경을 보관한 원래 Codex 계정으로 연결해 주세요.');
  source.guard();
  if(store.project(project.id)!==project)throw Error('프로젝트 등록 상태가 바뀌었습니다. 목록에서 다시 선택해 주세요.');
  if (status==='local') {
    try {
      const result=await source.runtime.client.request('project/create',{
        name,roots:[{path:project.path}],idempotencyKey:project.id
      });
      source.guard();
      if (!result?.project || !rootMatches(project,result.project) || result.project.roots.length!==1)throw Error('등록된 Codex 프로젝트 폴더를 확인할 수 없습니다.');
      if(result.project.name!==name)await source.runtime.client.request('project/update',{projectId:result.project.id,name});
      source.guard();return {link:{owner:source.context.owner,id:result.project.id,name}};
    } catch(error) {
      if(error.rpcCode!==-32601)throw error;
      // A mixed-version server can list projects while lacking the create method.
      (source.runtime.projectNameUnsupported??=new Set()).add('create');
      return;
    }
  } else {
    const row=source.matches.get(project.id);
    if(row.name!==name){
      try{await source.runtime.client.request('project/update',{projectId:row.id,name});}
      catch(error){if(error.rpcCode!==-32601)throw error;(source.runtime.projectNameUnsupported??=new Set()).add('update');return;}
    }
    source.guard();return {link:{owner:source.context.owner,id:row.id,name}};
  }
}

async function incomingNames(store, source) {
  if (!source) return;
  const changed=[];
  try {
    for (const [id, row] of source.matches) {
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 140) continue;
      const project=store.project(id), pending=project.pendingCodexName;
      const status=nameStatus(project,source);
      if(status==='differentAccount' || status==='conflict' || status==='unsupported')continue;
      let name=row.name;
      if(pending && pending.name!==name) {
        source.guard();
        await source.runtime.client.request('project/update',{projectId:row.id,name:pending.name});
        source.guard();
        name=pending.name;
      }
      const link=project.codexNameLink;
      if(!pending && link?.owner===source.context.owner && link.id===row.id && link.name===name && project.name===name)continue;
      if(project.name!==name){
        let details;
        try{details=await readDetails(store,id);}catch{continue;}
        source.guard();
        if(details.kickoff && details.kickoff.name!==name)await updateDetails(store,id,details.revision,{action:'display-name',name});
      }
      source.guard();
      changed.push({project,name:project.name,link,pending});
      project.name=name;
      project.codexNameLink={owner:source.context.owner,id:row.id,name};
      delete project.pendingCodexName;
    }
    if(changed.length)await store.save();
  } catch(error) {
    for(const saved of changed){
      saved.project.name=saved.name;
      if(saved.link)saved.project.codexNameLink=saved.link;else delete saved.project.codexNameLink;
      if(saved.pending)saved.project.pendingCodexName=saved.pending;else delete saved.project.pendingCodexName;
    }
    throw error;
  }
}

async function pushMove(source, order, id) {
  if (!source?.matches.has(id)) return;
  const selected = source.matches.get(id);
  const next = order.filter(i => source.matches.has(i)).map(i => source.matches.get(i).id);
  const known = new Set(next);
  const prior = source.remote.filter(row => known.has(row.id)).map(row => row.id);
  if (next.every((key, i) => key === prior[i])) return;
  let before = next[next.indexOf(selected.id) + 1];
  if (!before) {
    const preceding = next[next.length - 2];
    const others = source.remote.filter(row => row.id !== selected.id);
    before = others[others.findIndex(row => row.id === preceding) + 1]?.id;
  }
  source.guard();
  await source.runtime.client.request('project/move', {projectId:selected.id, beforeProjectId:before || null});
  source.guard();
}

module.exports = {orderedIds, withRemoteOrder, matchProjects, catalog, nameStatus, renameProject, incomingNames, pushMove};
