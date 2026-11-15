const { samePath } = require('./path-boundary.cjs');
const { pages } = require('./history.cjs');
const { readDetails, updateDetails } = require('./project-details.cjs');

function orderedIds(projects, order) {
  const ids = new Set(projects.map(project => project.id));
  const listed = order.filter(id => ids.delete(id));
  return [...listed, ...ids];
}

function matchProjects(projects, remote) {
  const matches = new Map();
  const keys = new Set();
  for (const project of projects) {
    const candidates = remote.filter(row => row.roots?.some(root => typeof root.path === 'string' && samePath(root.path, project.path)));
    if (candidates.length !== 1) continue;
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

async function catalog(store, getRuntime) {
  const runtime = getRuntime?.();
  if (!runtime?.controller?.status?.authenticated) return;
  const context = await runtime.ready(true);
  const guard = () => runtime.guard(context.owner, context.revision, context.epoch);
  let remote;
  try {
    remote = await pages(runtime.client, 'project/list', {limit:100, sortKey:'position', sortDirection:'asc'});
  } catch (error) {
    if (error.rpcCode === -32601) return;
    throw error;
  }
  guard();
  return {guard, runtime, remote, matches:matchProjects(store.state.projects, remote), context};
}

async function incomingNames(store, source) {
  if (!source) return;
  const renamed=[];
  try {
    for (const [id, row] of source.matches) {
      if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 140) continue;
      const project = store.project(id);
      if (project.name === row.name) continue;
      let details;
      try {details=await readDetails(store,id);}
      catch {continue;} // A disconnected volume must not stop the other cards from syncing.
      source.guard();
      if (details.kickoff && details.kickoff.name !== row.name) {
        await updateDetails(store, id, details.revision, {action:'display-name', name:row.name});
      }
      source.guard();
      renamed.push({project,before:project.name});
      project.name = row.name;
    }
    if (renamed.length) await store.save();
  } catch (error) {
    for (const {project,before} of renamed) project.name=before;
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

module.exports = {orderedIds, withRemoteOrder, matchProjects, catalog, incomingNames, pushMove};
