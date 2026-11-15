const test = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/answer-followup.ts');

test('최근 답변의 구체적인 제안에서 편집 가능한 다음 요청을 만든다', async () => {
  const {followupFromAnswer} = await loaded;
  assert.equal(followupFromAnswer('검사를 마쳤습니다. 검색 결과의 정렬도 검증할까요?').prompt, '검색 결과의 정렬도 검증해 주세요.');
  const named = followupFromAnswer('수집 완료.\n\n**다음 단계**\n- 새 표의 누락 행을 확인해 주세요.\n- 표의 열 순서를 점검해 주세요.');
  assert.equal(named.prompt, '새 표의 누락 행을 확인해 주세요.');
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
