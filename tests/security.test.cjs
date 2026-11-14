const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const {
  Security,
  registerSecurity,
  usageView,
} = require("../electron/security.cjs");

async function create(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-security-"));
  t.after(() =>
    fs.rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  let now = Date.UTC(2026, 0, 1);
  const clock = () => now;
  const security = new Security(tmp, clock);
  await security.load();
  const controller = Object.assign(new EventEmitter(), {
    runs: new Map(),
    loadedThreads: new Set(),
    status: { authenticated: true },
    store: { state: { sessions: [], settings: {} } },
    client: { approvals: new Map(), start: async () => {} },
    emitEvent(event) {
      this.emit("event", event);
    },
  });
  const calls = [];
  controller.client.request = async (method, params) => {
    calls.push([method, params]);
    if (method === "account/read")
      return { account: { type: "chatgpt", email: "비공개" } };
    if (method === "account/rateLimits/read")
      return {
        rateLimits: { primary: { usedPercent: 70, windowDurationMins: 300 } },
      };
    return {};
  };
  const power = new EventEmitter();
  power.getSystemIdleTime = () => 10000;
  const blockers = [],
    notifications = [];
  const api = {};
  const runtime = registerSecurity(
    (key, action) => {
      api[key] = (...args) => security.guard(key, () => action(...args));
    },
    security,
    {
      controller,
      busy: () => controller.runs.size > 0,
      powerMonitor: power,
      powerSaveBlocker: {
        start: (kind) => {
          blockers.push(kind);
          return 0;
        },
        stop: (id) => blockers.push(id),
      },
      Notification: class extends EventEmitter {
        constructor(input) {
          super();
          this.input = input;
        }
        static isSupported() {
          return true;
        }
        show() {
          notifications.push(this.input);
        }
      },
      focus: () => {},
    },
  );
  t.after(() => runtime.stop());
  return {
    tmp,
    security,
    controller,
    api,
    runtime,
    clock,
    advance: (n) => {
      now += n;
    },
    power,
    blockers,
    notifications,
    calls,
  };
}

test("기기 전용 잠금 번호는 솔트와 해시로만 보관하고 앱 재실행과 오입력 제한을 유지한다", async (t) => {
  const { tmp, security, api, clock, advance } = await create(t);
  await api.setSecurityPin("", "8704");
  const disk = await fs.readFile(security.file, "utf8");
  assert(!disk.includes('"8704"'));
  const raw = JSON.parse(disk);
  assert.match(raw.pin.hash, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(await api.securityState()).includes(raw.pin.salt));
  if (process.platform !== "win32")
    assert.equal((await fs.stat(security.file)).mode & 0o777, 0o600);
  const locked = await api.lockSecurity();
  assert(!locked.preferences);
  const attempts = await Promise.allSettled(
    Array.from({ length: 7 }, () => api.unlockSecurity("0000")),
  );
  assert(attempts.every((item) => item.status === "rejected"));
  const restart = new Security(tmp, clock);
  await restart.load();
  assert(restart.locked);
  await assert.rejects(restart.unlock("8704"), /잠시 후/);
  assert.equal(restart.data.failures, 5);
  advance(31000);
  await restart.unlock("8704");
  assert(!restart.locked);
  assert.equal(restart.data.failures, 0);
  await assert.rejects(restart.setPin("9999", null), /일치/);
  await restart.setPin("8704", "1357");
  assert.notEqual(restart.data.pin.salt, raw.pin.salt);
  await restart.setPin("1357", null);
  assert.equal(restart.state().hasPin, false);
  await fs.writeFile(restart.file, "{}");
  await assert.rejects(new Security(tmp).load(), /손상/);
});

test("잠금 전 시작한 비동기 응답과 오류도 화면으로 반환하지 않고 잠금 화면에서 유일한 공개 상태에 민감 정보를 담지 않는다", async (t) => {
  const { security, api } = await create(t);
  await assert.rejects(api.lockSecurity(), /잠금 번호/);
  await api.setSecurityPin("", "4650");
  let done, fail;
  const inflight = security.guard(
    "readWorkbench",
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const inflightError = security.guard(
    "readTeams",
    () =>
      new Promise((_r, reject) => {
        fail = reject;
      }),
  );
  await api.lockSecurity();
  let accessed = false;
  await assert.rejects(
    security.guard("newUnregisteredMethod", () => {
      accessed = true;
    }),
    /잠겼습니다/,
  );
  assert.equal(accessed, false);
  assert.deepEqual(
    Object.keys(await api.securityState()).sort(),
    [
      "loaded",
      "locked",
      "hasPin",
      "retryAt",
      "reason",
      "accountRevision",
    ].sort(),
  );
  await assert.rejects(api.setSecurityPin("", "7777"), /잠겼습니다/);
  await assert.rejects(api.securityPending(), /잠겼습니다/);
  await api.unlockSecurity("4650");
  done("비공개 프로젝트");
  fail(new Error("비공개 경로"));
  await assert.rejects(inflight, /잠겼습니다/);
  await assert.rejects(inflightError, /잠겼습니다/);
});

test("계정 한도는 허용 필드만 반환하고 로그아웃은 명시 요청 때 진행 중인 작업과 중복 요청을 확인한다", async (t) => {
  const { controller, security, api, calls } = await create(t);
  assert.equal(calls.length, 0);
  const view = await api.readAccountUsage();
  assert.equal(view.buckets[0].windows[0].minutes, 300);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["account/read", "account/rateLimits/read"],
  );
  const filtered = usageView({
    accountId: "사용자식별자",
    rateLimits: {},
    rateLimitsByLimitId: {
      x: {
        limitName: "별도 한도",
        secret: "비공개",
        primary: {
          usedPercent: 17,
          resetsAt: 1900000000,
          windowDurationMins: 300,
        },
        secondary: { usedPercent: 124, windowDurationMins: 10080 },
        credits: { hasCredits: true, unlimited: true, balance: null },
      },
    },
  });
  assert(!JSON.stringify(filtered).includes("비공개"));
  assert(!JSON.stringify(filtered).includes("사용자식별자"));
  assert.equal(filtered.buckets[0].windows[1].usedPercent, 100);
  controller.runs.set("내 대화", {});
  await assert.rejects(api.logoutSecurity(), /진행 중/);
  controller.runs.clear();
  const history = { id: "비공개 대화", messages: [{ text: "보존할 내용" }] };
  controller.store.state.sessions.push(history);
  let finish;
  const connect = security.guard(
    "connect",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await assert.rejects(api.logoutSecurity(), /진행 중/);
  finish();
  await connect;
  controller.client.request = (method) => {
    calls.push([method]);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const logout = api.logoutSecurity();
  await Promise.resolve();
  await assert.rejects(
    security.guard("send", async () => {}),
    /로그아웃/,
  );
  await assert.rejects(api.logoutSecurity(), /진행 중/);
  finish({});
  await logout;
  assert.equal(calls.filter((c) => c[0] === "account/logout").length, 1);
  assert.equal(controller.status.authenticated, false);
  assert.strictEqual(controller.store.state.sessions[0], history);
  assert.equal(security.accountRevision, 1);
});

test("절전, 자리 비움, 업무 마감 잠금 / 승인 복원 / 작업 중에만 절전 방지 / 내용 없는 운영체제 알림", async (t) => {
  const {
    api,
    security,
    runtime,
    advance,
    power,
    controller,
    blockers,
    notifications,
  } = await create(t);
  await api.setSecurityPin("", "4650");
  await api.setSecurityPreferences({
    idleMinutes: 5,
    notifyApproval: true,
    notifyDone: true,
    preventSleep: true,
  });
  runtime.checkIdle();
  assert(!security.locked);
  advance(300001);
  runtime.checkIdle();
  assert.equal(security.reason, "idle");
  await api.unlockSecurity("4650");
  power.emit("suspend");
  assert.equal(security.reason, "suspend");
  await api.unlockSecurity("4650");
  await api.setSecurityPreferences({ lockOnSuspend: false });
  power.emit("lock-screen");
  assert(!security.locked);
  controller.store.state.sessions.push({
    id: "대화",
    workflow: { kind: "pause" },
  });
  controller.runs.set("대화", { sessionId: "대화",ownerRevision:security.accountRevision });
  controller.emitEvent({ type: "status", sessionId: "대화" });
  await api.lockSecurity();
  controller.client.approvals.set("승인", {});
  controller.emitEvent({
    type: "approval",
    requestId: "승인",
    sessionId: "대화",
    details: "비공개 명령",
  });
  assert.deepEqual(blockers, ["prevent-app-suspension"]);
  assert(!JSON.stringify(notifications).includes("비공개"));
  await api.unlockSecurity("4650");
  assert.deepEqual(
    (await api.securityPending()).map((e) => e.type),
    ["status", "approval"],
  );
  controller.client.approvals.clear();
  assert.equal((await api.securityPending()).length, 1);
  controller.runs.clear();
  controller.emitEvent({
    type: "done",
    sessionId: "대화",
    status: "completed",
  });
  assert.equal(security.reason, "workday");
  assert.deepEqual(blockers, ["prevent-app-suspension", 0]);
  assert.equal(notifications.length, 2);
});
test("계정이 바뀌면 잠금 중에 도착한 이전 계정의 질문을 취소하고 복원 목록에서 지운다", async (t) => {
  const { controller, security, api } = await create(t);
  await security.accountOwner({ type:"chatgpt",email:"first@example.invalid" });
  await api.setSecurityPin("", "8822");await api.lockSecurity();
  const state = {type:"input",requestId:"q",sessionId:"s",questions:[{id:"secret",isSecret:true}]};
  controller.runs.set("s",{sessionId:"s",ownerRevision:security.accountRevision});
  controller.client.inputs=new Map([["q",{}]]);
  const calls=[];
  controller.client.resolveInput=(id,cancel)=>{calls.push([id,cancel]);controller.client.inputs.delete(id);};
  controller.emitEvent(state);
  await security.accountOwner({ type:"chatgpt",email:"second@example.invalid" });
  assert.deepEqual(calls,[["q",true]]);
  await api.unlockSecurity("8822");
  assert(!(await api.securityPending()).some(e=>e.type==="input"));
});
test('계정 변경은 모든 실행 연결의 승인과 질문을 취소하고 이전 실행을 중지하며 복원 목록을 비운다',async t=>{
 const {controller,security,api}=await create(t);await security.accountOwner({type:'chatgpt',email:'before@example.invalid'});
 const actions=[],secondary={ready:true,inputs:new Map([['질문',{}]]),approvals:new Map([['보조승인',{}]]),resolveInput(id,cancel){actions.push(['질문취소',id,cancel]);this.inputs.delete(id);},decide(id,decision){actions.push(['승인거절',id,decision]);this.approvals.delete(id);},async request(method,params){actions.push([method,params.threadId]);}};
 controller.client.approvals.set('기본승인',{});controller.client.decide=(id,decision)=>{actions.push(['승인거절',id,decision]);controller.client.approvals.delete(id);};controller.clients=()=>[controller.client,secondary];controller.requestClient=(id,kind='approvals')=>controller.clients().find(client=>client[kind]?.has(id));
 const run={sessionId:'원래대화',threadId:'합성thread',turnId:'합성turn',ownerRevision:security.accountRevision,client:secondary};controller.runs.set(run.sessionId,run);controller.finish=async(current,status)=>{actions.push(['실행종료',status]);controller.runs.delete(current.sessionId);};
 for(const requestId of ['기본승인','보조승인'])controller.emitEvent({type:'approval',sessionId:run.sessionId,requestId,details:'이전 계정의 비공개 명령'});controller.emitEvent({type:'input',sessionId:run.sessionId,requestId:'질문',questions:[]});
 assert.equal((await api.securityPending()).length,4);await security.accountOwner({type:'chatgpt',email:'after@example.invalid'});await new Promise(setImmediate);
 assert.equal(run.cancelled,true);assert.equal(controller.client.approvals.size,0);assert.equal(secondary.approvals.size,0);assert.equal(secondary.inputs.size,0);assert(actions.some(row=>row[0]==='turn/interrupt'));assert(actions.some(row=>row[0]==='실행종료'));assert.deepEqual(await api.securityPending(),[]);
});
