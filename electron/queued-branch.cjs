const {randomUUID} = require('node:crypto');
const {samePath} = require('./path-boundary.cjs');
const {readThread} = require('./codex-transfer-data.cjs');

async function forkQueuedRequest(controller, session, entry, check) {
  const {store, codexTransfer: runtime} = controller;
  const link = session.codexLink;
  const binding = session.desktopThread;
  if (!runtime || session.scope || (link ? link.mode !== 'linked' : !binding))
    throw Error('같은 Codex 대화에 연결된 대기 요청만 바로 분기할 수 있습니다.');
  const context = await runtime.ready(true);
  const project = store.project(session.projectId);
  const access = await controller.projectAccess(session, entry.mode);
  if (link) {
    require('./codex-transfer-link.cjs').validateLink(link);
    if (link.ownerHash !== context.owner || link.deviceHash !== await runtime.device())
      throw Error('원본 대화를 연결한 계정과 기기를 확인해 주세요.');
    await runtime.resolveLinkedThread(session, project, context);
  } else if (binding.ownerHash !== context.owner || binding.threadId !== session.threadId) {
    throw Error('원본 대화를 연결한 계정을 확인해 주세요.');
  }
  const source = session.threadId;
  const cwd = link ? project.path : binding.cwd;
  const guard = () => {
    runtime.guard(context.owner, context.revision, context.epoch);
    if (session.threadId !== source || (link ? session.codexLink !== link : session.desktopThread !== binding))
      throw Error('원본 대화가 바뀌었습니다. 대기 요청을 다시 확인해 주세요.');
    check();
  };
  guard();
  if (!samePath(cwd, access.cwd)) throw Error('원본 대화의 프로젝트 작업 위치를 확인해 주세요.');
  const client = runtime.client;
  await readThread(client, source, cwd);
  guard();
  const recent = await client.request('thread/turns/list', {
    threadId: source, sortDirection: 'desc', itemsView: 'notLoaded', limit: 20,
  });
  guard();
  if (!Array.isArray(recent.data)) throw Error('원본 대화의 최근 완료 지점을 확인할 수 없습니다.');
  const anchorIndex = recent.data.findIndex(turn => turn.status === 'completed');
  const anchor = recent.data[anchorIndex];
  let threadId;
  let messages = [];
  if (anchor) {
    const forkClient = controller.client;
    await forkClient.start(store.state.settings.codexPath);
    const {account} = await forkClient.request('account/read', {refreshToken: false});
    if (await controller.accountObserved?.(account) || account?.type !== 'chatgpt')
      throw Error('연결 계정이 바뀌었습니다. 다시 보내 주세요.');
    guard();
    const fork = await forkClient.request('thread/fork', {
      threadId: source, lastTurnId: anchor.id, excludeTurns: true, cwd,
      sandbox: access.sandbox, approvalPolicy: access.approvalPolicy, approvalsReviewer: access.approvalsReviewer,
      ...(entry.model && {model: entry.model}),
    });
    guard();
    if (!fork.thread?.id || fork.thread.id === source)
      throw Error('새 Codex 분기 대화를 확인하지 못했습니다.');
    threadId = fork.thread.id;
    const later = new Set(recent.data.slice(0, anchorIndex).map(turn => turn.id));
    const boundary = session.messages.findIndex(message => later.has(message.turnId));
    messages = session.messages.slice(0, boundary < 0 ? undefined : boundary)
      .map(message => ({...message, id: randomUUID()}));
  }
  guard();
  const preferences = {...session.preferences};
  delete preferences.chatGptUrl;
  const workflow = session.workflow && {...structuredClone(session.workflow), status: 'active'};
  if (workflow) delete workflow.completion;
  const branch = await store.createSession(session.projectId, {
    title: `분기 (${session.title})`.slice(0, 300), threadId, messages, workflow, preferences,
    defaultProjectMode: session.defaultProjectMode,
    applicationTools: Boolean(threadId && session.applicationTools),
  });
  if (threadId) controller.loadedThreads.add(threadId);
  return branch;
}

module.exports = {forkQueuedRequest};
