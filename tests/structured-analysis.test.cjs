const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {runStructuredAnalysis} = require('../electron/structured-analysis.cjs');

function fixture(t, background=false) {
  const analysis = new EventEmitter();
  const ready = Promise.withResolvers();
  analysis.start = async () => {};
  analysis.close = () => analysis.emit('disconnect', Error('Codex 연결을 종료했습니다.'));
  analysis.request = async (method, params) => {
    if (method === 'thread/start') return {thread:{id:'test'},activePermissionProfile:{id:params.permissions}};
    assert.equal(method, 'turn/start');
    ready.resolve();
    return {turn:{id:'turn'}};
  };
  const controller = {
    client:{start:async () => {},request:async method => method === 'account/read' ? {account:{type:'chatgpt'}} : {config:{}}},
    options:{analysisClientFactory:() => analysis},
    editingSessions:new Set(), store:{state:{settings:{}}}
  };
  const result = runStructuredAnalysis(controller, {prompt:'합성 추천 자료',schema:{type:'object'},background});
  result.catch(() => {});
  return {
    controller, ready:ready.promise, result,
    cancel:() => [...controller.analysisRuns.values()][0]?.cancel(),
    notify:(method, params) => analysis.emit('notification', {method, params:{threadId:'test', ...params}})
  };
}

function complete(f) {
  f.notify('item/completed', {item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'{"ok":true}'}});
  f.notify('turn/completed', {turn:{id:'turn',status:'completed'}});
}

test('추천 중 계획과 중간 설명을 받아도 마지막 답변만 해석한다', async t => {
  const f = fixture(t); await f.ready;
  f.notify('item/started', {item:{id:'plan',type:'plan'}});
  f.notify('item/completed', {item:{id:'comment',type:'agentMessage',phase:'commentary',text:'자료를 확인하겠습니다.'}});
  complete(f);
  assert.deepEqual(await f.result, {ok:true});
});

test('추론이 진행 중이면 전체 45초를 넘어서도 추천을 받는다', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f = fixture(t); await f.ready;
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(30000);
    f.notify('item/reasoning/summaryTextDelta', {itemId:'thinking',delta:'…'});
  }
  complete(f);
  assert.deepEqual(await f.result, {ok:true});
});

test('응답 지연과 취소는 연결 종료 문구에 가려지지 않는다', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const idle = fixture(t); await idle.ready;
  t.mock.timers.tick(10 * 60 * 1000);
  await assert.rejects(idle.result, /대기 시간/);
  const cancelled = fixture(t); await cancelled.ready; cancelled.cancel();
  await assert.rejects(cancelled.result, /취소/);
});

test('실행 도구 이벤트는 차단하고 그 이유를 표시한다', async t => {
  const f = fixture(t); await f.ready;
  f.notify('item/started', {item:{id:'tool',type:'commandExecution'}});
  await assert.rejects(f.result, /도구/);
});

test('명시한 요청이 다른 대화의 추천 준비를 기다리지 않고 우선 실행된다',async t=>{
 const f=fixture(t,true);await f.ready;
 const getsForeground=Promise.withResolvers();
 const client=new EventEmitter();
 client.start=async()=>{};
 client.close=()=>{};
 client.request=async(method,params)=>{
  if(method==='thread/start')return {thread:{id:'explicit'},activePermissionProfile:{id:params.permissions}};
  getsForeground.resolve();return {turn:{id:'turn'}};
 };
 f.controller.options.analysisClientFactory=()=>client;
 const foreground=runStructuredAnalysis(f.controller,{prompt:'사용자가 선택한 분석',schema:{type:'object'}});
 await assert.rejects(f.result,/취소/);await getsForeground.promise;
 client.emit('notification',{method:'item/completed',params:{threadId:'explicit',item:{id:'answer',type:'agentMessage',text:'{"ok":true}'}}});
 client.emit('notification',{method:'turn/completed',params:{threadId:'explicit',turn:{status:'completed'}}});
 assert.deepEqual(await foreground,{ok:true});assert.equal(f.controller.analysisRuns.size,0);
});
