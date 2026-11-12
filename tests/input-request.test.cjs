const test = require("node:test");
const assert = require("node:assert/strict");
const { CodexClient } = require("../electron/codex.cjs");
const { Controller } = require("../electron/controller.cjs");
const {
  questionParams,
  responseFor,
} = require("../electron/input-request.cjs");
const params = {
  threadId: "thread",
  turnId: "turn",
  itemId: "item",
  isBlocking: false,
  questions: [
    {
      id: "preset",
      header: "범위",
      question: "범위는?",
      options: [{ label: "요약", description: "핵심 범위" }],
    },
    {
      id: "custom",
      header: "기타",
      question: "선택 또는 직접 입력?",
      isOther: true,
      options: [{ label: "기본", description: "" }],
    },
    {
      id: "__proto__",
      header: "확인 문구",
      question: "문구는?",
      isSecret: true,
      options: null,
    },
  ],
};
const answers = Object.fromEntries([
  ["preset", { answers: ["요약"] }],
  ["custom", { answers: ["직접 쓴 값"] }],
  ["__proto__", { answers: ["임시 입력"] }],
]);
test("공식 질문과 답변의 구조를 유지하고 허용되지 않은 보기·중복 식별자·누락·권한 승인 교차 사용을 차단한다", () => {
  const allowed = questionParams(params);
  assert.deepEqual(responseFor(allowed.questions, answers), { answers });
  assert.throws(
    () =>
      responseFor(allowed.questions, {
        ...answers,
        preset: { answers: ["위조"] },
      }),
    /보기/,
  );
  assert.throws(
    () => responseFor(allowed.questions, { preset: { answers: ["요약"] } }),
    /모든 질문/,
  );
  assert.throws(
    () =>
      questionParams({
        ...params,
        questions: [params.questions[0], params.questions[0]],
      }),
    /형식/,
  );
  const client = new CodexClient(),
    wire = [];
  client._write = (v) => wire.push(v);
  const controller = new Controller({ state: { settings: {} } }, { client });
  controller.runs.set("session", {
    sessionId: "session",
    threadId: "thread",
    turnId: "turn",
    mode: "plan",
  });
  let event, resolved;
  controller.on("event", (e) => {
    if (e.type === "input") event = e;
    if (e.type === "inputResolved") resolved = e;
  });
  client._message({ id: 91, method: "item/tool/requestUserInput", params });
  assert.equal(event.isBlocking, false);
  assert.equal(event.sessionId, "session");
  assert.equal(client.approvals.size, 0);
  assert.equal(client.inputs.size, 1);
  assert.throws(() => client.decide(event.requestId, "accept"), /종료/);
  controller.answerInput({ requestId: event.requestId, answers });
  assert.deepEqual(wire, [{ id: 91, result: { answers } }]);
  assert.equal(client.inputs.size, 0);
  assert.equal(resolved.requestId, event.requestId);
  assert(!JSON.stringify(resolved).includes("임시 입력"));
  assert.throws(
    () => controller.answerInput({ requestId: event.requestId, answers }),
    /이미 종료/,
  );
  client._message({
    id: 92,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread" },
  });
  assert.deepEqual(wire.at(-1), { id: 92, result: { decision: "decline" } });
});
test("서버가 해결하거나 다른 턴에서 발생한 질문과 종료된 연결의 질문을 제거한다", async () => {
  const client = new CodexClient(),
    wire = [];
  client._write = (v) => wire.push(v);
  client.ready = true;
  const controller = new Controller({ state: { settings: {} } }, { client });
  controller.runs.set("s", {
    sessionId: "s",
    threadId: "thread",
    turnId: "turn",
    mode: "build",
  });
  client._message({
    id: 1,
    method: "item/tool/requestUserInput",
    params: { ...params, turnId: "이전 턴" },
  });
  assert.equal(client.inputs.size, 0);
  assert.equal(wire[0].error.code, -32800);
  client._message({ id: 2, method: "item/tool/requestUserInput", params });
  await controller.notification({
    method: "serverRequest/resolved",
    params: { requestId: 2 },
  });
  assert.equal(client.inputs.size, 0);
  client._message({
    id: 3,
    method: "item/tool/requestUserInput",
    params: { ...params, questions: [] },
  });
  assert.equal(wire.at(-1).error.code, -32602);
  client._message({ id: 4, method: "item/tool/requestUserInput", params });
  controller.runs.clear();
  client._fail(new Error("연결 종료"));
  assert.equal(client.inputs.size, 0);
});
