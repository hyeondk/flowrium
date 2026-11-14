const readline = require("node:readline");
let initialized = false;
let loggedOut = false;
let acknowledged = false;
let nextThread = 0;
let nextTurn = 0;
const turns = new Map();
const threads = new Map();
const approvalTurns = new Map();
const inputTurns = new Map();
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
      text: message || `확인한 결과입니다. / ${policy}`,
    },
  });
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "completed" },
  });
  const saved=threads.get(threadId)?.find(t=>t.id===turnId);
  if(saved){saved.status='completed';saved.items.push({id:turnId+'-answer',type:'agentMessage',text:message||`확인한 결과입니다. / ${policy}`});}
  turns.delete(turnId);
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (!method && inputTurns.has(id)) {
    const expected = inputTurns.get(id);inputTurns.delete(id);
    const answers=request.result?.answers;
    const valid=["요약","상세"].includes(answers?.style?.answers?.[0]) && answers?.source?.answers?.[0] && answers?.private?.answers?.[0];
    complete(expected.threadId,expected.turnId, valid ? "질문 응답 형식 확인 / "+answers.style.answers[0]+" / "+answers.source.answers[0] : "질문 응답이 올바르지 않습니다.");
    return;
  }
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
        account: loggedOut || process.argv.includes("--no-account")
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
  if (method === "account/logout") {
    loggedOut = true;
    write({ id, result: {} });
    return;
  }
  if (method === "account/rateLimits/read") {
    write({ id, result: { rateLimits: { limitId: "codex", planType: "pro", primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1900000000 } } } });
    return;
  }
  if (method === "model/list") {
    write({
      id,
      result: {
        data: [
          { id: "test-model", model: "test-model", displayName: "검증 모델" },
        ].map(model=>model.supportedReasoningEfforts?model:{...model,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"medium"},{reasoningEffort:"high"},{reasoningEffort:"xhigh"}]}),
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
    const threadId=`thread-${++nextThread}`;threads.set(threadId,[]);
    write({ id, result: { thread: { id: threadId } } });
    return;
  }
  if(method === 'thread/turns/list') {write({id,result:{data:threads.get(params.threadId)||[],nextCursor:null}});return;}
  if(method === 'thread/read') {write({id,result:{thread:{id:params.threadId,turns:threads.get(params.threadId)||[]}}});return;}
  if(method === 'thread/fork') {
    const source=threads.get(params.threadId)||[],index=params.lastTurnId?source.findIndex(t=>t.id===params.lastTurnId):source.length-1;
    if(params.lastTurnId&&index<0){write({id,error:{message:'시험 턴이 없습니다.'}});return;}
    const threadId=`thread-${++nextThread}`,copy=structuredClone(source.slice(0,index+1));copy.forEach(t=>{t.id=`turn-${++nextTurn}`;});threads.set(threadId,copy);
    write({id,result:{thread:{id:threadId,turns:copy}}});return;
  }
  if(method === 'thread/revert') {
    const source=threads.get(params.threadId)||[],index=source.findIndex(t=>t.id===params.beforeTurnId);
    if(index<0){write({id,error:{message:'되감을 시험 턴이 없습니다.'}});return;}
    threads.set(params.threadId,source.slice(0,index));write({id,result:{thread:{id:params.threadId,turns:[]}}});return;
  }
  if(method === 'thread/compact/start') {write({id,result:{}});setTimeout(()=>{notify('thread/tokenUsage/updated',{threadId:params.threadId,turnId:'compaction',tokenUsage:{last:{inputTokens:200,outputTokens:0,totalTokens:200},total:{totalTokens:200},modelContextWindow:1000}});notify('thread/compacted',{threadId:params.threadId});},25);return;}
  if (method === "thread/resume") {
    write({ id, result: { thread: { id: params.threadId } } });
    return;
  }
  if (method === "turn/start") {
    const turnId = `turn-${++nextTurn}`;
    const threadId = params.threadId;
    turns.set(turnId, { threadId });
    if(!threads.has(threadId))threads.set(threadId,[]);
    threads.get(threadId).push({id:turnId,status:'inProgress',items:[{id:params.clientUserMessageId||turnId+'-user',type:'userMessage',content:params.input}]});
    write({ id, result: { turn: { id: turnId, status: "inProgress" } } });
    notify("turn/started", { threadId, turn: { id: turnId } });
    const prompt = params.input[0].text;
    if(prompt.includes("문맥검증"))notify("thread/tokenUsage/updated",{threadId,turnId,tokenUsage:{last:{inputTokens:900,outputTokens:0,totalTokens:900},total:{totalTokens:1900},modelContextWindow:1000}});
    if (prompt.includes("강제종료")) {
      setTimeout(() => process.exit(9), 20);
      return;
    }
    if (prompt.includes("입력질문검증")) {
      const requestId="input-"+turnId;
      inputTurns.set(requestId,{threadId,turnId});
      write({id:requestId,method:"item/tool/requestUserInput",params:{threadId,turnId,itemId:turnId+"-questions",isBlocking:true,questions:[
        {id:"style",header:"보고서 형식",question:"어떤 형식으로 작성할까요?",options:[{label:"요약",description:"핵심 결과"},{label:"상세",description:"전체 근거"}]},
        {id:"source",header:"근거 자료",question:"무슨 자료를 사용할까요?",isOther:true,options:[{label:"내부 자료",description:"프로젝트 자료"}]},
        {id:"private",header:"검증 문구",question:"시험용 확인 문구를 입력해 주세요.",isSecret:true,options:null}
      ]}});
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
      () => complete(threadId, turnId, require("./teams-fake-response.cjs").teamResponse(prompt, params.outputSchema), params.sandboxPolicy.type),
      30,
    );
    return;
  }
  if (method === "turn/interrupt") {
    write({ id, result: {} });
    turns.delete(params.turnId);
    const saved=threads.get(params.threadId)?.find(t=>t.id===params.turnId);if(saved)saved.status="interrupted";
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
