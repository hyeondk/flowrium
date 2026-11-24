const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { zstdDecompressSync } = require('node:zlib');
const { CodexClient, resolveCodex } = require('../electron/codex.cjs');
const { Controller } = require('../electron/controller.cjs');
const { registerConversationScopes, scopeThreadParams } = require('../electron/conversation-scopes.cjs');
const { Store } = require('../electron/store.cjs');

const accountId = 'flowrium-test-workspace';
const token = 'flowrium-test-access';
const answer = '작업 공간 검증 응답';
const model = 'gpt-5.5';
const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function completion(emitter, event, accept) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, listener);
      reject(Error('대화 완료 대기 시간이 초과됐습니다.'));
    }, 30000);
    function listener(value) {
      if (!accept(value)) return;
      clearTimeout(timer);
      emitter.off(event, listener);
      resolve(value);
    }
    emitter.on(event, listener);
  });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-workspace-routing-'));
  const codexHome = path.join(temp, 'codex');
  const inputs = [];
  const errors = new Map();
  let client, controller, requestFailure;
  const server = http.createServer(async (req, res) => {
    const reply = value => res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify(value));
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (process.env.FLOWRIUM_WORKSPACE_TEST_TRACE) console.error(req.method, route);
      if (route.endsWith('/wham/config/bundle')) return reply({});
      if (route.endsWith('/wham/accounts/check')) {
        assert.equal(req.headers['chatgpt-account-id'], accountId);
        return reply({ accounts: [{
          id: accountId, account_routing_override: 'NO_CONSTRAINT',
          workspace_backend_origin: `https://127.0.0.1:${server.address().port}`,
        }] });
      }
      if (route.endsWith('/models')) return reply({ models: [] });
      if (req.method !== 'POST' || !route.endsWith('/backend-api/codex/responses')) return res.writeHead(404).end();
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse((req.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes).toString());
      inputs.push(body);
      const id = `response_${inputs.length}`;
      const item = { id: `item_${inputs.length}`, type:'message', role:'assistant', status:'completed', content:[{type:'output_text',text:answer,annotations:[]}] };
      const events = [
        { type:'response.created', response:{id,status:'in_progress'} },
        { type:'response.output_item.added', output_index:0, item:{...item,content:[]} },
        { type:'response.output_item.done', output_index:0, item },
        { type:'response.completed', response:{id,status:'completed',output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}} },
      ];
      res.writeHead(200, {'Content-Type':'text/event-stream'}).end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    } catch (error) {
      requestFailure = error;
      if (process.env.FLOWRIUM_WORKSPACE_TEST_TRACE) console.error(error.message);
      res.writeHead(500).end();
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await fs.mkdir(codexHome);
    const jwt = `${base64({alg:'none',typ:'JWT'})}.${base64({email:'fixture@example.com','https://api.openai.com/auth':{chatgpt_account_id:accountId,chatgpt_plan_type:'pro'}})}.c2lnbmF0dXJl`;
    await fs.writeFile(path.join(codexHome, 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt', last_refresh: new Date().toISOString(),
      tokens: { id_token: jwt, access_token: token, refresh_token: 'flowrium-test-refresh', account_id: accountId },
    }));
    const port = server.address().port;
    // Different loopback origins exercise the official workspace checks without routing inference to the advertised backend.
    const config = [
      'cli_auth_credentials_store = "file"',
      `chatgpt_base_url = "http://localhost:${port}/backend-api"`,
      `openai_base_url = "http://127.0.0.1:${port}/backend-api/codex"`,
      `model = "${model}"`, '[analytics]', 'enabled = false',
      '[features]', 'apps = false', 'plugins = false', '',
    ].join('\n');
    await fs.writeFile(path.join(codexHome, 'config.toml'), config);
    const descriptor = await resolveCodex();
    assert(descriptor, '번들 Codex가 설치되어야 합니다.');
    client = new CodexClient({descriptor, spawn:(cmd, args, options) => {
      const proc = spawn(cmd, args, {
        ...options, env:{...options.env,CODEX_HOME:codexHome,NO_PROXY:'localhost,127.0.0.1',no_proxy:'localhost,127.0.0.1'},
      });
      if (process.env.FLOWRIUM_WORKSPACE_TEST_TRACE) proc.stderr.on('data', value => process.stderr.write(value));
      return proc;
    }});
    const store = new Store(path.join(temp, 'app'));
    await store.load();
    controller = new Controller(store, { client, canRun: () => true, queueOwner: () => 0 });
    controller.on('event', value => { if (value.type === 'error') errors.set(value.sessionId, value.text); });
    if (process.env.FLOWRIUM_WORKSPACE_TEST_TRACE) controller.on('event', value => console.error('event', value.type, value.status ?? '', value.text ?? ''));
    const handlers = new Map();
    registerConversationScopes((name, handler) => handlers.set(name, handler), store, controller, { accountRevision: () => 0 });
    await client.start();
    assert.equal((await client.request('account/read',{refreshToken:false})).account?.type, 'chatgpt');

    const createConversation = handlers.get('createHubConversation');
    const session = await createConversation({scope:'general'});
    const previous = store.session(session.id);
    const params = await scopeThreadParams(controller, previous);
    const oldParams = structuredClone(params);
    delete oldParams.config.default_permissions;
    const legacy = await client.request('thread/start', {...oldParams,model});
    assert.equal(legacy.activePermissionProfile?.id, params.permissions);
    const failed = completion(client, 'notification', value => value.method === 'turn/completed' && value.params.threadId === legacy.thread.id);
    await client.request('turn/start', {threadId:legacy.thread.id,cwd:params.cwd,permissions:params.permissions,model,input:[{type:'text',text:'이전 설정 재현'}]});
    const failedTurn = (await failed).params.turn;
    assert.equal(failedTurn.status, 'failed');
    assert.match(failedTurn.error?.message ?? '', /failed to load workspace requirements: invalid input parameter/);
    assert.equal(inputs.length, 0);
    await client.request('thread/unsubscribe',{threadId:legacy.thread.id});
    previous.threadId = legacy.thread.id;
    await store.save();

    const cases = [
      [session, '기존 대화에서 재전송'],
      [await createConversation({scope:'general'}), '새 일반 채팅 테스트'],
      [await createConversation({scope:'integrated'}), '새 통합 채팅 테스트'],
    ];
    for (const [target, text] of cases) {
      const finished = completion(controller, 'event', value => value.type === 'done' && value.sessionId === target.id);
      await controller.send({sessionId:target.id,text,mode:'build',model});
      const result = await finished;
      if (requestFailure) throw requestFailure;
      assert.equal(result.status,'completed',errors.get(target.id) ?? result.text);
      assert(store.session(target.id).messages.some(message => message.role === 'assistant' && message.text === answer));
    }
    assert.equal(previous.threadId, legacy.thread.id);
    const history = await client.request('thread/read',{threadId:legacy.thread.id,includeTurns:true});
    assert.deepEqual(history.thread.turns.map(turn => turn.status), ['failed','completed']);
    assert.equal(inputs.length, 3);
    for (const [index, input] of inputs.entries()) {
      assert.equal(input.model, model);
      assert(JSON.stringify(input.input).includes(cases[index][1]));
      const names = (input.tools ?? []).flatMap(tool => (tool.tools ?? [tool]).map(value => value.name ?? value.type));
      for (const name of ['exec_command','shell','web_search','read_file','list_dir','view_image']) assert(!names.includes(name),name);
    }
    console.log('기존 ChatGPT 작업 공간 설정 오류 재현 / 같은 원본 대화에서 실패 기록 보존·재전송 성공 / 새 일반·통합 대화 성공 / 외부 실행 도구 제한 유지');
  } finally {
    await controller?.shutdown();
    client?.close();
    if (server.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await fs.rm(temp, {recursive:true,force:true,maxRetries:6,retryDelay:200});
  }
}

main().catch(error => { console.error(error);process.exitCode=1; });
