const { storeRequestSource } = require('./chat-attachments.cjs');
const { projectInlineLimit, sourceRecord } = require('./chat-long-request.cjs');

const pageSize = 12_000;
const reader = {
  name: 'flowrium_read_current_request',
  description: '이 작업에서 사용자가 보낸 긴 요청의 한 부분을 순서대로 읽습니다. 첫 부분 번호는 1입니다.',
  inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, required: ['page'], additionalProperties: false },
};

function pagesOf(text, size = pageSize) {
  const pages = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}

function readPage(run, args) {
  const pages = run.requestPages;
  if (!pages || !args || Object.keys(args).length !== 1 || !Number.isInteger(args.page) || args.page < 1 || args.page > pages.length)
    throw Error('현재 요청에서 읽을 수 있는 부분 번호를 선택해 주세요.');
  return { page: args.page, pages: pages.length, sha256:run.requestDigest, text: pages[args.page - 1] };
}

function projectPage(session, run, args) {
  if (session.scope || session.requestReaderThreadId !== run.threadId) throw Error('이 작업의 요청 원문을 확인할 수 없습니다.');
  return {contentItems:[{type:'inputText',text:JSON.stringify(readPage(run,args))}],success:true};
}

// Older threads have a fixed set of tools. Preserve their original thread and
// analyze every part in isolated, tool-free model calls before the final turn.
async function legacyNotes(controller, run, text, model, guard) {
  const schema = { type: 'object', properties: { notes: { type: 'string' } }, required: ['notes'], additionalProperties: false };
  const task = '최종 답변에 필요한 사용자 요청, 조건, 수치, 고유명사, 인용 위치를 보존해 한국어 4,000자 이내로 정리하세요. 작업을 직접 실행하지 마세요.';
  let parts = pagesOf(text, 48_000);
  do {
    const notes = [];
    for (const [i, part] of parts.entries()) {
      guard();
      controller.emitEvent({type:'status', sessionId:run.sessionId, status:'running', text:`긴 요청 읽는 중 (${i+1} / ${parts.length})`});
      const result = await require('./structured-analysis.cjs').runStructuredAnalysis(controller, {
        prompt: task + '\n\n' + part, schema, model,
      }, run);
      guard();
      if (typeof result.notes !== 'string' || !result.notes.trim() || result.notes.length > 8_000)
        throw Error('긴 요청의 일부를 정리하지 못했습니다. 입력 원문은 대화에 보존했습니다.');
      notes.push(result.notes);
    }
    const combined = notes.join('\n\n');
    if (combined.length <= 32_000) return combined;
    parts = pagesOf(combined, 48_000);
  } while (true);
}

async function scopedRequest(controller, run, session, message, model, guard) {
  if (!run.requestSource && message.length <= projectInlineLimit) return message;
  let source = run.requestSource;
  let text = message;
  if (source) {
    const file = await sourceRecord(controller.store, session.projectId, source.id, true);
    if (file.sha256 !== source.sha256)
      throw Error('저장한 긴 요청의 원본이 달라졌습니다.');
    text = file.bytes.toString('utf8');
  } else {
    source = await storeRequestSource(controller.store, session.projectId, text);
  }
  guard();
  const sent = session.messages.find(m => m.id === run.userMessageId);
  sent.requestSource = source;
  await controller.store.save();
  guard();
  const marker = '요청 원문 식별자 ' + source.sha256;
  if (session.requestReaderThreadId === run.threadId) {
    run.requestPages = pagesOf(text);
    run.requestDigest = source.sha256;
    return marker + '\n사용자가 보낸 긴 요청은 ' + run.requestPages.length + '부분입니다. ' + reader.name +
      ' 도구로 1부터 마지막 부분까지 순서대로 읽고 사용자의 요청에 답하세요. 첫 부분과 마지막 부분에 서로 다른 조건이 있을 수 있습니다.';
  }
  const notes = await legacyNotes(controller, run, text, model, guard);
  return marker + '\n사용자가 보낸 긴 요청의 모든 부분에서 추출한 요청과 근거입니다. 이를 바탕으로 답하세요. 정확한 인용이 필요한데 근거가 부족하면 그 부분을 명시하세요.\n\n' + notes;
}
module.exports = { reader, readPage, projectPage, scopedRequest, pagesOf };
