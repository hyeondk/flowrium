const { UUID } = require('./project-store.cjs');

const reasons = new Set(['점심', '퇴근', '회의', '기타']);
const statuses = new Set(['prepared', 'running', 'completed', 'failed', 'interrupted']);
const MAX_REPORTS = 64;
const invalid = () => Error('업무 마감 기록의 형식을 확인해 주세요.');

function validate(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
  const validBatch = batch => batch && UUID.test(batch.id) && reasons.has(batch.reason) &&
    typeof batch.memo === 'string' && batch.memo.length <= 11500 &&
    Array.isArray(batch.sessions) && batch.sessions.length <= MAX_REPORTS &&
    batch.sessions.every(row => row && UUID.test(row.sessionId) && UUID.test(row.projectId) &&
      UUID.test(row.submissionId) && statuses.has(row.status));
  const current = validBatch(saved.current) ? saved.current : undefined;
  const preparing = validBatch(saved.preparing) ? saved.preparing : undefined;
  if (current || preparing) return { current, preparing };
}

function prepare(saved, input, session) {
  if (!UUID.test(input.batchId) || !UUID.test(input.submissionId) || !reasons.has(input.reason) ||
      (input.memo !== undefined && (typeof input.memo !== 'string' || input.memo.length > 11500 || input.memo.includes('\0'))) ||
      session?.workflow?.kind !== 'pause' || session.scope || session.workflow.status === 'done') throw invalid();
  const memo = input.memo?.trim() || '';
  const snapshot = structuredClone(saved || {});
  if (session.messages.some(message => message.role === 'user' && message.id !== input.submissionId))
    throw Error('새로 시작하는 업무 마감 대화만 복귀 기록에 추가할 수 있습니다.');
  const key = snapshot.current?.id === input.batchId ? 'current' : 'preparing';
  let batch = snapshot[key];
  if (batch?.id !== input.batchId) {
    batch = { id: input.batchId, reason: input.reason, memo, sessions: [] };
    snapshot[key] = batch;
  }
  if (batch.reason !== input.reason || batch.memo !== memo) throw invalid();
  const previous = batch.sessions.find(row => row.sessionId === session.id);
  if (previous) {
    if (previous.submissionId !== input.submissionId) throw invalid();
    return saved;
  }
  if (batch.sessions.length >= MAX_REPORTS) throw invalid();
  batch.sessions.push({
    sessionId: session.id, projectId: session.projectId, submissionId: input.submissionId, status: 'prepared',
  });
  return snapshot;
}

function registered(snapshot, event) {
  for (const key of ['current', 'preparing']) {
    const row = snapshot?.[key]?.sessions.find(item => item.sessionId === event.sessionId && item.submissionId === event.submissionId);
    if (row) return { key, row, batch: snapshot[key] };
  }
}

function belongsTo(saved, batchId, event) {
  const match = registered(saved, event);
  return match?.batch.id === batchId && Boolean(event.turnId) &&
    (!match.row.turnId || match.row.turnId === event.turnId);
}

function start(saved, event) {
  const match = registered(saved, event);
  if (!match || match.row.status !== 'prepared' || !event.turnId || !event.startedAt) return saved;
  const snapshot = structuredClone(saved);
  const { key, row, batch } = registered(snapshot, event);
  Object.assign(row, { status: 'running', turnId: event.turnId, startedAt: event.startedAt });
  batch.startedAt ||= event.startedAt;
  if (key === 'preparing') {
    snapshot.current = batch;
    delete snapshot.preparing;
  }
  return snapshot;
}

function finish(saved, event) {
  const match = registered(saved, event);
  if (!match || !['completed', 'failed', 'interrupted'].includes(event.status)) return saved;
  if (match.row.status === 'running' && match.row.turnId === event.turnId) {
    const snapshot = structuredClone(saved);
    registered(snapshot, event).row.status = event.status;
    return snapshot;
  }
  // A rejected launch stays available to a retry with the same submission ID.
  return saved;
}

function recover(saved, store, runs) {
  let snapshot = saved;
  for (const key of ['current', 'preparing']) {
    for (const row of saved?.[key]?.sessions || []) {
      const session = store.peekSession(row.sessionId);
      const index = session?.messages.findIndex(message => message.role === 'user' && message.id === row.submissionId) ?? -1;
      if (index < 0) continue;
      const message = session.messages[index];
      const event = { ...row, turnId: message.turnId, startedAt: message.workStartedAt };
      if (row.status === 'prepared') snapshot = start(snapshot, event);
      if (registered(snapshot, event)?.row.status !== 'running') continue;
      const run = runs.get(row.sessionId);
      if (run?.userMessageId === row.submissionId && !run.finalized) continue;
      const nextUser = session.messages.findIndex((item, at) => at > index && item.role === 'user');
      const output = session.messages.slice(index + 1, nextUser === -1 ? undefined : nextUser);
      const stopped = output.find(item => item.role === 'system' && /^(작업을 완료하지 못했습니다\.|사용자의 요청으로 작업이 중지됐습니다\.)/.test(item.text));
      const status = /^작업을 완료하지 못했습니다\./.test(stopped?.text || '') ? 'failed'
        : !stopped && message.workCompletedAt && output.some(item => item.role === 'assistant' && item.turnId === message.turnId)
          ? 'completed' : 'interrupted';
      snapshot = finish(snapshot, { ...event, turnId: row.turnId || event.turnId, status });
    }
  }
  return snapshot;
}

function resumeView(batch, includeMemo = false) {
  if (!batch?.startedAt) return;
  const { id, reason, startedAt, notificationId } = batch;
  const sessions = batch.sessions.filter(row => row.status !== 'prepared')
    .map(({ sessionId, projectId, status }) => ({ sessionId, projectId, status }));
  if (!sessions.length) return;
  return { id, reason, startedAt, sessions, ...(notificationId && { notificationId }),
    ...(includeMemo && batch.memo && { memo: batch.memo }) };
}

module.exports = { validate, prepare, start, finish, recover, resumeView, belongsTo };
