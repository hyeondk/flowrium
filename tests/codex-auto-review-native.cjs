const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {CodexClient, resolveCodex} = require('../electron/codex.cjs');
const {killOwnedProcess, within} = require('./update-installed-ui.cjs');

function assistantMessage(id, text) {
  return {id, type:'message', role:'assistant', status:'completed',
    content:[{type:'output_text', text, annotations:[]}]};
}

function sendResponse(res, item) {
  const id = 'resp_' + randomUUID();
  const added = item.type === 'function_call' ? {...item, arguments:''} : {...item, content:[]};
  const events = [
    {type:'response.created', response:{id, status:'in_progress'}},
    {type:'response.output_item.added', output_index:0, item:added},
    {type:'response.output_item.done', output_index:0, item},
    {type:'response.completed', response:{id, status:'completed', output:[item],
      usage:{input_tokens:10, output_tokens:10, total_tokens:20}}},
  ];
  res.writeHead(200, {'content-type':'text/event-stream'});
  res.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''));
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-native-review-'));
  const cwd = path.join(temp, 'project');
  const profile = path.join(temp, 'account');
  let client, controller, server, current, fixtureError;
  try {
    await fs.mkdir(cwd);
    await fs.mkdir(profile);
    // 모델 응답과 계정 정보만 고정하고, 검토 결과 처리와 명령 실행은 실제 Codex에 맡긴다.
    server = http.createServer(async (req, res) => {
      try {
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/v1/responses');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        const {callId, marker, verdict, file} = current;
        if (body.client_metadata?.['x-openai-subagent'] === 'guardian') {
          current.reviews++;
          assert(JSON.stringify(body.input).includes(file), '격리 파일 작업을 자동 검토');
          const assessment = verdict === 'allow'
            ? {risk_level:'low', user_authorization:'high', outcome:'allow', rationale:'Synthetic fixture allowed.'}
            : {risk_level:'high', user_authorization:'unknown', outcome:'deny', rationale:'Synthetic fixture denied.'};
          sendResponse(res, assistantMessage('review_' + callId, JSON.stringify(assessment)));
          return;
        }
        const result = body.input.find(item => item.type === 'function_call_output' && item.call_id === callId);
        if (result) {
          current.result = result.output;
          sendResponse(res, assistantMessage('msg_' + callId, '시험 결과 수신 ' + marker));
          return;
        }
        assert(JSON.stringify(body.input).includes(marker), 'Flowrium이 지정된 합성 요청만 보냄');
        const tool = 'exec_command';
        const namespace = body.tools.find(item => item.type === 'namespace' && item.tools.some(entry => entry.name === tool));
        assert(namespace || body.tools.some(item => item.name === tool), '셸 도구 사용 가능');
        const cmd = process.platform === 'win32'
          ? `Set-Content -LiteralPath '${file}' -Value '${marker}'`
          : `printf '%s\\n' '${marker}' > '${file}'`;
        sendResponse(res, {id:'cmd_' + callId, type:'function_call', call_id:callId, name:tool,
          ...(namespace && {namespace:namespace.name}),
          arguments:JSON.stringify({cmd, workdir:cwd, sandbox_permissions:'require_escalated',
            justification:'Write only the designated synthetic fixture in the isolated test folder.'})});
      } catch (error) {
        fixtureError ||= error;
        res.writeHead(400).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port + '/v1';
    const config = [
      'cli_auth_credentials_store = "file"',
      'model = "gpt-5.5"',
      '[model_providers.flowrium_test]',
      'name = "Flowrium native review fixture"',
      'base_url = ' + JSON.stringify(base),
      'wire_api = "responses"',
      'env_key = "FLOWRIUM_OFFLINE_KEY"',
      'supports_websockets = false',
    ].join('\n');
    const configPath = path.join(profile, 'config.toml');
    await fs.writeFile(configPath, config);
    client = new CodexClient({descriptor:await resolveCodex(),
      spawn:(cmd, args, opts) => spawn(cmd, [...args, '-c', 'model_provider="flowrium_test"'],
        {...opts, env:{...opts.env, CODEX_HOME:profile, FLOWRIUM_OFFLINE_KEY:'synthetic-only',
          OPENAI_BASE_URL:base, NO_PROXY:'127.0.0.1', no_proxy:'127.0.0.1'}})});
    const requests = [];
    const nativeRequest = client.request.bind(client);
    client.request = (method, ...args) => {
      if (['thread/start', 'turn/start'].includes(method)) requests.push({method, params:args[0]});
      return method === 'account/read' ? Promise.resolve({account:{type:'chatgpt', planType:'test'}})
        : nativeRequest(method, ...args);
    };
    const inspections = [], nativeApprovals = [];
    client.on('notification', message => {
      if (message.method.startsWith('item/autoApprovalReview/')) inspections.push(message);
    });
    client.on('approval', event => nativeApprovals.push(event.method));

    const store = new Store(path.join(temp, 'flowrium'));
    await store.load();
    const project = await store.addProject(cwd);
    await store.saveSettings({model:'gpt-5.5'});
    controller = new Controller(store, {client, canRun:() => true});
    await controller.connect();
    const firstSession = await store.createSession(project.id);
    await assert.rejects(controller.send({sessionId:firstSession.id, text:'신뢰하기 전 시험'}, {fromComposer:true}), /신뢰/);
    assert.equal(requests.length, 0);
    assert.equal(await store.requestProjectTrust(project.id, async folder => {
      assert.equal(await fs.realpath(folder.path), await fs.realpath(cwd));
      return true;
    }), true);

    for (const verdict of ['allow', 'deny']) {
      const session = verdict === 'allow' ? firstSession : await store.createSession(project.id);
      const id = randomUUID();
      current = {callId:'write_' + id, marker:'FIXTURE_' + id, verdict, file:'result-' + verdict + '.txt', reviews:0};
      const expectedStatus = verdict === 'allow' ? 'approved' : 'denied';
      const steps = [];
      let flowriumApprovals = 0;
      const completion = Promise.withResolvers();
      const onEvent = event => {
        if (event.sessionId !== session.id) return;
        const step = event.workProgress?.step;
        if (step) steps.push({id:step.id, state:step.state});
        if (event.type === 'approval') flowriumApprovals++;
        if (event.type === 'done') completion.resolve(event);
      };
      controller.on('event', onEvent);
      try {
        await controller.send({sessionId:session.id, text:`격리된 시험 파일에 ${current.marker} 문자열을 저장해줘.`},
          {fromComposer:true});
        const result = await within(completion.promise, 30000, '합성 파일 자동 검토');
        if (fixtureError) throw fixtureError;
        assert.equal(result.status, 'completed', result.text);
      } finally {
        controller.off('event', onEvent);
      }

      const review = inspections.splice(0);
      assert.equal(current.reviews, 1);
      assert.notEqual(current.result, undefined, '검토 결과가 도구 응답으로 모델에 반환됨');
      assert.equal(review.length, 2, '자동 검토 시작과 완료');
      assert.equal(review[0].method, 'item/autoApprovalReview/started');
      assert.equal(review[1].method, 'item/autoApprovalReview/completed');
      assert.equal(review[0].params.reviewId, review[1].params.reviewId);
      assert.equal(review[1].params.review.status, expectedStatus);
      assert.deepEqual(nativeApprovals, [], 'Codex 수동 승인 요청 없음');
      assert.equal(flowriumApprovals, 0, 'Flowrium 수동 승인 팝업 없음');
      const messages = store.session(session.id).messages;
      const reviewId = 'auto-approval:' + review[1].params.reviewId;
      const finalState = verdict === 'allow' ? 'completed' : 'interrupted';
      assert.deepEqual(steps.filter(step => step.id === reviewId).map(step => step.state), ['running', finalState]);
      assert(messages.find(message => message.role === 'user').workSteps
        .some(step => step.id === reviewId && step.state === finalState));
      assert(messages.some(message => message.role === 'assistant' && message.text.includes(current.marker)));
      const target = path.join(cwd, current.file);
      if (verdict === 'allow') assert.equal((await fs.readFile(target, 'utf8')).trim(), current.marker);
      else await assert.rejects(fs.stat(target), {code:'ENOENT'});
      console.log(verdict === 'allow' ? '자동 승인 시 실제 파일 저장 확인' : '자동 거절 시 파일 미생성 확인');
    }
    assert.deepEqual(requests.map(entry => entry.method), ['thread/start', 'turn/start', 'thread/start', 'turn/start']);
    assert(requests.every(({params}) => params.approvalPolicy === 'on-request' && params.approvalsReviewer === 'auto_review'));
    assert.equal(await fs.readFile(configPath, 'utf8'), config);
    console.log('최초 프로젝트 신뢰 / 자동 검토 시작·결과 / 수동 승인 요청 미발생 확인');
  } finally {
    try {
      const child = client?.proc;
      const closed = child && once(child, 'close');
      if (child && process.platform === 'win32') await killOwnedProcess(child);
      await controller?.shutdown();
      client?.close();
      if (closed) await within(closed, 15000, '시험 Codex 종료');
    } finally {
      server?.closeAllConnections();
      if (server) await new Promise(resolve => server.close(resolve));
      await fs.rm(temp, {recursive:true, force:true, maxRetries:12, retryDelay:200});
    }
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
