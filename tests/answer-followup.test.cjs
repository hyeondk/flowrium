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

test('최신 답변에 제안하고 거부, 중복, 대기 완료, 빈 대화를 존중한다', async () => {
  const {originalAnswerFollowups} = await loaded;
  const user = {role:'user', text:'최근 응답을 검토해줘'};
  const answer = {id:'last', role:'assistant', text:'다음 작업: 판매표의 누락 행을 확인해 주세요.'};
  for (const session of [
    undefined, {messages:[]}, {messages:[answer,user]},
    {messages:[{...user,text:'후속 작업 추천은 하지 마세요.'},answer]},
    {messages:[user,answer],completedContinuationId:'last'},
  ]) assert.deepEqual(originalAnswerFollowups(session), []);
  const duplicate={messages:[{...user,text:'판매표의 누락 행을 확인해줘'},answer]};
  assert.notEqual(originalAnswerFollowups(duplicate)[0].prompt,duplicate.messages[0].text);
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
  for(const text of ['작업을 완료하지 못했습니다. 네트워크 오류','사용자의 요청으로 작업이 중지됐습니다.'])
    assert.deepEqual(originalAnswerFollowups({...session,messages:[...session.messages,{role:'system',text}]}),[]);
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
  assert.match(originalAnswerFollowups(make('완료 항목입니다.\n- 문서를 작성했습니다.\n- 폴더를 정리했습니다.\n- 파일을 저장했습니다.'))[0].prompt,/문서.*핵심 결론/);
});

test('명시 제안 없는 분석 완료에서도 문맥에 맞는 후속 작업을 찾고 이미 한 요청은 반복하지 않는다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const user={role:'user',text:'온라인 스토어의 월별 매출을 분석해줘'};
  const answer={role:'assistant',text:'월별 매출 분석을 완료했습니다. 최근 3개월의 주문 데이터와 전월 대비 변화를 정리했습니다.'};
  const session={workflow:{status:'done'},messages:[user,answer]},before=JSON.stringify(session);
  assert.equal(originalAnswerFollowups(session)[0].prompt,'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  assert.equal(JSON.stringify(session),before);
  assert.match(originalAnswerFollowups({messages:[user,{...answer,text:'확인한 결과입니다.'} ]})[0].prompt,/온라인 스토어의 월별 매출/);
  assert.deepEqual(originalAnswerFollowups({messages:[{role:'user',text:'후속 작업은 추천하지 마'},answer]}),[]);
  const repeated={messages:[{role:'user',text:'채널별 매출을 비교해줘'},{role:'assistant',text:'다음 단계\n- 채널별 매출을 비교해 주세요.\n- 분류되지 않은 주문을 확인해 주세요.'}]};
  assert.equal(originalAnswerFollowups(repeated)[0].prompt,'분류되지 않은 주문을 확인해줘');
});

test('코드와 작성물 속 분석 결과로 추천을 만들지 않으며 긴 답변도 즉시 계산한다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const answer='월별 매출 분석을 완료했습니다. 최근 주문 데이터를 정리했습니다.';
  for(const text of ['```text\n'+answer+'\n```',':::writing\n'+answer+'\n:::','> '+answer]) {
    assert.deepEqual(originalAnswerFollowups({messages:[{role:'user',text:'예시를 읽어줘'},{role:'assistant',text} ]}), []);
  }
  const session={messages:[{role:'user',text:'스토어 매출을 분석해줘'},{role:'assistant',text:'자료 설명 '.repeat(20000)+'\n'+answer}]};
  const start=performance.now();
  for(let i=0;i<30;i++)assert(originalAnswerFollowups(session)[0]);
  assert(performance.now()-start<2000,'로컬 추천 30회가 2초 이내에 끝나야 한다');
});

test('미검증 결과와 최신 요청의 우선순위로 다음 작업을 고른다', async () => {
  const {canOfferFollowup,followupFromAnswer,originalAnswerFollowups} = await loaded;
  const session = (request, text) => ({messages:[{role:'user',text:request},{id:'latest',role:'assistant',text}]});
  const answer = '다음 권장 작업\n- 화면 여백을 확인해 주세요.\n- 예약 알림의 수신 시간을 검증해 주세요.';
  assert.equal(originalAnswerFollowups(session('예약 알림 누락이 가장 중요합니다.',answer))[0].prompt,'예약 알림의 수신 시간을 검증해줘');
  assert.equal(originalAnswerFollowups(session('화면 여백부터 봐줘',answer.replace('예약 알림의','먼저 예약 알림의')))[0].prompt,'먼저 예약 알림의 수신 시간을 검증해줘');
  assert.equal(followupFromAnswer('윈도우의 예약 알림은 아직 미검증입니다.').prompt,'윈도우의 예약 알림을 검증해줘');
  assert.equal(followupFromAnswer('다음에는 실제 기기에서 알림을 검증해야 합니다.').prompt,'실제 기기에서 알림을 검증해줘');
  const completed = session('일정이 있는지 알려줘','그날은 일정이 없습니다.');
  assert.equal(canOfferFollowup(completed),true);
  assert.match(originalAnswerFollowups(completed)[0].prompt,/일정.*확인한 기간/);
  assert.equal(canOfferFollowup({...completed,completedContinuationId:'latest'}),false);
  assert.equal(canOfferFollowup(session('다음 단계는 제안하지 마세요.',answer)),false);
});

test('명시적인 후속 작업이 없을 때도 직전 답변에 맞춘 초안을 찾고 실제 처리 단계를 알린다',async()=>{
  const {originalAnswerFollowups,prepareAnswerFollowup}=await loaded;
  const session=(text,request='표를 확인해줘')=>({messages:[{role:'user',text:request},{role:'assistant',text}]});
  const completed=session('판매표를 확인했습니다.');
  const stages=[],start=performance.now();
  const result=await prepareAnswerFollowup(completed,percent=>stages.push(percent.toFixed(1)));
  assert.match(result.prompt,/판매표.*확인한 범위/);
  assert.deepEqual(stages,['0.0','25.0','50.0','75.0','100.0']);
  assert(performance.now()-start<10000);
  assert.equal(result.prompt,originalAnswerFollowups(completed)[0].prompt);
  assert.equal(originalAnswerFollowups(session('아이콘 정렬만 추가 조정이 필요합니다.'))[0].prompt,'아이콘 정렬만 추가 조정해줘');
  assert.deepEqual(originalAnswerFollowups(session('승인번호 98352를 확인했습니다.')),[]);
  const abort=new AbortController();
  assert.equal(await prepareAnswerFollowup(completed,()=>abort.abort(),abort.signal),undefined);
});

test('긴 요청의 원문 보관 표기를 추천 주제로 쓰지 않는다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const messages=[
    {role:'user',text:'대시보드 알림을 검증해줘'},
    {role:'assistant',text:'대시보드 알림을 검증했습니다.'},
    {role:'user',text:'긴 요청 원문 (3.98MB)',sourceOnly:true},
    {role:'assistant',text:'확인한 결과입니다.'},
  ];
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  messages.at(-1).text='판매표를 확인했습니다.';
  assert.match(originalAnswerFollowups({messages})[0].prompt,/판매표.*확인한 범위/);
});

test('인사나 반복 채팅 수신 확인에 후속 과제를 만들어 넣지 않는다',async()=>{
  const {canOfferFollowup,originalAnswerFollowups}=await loaded;
  const session={messages:[
    {role:'user',text:'채팅 테스트'},
    {role:'assistant',text:'예상 소요 시간: 몇 초 이내예요.\n채팅 테스트 메시지 잘 받았어요! 이 답변이 보이면 메시지를 주고받는 데 성공한 거예요.'},
    {role:'user',text:'다시 채팅 테스트'},
    {role:'assistant',text:'예상 소요 시간: 몇 초 이내예요.\n이번 테스트 메시지도 잘 받았어요!'},
  ]};
  assert.equal(canOfferFollowup(session),false);
  assert.deepEqual(originalAnswerFollowups(session),[]);
});

test('오래된 작업 목적과 말투를 적용하되 마지막 답변에 남은 과제를 고른다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const rest=Array.from({length:80},()=>({role:'system',text:'내부 검증 로그만 표시합니다.'}));
  const messages=[
    {role:'user',text:'권한 설정은 확인했으니 아이폰에서 기존 연결이 유지되는지 끝까지 확인해 줄래요?'},
    {role:'assistant',text:'맥을 재시작한 뒤 접속했습니다.'},
    ...rest,
    {role:'user',text:'같은 조건으로 계속'},
    {role:'assistant',text:'다음 단계\n- 관리자 화면 알림 색상을 검토해 주세요.\n- 아이폰에서 앱을 재실행하고 접속을 확인해 주세요.'},
  ];
  const before=JSON.stringify(messages);
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'아이폰에서 앱을 재실행하고 접속을 확인해 줄래요?');
  assert.equal(JSON.stringify(messages),before);
  messages[0].text='관리자 화면 알림의 색상부터 검토해줘';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'관리자 화면 알림 색상을 검토해줘');
});

test('최신 과제에 필요한 앞선 대상과 검증 범위를 담고 이미 요청한 과제를 반복하지 않는다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const messages=[
    {role:'user',text:'내 맥에서 시험 채팅을 만들어서 ChatGPT 앱의 Codex 목록에 바로 뜨는지 확인해줘. 제목 변경이랑 삭제도 양쪽에서 실제로 반영되는지 보고, 끝나면 시험 채팅만 정리해줘.'},
    {role:'assistant',text:'첫 메시지를 보냈고 목록에 나타난 걸 확인했습니다. 제목 변경과 삭제는 아직 확인하지 않았습니다.'},
  ];
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'시험 채팅의 제목 변경과 삭제가 양쪽 앱에 반영되는지 확인해줘');
  const history={messages:[
    {role:'user',text:'메뉴 아이콘 정렬을 검증해 주세요.'},
    {role:'assistant',text:'메뉴 아이콘은 가운데에 있습니다.'},
    ...Array.from({length:20},()=>({role:'user',text:'좋습니다.'})),
    {role:'assistant',text:'다음 단계\n- 메뉴 아이콘 정렬을 검증해 주세요.\n- 도움말의 밝은 모드 대비를 점검해 주세요.'},
  ]};
  assert.equal(originalAnswerFollowups(history)[0]?.prompt,'도움말의 밝은 모드 대비를 점검해 주세요');
});

test('인라인 요약 제목을 추천에 붙이지 않고 서로 합의해 미룬 일은 다시 권하지 않는다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const messages=[
    {role:'user',text:'아이폰 QR은 나중에 부탁할게. 지금 할 수 없다.'},
    {role:'assistant',text:'**남은 사항** 아이폰 연결 정보는 유지했고, 같은 인증으로 맥 내부 접속을 확인했습니다. 기존 외부 주소가 만료되어 새 QR 연결은 말씀하신 대로 나중에 진행합니다.'},
  ];
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  messages.at(-1).text+='\n\n**다음 단계** 윈도우 설치를 검증해 주세요.';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'윈도우 설치를 검증해줘');
  messages[0].text='모바일 연결도 확인해줘';
  messages[1].text='**검증 결과** 터미널 설치를 확인했습니다.\n**남은 사항** 아이폰 연결은 아직 확인하지 못했습니다.';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'아이폰 연결을 확인해줘');
});
