const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { registerRemote } = require("../electron/remote.cjs");
test("휴대폰 연결은 키와 출처·잠금을 검사하고 종료 즉시 접근을 닫는다", async (t) => {
  const api = {},
    controller = new EventEmitter();
  controller.status = { authenticated: true };
  controller.connectionStatus = async () => ({
    authenticated: true,
    available: true,
    accountLabel: "ChatGPT",
  });
  controller.runs = new Map();
  let locked = false,
    calls = 0;
  const handlers = new Map([
    [
      "send",
      async () => {
        calls++;
        return { accepted: true };
      },
    ],
  ]);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.exitCode = 0;
    child.emit("exit", 0);
  };
  const sid = randomUUID(),
    createdAt = new Date().toISOString();
  const messages = Array.from({ length: 121 }, (_, i) => ({
    id: randomUUID(),
    role: "assistant",
    createdAt,
    text: "별도 보관할 과거 기록 " + i + " " + "가".repeat(512),
  }));
  const state = {
    projects: [],
    sessions: [
      {
        id: sid,
        projectId: randomUUID(),
        title: "기록 조회",
        createdAt,
        updatedAt: createdAt,
        messages,
        workflow: { kind: "research", brief: "민감한 상세 의뢰 내용" },
      },
    ],
    settings: { effort: "medium" },
  };
  const service = registerRemote((n, f) => (api[n] = f), {
    store: {
      state,
      snapshot: () => {
        throw new Error("전체 대화 복제는 모바일 목록에서 수행하지 않습니다.");
      },
    },
    controller,
    handlers,
    isLocked: () => locked,
    version: "test",
    tunnelFactory: () => {
      setTimeout(
        () =>
          child.stderr.emit(
            "data",
            Buffer.from(
              "https://test-server.trycloudflare.com Registered tunnel connection",
            ),
          ),
        10,
      );
      return child;
    },
  });
  t.after(() => service.shutdown());
  const value = await api.startRemoteAccess(),
    address = new URL(value.localUrl),
    key = new URLSearchParams(address.hash.slice(1)).get("key"),
    base = address.origin,
    headers = { Authorization: "Bearer " + key };
  assert.equal((await fetch(base + "/api/mobile/state")).status, 401);
  assert.equal(
    (await fetch(base + "/api/mobile/state", { headers })).status,
    200,
  );
  const overview = await (
    await fetch(base + "/api/mobile/state", { headers })
  ).text();
  t.diagnostic(
    "121개 장문의 목록 응답 / " + Buffer.byteLength(overview) + "바이트",
  );
  assert.ok(
    Buffer.byteLength(overview) < 4000,
    "121개 장문이 있는 프로젝트 목록의 전송 바이트 " +
      Buffer.byteLength(overview),
  );
  assert.ok(
    !overview.includes("별도 보관할 과거 기록") &&
      !overview.includes("민감한 상세 의뢰 내용"),
  );
  assert.equal(JSON.parse(overview).sessions[0].messageCount, 121);
  const detail = base + "/api/mobile/sessions/" + sid;
  assert.equal((await fetch(detail)).status, 401);
  const latest = await (await fetch(detail + "?limit=50", { headers })).json();
  assert.deepEqual(
    latest.messages.map((m) => m.id),
    messages.slice(-50).map((m) => m.id),
  );
  const previous = await (
    await fetch(
      detail + "?limit=50&before=" + encodeURIComponent(latest.before),
      { headers },
    )
  ).json();
  assert.deepEqual(
    previous.messages.map((m) => m.id),
    messages.slice(21, 71).map((m) => m.id),
  );
  const first = await (
    await fetch(
      detail + "?limit=50&before=" + encodeURIComponent(previous.before),
      { headers },
    )
  ).json();
  assert.equal(
    (await fetch(detail + "?before=5:" + randomUUID(), { headers })).status,
    409,
  );
  assert.equal(first.before, null);
  assert.equal(first.messages.length, 21);
  assert.equal((await fetch(detail + "?limit=501", { headers })).status, 400);
  assert.equal(
    (await fetch(detail + "?before=broken", { headers })).status,
    400,
  );
  assert.equal(
    (await fetch(base + "/api/mobile/sessions/" + randomUUID(), { headers }))
      .status,
    404,
  );
  locked = true;
  assert.equal(
    (await fetch(base + "/api/mobile/state", { headers })).status,
    403,
  );
  assert.equal((await fetch(detail, { headers })).status, 403);
  locked = false;
  const call = (method, origin = base, args = [{}]) =>
    fetch(base + "/api/mobile/call", {
      method: "POST",
      headers: {
        ...headers,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method, args }),
    });
  assert.equal((await call("send", "https://invalid.test")).status, 403);
  assert.equal((await call("send")).status, 200);
  assert.equal(calls, 1);
  assert.equal((await call("terminalWrite")).status, 400);
  const baseInput = {
    type: "input",
    requestId: "질문",
    sessionId: sid,
    isBlocking: true,
  };
  const question = {
    id: "mode",
    header: "형식",
    question: "선호하는 형식",
    options: [{ label: "요약", description: "짧은 문서" }],
    isOther: true,
    isSecret: false,
  };
  let questions = [
    { ...baseInput, questions: [question] },
    {
      ...baseInput,
      requestId: "보호",
      details: "숨길 부가 원문",
      questions: [{ ...question, question: "숨길 질문 원문", isSecret: true }],
    },
    {
      type: "approval",
      requestId: "승인",
      sessionId: sid,
      details: "작업 실행",
    },
  ];
  let answerCalls = 0,
    permissionCalls = 0;
  handlers.set("securityPending", () => questions);
  handlers.set("approval", async () => {
    permissionCalls++;
  });
  handlers.set("answerInput", async () => {
    answerCalls++;
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const mobile = await (
    await fetch(base + "/api/mobile/state", { headers })
  ).json();
  assert.doesNotMatch(JSON.stringify(mobile), /숨길 (질문|부가) 원문/);
  const secret = mobile.approvals.find((event) => event.requestId === "보호");
  assert.equal(secret.desktopOnly, true);
  assert.equal(secret.questions, undefined);
  const sendAnswer = (id) =>
    call("answerInput", base, [
      { requestId: id, answers: { mode: { answers: ["요약"] } } },
    ]);
  assert.equal((await sendAnswer("보호")).status, 403);
  assert.equal((await sendAnswer("승인")).status, 400);
  assert.equal(
    (await call("approval", base, [{ requestId: "질문", decision: "accept" }]))
      .status,
    400,
  );
  assert.equal(permissionCalls, 0);
  assert.equal(answerCalls, 0);
  const twins = await Promise.all([sendAnswer("질문"), sendAnswer("질문")]);
  assert.deepEqual(twins.map((r) => r.status).sort(), [200, 400]);
  assert.equal(answerCalls, 1);
  assert.equal((await sendAnswer("질문")).status, 400);
  questions = questions.filter((e) => e.requestId !== "질문");
  await api.stopRemoteAccess();
  assert.equal((await api.remoteAccess()).enabled, false);
  await assert.rejects(fetch(base + "/api/mobile/state", { headers }));
});
