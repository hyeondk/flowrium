const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {ClaudeClient} = require('../electron/claude.cjs');

const key = 'sk-ant-api03-' + 'a'.repeat(40);
const nextKey = 'sk-ant-api03-' + 'b'.repeat(40);
const version = '2026-10-21';
const rows = [
  {id:'claude-opus-test', display_name:'Claude Opus', lifecycle:'active', line:'opus', capabilities:null},
  {id:'claude-sonnet-test', display_name:'Claude Sonnet', lifecycle:'active', line:'sonnet', max_input_tokens:200000, max_tokens:8192,
    capabilities:{effort:{supported:true, low:{supported:true}, medium:{supported:false}, high:{supported:true}}}},
  {id:'claude-retired-test', display_name:'Claude Retired', lifecycle:'retired', line:'sonnet'},
];
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json'}});
const catalog = () => json({data:rows, has_more:false});
const testStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain_access',
  encryptString: (value) => Buffer.from(value, 'utf8').map(byte => byte ^ 0x55),
  decryptString: (value) => value.map(byte => byte ^ 0x55).toString('utf8'),
};
async function fixture(t, fetchImpl, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-claude-test-'));
  t.after(() => fs.rm(directory, {recursive:true, force:true}));
  const client = new ClaudeClient({directory, secretStorage:testStorage, fetchImpl, ...options});
  return {client, directory};
}

function event(data) {
  return 'event: ' + data.type + '\r\ndata: ' + JSON.stringify(data) + '\r\n\r\n';
}

function stream(rows) {
  const bytes = Buffer.from(rows.map(event).join(''), 'utf8');
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.subarray(i, i + 13));
      controller.close();
    },
  }), {headers:{'content-type':'text/event-stream'}});
}

test('사용자가 등록한 키만 공식 API에서 확인한 뒤 암호화해 저장한다', async t => {
  const calls = [];
  const {client, directory} = await fixture(t, async (url, init) => {
    calls.push({url, init});
    return init.headers.authorization === `Bearer ${key}`
      ? catalog()
      : json({error:{type:'authentication_error', message:nextKey}}, 401);
  });

  assert.deepEqual(await client.status(), {configured:false});
  await assert.rejects(client.listModels(), {code:'CLAUDE_NOT_CONNECTED'});
  await assert.rejects(client.configure('sk-ant-oat01-' + 'q'.repeat(40)), {code:'CLAUDE_KEY_INVALID'});
  assert.equal(calls.length, 0);
  const saved = await client.configure(' ' + key + ' ');
  assert.equal(saved.configured, true);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=100');
  assert.equal(calls[0].init.headers['anthropic-version'], version);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(JSON.stringify(saved).includes(key), false);
  const [file] = await fs.readdir(directory);
  assert.equal(file, 'claude-api-key.enc');
  assert.equal((await fs.readFile(path.join(directory, file))).includes(key), false);

  const reopened = new ClaudeClient({directory, secretStorage:testStorage, fetchImpl:async () => catalog()});
  assert.deepEqual(await reopened.status(), {configured:true});
  await assert.rejects(client.configure(nextKey), error => error.code === 'CLAUDE_AUTH' && !error.message.includes(nextKey));
  assert.deepEqual(await client.status(), {configured:true});
  await client.listModels();
  assert.equal(calls.at(-1).init.headers.authorization, `Bearer ${key}`);
  assert.deepEqual(await client.disconnect(), {configured:false});
  assert.deepEqual(await reopened.status(), {configured:false});
  assert.deepEqual(await fs.readdir(directory), []);
});

test('운영체제 암호화 저장소를 쓸 수 없으면 평문 저장이나 인증 시도를 하지 않는다', async t => {
  let called = false;
  const {client, directory} = await fixture(t, async () => { called = true; return catalog(); }, {
    secretStorage:{...testStorage, getSelectedStorageBackend: () => 'basic_text'},
  });
  await assert.rejects(client.configure(key), {code:'CLAUDE_KEY_STORAGE_UNAVAILABLE'});
  assert.equal(called, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('모델 목록을 여러 페이지에서 읽고 제공자가 지원하는 추론 수준만 선택한다', async t => {
  const urls = [];
  const {client} = await fixture(t, async (url) => {
    urls.push(url);
    return url.endsWith('after_id=claude-opus-test')
      ? json({data:rows.slice(1), has_more:false})
      : json({data:rows.slice(0, 1), has_more:true, last_id:rows[0].id});
  });

  const {models} = await client.configure(key);
  assert.deepEqual(models.map(row => [row.id, row.isDefault]), [[rows[0].id, false], [rows[1].id, true]]);
  assert.deepEqual(models[1].supportedReasoningEfforts.map(row => row.reasoningEffort), ['low', 'high']);
  assert.equal(models[1].contextWindow, 200000);
  assert.equal(models[1].maxOutputTokens, 8192);
  assert.deepEqual(await client.listModels(), models);
  await assert.rejects(client.generate({effort:'ultra', messages:[{role:'user', content:'안녕'}]}), {code:'CLAUDE_EFFORT_UNSUPPORTED'});
  await assert.rejects(client.generate({model:'gpt-codex', messages:[{role:'user', content:'안녕'}]}), {code:'CLAUDE_MODEL_UNAVAILABLE'});
  assert.deepEqual(urls, ['https://api.anthropic.com/v1/models?limit=100', 'https://api.anthropic.com/v1/models?limit=100&after_id=claude-opus-test']);
});

test('선택한 문맥과 수준을 보내고 글자 스트림 및 앱 내부 도구 호출을 구분한다', async t => {
  let body;
  const answerEvents = [
    {type:'message_start', message:{model:rows[1].id, usage:{input_tokens:11, cache_read_input_tokens:4, output_tokens:1}}},
    {type:'content_block_start', index:0, content_block:{type:'thinking', thinking:'', signature:''}},
    {type:'content_block_delta', index:0, delta:{type:'thinking_delta', thinking:'내부 처리'}},
    {type:'content_block_delta', index:0, delta:{type:'signature_delta', signature:'signed'}},
    {type:'content_block_stop', index:0},
    {type:'ping'},
    {type:'content_block_start', index:1, content_block:{type:'text', text:''}},
    {type:'content_block_delta', index:1, delta:{type:'text_delta', text:'안녕'}},
    {type:'content_block_delta', index:1, delta:{type:'text_delta', text:'하세요'}},
    {type:'content_block_stop', index:1},
    {type:'content_block_start', index:2, content_block:{type:'tool_use', id:'toolu_test', name:'read_selected_data', input:{}}},
    {type:'content_block_delta', index:2, delta:{type:'input_json_delta', partial_json:'{"item":'}},
    {type:'content_block_delta', index:2, delta:{type:'input_json_delta', partial_json:'3}'}},
    {type:'content_block_stop', index:2},
    {type:'message_delta', delta:{stop_reason:'tool_use'}, usage:{output_tokens:10}},
    {type:'message_stop'},
  ];
  const {client} = await fixture(t, async (url, init) => {
    if (url.includes('/models')) return catalog();
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.accept, 'text/event-stream');
    body = JSON.parse(init.body);
    return stream(answerEvents);
  });
  await client.configure(key);
  const deltas = [];
  const messages = [{role:'user', content:'앞선 작업'}, {role:'assistant', content:'앞선 답변'}, {role:'user', content:[{type:'text', text:'다음 작업'}]}];
  const tools = [{name:'read_selected_data', description:'선택된 자료를 읽습니다', input_schema:{type:'object'}}];
  const answer = await client.generate({messages, system:'한국어로 답합니다.', effort:'high', tools, toolChoice:{type:'auto'}, onDelta:part => deltas.push(part)});
  assert.deepEqual(body, {messages, model:rows[1].id, max_tokens:8192, stream:true, system:'한국어로 답합니다.', output_config:{effort:'high'}, tools, tool_choice:{type:'auto'}});
  assert.deepEqual(deltas, ['안녕', '하세요']);
  assert.equal(answer.text, '안녕하세요');
  assert.deepEqual(answer.content[0], {type:'thinking', thinking:'내부 처리', signature:'signed'});
  assert.deepEqual(answer.toolCalls, [{id:'toolu_test', name:'read_selected_data', input:{item:3}}]);
  assert.deepEqual(answer.usage, {inputTokens:15, outputTokens:10});
  assert.equal(answer.stopReason, 'tool_use');
});

test('잘린 스트림과 중간 API 실패를 완료로 처리하지 않는다', async t => {
  let attempt = 0;
  const {client} = await fixture(t, async (url) => {
    if (url.includes('/models')) return catalog();
    if (++attempt === 1) return stream([{type:'ping'}]);
    return stream([{type:'error', error:{type:'overloaded_error', message:key}}]);
  });
  await client.configure(key);
  const args = {messages:[{role:'user', content:'안녕'}]};
  await assert.rejects(client.generate(args), {code:'CLAUDE_STREAM_INCOMPLETE'});
  await assert.rejects(client.generate(args), error => error.code === 'CLAUDE_SERVER' && !error.message.includes(key));
});

test('키를 끊으면 실행 중인 요청과 아직 확인 중인 키 저장이 함께 취소된다', async t => {
  const start = Promise.withResolvers();
  const rotation = Promise.withResolvers();
  const {client} = await fixture(t, async (url, init) => {
    if (url.includes('/models') && init.headers.authorization === `Bearer ${key}`) return catalog();
    const pending = new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true}));
    (url.includes('/models') ? rotation : start).resolve();
    return pending;
  });
  await client.configure(key);
  const answer = client.generate({messages:[{role:'user', content:'안녕'}]});
  const abortedAnswer = assert.rejects(answer, {code:'CLAUDE_CONNECTION_CHANGED'});
  await start.promise;
  const configuring = client.configure(nextKey);
  const abortedConfig = assert.rejects(configuring, {code:'CLAUDE_CONNECTION_CHANGED'});
  await rotation.promise;
  await client.disconnect();
  await Promise.all([abortedAnswer, abortedConfig]);
  assert.deepEqual(await client.status(), {configured:false});
});

test('직접 취소는 현재 키를 변경하지 않고 그 요청에만 적용된다', async t => {
  let start;
  const ready = new Promise(resolve => { start = resolve; });
  const {client} = await fixture(t, async (url, init) => {
    if (url.includes('/models')) return catalog();
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), {once:true});
      start();
    });
  });
  await client.configure(key);
  const cancel = new AbortController();
  const answer = client.generate({signal:cancel.signal, messages:[{role:'user', content:'안녕'}]});
  const failed = assert.rejects(answer, {code:'CLAUDE_CANCELLED'});
  await ready;
  cancel.abort();
  await failed;
  assert.deepEqual(await client.status(), {configured:true});
});

test('요청 시간 초과를 표시하고 등록했던 키는 유지한다', async t => {
  const {client} = await fixture(t, async (url, init) => {
    if (url.includes('/models')) return catalog();
    return new Promise((resolve, reject) => {
      const fallback = setTimeout(() => reject(Error('test server did not finish')), 1000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(fallback);
        reject(init.signal.reason);
      }, {once:true});
    });
  }, {streamTimeout:20});
  await client.configure(key);
  await assert.rejects(client.generate({messages:[{role:'user', content:'안녕'}]}), {code:'CLAUDE_TIMEOUT'});
  assert.deepEqual(await client.status(), {configured:true});
});
