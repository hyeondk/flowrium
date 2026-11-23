const names = {
  commandExecution: ['command', '명령 실행'],
  fileChange: ['file', '파일 변경'],
  webSearch: ['search', '웹 검색'],
  mcpToolCall: ['tool', '연결 도구'],
  dynamicToolCall: ['tool', '작업 도구'],
  collabAgentToolCall: ['agent', '하위 에이전트'],
  subAgentActivity: ['agent', '하위 에이전트'],
  imageView: ['image', '이미지 확인'],
  imageGeneration: ['image', '이미지 생성'],
  contextCompaction: ['context', '문맥 정리'],
};
const states = ['running', 'completed', 'failed', 'interrupted'];
const kinds = [...new Set([...Object.values(names).map(([kind]) => kind), 'approval', 'question'])];
const validText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const activityName = value => validText(value, 120) && /^[\p{L}\p{N} _.,+()@-]+$/u.test(value) ? value.trim() : undefined;
const filename = value => typeof value === 'string' ? activityName(value.split(/[/\\]/).at(-1)) : undefined;
const executable = action => {
  if (typeof action?.command !== 'string') return;
  const match = /^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s;|&]+))/.exec(action.command.trim());
  const name = filename(match?.[1] || match?.[2] || match?.[3]);
  return /^(?:bash|bun|cat|curl|deno|diff|find|git|grep|jq|ls|node|npm|npx|pnpm|powershell|pwsh|python[\d.]*|rg|sed|sh|tar|type|unzip|where|which|yarn|zsh)(?:\.exe)?$/i.test(name || '') ? name : undefined;
};

function activityTarget(kind, item, actions, files) {
  if (kind === 'command') {
    const detail = actions.flatMap(action => {
      if (action?.type === 'read') return filename(action.name) || filename(action.path) || [];
      if (['listFiles', 'search'].includes(action?.type)) return filename(action.path) || [];
      return executable(action) || [];
    });
    return [...new Set(detail)].slice(0, 2).join(' / ') || executable(item);
  }
  if (kind === 'file') return [...new Set(files.map(file => filename(file.path)).filter(Boolean))].slice(0, 2).join(' / ') || undefined;
  if (kind === 'image' && item.type === 'imageView') return filename(item.path);
  if (kind === 'search') {
    const source = sourceAddress(item.action?.url);
    return source ? new URL(source).hostname : undefined;
  }
  if (kind === 'tool') {
    return [activityName(item.appContext?.appName || item.server), activityName(item.appContext?.actionName || item.tool)]
      .filter(Boolean).join(' / ') || undefined;
  }
}

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
  if (item.type === 'subAgentActivity') {
    const state = {started:'running', interacted:'running', interrupted:'interrupted', completed:'completed'}[item.kind];
    if (!states.includes(state) || !validText(item.agentThreadId, 300)) return [];
    const name = activityName(agentNames?.get(item.agentThreadId)) || filename(item.agentPath);
    return [{id:item.agentThreadId, state, ...(name && {name})}];
  }
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
    const name = activityName(agentNames?.get(id));
    return [{ id, state, ...(name && {name}) }];
  });
}

function projectWorkStep(item, {createdAt, completedAt, running=false, agentNames} = {}) {
  const config = item && Object.hasOwn(names, item.type) && names[item.type];
  if (!config || !validText(item.id, 300) || !createdAt) return;
  const [kind, defaultLabel] = config;
  const actions = kind === 'command' && Array.isArray(item.commandActions) ? item.commandActions.slice(0, 30) : [];
  const exitCode = !running && kind === 'command' && Number.isSafeInteger(item.exitCode) && item.exitCode !== 0 ? item.exitCode : undefined;
  const noMatches = exitCode === 1 && actions.length === 1 && actions[0]?.type === 'search' && /^(?:rg|grep)(?:\.exe)?$/i.test(executable(actions[0]) || '');
  const declined = !running && item.status === 'declined';
  const state = running ? 'running' : item.status === 'interrupted' || declined ? 'interrupted'
    : !noMatches && (item.status === 'failed' || item.error || item.result?.isError || item.success === false || exitCode !== undefined) ? 'failed' : 'completed';
  const label = actions.some(action => action?.type === 'read') ? '파일 읽기'
    : actions.some(action => action?.type === 'listFiles') ? '파일 목록 확인'
    : actions.some(action => action?.type === 'search') ? '파일 검색'
    : kind === 'search' && item.action?.type === 'openPage' ? '웹 페이지 열기'
    : kind === 'search' && item.action?.type === 'findInPage' ? '웹 페이지에서 찾기' : defaultLabel;
  const files = kind === 'file' && Array.isArray(item.changes) ? item.changes.slice(0, 100).map(fileChange).filter(Boolean) : [];
  const agents = kind === 'agent' ? agentStates(item, agentNames) : [];
  const sourceUrl = kind === 'search' && state === 'completed' && ['openPage','findInPage'].includes(item.action?.type) ? sourceAddress(item.action.url) : undefined;
  const target = activityTarget(kind, item, actions, files);
  return {id:item.id, label, state, createdAt, kind,
    ...(state !== 'running' && completedAt && {completedAt}),
    ...(target && {target}), ...(noMatches && {outcome:'noMatches'}), ...(declined && {outcome:'declined'}),
    ...(!noMatches && exitCode !== undefined && {exitCode}),
    ...(files.length && {files}), ...(agents.length && {agents}), ...(sourceUrl && {sourceUrl})};
}

function validDetail(step) {
  const {kind, files, agents, sourceUrl, target, exitCode, outcome} = step;
  return (kind === undefined || kinds.includes(kind)) &&
    (target === undefined || validText(target, 250)) &&
    (exitCode === undefined || Number.isSafeInteger(exitCode)) &&
    (outcome === undefined || ['noMatches', 'declined'].includes(outcome)) &&
    (files === undefined || (Array.isArray(files) && files.length <= 100 && files.every(file => file && validText(file.path, 4096) &&
      [file.added,file.removed].every(n => n === undefined || Number.isSafeInteger(n) && n >= 0)))) &&
    (agents === undefined || (Array.isArray(agents) && agents.length <= 100 && agents.every(agent => agent && validText(agent.id, 300) &&
      states.includes(agent.state) && (agent.name === undefined || validText(agent.name, 120))))) &&
    (sourceUrl === undefined || sourceAddress(sourceUrl) === sourceUrl);
}

module.exports = { projectWorkStep, validDetail };
