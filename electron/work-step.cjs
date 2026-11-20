const names = {
  commandExecution: ['command', '명령 실행'],
  fileChange: ['file', '파일 변경'],
  webSearch: ['search', '웹 검색'],
  mcpToolCall: ['tool', '연결 도구'],
  dynamicToolCall: ['tool', '작업 도구'],
  collabAgentToolCall: ['agent', '하위 에이전트'],
  imageView: ['image', '이미지 확인'],
  imageGeneration: ['image', '이미지 생성'],
  contextCompaction: ['context', '문맥 정리'],
};
const states = ['running', 'completed', 'failed', 'interrupted'];
const kinds = Object.values(names).map(([kind]) => kind);
const validText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);

function sourceAddress(value) {
  if (!validText(value, 2048)) return;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2048) return url.href;
  } catch {}
}

function fileChange(change) {
  if (!validText(change?.path, 4096)) return;
  const file = { path: change.path };
  const diff = change.diff;
  if (typeof diff !== 'string' || diff.length > 1_000_000) return file;
  let added = 0, removed = 0, inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) inHunk = true;
    else if (line.startsWith('diff --git')) inHunk = false;
    else if (inHunk && line.startsWith('+')) added++;
    else if (inHunk && line.startsWith('-')) removed++;
  }
  return { ...file, added, removed };
}

function agentStates(item, agentNames) {
  const known = item.agentsStates;
  const ids = new Set([...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []), ...Object.keys(known || {})]);
  return [...ids].slice(0, 100).filter(id => validText(id, 300)).flatMap(id => {
    const status = Object.hasOwn(known || {}, id) ? known[id]?.status : undefined;
    let state;
    if (status === 'completed') state = 'completed';
    if (status === 'running' || status === 'pendingInit' || !status && ['spawnAgent', 'resumeAgent'].includes(item.tool)) state = 'running';
    if (status === 'errored' || status === 'notFound') state = 'failed';
    if (status === 'interrupted' || status === 'shutdown') state = 'interrupted';
    if (!state) return [];
    const name = agentNames?.get(id);
    return [{ id, state, ...(validText(name, 120) && {name}) }];
  });
}

function projectWorkStep(item, {createdAt, completedAt, running=false, agentNames} = {}) {
  const config = item && Object.hasOwn(names, item.type) && names[item.type];
  if (!config || !validText(item.id, 300) || !createdAt) return;
  const [kind, defaultLabel] = config;
  const state = running ? 'running' : item.status === 'interrupted' ? 'interrupted'
    : ['failed', 'declined'].includes(item.status) || item.error || item.result?.isError || (typeof item.exitCode === 'number' && item.exitCode !== 0) ? 'failed' : 'completed';
  const actions = kind === 'command' && Array.isArray(item.commandActions) ? item.commandActions : [];
  const label = actions.some(action => action?.type === 'read') ? '파일 읽기'
    : actions.some(action => action?.type === 'listFiles') ? '파일 목록 확인'
    : actions.some(action => action?.type === 'search') ? '파일 검색' : defaultLabel;
  const files = kind === 'file' && Array.isArray(item.changes) ? item.changes.slice(0, 100).map(fileChange).filter(Boolean) : [];
  const agents = kind === 'agent' ? agentStates(item, agentNames) : [];
  const sourceUrl = kind === 'search' && state === 'completed' && ['openPage','findInPage'].includes(item.action?.type) ? sourceAddress(item.action.url) : undefined;
  return {id:item.id, label, state, createdAt, kind,
    ...(state !== 'running' && completedAt && {completedAt}),
    ...(files.length && {files}), ...(agents.length && {agents}), ...(sourceUrl && {sourceUrl})};
}

function validDetail(step) {
  const {kind, files, agents, sourceUrl} = step;
  return (kind === undefined || kinds.includes(kind)) &&
    (files === undefined || (Array.isArray(files) && files.length <= 100 && files.every(file => file && validText(file.path, 4096) &&
      [file.added,file.removed].every(n => n === undefined || Number.isSafeInteger(n) && n >= 0)))) &&
    (agents === undefined || (Array.isArray(agents) && agents.length <= 100 && agents.every(agent => agent && validText(agent.id, 300) &&
      states.includes(agent.state) && (agent.name === undefined || validText(agent.name, 120))))) &&
    (sourceUrl === undefined || sourceAddress(sourceUrl) === sourceUrl);
}

module.exports = { projectWorkStep, validDetail };
