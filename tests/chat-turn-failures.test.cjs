const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { Controller } = require('../electron/controller.cjs');
const { chatFailure } = require('../electron/errors.cjs');

function turnFixture() {
  const client = Object.assign(new EventEmitter(), { inputs: new Map(), approvals: new Map() });
  const run = { threadId: 'thread', turnId: 'turn', sessionId: 'session', ownerRevision: 'local', userMessageId: 'user' };
  const session = { id: run.sessionId, messages: [{ id: run.userMessageId, role: 'user', text: '채팅 테스트' }] };
  const store = { peekSession: () => session, save: async () => {} };
  const controller = new Controller(store, { client });
  controller.shuttingDown = true;
  controller.runs.set(session.id, run);
  const events = [];
  controller.on('event', event => events.push(event));
  const report = (error, { willRetry = false, turnId = run.turnId } = {}) => controller.notification({
    method: 'error', params: { threadId: run.threadId, turnId, error, willRetry },
  });
  const finish = (status, error = null, id = run.turnId) => controller.notification({
    method: 'turn/completed', params: { threadId: run.threadId, turn: { id, status, error } },
  });
  return { session, events, report, finish };
}

test('내장 Codex의 구조화 오류 코드를 사용해 한국어로 원인을 안내한다', () => {
  const cases = [
    ['modelNotFound', 'model', /다른 모델/],
    ['badRequest', 'request', /요청 형식/],
    ['rateLimitExceeded', 'rate', /잠시 뒤/],
    ['flexUnavailable', 'speed', /표준 속도/],
    ['sessionBudgetExceeded', 'session-budget', /새 대화/],
    [{ responseStreamDisconnected: { httpStatusCode: null } }, 'connection', /네트워크/],
    [{ responseStreamConnectionFailed: { httpStatusCode: 401 } }, 'login', /다시 로그인/],
  ];
  for (const [codexErrorInfo, reason, description] of cases) {
    const result = chatFailure({ codexErrorInfo, message: 'Unavailable', additionalDetails: '검증용 비공개 원문' });
    assert.equal(result.reason, reason);
    assert.match(result.message, description);
    assert.doesNotMatch(result.message, /비공개 원문/);
  }
});

test('실패한 턴의 완료 기록에 상세가 없어도 같은 턴의 오류 원인을 보존한다', async () => {
  const { session, events, report, finish } = turnFixture();
  await report({ codexErrorInfo: 'modelNotFound', message: 'Unavailable' });
  await report({ codexErrorInfo: 'unauthorized', message: 'Unauthorized' }, { turnId: 'previous-turn' });
  await finish('failed', null, 'previous-turn');
  assert.equal(session.messages.length, 1);
  await finish('failed');
  assert.equal(session.messages.length, 2);
  assert.match(session.messages[1].text, /선택한 모델을 사용할 수 없습니다/);
  assert.deepEqual(events.filter(event => event.type === 'error').map(event => event.text), [
    '이 계정에서 선택한 모델을 사용할 수 없습니다. 다른 모델을 선택해 주세요.',
  ]);
});

test('ChatGPT 작업 공간 설정을 불러오지 못한 오류를 설정 문제로 안내한다', () => {
  const failure = chatFailure({ message: 'failed to load workspace requirements: invalid input parameter' });
  assert.equal(failure.reason, 'workspace-config');
  assert.match(failure.message, /작업 공간 설정을 불러오지 못했습니다/);
});

test('재시도 중 오류가 복구돼 작업이 끝나면 실패 알림을 남기지 않는다', async () => {
  const { session, events, report, finish } = turnFixture();
  await report({ codexErrorInfo: 'rateLimitExceeded' }, { willRetry: true });
  await finish('completed');
  assert.equal(session.messages.length, 1);
  assert.equal(events.some(event => event.type === 'error'), false);
  assert.equal(events.find(event => event.type === 'done').status, 'completed');
});
