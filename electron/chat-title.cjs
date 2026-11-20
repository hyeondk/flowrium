const defaultTitles = new Set(['새로운 작업', '새 일반 대화', '새 통합 채팅']);
const letter = /[\p{L}\p{N}]/u;

function suggestConversationTitle(request, attachments = []) {
  const first = request.slice(0, 6000)
    .replace(/^\s*(?:```|~~~)[^\n]*\n[\s\S]*?^\s*(?:```|~~~)[^\n]*$/gm, ' ')
    .replace(/https?:\/\/[^\s>]+/gi, ' ')
    .replace(/(?:^|\s)["']?(?:~\/|\/(?:Users|home|private|var|tmp)\/|[A-Z]:\\)[^\s]+/gi, ' ')
    .replace(/^\s*(?:#{1,6}|[-*>]|\d+[.)])\s+/gm, '')
    .replace(/^(?:\s*(?:안녕하세요|안녕|반갑습니다)[!.,\s]+)+/u, '');
  const sentences = first.split(/[\r\n]+|[.!?](?=\s|$)/);
  for (const sentence of sentences) {
    const subject = sentence.replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
      .replace(/^(?:(?:위|이|해당)\s*(?:프로젝트|자료|내용)(?:를|을)?\s*(?:참고|바탕)\s*(?:해서|해|으로)\s*|(?:먼저|지금|오늘|우선|혹시|부탁인데)\s+|(?:please|could you|can you)\s+)+/iu, '')
      .replace(/\s+(?:작성|정리|검토|확인|수정|만들어|처리|진행)(?:해)?\s*(?:주세요|줘|주실래요|줄래요|주시면 좋겠어요)$/u, '')
      .replace(/(?:을|를)\s*$/u, '')
      .replace(/[\t ]+/g, ' ').trim();
    if (!letter.test(subject) || /^(?:안녕|안녕하세요|반갑습니다)$/u.test(subject)) continue;
    return shorten(subject);
  }
  const filename = attachments[0]?.name?.replace(/\.[^.\s]{1,12}$/u, '').trim();
  if (filename && letter.test(filename)) return shorten(filename + ' 확인');
  return '새 대화';
}

function shorten(value) {
  const characters = Array.from(value);
  if (characters.length <= 32) return value;
  const prefix = characters.slice(0, 32).join('');
  const lastSpace = prefix.lastIndexOf(' ');
  return (lastSpace > 12 ? prefix.slice(0, lastSpace) : prefix).replace(/[,\s:/-]+$/u, '');
}

module.exports = {defaultTitles, suggestConversationTitle};
