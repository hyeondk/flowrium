const readline = require("node:readline");
const {existsSync} = require("node:fs");
const loginGate = process.env.FLOWRIUM_TEST_LOGIN_GATE;
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
function complete(threadId, turnId, message, policy, streamed=false) {
  if (!turns.has(turnId)) return;
  if (!streamed) {
    notify("item/agentMessage/delta", {threadId,turnId,itemId:`${turnId}-item`,delta:"확인한 "});
    notify("item/agentMessage/delta", {threadId,turnId,itemId:`${turnId}-item`,delta:"결과입니다."});
  }
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
  if (["thread/resume", "turn/start", "turn/steer"].includes(method) &&
      (typeof params.threadId !== "string" || !params.threadId.trim())) {
    write({ id, error: { code: -32600, message: "Invalid request: missing field `threadId`" } });
    return;
  }
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
    const oauthCompleted = loginGate && existsSync(loginGate);
    write({
      id,
      result: {
        account: loggedOut || (process.argv.includes("--no-account") && !oauthCompleted)
          ? null
          : process.argv.includes("--api-account")
            ? { type: "apiKey" }
            : {
                type: "chatgpt",
                email: "개인정보를 출력하지 않음",
                planType: process.env.FLOWRIUM_TEST_PLAN || "pro",
              },
        requiresOpenaiAuth: !process.argv.includes("--no-account"),
      },
    });
    return;
  }
  if (method === 'project/list' || method === 'thread/list') {
    const reply = () => write({id,result:{data:[],nextCursor:null}});
    const gate = process.env.FLOWRIUM_TEST_SETTINGS_SYNC_GATE;
    if (gate && method === 'thread/list' && params.archived === false && params.limit === 100 &&
        params.sortKey === 'updated_at' && params.sourceKinds?.[0] === 'appServer' && params.useStateDbOnly === true &&
        !params.cwd && !params.cursor) {
      const fs = require('node:fs');
      if (!fs.existsSync(gate+'.release')) {
        fs.writeFileSync(gate+'.pending','');
        const timer=setInterval(()=>{
          if (!fs.existsSync(gate+'.release')) return;
          clearInterval(timer);
          reply();
        },20);
        timer.unref();
        return;
      }
    }
    reply();
    return;
  }
  if (method === "account/logout") {
    loggedOut = true;
    write({ id, result: {} });
    return;
  }
  if (method === "account/rateLimits/read") {
    write({ id, result: { rateLimits: { limitId: "codex", planType: process.env.FLOWRIUM_TEST_PLAN || "pro", primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1900000000 }, credits:{hasCredits:true,unlimited:false,balance:"1234.50"} }, rateLimitResetCredits:{availableCount:2} } });
    return;
  }
  if (method === "model/list") {
    write({
      id,
      result: {
        data: [
          { id: "test-model", model: "test-model", displayName: "검증 모델" },
          ...(process.env.FLOWRIUM_TEST_CATALOG_FILE && require('node:fs').existsSync(process.env.FLOWRIUM_TEST_CATALOG_FILE)
            ? [{id:'catalog-preview',model:'catalog-preview',displayName:'추가된 시험 모델',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}] : []),
          ...(process.env.FLOWRIUM_TEST_CHAT_MODELS === '1' ? [
            {id:'gpt-6.1-terra', model:'gpt-6.1-terra', supportedReasoningEfforts:[{reasoningEffort:'low'}], defaultReasoningEffort:'low',serviceTiers:[{id:'priority'}]},
            {id:'gpt-6.1-sol', model:'gpt-6.1-sol', supportedReasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(reasoningEffort=>({reasoningEffort})), defaultReasoningEffort:'high',serviceTiers:[{id:'priority'},{id:'ultrafast'}]},
          ] : []),
        ].map(model=>model.supportedReasoningEfforts?model:{...model,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"medium"},{reasoningEffort:"high"},{reasoningEffort:"xhigh"}]}),
      },
    });
    return;
  }
  if (method === "account/login/start") {
    const loginId = "316e11a8-d5ef-407d-88b8-a8046c8ce863";
    write({
      id,
      result: { authUrl: "https://auth.openai.com/authorize?test=true", ...(loginGate && {loginId}) },
    });
    if (loginGate) {
      // Every client reads the same completed login, as with stored Codex credentials.
      const timer = setInterval(() => {
        if (!existsSync(loginGate)) return;
        clearInterval(timer);
        loggedOut = false;
        notify("account/login/completed", {loginId, success:true, error:null});
      },20);
      timer.unref();
    }
    return;
  }
  if (method === "config/read") {
    write({id, result:{config:{}}});
    return;
  }
  if (method === "thread/start") {
    const threadId=`thread-${++nextThread}`;threads.set(threadId,[]);
    write({ id, result: { thread: { id: threadId }, ...(params.permissions && {activePermissionProfile:{id:params.permissions}}) } });
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
    write({ id, result: { thread: { id: params.threadId }, ...(params.permissions && {activePermissionProfile:{id:params.permissions}}) } });
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
    if (process.env.FLOWRIUM_TEST_FOLLOWUP_ANSWER && prompt.includes('분류표를 확인해줘')) {
      setTimeout(() => complete(threadId, turnId, process.env.FLOWRIUM_TEST_FOLLOWUP_ANSWER), 150);
      return;
    }
    if (process.env.FLOWRIUM_TEST_STEP_GATE && prompt.includes('작업 단계 스트림 시험')) {
      const gate=process.env.FLOWRIUM_TEST_STEP_GATE, exists=require('node:fs').existsSync;
      const item={id:turnId+'-tool',type:'commandExecution',status:'inProgress',command:'node --version'};
      const child=turnId+'-child';
      const collaboration={type:'collabAgentToolCall',receiverThreadIds:[child],tool:'spawnAgent'};
      const progress='실시간 설명 맨 앞입니다.\n\n'+'긴 작업 설명 한글 문장을 전부 보여줘야 합니다. '.repeat(300)+'\n\n실시간 설명 맨 끝입니다.';
      for(const suffix of ['live','imported'])notify('item/completed',{threadId,turnId,item:{
        id:turnId+'-commentary-'+suffix,type:'agentMessage',phase:'commentary',text:progress,
      }});
      notify('thread/started',{thread:{id:child,parentThreadId:threadId,agentNickname:'준비 작업'}});
      notify('item/completed',{threadId,turnId,item:{...collaboration,id:turnId+'-spawn',status:'completed',agentsStates:{[child]:{status:'running',message:'표시하지 않을 에이전트 전문'}}}});
      notify('item/started',{threadId,turnId,item});
      const fullAnswer='답변 타이핑 첫 문장. '+'단계를 확인한 내용을 기록합니다. '.repeat(12)+'답변 타이핑 끝 문장.';
      let addedSearches=false,answerStreamed=false;
      const timer=setInterval(()=>{
        if(!addedSearches && exists(gate+'.search')){
          addedSearches=true;
          for(let index=0;index<6;index++)notify('item/completed',{threadId,turnId,item:{id:turnId+'-search-'+index,type:'webSearch',action:{type:'search'}}});
          const events=[
            {id:turnId+'-read',type:'commandExecution',status:'failed',exitCode:2,commandActions:[{type:'read',name:'중계 검사.txt',path:'/private/현장/중계 검사.txt'}]},
            {id:turnId+'-empty-search',type:'commandExecution',status:'failed',exitCode:1,commandActions:[{type:'search',command:'rg 확인',path:'/private/현장'}]},
            {id:turnId+'-mcp',type:'mcpToolCall',status:'completed',server:'자료 도구',tool:'list_documents',arguments:{secret:'도구 원문의 비공개 내용'}},
          ];
          for(const activity of events)notify('item/completed',{threadId,turnId,item:activity});
        }
        if(!answerStreamed && exists(gate+'.stream')){
          answerStreamed=true;
          notify('item/agentMessage/delta',{threadId,turnId,itemId:turnId+'-item',delta:fullAnswer});
        }
        if(!exists(gate))return;
        clearInterval(timer);
        notify('item/completed',{threadId,turnId,item:{...item,status:'completed',exitCode:0}});
        notify('item/completed',{threadId,turnId,item:{...collaboration,id:turnId+'-wait',tool:'wait',status:'completed',agentsStates:{[child]:{status:'completed'}}}});
        notify('item/completed',{threadId,turnId,item:{id:turnId+'-file',type:'fileChange',status:'completed',changes:[{
          path:'docs/작업 기록.md',diff:'--- 작업 기록\n+++ 작업 기록\n@@ -1 +1,2 @@\n-기존\n+수정\n+추가',
        }]}});
        notify('item/completed',{threadId,turnId,item:{id:turnId+'-web',type:'webSearch',action:{type:'openPage',url:'https://example.test/work'}}});
        complete(threadId,turnId,fullAnswer,undefined,answerStreamed);
      },40);
      return;
    }
    if (process.env.FLOWRIUM_TEST_CHAT_MODELS === '1' && prompt.includes('속도 전송 확인')) {
      setTimeout(()=>complete(threadId,turnId,'실제 실행 속도 / '+(params.serviceTierForTurn || 'inherited')),30);
      return;
    }
    if (process.env.FLOWRIUM_TEST_CHAT_MODELS === '1' && prompt.includes('전송 모델 확인')) {
      setTimeout(() => complete(threadId, turnId, `실제 전송 / ${params.model} / ${params.effort}`), 30);
      return;
    }
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
      () => complete(threadId, turnId, require("./teams-fake-response.cjs").teamResponse(prompt, params.outputSchema), (params.sandboxPolicy?.type || params.permissions)),
      30,
    );
    return;
  }
  if(method === 'turn/steer') {
    const turnId=params.expectedTurnId;
    if(!turns.has(turnId))return write({id,error:{code:-32602,message:'no active turn'}});
    const saved=threads.get(params.threadId)?.find(turn=>turn.id===turnId);
    saved?.items.push({id:params.clientUserMessageId||turnId+'-steer-'+saved.items.length,type:'userMessage',content:params.input});
    write({id,result:{turnId}});
    complete(params.threadId,turnId,'추가 지시 반영 / '+params.input[0].text);
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
