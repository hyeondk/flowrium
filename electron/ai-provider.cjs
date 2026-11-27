function checkedProvider(value) {
  if (value !== undefined && value !== 'codex' && value !== 'claude')
    throw Error('AI 서비스를 확인해 주세요.');
  return value;
}

function boundProvider(session) {
  if (session.threadId || session.desktopThread || session.codexLink || session.sourceThreadId) return 'codex';
  const first = session.messages?.find(message => message.role === 'assistant' || message.role === 'user');
  if(first)return first.provider || 'codex';
  const pending = session.queuedMessages?.find(message => message.status === 'queued' || message.status === 'sending');
  return pending ? pending.provider || 'codex' : undefined;
}

function providerFor(session, requested, settings) {
  checkedProvider(requested);
  const bound = boundProvider(session);
  if (settings.providerMode !== 'mixed' && bound) {
    if (requested && bound!==requested) throw Error('양방향 동기화에서는 같은 프로젝트의 다른 AI 서비스 대화를 열어 주세요.');
    return bound;
  }
  return requested || session.preferences?.provider || session.provider || bound || 'codex';
}

function allowsParallel(session,settings){
  // A work item produces one result and one artifact. Chat turns have no shared output target.
  return settings.providerMode === 'mixed' && !session.workflow;
}

module.exports = { checkedProvider, boundProvider, providerFor, allowsParallel };
