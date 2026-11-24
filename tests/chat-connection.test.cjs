const test = require('node:test');
const assert = require('node:assert/strict');
const {desktopAppInstalled, verifyChatConnection, refreshSharedDesktopAccount} = require('../electron/chat-connection.cjs');
const {chatFailure} = require('../electron/errors.cjs');
const {serviceTierForPlan} = require('../electron/model-speed.cjs');

test('윈도우에서 ChatGPT 또는 Codex 설치 변화와 시작 메뉴 등록을 다시 확인한다', async () => {
  let data = {packages:[], startIds:[]};
  const options = {systemRoot:'C:\\Windows', execute:async (exe,args) => {
    assert.equal(exe,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.match(args.at(-1),/Get-AppxPackage/);
    assert.match(args.at(-1),/Get-StartApps/);
    return {stdout:JSON.stringify(data)};
  }};
  assert.equal(await desktopAppInstalled('win32',options),false);
  data = {packages:['OpenAI.CodexPrimaryRuntime'],startIds:[]};
  assert.equal(await desktopAppInstalled('win32',options),false);
  data = {packages:['OpenAI.ChatGPT-Desktop'],startIds:[]};
  assert.equal(await desktopAppInstalled('win32',options),true);
  data = {packages:null,startIds:['OpenAI.Codex_2p2nqsd0c76g0!App']};
  assert.equal(await desktopAppInstalled('win32',options),true);
  data = {packages:null,startIds:['OpenAI.Codex_otherpublisher!App']};
  assert.equal(await desktopAppInstalled('win32',options),null);
});

test('공유 로그인을 발견하면 작업과 브라우저 인증을 건드리지 않고 미연결 상태만 다시 읽는다', async () => {
  let shared = null, started = 0, connected = 0, closed = 0, busyDuringRead = false;
  const makeClient = () => ({
    start:async () => {started++;},
    request:async () => {
      if (busyDuringRead) current.runs.set('in-flight',{});
      return {account:shared};
    },
    close:() => {closed++;},
  });
  function createController() {
    return {
      options:{queueOwner:()=>1}, store:{state:{settings:{}}}, status:{authenticated:false},
      runs:new Map(), editingSessions:new Set(), client:{pending:new Map(), close:() => {closed++;}},
      codexTransfer:{ownsClient:true, isBusy:()=>false, client:{close:() => {closed++;}}},
      connect:async quiet=>{assert.equal(quiet,true);connected++;},
    };
  }
  const refresh = controller => refreshSharedDesktopAccount(controller,{canReconnect:()=>true,makeClient});
  let current = createController();
  await refresh(current);
  assert.deepEqual({started,connected,closed},{started:1,connected:0,closed:1});
  current = createController();
  current.loginPending = true;
  shared = {type:'chatgpt'};
  await refresh(current);
  assert.equal(started,1);
  current.loginPending = false;
  await refresh(current);
  assert.deepEqual({started,connected,closed},{started:2,connected:1,closed:4});
  current = createController();
  busyDuringRead = true;
  await refresh(current);
  assert.deepEqual({started,connected,closed},{started:3,connected:1,closed:5});
});

test('데스크톱 앱 설치 여부 없이 내장 Codex 계정을 확인한다', async () => {
  let owner = 'current', account = {type:'chatgpt',planType:'pro'}, allowed = true;
  let started = 0;
  const client = {
    start:async () => {started++;},
    request:async (method,params) => {
      assert.equal(method,'account/read');
      assert.deepEqual(params,{refreshToken:false});
      return {account};
    },
  };
  const controller = {client,store:{state:{settings:{}}},options:{queueOwner:()=>owner,canRun:()=>allowed}};
  assert.deepEqual(await verifyChatConnection(controller),{ready:true});
  account = null;
  assert.equal((await verifyChatConnection(controller)).reason,'login');
  account = {type:'apiKey'};
  assert.equal((await verifyChatConnection(controller)).reason,'login');
  controller.accountObserved = async () => {owner='different';};
  assert.equal((await verifyChatConnection(controller)).reason,'changed');
  allowed = false;
  assert.equal((await verifyChatConnection(controller)).reason,'changed');
  assert.equal(started,4);
  allowed = true;
  client.start = async () => {throw Object.assign(Error('spawn path'),{code:'CODEX_START'});};
  const unavailable=await verifyChatConnection(controller);
  assert.equal(unavailable.reason,'unavailable');
  assert.match(unavailable.message,/실행 파일을 열지 못했습니다/);
});

test('서버·운영체제 오류의 알려진 원인을 현지화하고 알 수 없는 원문을 표시하지 않는다', () => {
  const sample = [
    [{codexErrorInfo:'usageLimitExceeded'},'usage',/크레딧/],
    [{codexErrorInfo:{httpConnectionFailed:{httpStatusCode:401}}},'login',/다시 로그인/],
    [new Error('unexpected status 429 Too Many Requests'),'rate',/잠시 뒤/],
    [{code:'PROTOCOL_FRAME_TOO_LARGE'},'response-size',/수신 한도/],
    [{code:'RPC_TIMEOUT'},'timeout',/시간 안에 응답하지 않았습니다/],
    [Error('Invalid request: missing field `threadId`'),'thread',/식별자가 빠져/],
    [Error('Windows sandbox setup failed'),'permission',/윈도우/],
    [Error('fetch failed ECONNREFUSED'),'connection',/네트워크/],
    [Error('Codex 요청을 처리하지 못했습니다. Private upstream response: token x-secret'), 'other', /구체적인 원인/],
  ];
  for (const [error,reason,pattern] of sample) {
    const actual=chatFailure(error);
    assert.equal(actual.reason,reason);
    assert.match(actual.message,pattern);
    assert.doesNotMatch(actual.message,/x-secret|threadId|ECONNREFUSED/);
  }
  assert.equal(chatFailure(Error('프로젝트에 대한 신뢰가 필요합니다.')).message,'프로젝트에 대한 신뢰가 필요합니다.');
});

test('Pro 요금제에서만 Ultrafast를 실행한다', () => {
  assert.equal(serviceTierForPlan('ultrafast','pro'),'ultrafast');
  assert.equal(serviceTierForPlan('ultrafast','plus'),'default');
  assert.equal(serviceTierForPlan('ultrafast',undefined),'default');
  assert.equal(serviceTierForPlan('fast','plus'),'priority');
});
