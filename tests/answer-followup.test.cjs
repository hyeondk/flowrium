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
    {messages:[user,answer],completedContinuationId:'last'},
  ]) assert.deepEqual(originalAnswerFollowups(session), []);
  const session = {messages:[user,{...answer,text:'긴 본문 '.repeat(20000)+'\n'+answer.text}]};
  const before = JSON.stringify(session);
  const suggestions = originalAnswerFollowups(session);
  assert.deepEqual(suggestions.map(s => s.prompt),['판매표의 누락 행을 확인해줘']);
  assert.equal(JSON.stringify(session),before);
});

test('완료 상태와 뒤따른 작업 로그에도 본문에 있는 다음 행동을 제안한다', async()=>{
  const {originalAnswerFollowups,latestFollowupAnswer}=await loaded;
  const answer={id:'a',role:'assistant',text:'월별 매출을 분석했습니다. 다음에는 채널별 매출을 비교할 수 있어요.'};
  const session={workflow:{status:'done'},messages:[{role:'user',text:'월별 매출을 분석해줘'},answer,{role:'system',text:'작업을 완료했습니다.'}]};
  assert.equal(latestFollowupAnswer(session),answer);
  assert.equal(originalAnswerFollowups(session)[0].prompt,'채널별 매출을 비교해줘');
  assert.deepEqual(originalAnswerFollowups({...session,messages:[...session.messages,{role:'user',text:'다른 작업을 시작해줘'}]}),[]);
});

test('완료 보고의 미검증 사항을 구체적인 다음 요청으로 보존한다',async()=>{
  const {followupFromAnswer}=await loaded;
  assert.equal(followupFromAnswer('검증 결과\n데스크톱 동작을 확인했습니다.\n남은 사항\n휴대폰에서 직접 재접속하는 시험은 이번에 수행하지 않았습니다.').prompt,'휴대폰에서 직접 재접속하는 시험을 진행해줘');
  assert.equal(followupFromAnswer('모바일 재접속은 아직 확인하지 못했습니다.').prompt,'모바일 재접속을 확인해줘');
  assert.equal(followupFromAnswer('휴대폰 재접속 검증이 남았습니다.').prompt,'휴대폰 재접속 검증을 진행해줘');
  assert.equal(followupFromAnswer('외부 배포는 의도적으로 진행하지 않았습니다.'),undefined);
});

test('다음이라는 접두어가 없어도 구체적인 산출 제안과 공개된 비교 항목을 활용한다',async()=>{
  const {followupFromAnswer,originalAnswerFollowups}=await loaded;
  assert.equal(followupFromAnswer('갈림길과 쉬어 갈 곳을 표로 정리할 수 있어요.').prompt,'갈림길과 쉬어 갈 곳을 표로 정리해줘');
  const make=text=>({messages:[{role:'user',text:'차이를 자세히 설명해줘'},{role:'assistant',text}]});
  assert.equal(originalAnswerFollowups(make('세 가지 비교 기준입니다.\n- 비용은 A가 낮습니다.\n- 처리 시간은 B가 짧습니다.\n- 지원 범위는 C가 넓습니다.'))[0].prompt,'답변에 나온 비교 기준과 차이를 한 표로 정리해줘');
  assert.equal(originalAnswerFollowups(make('연결 방법은 다음 순서입니다.\n1. 실행 환경을 확인합니다.\n2. 연결 주소를 설정합니다.\n3. 다시 연결해 동작을 확인합니다.'))[0].prompt,'안내한 작업 순서를 실행할 수 있는 체크리스트로 정리해줘');
  assert.deepEqual(originalAnswerFollowups(make('완료 항목입니다.\n- 문서를 작성했습니다.\n- 폴더를 정리했습니다.\n- 파일을 저장했습니다.')),[]);
});

test('명시 제안 없는 분석 완료에서도 문맥에 맞는 후속 작업을 찾고 이미 한 요청은 반복하지 않는다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const user={role:'user',text:'온라인 스토어의 월별 매출을 분석해줘'};
  const answer={role:'assistant',text:'월별 매출 분석을 완료했습니다. 최근 3개월의 주문 데이터와 전월 대비 변화를 정리했습니다.'};
  const session={workflow:{status:'done'},messages:[user,answer]},before=JSON.stringify(session);
  assert.equal(originalAnswerFollowups(session)[0].prompt,'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  assert.equal(JSON.stringify(session),before);
  assert.deepEqual(originalAnswerFollowups({messages:[user,{...answer,text:'확인한 결과입니다.'}]}),[]);
  assert.deepEqual(originalAnswerFollowups({messages:[{role:'user',text:'후속 작업은 추천하지 마'},answer]}),[]);
  const repeated={messages:[{role:'user',text:'채널별 매출을 비교해줘'},{role:'assistant',text:'다음 단계\n- 채널별 매출을 비교해 주세요.\n- 분류되지 않은 주문을 확인해 주세요.'}]};
  assert.equal(originalAnswerFollowups(repeated)[0].prompt,'분류되지 않은 주문을 확인해줘');
});

test('코드와 작성물 속 분석 결과로 추천을 만들지 않으며 긴 답변도 즉시 계산한다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const answer='월별 매출 분석을 완료했습니다. 최근 주문 데이터를 정리했습니다.';
  for(const text of ['```text\n'+answer+'\n```',':::writing\n'+answer+'\n:::','> '+answer]) {
    assert.deepEqual(originalAnswerFollowups({messages:[{role:'user',text:'예시를 읽어줘'},{role:'assistant',text}]}),[]);
  }
  const session={messages:[{role:'user',text:'스토어 매출을 분석해줘'},{role:'assistant',text:'자료 설명 '.repeat(20000)+'\n'+answer}]};
  const start=performance.now();
  for(let i=0;i<30;i++)assert(originalAnswerFollowups(session)[0]);
  assert(performance.now()-start<2000,'로컬 추천 30회가 2초 이내에 끝나야 한다');
});
