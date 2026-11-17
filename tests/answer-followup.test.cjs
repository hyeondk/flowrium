const test = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/answer-followup.ts');

test('최근 답변의 구체적인 제안에서 편집 가능한 다음 요청을 만든다', async () => {
  const {followupFromAnswer} = await loaded;
  assert.equal(followupFromAnswer('검사를 마쳤습니다. 검색 결과의 정렬도 검증할까요?').prompt, '검색 결과의 정렬도 검증해줘');
  const named = followupFromAnswer('수집 완료.\n\n**다음 단계**\n- 새 표의 누락 행을 확인해 주세요.\n- 표의 열 순서를 점검해 주세요.');
  assert.equal(named.prompt, '새 표의 누락 행을 확인해줘');
  assert.equal(named.source, 'conversation');
});

test('완료 보고, 열린 질문, 인용, 작성물, 코드 예시를 새 작업으로 제시하지 않는다', async () => {
  const {followupFromAnswer} = await loaded;
  for (const text of [
    '작업을 완료했습니다.', '그대로 진행할까요?', '어느 표를 먼저 검증할까요?',
    '남은 사항: 보관이 필요합니다.', '다음 단계: 남은 작업은 없습니다.',
    '> 다음 단계: 파일 목록을 확인해 주세요.',
    ':::writing{variant="note"}\n다음 단계: 표의 정합성을 확인해 주세요.\n:::',
    ['예시', '```text', '다음 단계: 검색 목록을 확인해 주세요.', '```'].join('\n'),
    '{"type":"function_call_output","call_id":"a","output":"다음 단계: 표 대조"}',
  ]) assert.equal(followupFromAnswer(text), undefined, text);
});

test('마지막 답변만 읽고 거부, 중복, 대기 완료, 빈 대화를 존중한다', async () => {
  const {originalAnswerFollowups} = await loaded;
  const user = {role:'user', text:'최근 응답을 검토해줘'};
  const answer = {id:'last', role:'assistant', text:'다음 작업: 판매표의 누락 행을 확인해 주세요.'};
  for (const session of [
    undefined, {messages:[]}, {messages:[answer,user]},
    {messages:[user,{...answer,text:'판매표를 확인했습니다.'}]},
    {messages:[{...user,text:'후속 작업 추천은 하지 마세요.'},answer]},
    {messages:[{...user,text:'판매표의 누락 행을 확인해줘'},answer]},
    {messages:[user,answer],completedContinuationId:'last'}, {messages:[user,answer],workflow:{status:'done'}},
  ]) assert.deepEqual(originalAnswerFollowups(session), []);
  const session = {messages:[user,{...answer,text:'긴 본문 '.repeat(20000)+'\n'+answer.text}]};
  const before = JSON.stringify(session);
  const suggestions = originalAnswerFollowups(session);
  assert.deepEqual(suggestions.map(s => s.prompt),['판매표의 누락 행을 확인해줘']);
  assert.equal(JSON.stringify(session),before);
});
