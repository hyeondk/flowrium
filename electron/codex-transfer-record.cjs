const D = require('./codex-transfer-data.cjs');
const { mergeMessages } = require('./codex-transfer-merge.cjs');
const { validateSession } = require('./project-store.cjs');
const { validateLink } = require('./codex-transfer-link.cjs');

function importedSession({ project, data, existing, targetId, mode, ownerHash, deviceHash, archivePath }) {
  const threadId = data.thread.id;
  const updatedAt = D.at(data.thread.updatedAt);
  const session = {
    ...existing,
    id: existing?.id || D.stable('flowrium:codex:'+project.id+':'+threadId+':'+mode),
    projectId: project.id,
    title: String(data.thread.name || data.thread.preview || '제목 없는 대화').slice(0,300),
    threadId: targetId,
    sourceThreadId: threadId,
    createdAt: D.at(data.thread.createdAt),
    updatedAt,
    messages: mergeMessages(existing?.messages || [], data.messages),
    codexLink: {
      version:1, mode, sourceThreadId:threadId, ownerHash, deviceHash, archivePath,
      importedAt:existing?.codexLink?.importedAt || new Date().toISOString(),
      sourceUpdatedAt:updatedAt, snapshotHash:data.contentHash, activeAtImport:data.active,
      sourceMessageIds:data.messages.map(message=>message.id),
    },
  };
  validateLink(session.codexLink);
  validateSession(session,project.id);
  checkImportSize(session);
  return session;
}
function checkImportSize(session) {
  if(Buffer.byteLength(JSON.stringify(session,null,2))>120*1024*1024) throw Error('대화의 표시 기록이 120MB를 넘었습니다. 원문은 보관했으며 대화 본문을 잘라서 저장하지 않았습니다.');
}
module.exports = { importedSession, checkImportSize };
