const readline = require("node:readline");
let initialized = false;
let acknowledged = false;
let nextThread = 0;
let nextTurn = 0;
const turns = new Map();
const approvalTurns = new Map();
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => write({ method, params });
function complete(threadId, turnId, message, policy) {
  if (!turns.has(turnId)) return;
  notify("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: `${turnId}-item`,
    delta: "확인한 ",
  });
  notify("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: `${turnId}-item`,
    delta: "결과입니다.",
  });
  notify("item/completed", {
    threadId,
    turnId,
    item: {
      id: `${turnId}-item`,
      type: "agentMessage",
      text: `확인한 결과입니다. / ${policy}`,
    },
  });
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed" },
  });
  turns.delete(turnId);
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (!method && approvalTurns.has(id)) {
    const run = approvalTurns.get(id);
    approvalTurns.delete(id);
    complete(
      run.threadId,
      run.turnId,
      "",
      request.result?.decision || "decline",
    );
    return;
  }
  if (method === "initialize") {
    initialized = true;
    write({ id, result: { userAgent: "모의 Codex" } });
    return;
  }
  if (method === "initialized") {
    acknowledged = true;
    return;
  }
  if (!initialized || !acknowledged) {
    write({ id, error: { message: "초기화되지 않았습니다." } });
    return;
  }
  if (method === "account/read") {
    write({
      id,
      result: {
        account: process.argv.includes("--no-account")
          ? null
          : process.argv.includes("--api-account")
            ? { type: "apiKey" }
            : {
                type: "chatgpt",
                email: "개인정보를 출력하지 않음",
                planType: "pro",
              },
        requiresOpenaiAuth: !process.argv.includes("--no-account"),
      },
    });
    return;
  }
  if (method === "model/list") {
    write({
      id,
      result: {
        data: [
          { id: "test-model", model: "test-model", displayName: "검증 모델" },
        ],
      },
    });
    return;
  }
  if (method === "account/login/start") {
    write({
      id,
      result: { authUrl: "https://auth.openai.com/authorize?test=true" },
    });
    return;
  }
  if (method === "thread/start") {
    write({ id, result: { thread: { id: `thread-${++nextThread}` } } });
    return;
  }
  if (method === "thread/resume") {
    write({ id, result: { thread: { id: params.threadId } } });
    return;
  }
  if (method === "turn/start") {
    const turnId = `turn-${++nextTurn}`;
    const threadId = params.threadId;
    turns.set(turnId, { threadId });
    write({ id, result: { turn: { id: turnId, status: "inProgress" } } });
    notify("turn/started", { threadId, turn: { id: turnId } });
    const prompt = params.input[0].text;
    if (prompt.includes("강제종료")) {
      setTimeout(() => process.exit(9), 20);
      return;
    }
    if (prompt.includes("승인검증")) {
      const approvalId = `approval-${turnId}`;
      approvalTurns.set(approvalId, { threadId, turnId });
      write({
        id: approvalId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId,
          turnId,
          command: "검증용 명령",
          reason: "승인 동작 검증",
        },
      });
      return;
    }
    if (prompt.includes("대기검증")) return;
    setTimeout(
      () => complete(threadId, turnId, "", params.sandboxPolicy.type),
      30,
    );
    return;
  }
  if (method === "turn/interrupt") {
    write({ id, result: {} });
    turns.delete(params.turnId);
    notify("turn/completed", {
      threadId: params.threadId,
      turn: { id: params.turnId, status: "interrupted" },
    });
    return;
  }
  if (method === "검증/종료") {
    process.exit(8);
    return;
  }
  write({
    id,
    error: { code: -32601, message: "지원하지 않는 모의 요청입니다." },
  });
});
