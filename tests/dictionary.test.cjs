const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Dictionary } = require('../electron/dictionary.cjs');
const { Controller } = require('../electron/controller.cjs');
const { CodexClient } = require('../electron/codex.cjs');
const { Store } = require('../electron/store.cjs');
const { registerConversationScopes } = require('../electron/conversation-scopes.cjs');
const { addTrustedFixtureProject } = require('./project-trust-fixture.cjs');
const limits = require('../electron/dictionary-limits.json');

const ownerA = 'a'.repeat(64), ownerB = 'b'.repeat(64);
const input = (term, extra = {}) => ({term, ...extra});
const save = (dictionary, revision, entry) => dictionary.action({action:'save', revision, entry});
const words = reference => JSON.parse(reference.value.slice(reference.value.indexOf('\n') + 1));

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-dictionary-'));
  t.after(() => fs.rm(root, {recursive:true, force:true,maxRetries:6,retryDelay:150}));
  let context = {owner:ownerA, revision:0, epoch:0};
  const getContext = () => context;
  const dictionary = new Dictionary(root, {context:getContext, ...options});
  return {root, dictionary, getContext, context(value) { context = value; }};
}

test('사전은 변경 세대를 비교해 원자적으로 저장하고 NFC와 대소문자 중복을 막는다', async t => {
  const f = await fixture(t), dictionary = f.dictionary;
  assert.deepEqual(await dictionary.state(), {revision:0,includeInChat:true,entries:[]});
  const first = await save(dictionary,0,input('한달 보고'.normalize('NFD')));
  const {id,createdAt} = first.entries[0];
  assert.equal(first.revision,1);
  assert.equal(first.entries[0].term,'한달 보고');
  assert.deepEqual(Object.keys(first.entries[0]).sort(),['createdAt','id','term']);
  assert.match(createdAt,/^\d{4}-\d\d-\d\dT/);
  await assert.rejects(save(dictionary,1,input('한달 보고')),/이미 사전에/);
  await assert.rejects(save(dictionary,1,input('긴'.repeat(limits.term+1))),/입력 길이/);
  await assert.rejects(save(dictionary,1,input('시험',{definition:'예전 형식은 허용하지 않음'})),/입력 길이/);
  await delay(10);
  const concurrent = await Promise.allSettled([
    save(dictionary,1,input('Month  Report',{id})),
    save(dictionary,1,input('오래된 개정')),
  ]);
  assert.deepEqual(concurrent.map(result=>result.status),['fulfilled','rejected']);
  assert.match(concurrent[1].reason.message,/최신 목록/);
  await assert.rejects(save(dictionary,2,input('month report')),/이미 사전에/);
  const restarted = new Dictionary(f.root,{context:f.getContext});
  assert.deepEqual((await restarted.state()).entries[0],{id,term:'Month  Report',createdAt});
  const disabled = await restarted.action({action:'settings',revision:2,includeInChat:false});
  assert.equal(disabled.includeInChat,false);
  assert.equal(disabled.revision,3);
  const deleted = await restarted.action({action:'delete',revision:3,id});
  assert.deepEqual(deleted,{revision:4,includeInChat:false,entries:[]});
  assert.equal((await fs.readdir(f.root)).length,1);
});

test('현재 계정만 보고 잠금과 계정 변경 사이에 얻었던 사전 결과를 재사용하지 않는다', async t => {
  const f = await fixture(t), dictionary = f.dictionary;
  await save(dictionary,0,input('정산 기준'));
  const pending = await dictionary.reference('정산 기준으로 알려줘');
  assert.deepEqual(words(pending()),['정산 기준']);
  f.context(null);
  await assert.rejects(dictionary.state(),/잠금을 해제/);
  assert.equal(pending(),undefined);
  assert.equal(await dictionary.reference('정산 기준'),undefined);
  f.context({owner:ownerB,revision:1,epoch:2});
  assert.equal((await dictionary.state()).entries.length,0);
  await save(dictionary,0,input('다른 계정 용어'));
  const other = await dictionary.reference('정산 기준과 다른 계정 용어');
  assert.deepEqual(words(other()),['다른 계정 용어']);
  f.context({owner:ownerA,revision:2,epoch:3});
  assert.equal((await dictionary.state()).entries[0].term,'정산 기준');
  assert.equal(other(),undefined);
  assert.equal(pending(),undefined);
  const match = await dictionary.reference('정산 기준');
  await dictionary.action({action:'settings',revision:1,includeInChat:false});
  assert.equal(match(),undefined,'조회 직후 참조 설정이 바뀌어도 예전 정의를 보내지 않는다.');
});

test('저장소 손상과 느린 선택 조회는 채팅에 데이터를 넣지 않고 원본을 보존한다', async t => {
  const f = await fixture(t,{lookupTimeout:25}), dictionary = f.dictionary;
  await save(dictionary,0,input('사전 검사'));
  assert.equal(await dictionary.reference(()=>new Promise(()=>{})),undefined);
  const [filename] = await fs.readdir(f.root);
  await fs.writeFile(path.join(f.root,filename),'{기존 기록이 손상된 상태');
  const broken = new Dictionary(f.root,{context:f.getContext});
  await assert.rejects(broken.state(),/기존 파일은 그대로 보존/);
  await assert.rejects(save(broken,0,input('새 항목')),/기존 파일은 그대로 보존/);
  assert.equal(await broken.reference('사전 검사'),undefined);
  assert.equal(await fs.readFile(path.join(f.root,filename),'utf8'),'{기존 기록이 손상된 상태');
});

test('긴 요청의 앞뒤에서 빠진 본문을 건너뛰어 서로 다른 두 단어를 하나로 매칭하지 않는다', async t => {
  const {dictionary} = await fixture(t);
  await save(dictionary,0,input('첫째 마지막'));
  const first = ' '.repeat(19_998) + '첫째';
  const last = '마지막' + ' '.repeat(19_997);
  assert.equal(await dictionary.reference(first + '생략된 본문' + last),undefined);
  assert.deepEqual(words((await dictionary.reference('첫째 마지막을 확인해줘.'))()),['첫째 마지막']);
});

function done(controller, id) {
  const completed = new Promise((resolve,reject)=>{
    const timer = setTimeout(() => { controller.off('event',listener); reject(Error('시험 대화 완료를 확인하지 못했습니다.')); },5000);
    function listener(event) {
      if (event.type !== 'done' || event.sessionId !== id) return;
      clearTimeout(timer); controller.off('event',listener);
      if (event.status === 'completed') resolve(event);
      else reject(Error(event.text));
    }
    controller.on('event',listener);
  });
  completed.catch(()=>{});
  return completed;
}

test('실제 Controller RPC에서 프로젝트·일반·통합·추가 지시에 관련 사전만 참고로 전달한다', async t => {
  const f = await fixture(t), dictionary = f.dictionary, observed = [];
  const store = new Store(path.join(f.root,'앱 설정'));
  await store.load();
  const folder = path.join(f.root,'시험 프로젝트');
  await fs.mkdir(folder);
  const project = await addTrustedFixtureProject(store,folder);
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const createClient = options => {
    const client = new CodexClient(options), request = client.request.bind(client);
    client.request = (method, params, ...rest) => {
      if (method === 'turn/start' || method === 'turn/steer') observed.push({method,params});
      return request(method, params, ...rest);
    };
    return client;
  };
  const client = createClient({});
  let dictionarySource = dictionary;
  const controller = new Controller(store,{client, scopeClientFactory:configOverrides=>createClient({configOverrides}),
    queueOwner:()=>f.getContext().revision, dictionaryReference:value=>dictionarySource.reference(value)});
  try {
    const handlers = new Map();
    registerConversationScopes((name, handler)=>handlers.set(name,handler),store,controller,{accountOwner:()=>f.getContext().owner});
    await controller.connect();
    const projectChat = await store.createSession(project.id);
    const createScope = scope => handlers.get('createHubConversation')({scope});
    const general = await createScope('general'), integrated = await createScope('integrated');
    await save(dictionary,0,input('정산 기준'));
    await save(dictionary,1,input('SLA'));
    await save(dictionary,2,input('업무 용량'));
    await save(dictionary,3,input('무관 단어'));
    await save(dictionary,4,input('service-level'));
    await save(dictionary,5,input('시범'));
    async function send(session, text) {
      const completed = done(controller,session.id);
      await controller.send({sessionId:session.id,text,mode:'plan'});
      await completed;
      const params = observed.at(-1).params;
      assert.equal(params.input[0].text,text);
      return params.additionalContext?.flowrium_dictionary;
    }
    const matched = await send(projectChat,'정산 기준을 적용하고 sla를 확인하자. service-level과 업무 용량, 시범을 검토해줘.');
    assert.equal(matched.kind,'untrusted');
    assert.deepEqual(words(matched),['service-level','정산 기준','업무 용량','SLA']);
    assert.doesNotMatch(matched.value,/무관 단어|createdAt|revision|includeInChat/);
    assert.equal(await send(projectChat,'SLACK의 설정을 확인해줘.'),undefined);
    assert.deepEqual(words(await send(general,'정산 기준은 어떤 의미야?')),['정산 기준']);
    assert.deepEqual(words(await send(integrated,'SERVICE-LEVEL을 확인해줘.')),['service-level']);
    const steerDone = done(controller,projectChat.id);
    await controller.send({sessionId:projectChat.id,text:'대기검증',mode:'plan'});
    for(let retry=0;retry<100&&!controller.runs.get(projectChat.id)?.turnId;retry++)await delay(10);
    assert(controller.runs.get(projectChat.id)?.turnId);
    const steered=await controller.send({sessionId:projectChat.id,text:'정산 기준으로 추가 확인해줘.',mode:'plan',delivery:'steer'});
    assert.equal(steered.steered,true);
    await steerDone;
    assert.equal(observed.at(-1).method,'turn/steer');
    assert.deepEqual(words(observed.at(-1).params.additionalContext.flowrium_dictionary),['정산 기준']);
    const disabled=await dictionary.action({action:'settings',revision:6,includeInChat:false});
    assert.equal(await send(projectChat,'정산 기준을 확인해줘.'),undefined);
    await dictionary.action({action:'settings',revision:disabled.revision,includeInChat:true});
    f.context({owner:ownerB,revision:1,epoch:1});
    assert.equal(await send(projectChat,'정산 기준과 SLA를 확인해줘.'),undefined);
    await save(dictionary,0,input('다른 계정 단어'));
    assert.deepEqual(words(await send(projectChat,'정산 기준과 다른 계정 단어를 확인해줘.')),['다른 계정 단어']);
    dictionarySource = { reference:async () => { throw Error('사전 시험 오류'); } };
    assert.equal(await send(projectChat,'정산 기준을 다시 확인해줘.'),undefined);
  } finally {
    await controller.shutdown();
  }
});
