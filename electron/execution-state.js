import { followupFromAnswer, publicLines } from './mobile/answer-followup.js';
export { QUESTION_DECISION_NOTICE } from './mobile/decision-notice.js';

const waitingByAnswer = new WeakMap();

export function asksToContinue(text) {
  const ending = publicLines(text).findLast(Boolean) || '';
  return Boolean(followupFromAnswer(text)) ||
    /(?:계속|진행|이어서|시작|다음|추가)[^?？]{0,180}(?:할까요|해\s*드릴까요|될까요|원하시나요|하실까요|하겠습니까)[?？]\s*$|(?:would you like me to|shall I|should I)[^?]{0,150}\?\s*$/i.test(ending);
}

export function continuationAnswer(session) {
  const last = session.messages.findLast(message => message.role !== 'system' || !message.progressCommentary);
  return last?.role === 'assistant' ? last : undefined;
}

export function awaitsContinuation(session) {
  if (session.workflow?.status === 'done' || session.compacting ||
    session.queuedMessages?.some(q => q.status === 'queued' || q.status === 'sending')) return false;
  const answer = continuationAnswer(session);
  if (!answer || (session.completedContinuationId && session.completedContinuationId === answer.id)) return false;
  const cached = waitingByAnswer.get(answer);
  if (cached?.text === answer.text) return cached.waiting;
  const waiting = asksToContinue(answer.text);
  waitingByAnswer.set(answer, {text: answer.text, waiting});
  return waiting;
}

export function visibleProposals(rows, now = Date.now()) {
  return rows.filter(p => !p.hidden && p.status === 'pending' && (!p.snoozedUntil || p.snoozedUntil <= now));
}

export function executionFor(session, running, deciding, unsettled = false) {
  if (deciding) return 'decision';
  if (running === true) return 'running';
  return !unsettled && awaitsContinuation(session) ? 'waiting' : null;
}
