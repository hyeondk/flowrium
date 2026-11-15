export function asksToContinue(text) {
  const ending = text.trim().split(/\n\s*\n/).at(-1) || '';
  return /(?:계속|진행|이어서|시작|다음|추가|원하|선택|알려)[\s\S]{0,180}(?:할까요|해드릴까요|될까요|원하시나요|주세요|하실까요|하겠습니까)[?？.!\s]*$|(?:would you like|shall I|should I)[\s\S]{0,150}\?\s*$/i.test(ending);
}

export function awaitsContinuation(session) {
  if (session.workflow?.status === 'done') return false;
  if (session.queuedMessages?.some(q => q.status === 'queued' || q.status === 'sending')) return true;
  const last = session.messages.at(-1);
  if (last?.role !== 'assistant' || (session.completedContinuationId && session.completedContinuationId === last.id)) return false;
  return asksToContinue(last.text);
}

export function visibleProposals(rows, now = Date.now()) {
  return rows.filter(p => !p.hidden && p.status === 'pending' && (!p.snoozedUntil || p.snoozedUntil <= now));
}

export function executionFor(session, activity, deciding) {
  if (deciding) return 'decision';
  if (activity) return 'running';
  return awaitsContinuation(session) ? 'waiting' : null;
}
