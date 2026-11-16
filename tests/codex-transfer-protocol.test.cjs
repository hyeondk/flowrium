const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough, Writable} = require('node:stream');
const {CodexClient} = require('../electron/codex.cjs');

function client(options = {}) {
  const largeText = '가'.repeat(6 * 1024 * 1024);
  return new CodexClient({...options, descriptor:{command:'시험용 실행 파일',prefix:[],label:'시험용 실행 파일'}, spawn:() => {
    const proc = new EventEmitter();
    proc.exitCode = null;
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    function send(message) {
      const bytes = Buffer.from(JSON.stringify(message) + '\n');
      // Split JSON and UTF-8 characters across pipe reads.
      for (let offset = 0; offset < bytes.length; offset += 65521) {
        proc.stdout.write(bytes.subarray(offset, offset + 65521));
      }
    }
    proc.stdin = new Writable({write(chunk, _, done) {
      const {id, method} = JSON.parse(chunk.toString());
      if (id) queueMicrotask(() => {
        if (method === 'large-event' || method === 'large-approval') {
          if (method === 'large-event') send({method:'item/completed', params:{threadId:'시험', item:{type:'agentMessage', text:largeText}}});
          else send({id:111, method:'item/permissions/requestApproval', params:{reason:largeText}});
        }
        send({id, result:method === 'large' ? {text:largeText} : {}});
      });
      done();
    }});
    proc.kill = () => { proc.exitCode = 1; proc.emit('exit', 1); };
    return proc;
  }});
}

test('기본 실행 연결에서 18MiB 한글 응답과 작업 완료 알림을 끝까지 수신한다', async () => {
  const c = client();
  try {
    await c.start();
    let completed;
    c.on('notification', event => { completed = event.params.item.text; });
    const result = await c.request('large', {});
    await c.request('large-event', {});
    assert.equal(result.text.length, 6 * 1024 * 1024);
    assert.equal(completed, result.text);
    assert.equal(result.text.at(-1), '가');
    assert.equal(c.ready, true);
  } finally { c.close(); }
});

test('한도를 넘는 응답 하나만 거절하고 같은 연결의 다른 진행 중 요청은 완료한다', async () => {
  const c = client({maxProtocolLineBytes:1024 * 1024});
  try {
    await c.start();
    const result = await Promise.allSettled([c.request('large', {}), c.request('other', {})]);
    assert.equal(result[0].reason.code, 'PROTOCOL_FRAME_TOO_LARGE');
    assert.equal(result[0].reason.connectionPreserved, true);
    assert.deepEqual(result[1], {status:'fulfilled', value:{}});
    assert.deepEqual(await c.request('small', {}), {});
  } finally { c.close(); }
});

test('크기 초과 승인 요청을 응답으로 오인하지 않고 연결을 중단하며 재연결할 수 있다', async () => {
  const c = client({maxProtocolLineBytes:1024 * 1024});
  try {
    await c.start();
    let disconnected = 0;
    c.on('disconnect', () => disconnected++);
    await assert.rejects(c.request('large-approval', {}), error => error.code === 'PROTOCOL_FRAME_TOO_LARGE');
    assert.equal(disconnected, 1);
    assert.equal(c.ready, false);
    await c.start();
    assert.deepEqual(await c.request('small', {}), {});
  } finally { c.close(); }
});

test('응답 한도의 무제한 확대와 유효하지 않은 값은 거절한다', () => {
  for (const maxProtocolLineBytes of [0, -1, NaN, Infinity, 129 * 1024 * 1024])
    assert.throws(() => new CodexClient({maxProtocolLineBytes}), /응답 제한/);
});

test('이전 페이지를 받은 뒤 큰 다음 페이지를 만나면 해당 커서에서만 줄여서 끝까지 읽는다', async () => {
  const {pages} = require('../electron/history.cjs');
  const {itemPages} = require('../electron/codex-transfer-data.cjs');
  for (const read of [
    c => pages(c, 'thread/items/list', {limit:25}),
    c => itemPages(c, '대화', '작업', {recover:() => assert.fail('동작 중인 연결을 종료했습니다.')}),
  ]) {
    const calls = [];
    const c = {async request(_, {cursor, limit}) {
      calls.push([cursor, limit]);
      if (cursor && limit > 6) throw Object.assign(Error('큰 페이지'), {
        code:'PROTOCOL_FRAME_TOO_LARGE', connectionPreserved:true,
      });
      return cursor ? {data:['둘째 항목'],nextCursor:null} : {data:['첫 항목'],nextCursor:'다음'};
    }};
    assert.deepEqual(await read(c), ['첫 항목', '둘째 항목']);
    assert.deepEqual(calls, [[undefined,25],['다음',25],['다음',12],['다음',6]]);
  }
});
