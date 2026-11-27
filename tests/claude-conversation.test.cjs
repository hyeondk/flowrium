const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { Store } = require('../electron/store.cjs');
const { Controller } = require('../electron/controller.cjs');
const { startWork } = require('../electron/workbench.cjs');

async function setup(t, generate, useCodex=false) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-provider-')));
  const projectPath=path.join(temp,'프로젝트');
  const profile=path.join(temp,'프로필');
  await fs.mkdir(projectPath);
  const store=new Store(profile);
  await store.load();
  const project=await store.addProject(projectPath);
  await store.requestProjectTrust(project.id,async()=>true);
  const codex=Object.assign(new EventEmitter(),{
    approvals:new Map(),inputs:new Map(),close(){},
    async start(){assert.fail('Claude 작업에서 Codex를 호출했습니다.');},
  });
  const claude={status:async()=>({configured:true}),listModels:async()=>[
    {id:'claude-fixture',isDefault:true,contextWindow:200000,supportedReasoningEfforts:[{reasoningEffort:'high'}]},
    {id:'claude-fixture-low',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
  ],generate};
  const controller=new Controller(store,{claude,...(useCodex?{descriptor:{command:process.execPath,
    prefix:[path.join(__dirname,'backend-fake-codex.cjs')],label:'격리 시험',node:false}}:{client:codex})});
  t.after(async()=>{await controller.shutdown();await fs.rm(temp,{recursive:true,force:true,maxRetries:4});});
  async function send(input) {
    const done = new Promise(resolve=>{
      const listener=event=>{
        if(event.type==='done' && event.sessionId===input.sessionId){controller.off('event',listener);resolve(event);}
      };
      controller.on('event',listener);
    });
    assert.equal((await controller.send({mode:'build',...input})).accepted,true);
    return done;
  }
  return {store,controller,project,profile,send};
}

function event(controller,predicate){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{controller.off('event',listener);reject(Error('시험 이벤트를 확인하지 못했습니다.'));},5000);
    function listener(data){if(predicate(data)){clearTimeout(timer);controller.off('event',listener);resolve(data);}}
    controller.on('event',listener);
  });
}

test('Claude는 켜기 전에는 전송되지 않고 자신이 선택된 대화에서 스트리밍과 기존 문맥을 사용한다', async t=>{
  const calls=[];
  const f=await setup(t,async options=>{
    calls.push(structuredClone(options.messages));
    assert.equal(options.model,'claude-fixture');
    assert.equal(options.effort,'high');
    options.onDelta('첫 ');
    options.onDelta('답변');
    return {text:'첫 답변',usage:{inputTokens:20,outputTokens:7}};
  });
  const session=await f.store.createSession(f.project.id);
  const input={sessionId:session.id,text:'한 줄로 정리해줘',provider:'claude'};
  await assert.rejects(f.controller.send({...input,mode:'build'}),/Claude 사용을 켜/);
  await f.store.saveSettings({claudeEnabled:true,claudeModel:'claude-fixture',claudeEffort:'high'});
  assert.equal((await f.send(input)).status,'completed');
  assert.equal(f.store.session(session.id).provider,'claude');
  assert.equal(f.store.session(session.id).threadId,undefined);
  assert.equal(f.store.session(session.id).messages.at(-1).text,'첫 답변');
  assert.equal((await f.send({...input,text:'이어서 말해줘',provider:undefined})).status,'completed');
  assert.deepEqual(calls[1].slice(0,-1),[{role:'user',content:input.text},{role:'assistant',content:'첫 답변'}]);
  await assert.rejects(f.controller.send({...input,provider:'codex',mode:'build'}),/양방향 동기화/);
  await f.store.saveSettings({claudeEnabled:false});
  await assert.rejects(f.controller.send({...input,provider:undefined,mode:'build'}),/Claude 사용을 켜/);
  const reopened=new Store(f.profile);
  await reopened.load();
  assert.equal(reopened.session(session.id).provider,'claude');
  assert.equal(reopened.state.settings.claudeEnabled,false);
});

test('Claude 주간업무보고는 선택한 모델과 수준을 적용하고 공용 양식의 엑셀을 생성한다', async t=>{
  const report=[
    '## 금주 업무내용','| 구분 | 업무내용 | 날짜 | 비고 |','| --- | --- | --- | --- |',
    '| 개발 | 화면 비교 검증 | 2026-11-26 | 테스트 통과 |','## 차주 업무계획',
    '| 구분 | 업무내용 | 날짜 | 비고 |','| --- | --- | --- | --- |',
    '| 개발 | 설치 경로 확인 | 2026-12-01 | |',
  ].join('\n');
  const f=await setup(t,async options=>{
    assert.equal(options.model,'claude-fixture');
    assert.equal(options.effort,'low');
    assert.match(options.system,/업무내용.*업무계획/);
    options.onDelta(report);
    return {text:report};
  });
  await f.store.saveSettings({claudeEnabled:true});
  const session=await startWork(f.store,{projectId:f.project.id,kind:'weekly',provider:'claude',model:'claude-fixture',effort:'low',title:'보고',from:'2026-11-23',to:'2026-11-27'});
  assert.equal((await f.send({sessionId:session.id,text:'주간 보고 작성해줘'})).status,'completed');
  const answer=f.store.session(session.id).messages.at(-1);
  const excel=await fs.readFile(path.join(f.profile,'weekly-report-files',`${session.id}--${answer.id}.xlsx`));
  assert.equal(excel.subarray(0,2).toString(),'PK');
});

test('Claude 대화의 별도 모델이 계정 추론을 지원하지 않으면 공급자의 기본값을 쓴다', async t=>{
  const selected=[];
  const f=await setup(t,async ({model,effort})=>{
    selected.push({model,effort});
    return {text:'검증 답변'};
  });
  await f.store.saveSettings({claudeEnabled:true,claudeModel:'claude-fixture',claudeEffort:'high'});
  const session=await f.store.createSession(f.project.id,{preferences:{provider:'claude',model:'claude-fixture-low'}});
  assert.equal((await f.send({sessionId:session.id,text:'기본값 확인'})).status,'completed');
  assert.equal((await f.send({sessionId:session.id,text:'별도 선택 확인',effort:'low'})).status,'completed');
  assert.deepEqual(selected,[{model:'claude-fixture-low',effort:undefined},{model:'claude-fixture-low',effort:'low'}]);
});

test('양방향 동기화 모드에서 분리된 두 대화는 프로젝트의 최신 문맥을 읽으며 동시에 실행된다', async t=>{
  const f=await setup(t,async options=>{
    assert.match(options.messages.at(-1).content[0].text,/대기검증/);
    assert.match(options.messages.at(-1).content[0].text,/"running":true/);
    return {text:'같은 프로젝트의 Claude 답변'};
  },true);
  await f.controller.connect();
  await f.store.saveSettings({providerMode:'sync',claudeEnabled:true,provider:'claude'});
  const codex=await f.store.createSession(f.project.id);
  const claude=await f.store.createSession(f.project.id,{preferences:{provider:'claude'}});
  const request=f.controller.client.request.bind(f.controller.client);
  const nativeTurns=[];
  f.controller.client.request=(method,params,...rest)=>{
    if(method==='turn/start')nativeTurns.push(params);
    return request(method,params,...rest);
  };
  await f.controller.send({sessionId:codex.id,mode:'plan',text:'대기검증'});
  assert.equal(f.controller.runs.get(codex.id).provider,'codex');
  assert.equal((await f.send({sessionId:claude.id,text:'현재 상태를 알려줘'})).status,'completed');
  assert.equal(f.controller.runs.has(codex.id),true);
  const finished=event(f.controller,data=>data.type==='done'&&data.sessionId===codex.id);
  await f.controller.interrupt(codex.id);
  await finished;
  assert.equal((await f.send({sessionId:codex.id,text:'현재 프로젝트 상태 요약'})).status,'completed');
  assert.match(nativeTurns.at(-1).additionalContext.flowrium_project.value,/같은 프로젝트의 Claude 답변/);
  assert.equal(f.store.session(claude.id).threadId,undefined);
});

test('별도 구성에서 동일한 대화의 Codex와 Claude를 겹쳐 실행하고 각 응답과 Codex 원본을 보존한다', async t=>{
  const start=Promise.withResolvers(), answer=Promise.withResolvers();
  const f=await setup(t,async options=>{
    options.onDelta('Claude 참고 답변');
    start.resolve();
    await answer.promise;
    return {text:'Claude 참고 답변 최종'};
  },true);
  await f.controller.connect();
  await f.store.saveSettings({providerMode:'mixed',claudeEnabled:true});
  const session=await f.store.createSession(f.project.id);
  await f.controller.send({sessionId:session.id,mode:'plan',text:'먼저 Claude에 요청',provider:'claude'});
  await start.promise;
  const request=f.controller.client.request.bind(f.controller.client), nativeStarted=Promise.withResolvers();
  const observed=[];
  f.controller.client.request=(method,params,...rest)=>{
    const value=request(method,params,...rest);
    if(method==='turn/start'){observed.push(params);value.then(nativeStarted.resolve,nativeStarted.reject);}
    return value;
  };
  await f.controller.send({sessionId:session.id,mode:'plan',text:'대기검증',provider:'codex'});
  await nativeStarted.promise;
  assert.deepEqual(f.controller.runs.providers(session.id),['codex','claude']);
  assert.match(observed[0].additionalContext.flowrium_claude.value,/Claude 참고 답변/);
  assert.equal(observed[0].input[0].text,'대기검증');
  const claudeDone=event(f.controller,data=>data.type==='done'&&data.provider==='claude');
  answer.resolve();
  assert.deepEqual((await claudeDone).runningProviders,['codex']);
  const codexDone=event(f.controller,data=>data.type==='done'&&data.provider==='codex');
  await f.controller.interrupt(session.id,'codex');
  assert.deepEqual((await codexDone).runningProviders,[]);
  const persisted=f.store.session(session.id);
  assert.ok(persisted.threadId);
  assert.equal(persisted.messages.find(row=>row.provider==='claude'&&row.role==='assistant').text,'Claude 참고 답변 최종');
  const backup=new Store(f.profile);await backup.load();
  assert.equal(backup.session(session.id).threadId,persisted.threadId);
  assert.equal(backup.session(session.id).messages.filter(row=>row.provider==='claude').length,2);
});
