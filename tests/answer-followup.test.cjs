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
  assert.deepEqual(originalAnswerFollowups(duplicate),[]);
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
  assert.deepEqual(originalAnswerFollowups(make('연결 방법은 다음 순서입니다.\n1. 실행 환경을 확인합니다.\n2. 연결 주소를 설정합니다.\n3. 다시 연결해 동작을 확인합니다.')),[]);
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
  assert.deepEqual(originalAnswerFollowups(completed),[]);
  assert.equal(canOfferFollowup({...completed,completedContinuationId:'latest'}),false);
  assert.equal(canOfferFollowup(session('다음 단계는 제안하지 마세요.',answer)),false);
});

test('명시적인 후속 작업이 없을 때도 직전 답변에 맞춘 초안을 찾고 실제 처리 단계를 알린다',async()=>{
  const {originalAnswerFollowups,prepareAnswerFollowup}=await loaded;
  const session=(text,request='표를 확인해줘')=>({messages:[{role:'user',text:request},{role:'assistant',text}]});
  const completed=session('맥과 윈도우 새 버전을 배포했고 설치 버튼을 눌러 내려받았습니다.','새 버전을 배포해줘');
  const stages=[],start=performance.now();
  const result=await prepareAnswerFollowup(completed,percent=>stages.push(percent.toFixed(1)));
  assert.equal(result.prompt,'공식 홈페이지의 맥·윈도우 설치 버튼이 공개 최신 태그와 같은 버전을 가리키는지 자동으로 검사해줘');
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
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  messages.at(-1).text='월별 매출 분석을 완료했습니다. 온라인 스토어의 주문 데이터를 확인했습니다.';
  assert.equal(originalAnswerFollowups({messages})[0].prompt,'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
});

test('배포 보고에 나온 고정 작업 줄과 스크롤을 실제로 검증하는 명령을 제안한다',async()=>{
  const {originalAnswerFollowups,prepareAnswerFollowup}=await loaded;
  const messages=[
    {role:'user',text:'작업 내역에서 이전 기록이 위로 밀려 잘려 나가요. 현재 작업은 한 줄에서 갱신하고 위쪽을 읽을 수 있게 해줘.'},
    {role:'assistant',text:'### 실시간 작업 과정\n입력창 위의 현재 작업은 같은 자리에서 갱신됩니다. 이전 과정은 작업 내역에서 펼쳐 볼 수 있고, 위쪽 기록을 읽는 중에 새 작업이 들어와도 스크롤 위치가 유지됩니다.\n\n### 검증과 정리\n맥 설치 파일을 새 버전으로 배포했습니다.'},
  ];
  const command='작업 내역 위쪽을 읽는 중에 테스트용 작업 이벤트를 연속으로 넣고, 현재 작업 줄과 읽던 위치가 밀리지 않는지 확인하는 회귀 테스트를 추가해줘';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,command);
  assert.equal((await prepareAnswerFollowup({messages},()=>{}))?.prompt,command);
  messages[1].text+='\n\n**다음 단계**\n- 적용할 때 필요한 순서와 확인 방법을 정리해 주세요.';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,command);
});

test('완료 사실만으로 절차 안내를 만들거나 관련 없는 이전 주제를 꺼내지 않는다',async()=>{
  const {originalAnswerFollowups,followupFromAnswer}=await loaded;
  const messages=[
    {role:'user',text:'아이폰을 다시 열면 QR 없이 접속되는지 확인해줘'},
    {role:'assistant',text:'맥을 재시작한 뒤 아이폰이 저장한 연결 주소로 재접속했습니다.'},
  ];
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,'시험 중계에 잠깐 응답 지연을 넣고 휴대폰이 저장된 연결 주소로 자동 복구되는지 검증해줘');
  messages.push({role:'user',text:'문서의 문단 여백을 고쳐줘'},{role:'assistant',text:'문서의 문단 여백을 수정해 저장했습니다.'});
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  assert.equal(followupFromAnswer('**다음 단계**\n- 설정에 적용할 때 필요한 순서와 확인 방법을 정리해 주세요.'),undefined);
  assert.equal(followupFromAnswer('**다음 단계**\n- 실패한 요청을 재전송하는 테스트를 추가해 주세요.').prompt,'실패한 요청을 재전송하는 테스트를 추가해줘');
});

test('답변에 직접 적힌 순서·절차 안내도 걸러내고 실제 변경·검증은 추천한다',async()=>{
  const {followupFromAnswer}=await loaded;
  const {isAdvisoryFollowup}=await import('../electron/mobile/answer-followup.js');
  for(const advice of [
    '프로젝트 전환 순서를 정리해줘',
    '재현 절차를 알려줘',
    '휴대폰 연결 방법을 번호로 안내해 주세요.',
    '적용할 때 필요한 순서와 확인 방법을 설명해 줄래요?',
  ]){
    assert.equal(isAdvisoryFollowup(advice),true,advice);
    assert.equal(followupFromAnswer('다음 작업: '+advice),undefined,advice);
  }
  for(const command of [
    '프로젝트 전환 순서를 바꾼 뒤 스크롤 위치를 검증해줘',
    '방법별 결과를 비교해줘',
    '사용자가 입력한 프로젝트 번호를 설정에 저장해줘',
    '설치 방법을 검증하고 도움말에 수정 사항을 반영해줘',
  ]){
    assert.equal(isAdvisoryFollowup(command),false,command);
    assert.equal(followupFromAnswer('다음 작업: '+command)?.prompt,command);
  }
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

test('이전 빌드 정리를 막은 실행 중 중계를 찾아 연결 보존부터 추천한다',async()=>{
  const {originalAnswerFollowups,prepareAnswerFollowup}=await loaded;
  const messages=[
    {role:'user',text:'아이폰에서 QR 다시 안 찍어도 연결되는지 확인하고 맥과 윈도우에 배포해줘. 기존 휴대폰 연결은 유지해줘.'},
    {role:'assistant',text:'기존 아이폰 연결이 유지됐습니다.'},
    {role:'user',text:'그리고 캐시 파일과 기존 빌드 파일들 전부 다 지워줘.'},
    {role:'assistant',text:[
      '**Flowrium을 공개했습니다.** 두 설치 파일을 확인했습니다.',
      '### 아이폰 연결',
      '이 맥에서 Flowrium을 재시작한 뒤 기존 아이폰 홈 화면 앱이 **QR 재스캔 없이 바로 열리는 것**을 확인했습니다.',
      '### 이전 빌드와 캐시 정리',
      '미사용 이전 맥 설치본과 시험 캐시를 삭제했습니다. 직전 버전 복구본 1개와 현재 아이폰 중계가 사용 중인 실행 파일은 유지했습니다. 추가 조치가 필요한 사항은 없습니다.',
    ].join('\n\n')},
  ];
  const expected='QR을 다시 찍지 않도록 기존 연결을 유지하면서 아이폰 중계를 최신 버전으로 옮기고, 교체가 확인되면 직전 복구본만 남기고 나머지 이전 빌드를 정리해줘';
  assert.equal(originalAnswerFollowups({messages})[0]?.prompt,expected);
  const start=performance.now();
  assert.equal((await prepareAnswerFollowup({messages},()=>{}))?.prompt,expected);
  assert(performance.now()-start<10000);
  messages[2].text='직전 버전 복구본만 남겨두고 이전 빌드는 전부 지워 주세요.';
  assert.match(originalAnswerFollowups({messages})[0]?.prompt||'',/나머지 이전 빌드를 정리해 주세요$/);
  messages[2].text='캐시만 비우고 이전 빌드는 그대로 보존해줘.';
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  messages[2].text='이전 빌드를 정리해줘';
  messages[3].text='이전 빌드를 모두 정리했습니다. 직전 버전 복구본은 보관했습니다. 아이폰 중계는 최신 빌드로 옮겼습니다. 남은 작업은 없습니다.';
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
  messages[3].text='이전 빌드를 모두 정리했습니다. 현재 아이폰 중계가 사용 중인 최신 실행 파일은 유지했습니다. 남은 작업은 없습니다.';
  assert.deepEqual(originalAnswerFollowups({messages}),[]);
});

test('검증 보고의 완료 문구보다 답변에서 명시한 미완료 조치를 따른다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const request={role:'user',text:'배포 안내를 확정하고 두 플랫폼에 적용해 주세요.'};
  const answer={role:'assistant',text:'맥 설치와 사이트 안내를 검증했습니다. 윈도우의 설치 안내 반영이 아직 남았습니다.'};
  assert.equal(originalAnswerFollowups({messages:[request,answer]})[0]?.prompt,'윈도우의 설치 안내 반영해 주세요');
  answer.text='맥 배포를 완료했습니다. 윈도우 설치본은 아직 배포하지 못했습니다.';
  assert.equal(originalAnswerFollowups({messages:[request,answer]})[0]?.prompt,'윈도우 설치본을 배포해 주세요');
  answer.text='맥과 윈도우 설치와 사이트 안내를 검증했습니다. 남은 사항은 없습니다.';
  assert.deepEqual(originalAnswerFollowups({messages:[request,answer]}),[]);
});

test('마지막 답변의 매출 수치를 바탕으로 두 요인의 기여액 계산을 권한다',async()=>{
  const {originalAnswerFollowups}=await loaded;
  const request={role:'user',text:'가상 스토어의 월별 매출 흐름을 분석해줘.'};
  const answer={role:'assistant',text:'월별 매출 분석을 마쳤습니다. 10월 매출은 전월 대비 14.3% 올랐고 주문 수와 평균 주문 금액이 함께 늘었습니다.'};
  const session={messages:[request,answer]};
  assert.match(originalAnswerFollowups(session)[0]?.prompt||'',/주문 수와 평균 주문 금액의 기여액으로 나누고/);
  answer.text+=' 두 요인의 기여액을 이미 계산했습니다.';
  assert.doesNotMatch(originalAnswerFollowups(session)[0]?.prompt||'',/기여액으로 나누고/);
  answer.text='월별 매출 분석을 마쳤습니다. 10월 매출은 전월 대비 14.3% 올랐습니다.';
  assert.doesNotMatch(originalAnswerFollowups(session)[0]?.prompt||'',/기여액으로 나누고/);
});
