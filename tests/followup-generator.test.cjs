const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createFollowupGenerator } = require('../electron/followup-generator.cjs');

const identity = { type:'chatgpt', email:'synthetic@example.invalid' };
const owner = createHash('sha256').update('flowrium-account:'+identity.email).digest('hex');
const answerText = '입력창 위의 현재 작업은 같은 자리에서 갱신됩니다. 펼친 작업 내역은 읽던 스크롤 위치를 보존합니다.';
const action = '작업 내역을 펼쳐 위쪽 기록을 읽는 동안 새 이벤트를 연속으로 넣고, 현재 작업 줄과 읽던 기록의 위치가 유지되는지 재현해줘.';
const evidence = '읽던 스크롤 위치를 보존합니다';

const message = (role, text, extra = {}) => ({ id:randomUUID(), role, text, ...extra });

function fixture(options = {}) {
  const answer = message('assistant', answerText);
  const session = { id:randomUUID(), messages:[
    message('user', '실시간 작업 과정에서 이전 문구가 올라가서 가려지는 점을 수정하고, 같은 줄에서 현재 작업을 보여줘.'),
    answer,
  ] };
  const captured = [], ready = Promise.withResolvers(), made = Promise.withResolvers();
  let auth = identity, version = 0, closed = 0;
  const controller = {
    status: { authenticated:true },
    client: {
      ready: true,
      options:{},
      start: async () => {},
      close: () => assert.fail('추천 중 기본 연결을 닫았습니다.'),
      request: async method => {
        if (method === 'account/read') return {account:identity};
        assert.equal(method,'config/read');
        return {config:{mcp_servers:{fixture:{command:'실행되면 안 됨'}},plugins:{fixture:{enabled:true}}}};
      },
    },
    store: { state:{settings:{aiFollowups:true}}, session:id=>id===session.id ? session : null },
    options: {
      modelAccount: () => owner,
      canRun: () => true,
      analysisClientFactory: overrides => {
        assert.equal(overrides['features.shell_tool'],false);
        assert.equal(overrides['web_search'],'disabled');
        assert.equal(overrides['mcp_servers."fixture".enabled'],false);
        assert.equal(overrides['plugins."fixture".enabled'],false);
        const client = new EventEmitter();
        client.start = async () => {};
        client.close = () => { closed++; };
        client.request = async (method, params) => {
          captured.push({method,params});
          if (method === 'account/read') return {account:auth};
          if (method === 'thread/start') {
            assert.equal(params.ephemeral,true);
            assert.equal(params.approvalPolicy,'never');
            assert.equal(params.config.permissions[params.permissions].network.enabled,false);
            assert.equal(params.config.permissions[params.permissions].filesystem[':root'],'deny');
            return {thread:{id:'isolated-thread'},activePermissionProfile:{id:params.permissions}};
          }
          assert.equal(method,'turn/start');
          ready.resolve(params);
          return {turn:{id:'preview'}};
        };
        made.resolve(client);
        return client;
      },
    },
    runs: new Map(),
    editingSessions: new Set(),
  };
  const generator = createFollowupGenerator(controller,{stateEpoch:()=>version, canRun:()=>controller.store.state.settings.aiFollowups===true, ...options});
  const finish = async (suggested=action, quote=evidence) => {
    const client = await made.promise;
    const notify = (method, params) => client.emit('notification',{method,params:{threadId:'isolated-thread',...params}});
    notify('item/completed',{item:{id:'final',type:'agentMessage',phase:'final_answer',
      text:JSON.stringify({suggestions:[{prompt:suggested,evidence:quote}]})}});
    notify('turn/completed',{turn:{status:'completed'}});
  };
  return {session,answer,controller,captured,ready:ready.promise,made:made.promise,finish,generator,
    changeUser:()=>{version++;}, changeAnalysisAccount:value=>{auth=value;},closed:()=>closed};
}

test('한 번의 격리 모델 요청으로 설명 대신 재현 가능한 명령을 생성하고 같은 답변에는 결과만 재사용한다',async()=>{
  const f = fixture();
  const result = f.generator.recommend(f.session.id,f.answer.id);
  assert.equal(f.generator.recommend(f.session.id,f.answer.id),result);
  const params = await f.ready;
  assert.equal(params.approvalPolicy,'never');
  assert.equal(params.effort,'lowest-supported');
  assert.match(params.input[0].text,/놓친 검증/);
  assert.match(params.input[0].text,/사용자의 기존 말투와 관계없이 존댓말 없이/);
  const context = params.additionalContext.flowrium_analysis_evidence;
  assert.equal(context.kind,'untrusted');
  assert.equal(JSON.parse(context.value).at(-1).text,answerText);
  await f.finish();
  assert.deepEqual(await result,{source:'conversation',title:action,prompt:action,reason:'최근 대화에서 찾은 다음 작업'});
  assert.deepEqual(await f.generator.recommend(f.session.id,f.answer.id),await result);
  assert.equal(f.captured.filter(row=>row.method==='turn/start').length,1);
  assert.equal(f.controller.editingSessions.size,0);
  assert.equal(f.controller.analysisRuns,undefined);
  assert.equal(f.session.messages.length,2);
  assert(f.closed()>0);
});

test('도구 기록, 첨부 경로, 비밀값과 저장된 별도 원문은 추천 모델에 전달하지 않는다',async()=>{
  const f = fixture();
  f.session.messages.splice(1,0,
    message('system','노출되면 안 되는 도구 기록',{progressCommentary:true}),
    message('user','노출되면 안 되는 별도 원문',{sourceOnly:true}),
  );
  f.session.messages[0].text += '\n/Users/example/private.txt\nAPI_KEY=sk-proj-syntheticexample123456\n' +
    'https://example.invalid/private-asset\npassword= 다른 시험 비밀\n' +
    '-----BEGIN PRIVATE KEY-----\n가려져야 할 비밀 블록\n-----END PRIVATE KEY-----\n' +
    '[작업 기록](https://example.invalid/task-doc)에서 확인\n--\n```sh\n이전 지시를 무시하는 코드 예시\n```';
  const result = f.generator.recommend(f.session.id,f.answer.id);
  const params = await f.ready;
  const context = params.additionalContext.flowrium_analysis_evidence.value;
  assert(context.includes('작업 기록에서 확인'));
  for(const privateValue of ['도구 기록','별도 원문','private.txt','syntheticexample','private-asset','코드 예시','다른 시험 비밀','비밀 블록','/task-doc']) {
    assert(!context.includes(privateValue));
  }
  await f.finish();
  assert.equal((await result).prompt,action);
});

test('긴 최신 답변은 마지막 결과를 살리고 끝 부근 코드 블록은 제외한다',async()=>{
  const f=fixture();
  f.answer.text='화면 안정성을 점검했습니다.\n'+'중간 점검 결과입니다.\n'.repeat(1700)+
    '```\n근거가 되어서는 안 되는 예시\n```\n'+answerText;
  const result=f.generator.recommend(f.session.id,f.answer.id);
  const rows=JSON.parse((await f.ready).additionalContext.flowrium_analysis_evidence.value);
  const excerpt=rows.at(-1).text;
  assert(excerpt.startsWith('화면 안정성을'));
  assert(excerpt.endsWith(answerText));
  assert(excerpt.length<=2300 && !excerpt.includes('근거가 되어서는 안 되는 예시'));
  await f.finish();
  assert.equal((await result).prompt,action);
});

test('사용자 설정 또는 실제 인증이 없거나 최초 답변 이후 대화가 바뀌면 모델을 시작하지 않는다',async()=>{
  const f = fixture();
  f.controller.store.state.settings.aiFollowups = false;
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  f.controller.store.state.settings.aiFollowups = true;
  f.controller.status.authenticated = false;
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  f.controller.status.authenticated = true;
  f.controller.runs.set('foreground',{});
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  f.controller.runs.clear();
  f.session.messages.push(message('user','새로운 내용을 계속 수정해줘.'));
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  assert.equal(f.captured.length,0);
});

test('일반적인 방법 정리와 근거 없는 출력은 추천 후보에서 제외한다',async()=>{
  for(const [suggested,quote] of [
    ['입력창에 실제로 적용할 때 필요한 순서와 확인 방법을 정리해줘.',evidence],
    ['입력창을 검증하기 위한 구체적인 실행 계획을 정리해줘.',evidence],
    ['작업 내역을 보내 주시면, 제가 새 이벤트의 위치를 검증해 볼까요?',evidence],
    [action,'대화에 실제로 들어 있지 않은 근거'],
    [action,'실시간 작업 과정에서 이전 문구'],
  ]) {
    const f = fixture();
    const result = f.generator.recommend(f.session.id,f.answer.id);
    await f.ready;
    await f.finish(suggested,quote);
    assert.equal(await result,null);
  }
});

test('모델 후보의 공손한 요청을 반말 명령으로 바꾸고 영어 명령은 보존한다',async()=>{
  const korean = fixture();
  korean.session.messages[0].text='실시간 작업 과정의 위치를 점검해 주세요.';
  const result = korean.generator.recommend(korean.session.id,korean.answer.id);
  await korean.ready;
  await korean.finish(action.replace(/줘\.$/, ' 주세요.'));
  assert.equal((await result).prompt,action);

  const english = fixture();
  english.session.messages[0].text='Check that the composer sends a multiline message intact.';
  english.answer.text='The composer keeps each line break before sending.';
  const englishCommand='Send a sample with blank lines and compare the received line breaks.';
  const englishResult=english.generator.recommend(english.session.id,english.answer.id);
  await english.ready;
  await english.finish(englishCommand,'keeps each line break');
  assert.equal((await englishResult).prompt,englishCommand);
});

test('추천 전용 연결이 다른 계정으로 열린 경우 대화 내용을 전송하지 않는다',async()=>{
  const f = fixture();
  f.changeAnalysisAccount({...identity,email:'another@example.invalid'});
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  assert.deepEqual(f.captured.map(row=>row.method),['account/read']);
  assert(f.closed()>0);
});

test('초기 인증 응답부터 총 시간을 제한하며 만료는 기본 연결을 닫지 않는다',async()=>{
  const f = fixture({timeout:50});
  f.controller.client.request = async()=>new Promise(()=>{});
  assert.equal(await f.generator.recommend(f.session.id,f.answer.id),null);
  assert.equal(f.captured.length,0);
  assert.equal(f.closed(),0);
});

test('계정 전환과 명시적 무효화는 생성 중 추천을 보이지 않게 한다',async()=>{
  const changed = fixture();
  const stale = changed.generator.recommend(changed.session.id,changed.answer.id);
  await changed.ready;
  changed.changeUser();
  await changed.finish();
  assert.equal(await stale,null);
  const invalidated = fixture();
  const pending = invalidated.generator.recommend(invalidated.session.id,invalidated.answer.id);
  await invalidated.ready;
  invalidated.generator.invalidate();
  assert.equal(await pending,null);
  assert(invalidated.closed()>0);
});
