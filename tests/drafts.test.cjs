const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto");
const { Security } = require("../electron/security.cjs");
const { Drafts, registerDrafts } = require("../electron/drafts.cjs");
async function make(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-drafts-"));
  t.after(() =>
    fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 100,
    }),
  );
  const auth = { account: { type: "chatgpt", email: "first@example.invalid" } };
  async function open() {
    const security = new Security(root);
    await security.load();
    const controller = {
      store: { state: { settings: {} } },
      client: {
        start: async () => {},
        request: async () => ({ account: auth.account }),
      },
    };
    const service = new Drafts(root, security, controller),
      api = {};
    registerDrafts(
      (k, fn) => (api[k] = (...a) => security.guard(k, () => fn(...a))),
      service,
    );
    return { security, service, api, controller };
  }
  return { root, auth, open, ...(await open()) };
}
test("기존 미전송 초안은 한 번 이관하고, 입력 중 변경 / 모드 / 앱 재시작을 복원하며 PIN 잠금 중에는 읽기와 쓰기를 거절한다", async (t) => {
  const { open, security, service, api } = await make(t);
  const key = "session:" + randomUUID(),
    original = { text: "미전송 기록", mode: "review" };
  await service.migrate(JSON.stringify({ [key]: original }));
  assert.deepEqual(await api.readDrafts(0), { [key]: original });
  await Promise.all([
    api.writeDrafts(0, { [key]: { text: "초안1", mode: "build" } }),
    api.writeDrafts(0, { [key]: { text: "최종 임시 입력", mode: "plan" } }),
  ]);
  await security.setPin("", "5678");
  security.lock();
  await assert.rejects(api.readDrafts(0), /잠겼습니다/);
  await assert.rejects(api.writeDrafts(0, { [key]: null }), /잠겼습니다/);
  await security.unlock("5678");
  const next = await open();
  await next.service.migrate(
    JSON.stringify({ [key]: { text: "오래된 중복 기록", mode: "review" } }),
  );
  await next.security.unlock("5678");
  assert.deepEqual((await next.api.readDrafts(0))[key], {
    text: "최종 임시 입력",
    mode: "plan",
  });
  await next.api.writeDrafts(0, { [key]: null });
  assert.deepEqual(await next.api.readDrafts(0), {});
});
test("로그아웃 / 외부 계정 교체 후 남은 이전 화면의 쓰기나 레거시 초안이 다른 계정으로 넘어가지 않는다", async (t) => {
  const { open, root, security, service, api, auth, controller } =
    await make(t);
  const key = "project:" + randomUUID(),
    draft = { text: "이전 계정 전용", mode: "plan" };
  await service.migrate(JSON.stringify({ [key]: draft }));
  assert.deepEqual((await api.readDrafts(0))[key], draft);
  auth.account = null;
  await security.accountOwner(null, true);
  await assert.rejects(api.writeDrafts(0, { [key]: draft }), /계정이 바뀌/);
  assert.deepEqual(await api.readDrafts(1), {});
  auth.account = { type: "chatgpt", email: "second@example.invalid" };
  await controller.accountObserved(auth.account);
  assert.equal(security.accountRevision, 2);
  assert.deepEqual(await api.readDrafts(2), {});
  await api.writeDrafts(2, { [key]: { ...draft, text: "새 계정 전용" } });
  const next = await open();
  await next.service.migrate(null);
  assert.equal(next.security.accountRevision, 2);
  assert.equal((await next.api.readDrafts(2))[key].text, "새 계정 전용");
  const data = await fs.readFile(path.join(root, "security.json"), "utf8");
  assert(!data.includes("@example.invalid"));
  await assert.rejects(
    next.api.writeDrafts(2, { "other/../test": draft }),
    /식별자/,
  );
});
test('이관 중 바뀐 구버전 초안은 비교한 뒤 제거하며 다음 실행에서도 새 원문을 보존한다',async t=>{
 const {EventEmitter}=require('node:events'),vm=require('node:vm');const f=await make(t),key='session:'+randomUUID(),original=JSON.stringify({[key]:{text:'처음 읽은 원문',mode:'plan'}}),updated=JSON.stringify({[key]:{text:'읽는 동안 새로 바꾼 원문',mode:'review'}});let local=original;
 function contents(){const target=new EventEmitter();target.executeJavaScript=async script=>vm.runInNewContext(script,{localStorage:{getItem:()=>local,removeItem:()=>{local=null}}});return target;}
 const migrate=f.service.migrate.bind(f.service);f.service.migrate=async source=>{local=updated;return migrate(source);};
 const first=contents();f.service.beginMigration(first);first.emit('did-finish-load');await f.service.migration;assert.equal(local,updated);assert.equal((await f.api.readDrafts(0))[key].text,'처음 읽은 원문');
 const next=await f.open(),second=contents();next.service.beginMigration(second);second.emit('did-finish-load');await next.service.migration;assert.equal(local,updated);assert.equal((await next.api.readDrafts(0))[key].text,'처음 읽은 원문');
 const disk=JSON.parse(await fs.readFile(path.join(f.root,'composer-drafts','legacy.json'),'utf8'));assert.equal(disk.source,original);
});
test('원문이 그대로 보관된 경우에만 구버전 저장소의 중복 값을 제거한다',async t=>{
 const {EventEmitter}=require('node:events'),vm=require('node:vm');const f=await make(t),key='session:'+randomUUID(),source=JSON.stringify({[key]:{text:'변경 없는 원문',mode:'build'}});let local=source;
 const target=new EventEmitter();target.executeJavaScript=async script=>vm.runInNewContext(script,{localStorage:{getItem:()=>local,removeItem:()=>{local=null}}});f.service.beginMigration(target);target.emit('did-finish-load');await f.service.migration;assert.equal(local,null);assert.equal((await f.api.readDrafts(0))[key].text,'변경 없는 원문');
});
test('여러 대화의 대형 초안은 저장 실패 시 직전 내용을 유지하고, 지운 초안의 원문 파일을 정리한다',async t=>{
  const {root,service,api,open}=await make(t);
  await service.migrate(null);
  const first='session:'+randomUUID(), second='session:'+randomUUID();
  const text='한'.repeat(256*1024-1)+'🚦'+'글'.repeat(4_500_000)+'\ud83d';
  const other='다른 초안'.repeat(1_100_000);
  assert(Buffer.byteLength(text)+Buffer.byteLength(other)>24*1024*1024);
  await api.writeDrafts(0,{[first]:{mode:'build',text},[second]:{mode:'review',text:other}});
  const dir=path.join(root,'composer-drafts');
  const files=async()=>(await fs.readdir(dir)).filter(name=>name.endsWith('.draft')).sort();
  const initial=await files();
  assert.equal(initial.length,2);
  const previousStore=service.storeText.bind(service);
  let calls=0;
  service.storeText=async(...args)=>{
    if (++calls===2) throw Error('시험 저장 공간 부족');
    return previousStore(...args);
  };
  await assert.rejects(api.writeDrafts(0,{[first]:{mode:'build',text:other},[second]:{mode:'plan',text}}),/저장 공간 부족/);
  assert.deepEqual(await files(),initial);
  const restored=await open();
  const committed=await restored.api.readDrafts(0);
  assert.equal(committed[first].text,text);
  assert.equal(committed[second].text,other);
  await restored.api.writeDrafts(0,{[first]:{mode:'build',text:'짧은 초안'},[second]:null});
  assert.deepEqual(await files(),[]);
  assert.deepEqual(await restored.api.readDrafts(0),{[first]:{mode:'build',text:'짧은 초안'}});
});
