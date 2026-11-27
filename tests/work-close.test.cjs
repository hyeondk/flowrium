const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { Store } = require('../electron/store.cjs');
const { Controller } = require('../electron/controller.cjs');
const { WorkflowRuntime } = require('../electron/workflow.cjs');
const { Security, registerSecurity } = require('../electron/security.cjs');
const { startWork } = require('../electron/workbench.cjs');
const { addTrustedFixtureProject } = require('./project-trust-fixture.cjs');

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-work-close-'));
  const profile = path.join(root, '설정');
  const directory = path.join(root, '시험 프로젝트');
  await fs.mkdir(directory);
  let store, controller, runtime;
  let owner = 0, allowed = true;
  const events = [];
  async function launch() {
    store = new Store(profile);
    await store.load();
    controller = new Controller(store, {
      queueOwner: () => owner, modelAccount: () => 'a'.repeat(64), canRun: () => allowed,
    });
    controller.on('event', event => events.push(event));
    runtime = new WorkflowRuntime(store, controller, {
      accountRevision: () => owner, canRun: () => allowed, intervalMs: 3600000, ...options,
    });
  }
  async function close() {
    await controller?.shutdown();
    await runtime?.shutdown();
  }
  t.after(async () => {
    try { await close(); } finally { await fs.rm(root, {recursive: true, force: true}); }
  });
  await launch();
  const project = await addTrustedFixtureProject(store, directory);
  await store.saveSettings({codexPath: path.join(__dirname, 'backend-fake-codex.cjs')});
  await controller.connect();
  return {
    project, profile, events, get controller() { return controller; }, get runtime() { return runtime; },
    async make(provider) { return startWork(store, {projectId:project.id,kind:'pause',title:'시험 마감 기록',provider}); },
    async action(input) { return runtime.action(input); },
    async state() { return runtime.state(); },
    async wait(ready) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await runtime.state();
        if (ready(state)) return state;
        await delay(15);
      }
      throw Error('업무 복귀 시험 상태 갱신 시간 초과');
    },
    async restart(concurrent = false) {
      if(concurrent)await Promise.all([runtime.shutdown(),controller.shutdown()]);
      else await close();
      await launch();
      await controller.connect();
    },
    setAccount(value) { owner = value; },
    setAllowed(value) { allowed = value; },
    session(id) { return store.session(id); },
  };
}

function arm(sessionId, reason, memo = '', batchId = randomUUID()) {
  return {action:'armWorkClose',sessionId,reason,memo,batchId,submissionId:randomUUID()};
}
const reserve = {action:'returnToWork'};
const countNotices = state => state.notifications.filter(row => row.kind === 'work-resume');

test('로컬 Claude 연결만으로 마감 요청을 보내고 복귀 메모를 계정 경계 안에서 읽는다', async t => {
  let claudeConnected=true;
  const app=await setup(t,{canUseLocalClaude:()=>claudeConnected});
  const controller=app.controller;
  controller.status.authenticated=false;
  await controller.store.saveSettings({claudeEnabled:true});
  const sent=[];
  controller.options.claude={
    status:async()=>({configured:true}),
    listModels:async()=>[],
    generate:async input=>{sent.push(input);return {text:'회의 전에 실행한 항목을 확인했습니다.'};},
  };
  const session=await app.make('claude');
  const input=arm(session.id,'회의','같은 기기에서 확인할 복귀 메모');
  await app.action({action:'beginWorkClose',batchId:input.batchId});
  await app.action(input);
  await controller.send({sessionId:session.id,provider:'claude',submissionId:input.submissionId,text:'회의 전에 남은 항목을 정리해줘.',mode:'plan'});
  await app.action({action:'finishWorkClose',batchId:input.batchId});
  const state=await app.wait(value=>value.workClose?.sessions[0]?.status==='completed');
  assert.equal(state.workClose.returnPending,true);
  assert.equal(sent.length,1);
  assert.doesNotMatch(JSON.stringify(sent),/같은 기기에서 확인할 복귀 메모/);
  assert.equal((await app.action(reserve)).id,input.batchId);
  const read={action:'readWorkClose',batchId:input.batchId};
  assert.equal((await app.action(read)).memo,input.memo);
  claudeConnected=false;
  assert.equal((await app.state()).workClose,undefined);
  await assert.rejects(app.action(read),/AI 서비스 연결/);
  claudeConnected=true;
  app.setAccount(1);
  assert.equal(await app.action(read),null);
});

test('실제로 실행한 마감만 1초 이내 복귀에서 알림 한 번을 만들고 새 실행 이후에도 메모를 비공개로 유지한다', async t => {
  const app = await setup(t);
  const session = await app.make();
  const memo = '이름과 별개로 남긴 비공개 메모';
  const input = arm(session.id, '회의', memo);
  await app.action(input);
  assert.equal((await app.state()).workClose,undefined);
  assert.equal(await app.action(reserve),null);
  await app.controller.send({sessionId:session.id,submissionId:input.submissionId,text:'회의 전 합성 대기검증',mode:'plan'});
  const state = await app.wait(value => value.workClose?.returnPending);
  assert.equal(state.workClose.memo,undefined);
  assert.equal(state.workClose.sessions[0].status,'running');
  assert.deepEqual(app.events.filter(event => event.type === 'workCloseReady'),[{type:'workCloseReady',sessionId:session.id}]);
  const results = await Promise.all([app.action(reserve), app.action(reserve)]);
  const returned = results.find(Boolean);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(returned.id,input.batchId);
  assert.equal(returned.memo,undefined);
  assert.equal(returned.reason,'회의');
  assert.equal(countNotices(await app.state())[0].id,returned.notificationId);
  assert.doesNotMatch(JSON.stringify(await app.state()),new RegExp(memo));
  await app.controller.interrupt(session.id);
  await app.wait(value => value.workClose?.sessions[0].status==='interrupted');
  await app.restart();
  const restarted = await app.state();
  assert.equal(restarted.workClose.returnPending,false);
  assert.equal(countNotices(restarted).length,1);
  assert.equal(await app.action(reserve),null);
  assert.equal((await app.action({action:'readWorkClose',batchId:input.batchId})).memo,memo);
  app.setAllowed(false);
  await assert.rejects(app.action({action:'readWorkClose',batchId:input.batchId}),/잠금/);
  app.setAllowed(true);
  app.setAccount(1);
  assert.equal(await app.action({action:'readWorkClose',batchId:input.batchId}),null);
  assert.equal((await app.state()).workClose,undefined);
});

test('서버에 아직 전달되지 않은 대기 지시는 복귀로 기록하지 않고 빠른 실제 완료는 재실행 뒤에도 복귀할 수 있다', async t => {
  const app = await setup(t);
  const session = await app.make();
  const input = arm(session.id, '점심');
  await app.action(input);
  app.session(session.id).compacting = true;
  const queued = await app.controller.send({sessionId:session.id,submissionId:input.submissionId,text:'점심 전 완료 보고서',mode:'plan'});
  assert.equal(queued.queued,true);
  assert.equal(await app.action(reserve),null);
  assert.equal((await app.state()).workClose,undefined);
  app.session(session.id).compacting = false;
  await app.controller.messageQueue.flush(session.id);
  await app.wait(state => state.workClose?.sessions[0].status==='completed');
  await app.restart();
  assert.equal((await app.state()).workClose.returnPending,true);
  const returned = await app.action(reserve);
  assert.equal(returned.reason,'점심');
  assert.equal(returned.sessions[0].sessionId,session.id);
  assert.equal(returned.sessions[0].status,'completed');
  assert.equal(returned.notificationId,countNotices(await app.state())[0].id);
});

test('마감이 진행 중일 때 앱 처리기가 먼저 종료돼도 재시작에서 중단 상태를 복원한다', async t => {
  const app = await setup(t);
  const input = arm((await app.make()).id, '회의');
  await submit(app,input,'종료 뒤 복귀 확인 대기검증');
  await app.wait(state=>state.workClose?.sessions[0].status==='running');
  await app.restart(true);
  const resumed = await app.action(reserve);
  assert.equal(resumed.id,input.batchId);
  assert.equal(resumed.sessions[0].status,'interrupted');
});

test('한 마감의 여러 실행 결과를 모으고 시작하지 못한 다른 마감은 최신 복귀 기록을 덮지 않는다', async t => {
  const app = await setup(t);
  const first = await app.make();
  const second = await app.make();
  const pending = await app.make();
  const one = arm(first.id,'퇴근');
  const two = arm(second.id,'퇴근','',one.batchId);
  await app.action(one);
  await app.controller.send({sessionId:first.id,submissionId:one.submissionId,text:'합성 보고서 작성',mode:'plan'});
  await app.wait(state=>state.workClose?.sessions[0].status==='completed');
  await app.action(arm(pending.id,'기타'));
  assert.equal((await app.state()).workClose.id,one.batchId);
  await app.action(two);
  await app.controller.send({sessionId:second.id,submissionId:two.submissionId,text:'조기 연결 실패 강제종료',mode:'plan'});
  for(let attempt=0;attempt<100 && app.controller.runs.has(second.id);attempt++) await delay(15);
  assert.equal(app.controller.runs.has(second.id),false);
  await app.controller.connect();
  const state = await app.wait(value=>value.workClose?.sessions[1]?.status==='failed');
  assert.equal(state.workClose.id,one.batchId);
  assert.deepEqual(state.workClose.sessions.map(row=>row.status),['completed','failed']);
  assert.equal(app.events.filter(event=>event.type==='workCloseReady').length,1);
  assert.equal((await app.action(reserve)).sessions.length,2);
  assert.equal(countNotices(await app.state()).length,1);
});

async function lockFixture(t, app) {
  const security = new Security(app.profile);
  await security.load();
  await security.setPin('', '8642');
  await security.accountOwner({type:'chatgpt',email:'pause-fixture-a@example.invalid'});
  const powerMonitor=Object.assign(new EventEmitter(),{getSystemIdleTime:()=>0});
  const integration=registerSecurity(()=>{},security,{
    controller:app.controller, busy:()=>false, powerMonitor,
    powerSaveBlocker:{start:()=>0,stop:()=>{}}, Notification:{isSupported:()=>false},
    deferWorkCloseLock:(event,lock)=>app.runtime.deferWorkCloseLock(event,lock),
  });
  t.after(()=>integration.stop());
  return {security,powerMonitor};
}

async function submit(app, input, text) {
  await app.action(input);
  return app.controller.send({sessionId:input.sessionId,submissionId:input.submissionId,text,mode:'plan'});
}

test('PIN 자동 마감 잠금이 같은 묶음의 다른 프로젝트 시작을 기다리더라도 제출 종료 즉시 잠근다', async t => {
  const app=await setup(t), {security}=await lockFixture(t,app);
  const first=await app.make(), second=await app.make();
  const one=arm(first.id,'회의');
  const two=arm(second.id,'회의','',one.batchId);
  await app.action({action:'beginWorkClose',batchId:one.batchId});
  await submit(app,one,'먼저 끝나는 시험');
  await app.wait(result=>result.workClose?.sessions[0].status==='completed');
  assert.equal(security.locked,false);
  await submit(app,two,'다른 프로젝트 대기검증');
  await app.wait(result=>result.workClose?.sessions[1]?.status==='running');
  await app.action({action:'finishWorkClose',batchId:one.batchId});
  await delay(0);
  assert.equal(security.reason,'workday');
});

test('준비 창이 사라지면 자동 잠금을 제한 시간 뒤 실행하고 같은 마감의 재호출은 기한을 연장하지 않는다', async t => {
  const app=await setup(t,{workCloseSubmissionMs:650}), {security}=await lockFixture(t,app);
  const input=arm((await app.make()).id,'기타');
  await app.action({action:'beginWorkClose',batchId:input.batchId});
  const timer=app.runtime.workCloseSubmission.timer;
  await submit(app,input,'자동 잠금 시간 제한 시험');
  await app.wait(result=>result.workClose?.sessions[0].status==='completed');
  assert.equal(security.locked,false);
  await app.action({action:'beginWorkClose',batchId:input.batchId});
  assert.equal(app.runtime.workCloseSubmission.timer,timer);
  for(let retry=0;retry<100&&!security.locked;retry++)await delay(15);
  assert.equal(security.reason,'workday');
  await app.action({action:'beginWorkClose',batchId:input.batchId});
  assert.equal(app.runtime.workCloseSubmission.timer,undefined);
});

test('이미 다른 계정으로 바뀌었거나 직접 잠갔다 해제한 화면에는 지연된 마감 잠금을 실행하지 않는다', async t => {
  const app=await setup(t), {security,powerMonitor}=await lockFixture(t,app);
  const input=arm((await app.make()).id,'점심');
  await app.action({action:'beginWorkClose',batchId:input.batchId});
  await submit(app,input,'사용자 잠금 유지 시험');
  await app.wait(result=>result.workClose?.sessions[0].status==='completed');
  powerMonitor.emit('suspend');
  assert.equal(security.reason,'suspend');
  await security.unlock('8642');
  await app.action({action:'finishWorkClose',batchId:input.batchId});
  await delay(0);
  assert.equal(security.locked,false);
  const next=arm((await app.make()).id,'퇴근');
  await app.action({action:'beginWorkClose',batchId:next.batchId});
  await submit(app,next,'계정 전환 시험');
  await app.wait(result=>result.workClose?.id===next.batchId&&result.workClose.sessions[0].status==='completed');
  await security.accountOwner({type:'chatgpt',email:'pause-fixture-b@example.invalid'});
  app.setAccount(security.accountRevision);
  await app.action({action:'finishWorkClose',batchId:next.batchId});
  await delay(0);
  assert.equal(security.locked,false);
  assert.equal(app.runtime.workCloseSubmission.lock,undefined);
});
