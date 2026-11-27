const assert = require('node:assert/strict');
const {test} = require('node:test');
const {mergeNative, liveView} = require('../electron/chat-sync.cjs');
const {mergeMessages, restoreLinkedMessageOrder} = require('../electron/codex-transfer-merge.cjs');

const at = second => new Date(Date.UTC(2026, 10, 27, 0, 0, second)).toISOString();
const row = (id, role, text, created, turnId) => ({id, role, text, createdAt:at(created), turnId});
const first = [row('codex-u', 'user', '첫 요청', 1, 'first'), row('codex-a', 'assistant', '첫 답변', 2, 'first')];
const sharedTurn = 'same-turn';
const claude = [
  {...row('claude-u', 'user', '같은 요청', 3, sharedTurn), provider:'claude'},
  {...row('claude-s', 'system', '로컬 자료를 확인합니다.', 4, sharedTurn), provider:'claude', progressCommentary:true},
  {...row('claude-a', 'assistant', '다시 확인했습니다.', 5, sharedTurn), provider:'claude', reaction:'like'},
];
const last = [row('codex-second-u', 'user', '같은 요청', 6, sharedTurn), row('codex-second-a', 'assistant', '다시 확인했습니다.', 7, sharedTurn)];

test('동일 작업 ID나 문장이 있어도 Claude 기록을 Codex 원본과 매칭하지 않는다', () => {
  const previous = [...first, ...claude];
  const remote = [...first, ...last];
  const expected = [...previous, ...last];
  for (const merge of [mergeNative, mergeMessages]) {
    const result = merge(previous, remote);
    assert.deepEqual(result, expected);
    assert.deepEqual(merge(result, remote), expected);
  }
  assert.deepEqual(previous, [...first, ...claude]);
  assert.deepEqual(remote, [...first, ...last]);
});

test('드물게 원본 메시지 식별자까지 충돌하면 기존 대화를 덮어쓰기 전에 중단한다', () => {
  const previous = [...first, ...claude];
  const remote = [...first, {...last[0], id:claude[0].id}];
  for (const merge of [mergeNative, mergeMessages]) {
    assert.throws(() => merge(previous, remote), /기존 대화를 보존/);
  }
  assert.deepEqual(previous, [...first, ...claude]);
});

test('연결한 대화를 다시 열면 Claude 기록을 별도로 시간순에 합친다', () => {
  const session = {
    codexLink:{mode:'linked', sourceMessageIds:[...first, ...last, claude[0]].map(message => message.id)},
    messages:[...first, ...last, ...claude],
  };
  restoreLinkedMessageOrder(session);
  assert.deepEqual(session.messages, [...first, ...claude, ...last]);
  restoreLinkedMessageOrder(session);
  assert.deepEqual(session.messages, [...first, ...claude, ...last]);
});

test('기기 시계가 뒤로 바뀌어도 저장된 Claude 입력과 답변 순서를 유지한다', () => {
  const local = [{...claude[0], createdAt:at(5)}, claude[1], {...claude[2], createdAt:at(3)}];
  const previous = [...first, ...local], remote = [...first, ...last];
  for (const merge of [mergeNative, mergeMessages]) {
    assert.deepEqual(merge(previous, remote), [...previous, ...last]);
  }
  const session = {codexLink:{mode:'linked', sourceMessageIds:remote.map(message => message.id)}, messages:[...remote, ...local]};
  restoreLinkedMessageOrder(session);
  assert.deepEqual(session.messages, [...previous, ...last]);
});

test('Codex 작업 중 읽어 온 원본 미리보기는 Claude 기록을 바꾸지 않는다', () => {
  const session = {id:'local', threadId:'native', messages:[...first, ...claude, ...last]};
  const partial = [{...last[0]}, {...last[1], text:'아직 작성 중입니다.'}];
  const runtime = {
    controller:{runs:new Map()}, guard(){},
    liveTurns:new WeakMap([[session, {threadId:'native', turnId:sharedTurn, rows:partial}]]),
  };
  assert.deepEqual(liveView(runtime, session).messages, [...first, ...claude, ...partial]);
  assert.deepEqual(session.messages, [...first, ...claude, ...last]);
});
