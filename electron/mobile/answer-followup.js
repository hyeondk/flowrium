// Recommendations only use published conversation text, on this device.
const decline = /(?:추천|제안|후속(?:\s*작업)?|다음\s*(?:단계|작업)|추가\s*질문)[^.!?\n]{0,24}(?:하지\s*마|지\s*말|없이|빼|생략|금지|필요\s*없|원하지\s*않)|(?:do not|don't|no)\s+(?:suggest|recommend|follow[ -]?up)/i;
const sectionHeading = /^(?:다음\s*(?:작업|단계)|후속\s*작업|남은\s*(?:작업|사항)|next steps?)\s*(?:[:：]\s*(.*))?$/i;
const actionNoun = /(?:정리|비교|검토|작성|검증|분류|분석|확인|점검|시험|수정|추가|변환|요약|제작|구현|적용|진행|실행|대조|측정|반영|조사|계산|선정|생성)$/;
function toRequest(sentence, inSection) {
  let text = sentence.trim().replace(/^(?:원하시면|원한다면|필요하시면)\s*[,，]?\s*/, '');
  if (text.length < 6 || text.length > 190 || /https?:|[`<>\[\]{}"“”]|(?:어떤|무엇|어떻게|어느|아니면|또는)\s|(?:완료|해결|불필요|없음|생략)(?:했습니다|됐습니다|됨)?[.!]?$/.test(text)) return;
  const requestEnd = /(?:할까요|해\s*드릴까요|해\s*볼까요)[?？]$/;
  if (requestEnd.test(text)) text = text.replace(requestEnd, '해줘');
  else if (!inSection) return;
  else if (/해\s*(?:주세요|줘요|줘)[.!]?$/.test(text)) text = text.replace(/해\s*(?:주세요|줘요|줘)[.!]?$/, '해줘');
  else {
    text = text.replace(/[.]$/, '').replace(/하기$/, '');
    if (!actionNoun.test(text)) return;
    text += '해줘';
  }
  if (text.split(/\s+/).length < 2 || /^(?:(?:이대로|그대로|계속|이어서|다음\s*단계(?:를|로)?)\s*)*(?:이어서\s*)?(?:진행|계속|시작)해줘$/.test(text)) return;
  return {source:'conversation', title:text, prompt:text, reason:'직전 답변의 다음 작업'};
}
export function followupFromAnswer(text) {
  if (!text) return;
  let fence = '', writing = false, next = false, suggestion;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence) && line.trim() === marker) fence = '';
      next = false;
      continue;
    }
    if (fence) continue;
    if (/^ {0,3}:::writing\b/.test(line)) { writing = true; next = false; continue; }
    if (writing) { if (/^ {0,3}:::\s*$/.test(line)) writing = false; continue; }
    if (!line.trim()) continue;
    if (line.length > 4096 || /^(?: {4}|\t|\s*[>{[|"])/.test(line)) { next = false; continue; }
    const body = line.trim().replace(/\*\*|__/g, '').replace(/^#{1,6}\s+/, '');
    const heading = sectionHeading.exec(body);
    if (heading) {
      next = true;
      suggestion = heading[1] ? toRequest(heading[1], true) : undefined;
      continue;
    }
    const task = /^(?:[-*+]\s+|\d+[.)]\s+)(?:\[ \]\s*)?/.exec(body);
    if (next && task) { suggestion ||= toRequest(body.slice(task[0].length), true); continue; }
    if (next && !suggestion) suggestion = toRequest(body, true);
    next = false;
    const question = toRequest(body.split(/(?<=[.!?。])\s+/).at(-1), false);
    if (question) suggestion = question;
  }
  return suggestion;
}
function normalized(text) {
  return text.normalize('NFC').replace(/(?:해주세요|해\s*주세요|해줘요?|부탁해요?)[.!\s]*$/,'').replace(/[\s\p{P}]/gu,'');
}
export function originalAnswerFollowups(session) {
  const messages = session?.messages || [];
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || session.completedContinuationId === last.id && last.id || session.workflow?.status === 'done') return [];
  const request = messages.findLast(row => row.role === 'user')?.text || '';
  if (decline.test(request)) return [];
  const candidate = followupFromAnswer(last.text);
  if (!candidate) return [];
  const key = normalized(candidate.prompt);
  if (messages.slice(-12).some(row => row.role === 'user' && row.text.length < 500 && normalized(row.text) === key)) return [];
  return [candidate];
}
