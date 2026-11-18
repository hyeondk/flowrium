// 이미 전달된 답변의 표시 형식만 읽는다. 이 기록으로 새 입력 요청을 만들거나 답을 재전송하지 않는다.
export function parseQuestionReply(source) {
  if (typeof source!=='string' || source.length>262144) return;
  const text=source.replace(/^(?:[ \t]*\r?\n)+/,'').replace(/\s+$/,'');
  // 전체 메시지가 알려진 전달 형식이어야 한다. 설명 속 예시 / 인용 / 코드 울타리 / 들여쓴 코드는 보존한다.
  const envelope=/^ {0,3}<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>$/.exec(text);
  if (!envelope) return;
  let rows;
  try {rows=JSON.parse(envelope[1]);} catch {return;}
  if (!Array.isArray(rows) || !rows.length || rows.length>32) return;
  const answers=[];
  for (const row of rows) {
    if (!row || typeof row!=='object' || Array.isArray(row)
        || Object.keys(row).some(key=>!['questionItemId','question','answer'].includes(key))) return;
    let id=row.questionItemId;
    // 데스크톱에서 보낸 기록은 배열 식별자를 한 번 더 문자열로 인코딩할 수 있다.
    if (typeof id==='string' && id.length<=4096) {
      try {id=JSON.parse(id);} catch {return;}
    }
    if (!Array.isArray(id) || id.length<2 || id.length>12
        || !['request_user_input_async','request_user_input'].includes(id[0])
        || id.some(part=>!(typeof part==='string' && part.length>0 && part.length<=512)
          && !(typeof part==='number' && Number.isSafeInteger(part)))) return;
    if (typeof row.question!=='string' || !row.question.trim() || row.question.length>16000
        || typeof row.answer!=='string' || !row.answer.trim() || row.answer.length>16000) return;
    answers.push({question:row.question,answer:row.answer});
  }
  return answers;
}
