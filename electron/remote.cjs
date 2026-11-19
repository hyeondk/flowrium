const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  { spawn } = require("node:child_process"),
  { randomBytes, timingSafeEqual, createHash } = require("node:crypto");
const {continuationAnswer,executionFor} = require('./execution-state.js');
const {latestFollowupAnswer}=require('./mobile/answer-followup.js');
const {attachmentDisplayText}=require('./mobile/attachment-text.js');
const {MobileUpdater} = require('./mobile-updater.cjs');
const {MobileRequestUploads,chunkBytes,singleUploadBytes} = require('./mobile-request-uploads.cjs');
const allowed = new Set([
  "startWork",
  "send",
  "interrupt",
  "readTeams",
  "openTeamNode",
  "updateWork",
  "approval",
  "answerInput",
  "readWorkbench",
  "readWorkArtifact",
  "saveTeam", "directTeam", "changeTeamRun", "workflowAction", "mobileWorkflowState",
  "mobileSettings", "saveMobileSettings", "setMobileChatModel", "readAccountUsage", "readChatAttachment", "readChatCitation", "readRequestSource",
  "listQueuedMessages", "cancelQueuedMessage", "resumeQueuedMessages", "sendQueuedToCodex", "clearUnconfirmedCodexQueue", "webPushState", "webPushAction",
  "checkMobileUpdate", "applyMobileUpdate",
]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function mobileSummary(s, active, deciding, revision, activity, unsettled) {
  const { id, projectId, title, createdAt, updatedAt } = s;
  const executionState=executionFor(s,active,deciding,unsettled);
  return {
    id,
    projectId,
    title,
    createdAt,
    updatedAt,
    executionState,
    defaultProjectMode: s.defaultProjectMode,
    completedContinuationId:s.completedContinuationId,
    scope: s.scope,
    canCompleteWaiting: executionState==='waiting',
    continuationMessageId: executionState==='waiting' ? continuationAnswer(s)?.id : undefined,
    revision,
    activity,
    messageCount: s.messages.length,
    lastMessageId: s.messages.at(-1)?.id,
    recommendationMessageId: latestFollowupAnswer(s)?.id ?? null,
    messages: [],
    workflow: s.workflow && {
      kind: s.workflow.kind,
      status: s.workflow.status,
      completedAt: s.workflow.completion?.at,
      nextTask: s.workflow.checklist?.find(item=>!item.done)?.text.slice(0,200),
      teamSlot: s.workflow.teamSlot && { mode: s.workflow.teamSlot.mode },
    },
    preferences: s.preferences && {
      model: s.preferences.model,
      effort: s.preferences.effort,
      sandbox: s.preferences.sandbox,
    },
  };
}
function mobileMessages(s, params, revision) {
  const limit = Number(params.get("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return { code: 400, value: { error: "메시지 조회 개수는 1~100개입니다." } };
  const items = s.messages;
  const progress = params.get('progress') === '1';
  let end = items.length;
  if (params.has("before")) {
    const parts = params.get("before").split(":");
    if (
      parts.length !== 2 ||
      !/^\d{1,12}$/.test(parts[0]) ||
      !uuid.test(parts[1])
    )
      return {
        code: 400,
        value: { error: "이전 메시지 위치가 올바르지 않습니다." },
      };
    end = Number(parts[0]);
    if (items[end]?.id !== parts[1])
      return {
        code: 409,
        value: {
          error: "대화 기록이 변경됐습니다. 최근 기록을 다시 열어 주세요.",
        },
      };
  }
  let start = end,
    bytes = 0;
  const messages = [];
  while (start > 0 && end - start < limit) {
    const m = items[start - 1],
      visible = m.role === "assistant" || m.role === "user" || (progress && m.progressCommentary === true);
    // 휴대폰에는 단계 이름, 상태, 시각만 전달한다. 명령과 도구 출력은 컴퓨터에 남긴다.
    const toolLabel=progress && m.role==='system' && (m.progressCommentary===true ? m.text :
      m.text.startsWith('실행 도구 / 명령') ? '명령 실행' :
      m.text.startsWith('파일 변경 기록') ? '파일 변경' :
      m.text.startsWith('도구 실행 기록') ? '도구 실행' : undefined);
    const workSteps=progress&&visible&&m.workSteps?.map(({id,label,state,createdAt,completedAt})=>({id,label,state,createdAt,...(completedAt && {completedAt})}));
    const text=m.role==='user'?attachmentDisplayText(m.text):m.text;
    const size = (visible ? Buffer.byteLength(text) : 0)+(workSteps?Buffer.byteLength(JSON.stringify(workSteps)):0);
    if (messages.length && bytes + size > 512 * 1024) break;
    start--;
    if (visible || toolLabel) {
      messages.push({
        id: m.id,
        createdAt: m.createdAt,
        role: m.role,
        text: visible ? text : toolLabel,
        ...(text!==m.text && {attachmentHeaderRemoved:true}),
        index: start,
        attachments: visible ? m.attachments : undefined,
        ...(visible && m.sourceOnly && {sourceOnly:true}),
        ...(progress && m.turnId && {turnId:m.turnId}),
        ...(progress && m.workStartedAt && {workStartedAt:m.workStartedAt}),
        ...(progress && m.workCompletedAt && {workCompletedAt:m.workCompletedAt}),
        ...(progress && m.progressCommentary && {progressCommentary:true}),
        ...(workSteps && {workSteps}),
      });
      bytes += size;
    }
  }
  return {
    code: 200,
    value: {
      id: s.id,
      revision,
      messages: messages.reverse(),
      start,
      end,
      total: items.length,
      updatedAt: s.updatedAt,
      lastMessageId: items.at(-1)?.id,
      before: start > 0 ? start + ":" + items[start].id : null,
    },
  };
}
function mobileInput(event) {
  const { type, requestId, sessionId, isBlocking } = event;
  const base = { type, requestId, sessionId, isBlocking: Boolean(isBlocking) };
  if (
    event.desktopOnly ||
    !Array.isArray(event.questions) ||
    !event.questions.length ||
    event.questions.some(
      (q) =>
        !q || q.isSecret !== false || !q.id || typeof q.question !== "string",
    )
  )
    return { ...base, desktopOnly: true };
  return {
    ...base,
    questions: event.questions.map(
      ({ id, header, question, options, isOther }) => ({
        id,
        header,
        question,
        isOther: Boolean(isOther),
        options: Array.isArray(options)
          ? options.map(({ label, description }) => ({ label, description }))
          : [],
      }),
    ),
  };
}
function registerRemote(
  register,
  {
    store,
    controller,
    handlers,
    isLocked,
    version,
    mobileUpdateDirectory,
    mobileUpdateStorage,
    mobileUpdateFetch,
    guard = (_name, action) => action(),
    readDecisionLinks = () => [],
    tunnelFactory = spawn,
    accountRevision = () => 0,
    accountOwner = () => "",
    pairing = null,
    onContextChanged = () => {},
    now = Date.now,
  },
) {
  const mobileUpdater = new MobileUpdater({version,directory:mobileUpdateDirectory,storage:mobileUpdateStorage,fetchImpl:mobileUpdateFetch});
  const requestUploads = new MobileRequestUploads();
  const answeredInputs = new Set();
  const runRevisions = new WeakMap();
  const runLabels = new WeakMap();
  const externalPreview=s=>s&&controller.codexTransfer?.liveTurn?.(s);
  const revisionOf=id=>runRevisions.get(controller.runs.get(id))||externalPreview(store.peekSession?.(id))?.version||0;
  const display=s=>controller.codexTransfer?.liveView?.(s)||s;
  const handoffs = new Map();
  const scopeId = () => key ? createHash("sha256").update(key).digest("hex") : "";
  const checkScope = (scope, owner) => {
    if (!server?.listening || scope !== scopeId() || owner !== connectionOwner || owner !== String(accountRevision()) || isLocked())
      throw Error("휴대폰 연결을 다시 확인해 주세요.");
  };
  const originAllowed = (req, local) => req.headers.origin === publicOrigin || req.headers.origin === "http://" + local;
  async function readBody(req, max = 2 * 1024 * 1024) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw Error("요청 크기가 너무 큽니다.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function workflowView(value) {
    const {version,revision,preferences,notifications,reminders,deliveries,reports,projects,sessions}=value;
    return {version,revision,preferences,notifications,reminders,deliveries,reports,projects,sessions,
      proposals:(value.proposals||[]).map(p=>{const {id,revision,kind,title,body,sourceId,targetId,projectId,status,createdAt,hidden,snoozedUntil,result,preview}=p;return {id,revision,kind,title,body,sourceId,targetId,projectId,status,createdAt,hidden,snoozedUntil,result,preview};}),
      pending:(value.pending || []).map(e => e.type === "input" ? mobileInput(e) : e).filter(e => e.type === "input" || e.type === "approval")};
  }
  async function requireSessionTrust(id) {
    const session=store.state.sessions.find(item=>item.id===id);
    if(!session)throw Error('연결된 프로젝트 대화를 선택해 주세요.');
    if(!session.scope)await store.requireProjectTrust(session.projectId);
  }
  async function mobileCall(method, args, requestScope, requestOwner) {
    const input=args[0];
    if(method==='send' || (method==='workflowAction' && input?.action==='continueConversation')){
      await requireSessionTrust(input?.sessionId);
      if(input.requestSourceId){
        const session=store.state.sessions.find(item=>item.id===input.sessionId);
        checkScope(requestScope,requestOwner);
        const sourceKey=id=>JSON.stringify([requestScope,requestOwner,session.projectId,session.id,id]);
        const found=input.submissionId && await requestUploads.publish(sourceKey(input.submissionId),input.requestSourceId);
        if(!found)await requestUploads.publish(sourceKey('legacy:'+input.requestSourceId),input.requestSourceId);
      }
    }else if(method==='sendQueuedToCodex' || method==='resumeQueuedMessages'){
      await requireSessionTrust(input);
    }else if(method==='startWork' || method==='directTeam'){
      await store.requireProjectTrust(method==='startWork'?input?.projectId:input);
    }
    checkScope(requestScope,requestOwner);
    if(method==='sendQueuedToCodex'||method==='clearUnconfirmedCodexQueue'){
      const [sessionId,queueId]=args;
      if(args.length!==2 || typeof sessionId!=='string' || !uuid.test(sessionId) || typeof queueId!=='string' || !uuid.test(queueId) || !store.state.sessions.some(row=>row.id===sessionId&&!row.scope))
        throw Error('연결된 프로젝트의 대기 요청을 선택해 주세요.');
      const send=handlers.get(method);
      if(!send)throw Error('원래 Codex 대화로 보내려면 데스크톱 Flowrium을 업데이트해 주세요.');
      return send(sessionId,queueId);
    }
    if (method === 'checkMobileUpdate' || method === 'applyMobileUpdate') {
      if (method === 'checkMobileUpdate' && args.length === 0) return mobileUpdater.check();
      if (method === 'applyMobileUpdate' && args.length === 1 && typeof args[0] === 'string')
        return mobileUpdater.apply(args[0], () => checkScope(requestScope, requestOwner));
      throw Error('모바일 업데이트 요청을 확인해 주세요.');
    }
    if(method==='readRequestSource' && (args.length!==3 || !Number.isSafeInteger(args[2]) || args[2]<0 || !store.state.sessions.some(s=>s.id===args[0])))throw Error('프로젝트 채팅 원문 위치를 확인해 주세요.');
    if (method === "setMobileChatModel") {
      const [id,model]=args;
      const session=store.state.sessions.find(s=>s.id===id&&!s.scope);
      if(args.length!==2 || typeof id!=='string' || !uuid.test(id) || !session || typeof model!=='string' || model.length>300 || model!==model.trim())
        throw Error('연결된 프로젝트 대화와 모델을 선택해 주세요.');
      if(model){
        const connection=await handlers.get('connect')?.();
        if(!connection?.status?.authenticated || !connection.models?.some(x=>x.id===model))throw Error('현재 계정에서 제공하는 모델을 선택해 주세요.');
      }
      checkScope(requestScope,requestOwner);
      if(!store.state.sessions.includes(session))throw Error('대화 목록이 바뀌었습니다. 프로젝트 대화를 다시 선택해 주세요.');
      const edit=handlers.get('editConversation');
      if(!edit)throw Error('이 데스크톱 버전은 대화 모델 변경을 지원하지 않습니다.');
      const value=await guard('editConversation',()=>edit(id,{action:'model',model}));
      checkScope(requestScope,requestOwner);
      controller.emitEvent?.({type:'session',sessionId:id,session:value});
      return {model:value.preferences?.model||''};
    }
    // Older mobile clients include a snapshot of the default model. Resolve it in
    // the desktop controller at send time, including when this request is queued.
    if(method==='send' && args.length===1 && args[0] && typeof args[0]==='object'){
      const {model,effort,...input}=args[0];
      return handlers.get('send')(input);
    }
    if (method === "mobileSettings") {
      const connection = await handlers.get("connect")?.();
      return {model:store.state.settings.model,effort:store.state.settings.effort,chatDefaults:store.state.settings.chatDefaults,
        models:(connection?.models || []).map(({id,displayName,isDefault,supportedReasoningEfforts,defaultReasoningEffort}) => ({id,displayName,isDefault,supportedReasoningEfforts,defaultReasoningEffort}))};
    }
    if (method === "saveMobileSettings") {
      const input = args[0];
      if (args.length !== 1 || !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["model","effort","chatDefaults"].includes(k)))
        throw Error("모바일에서 바꿀 수 없는 설정입니다.");
      if (input.chatDefaults && (typeof input.chatDefaults !== "object" || Array.isArray(input.chatDefaults) || Object.keys(input.chatDefaults).some(k => !["answerLength","testing","askNext","autoCompact","compactAt"].includes(k))))
        throw Error("실행 권한은 데스크톱에서 바꿔 주세요.");
      const changes = input.chatDefaults
        ? {...input,chatDefaults:{...store.state.settings.chatDefaults,...input.chatDefaults}}
        : input;
      const result = await handlers.get("saveSettings")(changes);
      return {model:result.model,effort:result.effort,chatDefaults:result.chatDefaults};
    }
    if (method === "mobileWorkflowState") return workflowView(await handlers.get("workflowState")());
    if (method === "workflowAction") {
      const input = args[0];
      if(input?.action==='completeContinuation'||input?.action==='continueConversation'){
        if(args.length!==1||!uuid.test(input.messageId)||!store.state.sessions.some(s=>s.id===input.sessionId))throw Error('프로젝트의 후속 대기를 선택해 주세요.');
        const {model,effort,...target}=input;
        return handlers.get('workflowAction')(target);
      }
      if (args.length !== 1 || !input || !["preferences","send","request","propose","approve","reject","hide","restore","snooze","bulk","read","readSession","clearNotifications","reportNow","collect","recommend","reminderAdd","reminderCancel","retryDelivery"].includes(input.action))
        throw Error("지원하지 않는 비서 작업입니다.");
      if (input.action === "preferences" && Object.keys(input.value || {}).some(k => !["enabled","aiReports","intervalMinutes","startHour","endHour","weekdays","timezone","projectId"].includes(k)))
        throw Error("연결 서비스 설정은 데스크톱에서 바꿔 주세요.");
    }
    if (method === 'readChatCitation' && (args.length!==4 || !['preview','download'].includes(args[3]))) throw Error('휴대폰에서 열 수 없는 파일 작업입니다.');
    if (method === "changeTeamRun" && !["automation","dispatch","pause","resume","stop","reopen","report","raiseLimit","finishStopped","answer","instruct","ask","explain","reassign","message","stopNode","completeNode","retry"].includes(args[2]?.action))
      throw Error("지원하지 않는 팀 작업입니다.");
    if (method === "directTeam") {
      const input = args[4];
      if (!input || typeof input !== "object" || Object.keys(input).some(k => !["strategy","assignments","isolate","autoReport","budget","minutes","leadModel","autoDispatch","autoPM","autoQA","autoIntegrate","maxQaRounds","maxPMRounds","integrationRoleIndex"].includes(k)))
        throw Error("팀 실행 옵션을 확인해 주세요.");
    }
    const handler = handlers.get(method);
    if (!handler) throw Error("이 앱 버전에서 사용할 수 없는 작업입니다.");
    const result = await handler(...args);
    return method === "workflowAction" && result?.pending ? workflowView(result) : result;
  }
  let pairedLink, startFlight, reconnectTimer, shuttingDown = false;
  let sequence = 0;
  let connectionOwner = "";
  let server,
    tunnel,
    key,
    publicOrigin,
    status = "",
    running = new Set(),
    approvals = new Map();
  const state = () => ({
    enabled: !!server && (!pairing || !!pairedLink),
    localUrl: server?.listening && (!pairing || !!pairedLink)
      ? "http://127.0.0.1:" + server.address().port + "/#key=" + key
      : undefined,
    url: publicOrigin ? publicOrigin + "/#key=" + key : undefined,
    message: status || undefined,
  });
  function update(event) {
    if (event.type === "status" && event.status === "connected") scheduleRestore();
    const run=controller.runs.get(event.sessionId);
    if(server && run && (event.type==='delta'||event.type==='session'||event.workProgress))runRevisions.set(run,revisionOf(event.sessionId)+1);
    if(server && run && event.type==='status' && typeof event.text==='string')runLabels.set(run,event.text.slice(0,180));
    if (event.type === "approval" || event.type === "input")
      approvals.set(event.requestId, event);
    if (event.type === "input") answeredInputs.delete(event.requestId);
    if (event.type === "inputResolved") approvals.delete(event.requestId);
    if (event.type === "done") {
      running.delete(event.sessionId);
      for (const [id, a] of approvals)
        if (a.sessionId === event.sessionId) approvals.delete(id);
    }
    if (event.type === "status" && event.sessionId)
      running.add(event.sessionId);
  }
  async function readPending() {
    const pending = handlers.get("securityPending");
    const events = pending ? await pending() : [...approvals.values()];
    const ids = new Set(
      events.filter((e) => e.type === "input").map((e) => e.requestId),
    );
    for (const id of answeredInputs)
      if (!ids.has(id)) answeredInputs.delete(id);
    return events;
  }
  function authorized(req) {
    if (!key || !server?.listening || connectionOwner !== String(accountRevision())) return false;
    const actual = req.headers.authorization || "",
      expected = "Bearer " + key;
    const a = Buffer.from(actual),
      b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const json = (res, code, value) => {
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  async function handle(req, res) {
    const local = "127.0.0.1:" + server.address().port;
    const hostname = req.headers.host;
    if (
      hostname !== local &&
      hostname !== (publicOrigin && new URL(publicOrigin).host)
    ) {
      res.writeHead(400).end();
      return;
    }
    const u = new URL(req.url, "http://" + local);
    if (u.pathname === "/api/mobile/handoff" && req.method === "POST") {
      try {
        if (!originAllowed(req,local) || req.headers["content-type"]?.split(";")[0] !== "application/json") throw Error("허용되지 않은 연결 요청입니다.");
        const input = JSON.parse((await readBody(req,4096)).toString("utf8"));
        if (typeof input.handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.handoff)) throw Error("연결 주소를 확인해 주세요.");
        const id = createHash("sha256").update(input.handoff).digest("hex"), record = handoffs.get(id);
        handoffs.delete(id);
        if (!record || record.expiresAt <= now()) throw Error("만료됐거나 이미 사용한 연결 주소입니다.");
        checkScope(record.scopeId,record.owner);
        json(res,200,{key});
      } catch (e) {json(res,400,{error:require("./errors.cjs").publicMessage(e)});}
      return;
    }
    if (u.pathname.startsWith("/api/")) {
      if (!authorized(req)) {
        json(res, 401, { error: "데스크톱에서 새 연결 주소를 받아 주세요." });
        return;
      }
      if (isLocked()) {
        json(res, 403, {
          error: "데스크톱 Flowrium이 잠겨 있습니다.",
          locked: true,
        });
        return;
      }
      const requestScope = scopeId(), requestOwner = String(accountRevision());
      if(u.pathname==='/api/mobile/request-upload'){
        try{
          const sessionId=u.searchParams.get('sessionId'),uploadId=u.searchParams.get('id'),action=u.searchParams.get('action');
          const session=store.state.sessions.find(item=>item.id===sessionId),contentType=req.headers['content-type']?.split(';')[0];
          if(!originAllowed(req,local)||!session||!uuid.test(uploadId))throw Error('원문 전송 연결을 확인해 주세요.');
          const uploadKey=JSON.stringify([requestScope,requestOwner,session.projectId,sessionId,uploadId]);
          const verify=async()=>{
            checkScope(requestScope,requestOwner);
            await requireSessionTrust(sessionId);
            if(!store.state.sessions.some(item=>item.id===sessionId&&item.projectId===session.projectId))throw Error('대화가 변경됐습니다.');
            checkScope(requestScope,requestOwner);
          };
          if(req.method==='DELETE'){
            checkScope(requestScope,requestOwner);await requestUploads.discard(uploadKey);json(res,200,{});return;
          }
          if(req.method==='PUT' && action==='part' && contentType==='application/octet-stream'){
            const offset=u.searchParams.get('offset');
            if(!/^\d{1,16}$/.test(offset)||Number(req.headers['content-length'])>chunkBytes)throw Error('원문 전송 조각 크기를 확인해 주세요.');
            const bytes=await readBody(req,chunkBytes);await verify();
            const result=await guard('addChatAttachments',()=>requestUploads.part(uploadKey,Number(offset),bytes,req.headers['x-content-sha256']));
            checkScope(requestScope,requestOwner);json(res,200,result);return;
          }
          if(req.method!=='POST'||contentType!=='application/json'||!['begin','finish'].includes(action))throw Error('원문 전송 형식을 확인해 주세요.');
          const input=JSON.parse((await readBody(req,1024)).toString('utf8'));await verify();
          const result=await guard('addChatAttachments',()=>action==='begin'
            ?requestUploads.begin(uploadKey,input.size,store,session.projectId,verify)
            :requestUploads.finish(uploadKey,input.chain));
          checkScope(requestScope,requestOwner);json(res,200,result);
        }catch(e){json(res,400,{error:require('./errors.cjs').publicMessage(e)});}
        return;
      }
      if(u.pathname==='/api/mobile/request-source' && req.method==='POST'){
        try{
          if(!originAllowed(req,local)||req.headers["content-type"]?.split(";")[0]!=="application/octet-stream")throw Error('원문 업로드 요청을 확인해 주세요.');
          const sessionId=u.searchParams.get('sessionId'),session=store.state.sessions.find(s=>s.id===sessionId);
          if(!session)throw Error('프로젝트 대화를 다시 선택해 주세요.');
          const bytes=await readBody(req,singleUploadBytes);
          await requireSessionTrust(session.id);
          checkScope(requestScope,requestOwner);
          const verify=async()=>{await requireSessionTrust(session.id);checkScope(requestScope,requestOwner);};
          const sha=createHash('sha256').update(bytes).digest('hex');
          const sourceId=require('./chat-request-source.cjs').sourceId(sha);
          const legacyKey=JSON.stringify([requestScope,requestOwner,session.projectId,session.id,'legacy:'+sourceId]);
          const source=await guard('addChatAttachments',()=>requestUploads.legacy(legacyKey,bytes,store,session.projectId,verify));
          checkScope(requestScope,requestOwner);
          json(res,200,{id:source.id});
        }catch(e){json(res,400,{error:require('./errors.cjs').publicMessage(e)});}
        return;
      }
      if (u.pathname === "/api/mobile/attachments" && req.method === "POST") {
        try {
          if (!originAllowed(req,local) || req.headers["content-type"]?.split(";")[0] !== "application/octet-stream") throw Error("첨부 요청 형식을 확인해 주세요.");
          const projectId=u.searchParams.get("projectId"), name=u.searchParams.get("name"), type=u.searchParams.get("type");
          const bytes=await readBody(req,20*1024*1024);
          await store.requireProjectTrust(projectId);
          checkScope(requestScope,requestOwner);
          const handler=handlers.get("addChatAttachments");if(!handler)throw Error("첨부를 사용할 수 없는 앱 버전입니다.");
          const result=await guard("addChatAttachments",()=>handler(projectId,[{name,type,bytes}]));
          checkScope(requestScope,requestOwner);json(res,200,{result});
        } catch(e) {json(res,400,{error:require("./errors.cjs").publicMessage(e)});}
        return;
      }
      if (u.pathname === '/api/mobile/dashboard' && req.method === 'GET') {
        try {
          const facts = await guard('bootstrap', async () => {
            const cards = await handlers.get('readPortfolio')?.() || [];
            return require('./mobile/dashboard-facts.js').dashboardFacts(cards);
          });
          checkScope(requestScope, requestOwner);
          json(res, 200, facts);
        } catch { json(res, 403, {error:'대시보드 연결 상태를 확인해 주세요.'}); }
        return;
      }
      if (u.pathname === "/api/mobile/state" && req.method === "GET") {
        try {
          const value = await guard("bootstrap", async () => {
            const snapshot = store.state,
              connection = await controller.connectionStatus();
            const [pending,links] = await Promise.all([readPending(),readDecisionLinks()]);
            const requests = pending.filter(e=>e.type==='approval'||(e.type==='input'&&!answeredInputs.has(e.requestId)));
            const deciding = new Set([...requests.map(e=>e.sessionId),...links.flatMap(p=>[p.sourceId,p.targetId])]);
            return {
              projects: await Promise.all(snapshot.projects.map(async (p) => ({
                id: p.id,
                name: p.name,
                createdAt: p.createdAt,
                trustedForFileAccess: await store.isProjectTrusted(p.id),
              }))),
              sessions: snapshot.sessions.map(s=>{
                const run=controller.runs.get(s.id),external=externalPreview(s);
                const active=Boolean(run&&!run.claimingWriter&&!run.finalized||external?.running);
                return mobileSummary(display(s),active,deciding.has(s.id),revisionOf(s.id),runLabels.get(run),Boolean(external));
              }),
              settings: {
                theme: snapshot.settings.theme === 'dark' ? 'dark' : 'light',
                accentColor: ['blue','green','purple'].includes(snapshot.settings.accentColor) ? snapshot.settings.accentColor : 'blue',
                sandbox: snapshot.settings.chatDefaults?.sandbox,
                model: snapshot.settings.chatDefaults?.model || snapshot.settings.model,
                effort: snapshot.settings.chatDefaults?.effort || snapshot.settings.effort,
              },
              version,
              mobileVersion:mobileUpdater.version,
              canSteer:true,
              canUploadRequestChunks:true,
              pushAvailable: !!handlers.get("webPushAction"),
              connection: {
                available: connection.available,
                authenticated: connection.authenticated,
                accountLabel: connection.accountLabel,
              },
              running: [...controller.runs].filter(([,run])=>!run.claimingWriter&&!run.finalized).map(([id])=>id),
              approvals: requests.map(e => e.type === "input" ? mobileInput(e) : e),
            };
          });
          if (isLocked()) {
            json(res, 403, {
              locked: true,
              error: "데스크톱 Flowrium이 잠겨 있습니다.",
            });
            return;
          }
          checkScope(requestScope,requestOwner);
          json(res, 200, value);
        } catch {
          json(res, 403, {
            locked: true,
            error: "데스크톱 Flowrium에서 계정과 잠금을 확인해 주세요.",
          });
        }
        return;
      }
      const sessionRoute = /^\/api\/mobile\/sessions\/([^/]+)$/.exec(
        u.pathname,
      );
      if (sessionRoute && req.method === "GET") {
        try {
          const result = await guard("bootstrap", () => {
            const record =
              uuid.test(sessionRoute[1]) &&
              store.state.sessions.find((s) => s.id === sessionRoute[1]);
            return record
              ? mobileMessages(display(record), u.searchParams, revisionOf(record.id))
              : { code: 404, value: { error: "대화를 찾을 수 없습니다." } };
          });
          if (isLocked()) {
            json(res, 403, {
              locked: true,
              error: "데스크톱 Flowrium이 잠겨 있습니다.",
            });
            return;
          }
          checkScope(requestScope,requestOwner);
          json(res, result.code, result.value);
        } catch {
          json(res, 403, {
            locked: true,
            error: "데스크톱 Flowrium에서 계정과 잠금을 확인해 주세요.",
          });
        }
        return;
      }
      if (u.pathname === "/api/mobile/call" && req.method === "POST") {
        const origin = req.headers.origin;
        if (origin !== publicOrigin && origin !== "http://" + local) {
          json(res, 403, { error: "허용되지 않은 요청 출처입니다." });
          return;
        }
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
          json(res, 415, { error: "요청 형식을 확인해 주세요." });
          return;
        }
        try {
          const bytes = await readBody(req, require("./mobile/chat-input.js").maxChatInput * 6 + 131072);
          const input = JSON.parse(bytes.toString("utf8"));
          if (bytes.length > 2 * 1024 * 1024 && input.method !== "send" && !(input.method === "workflowAction" && input.args?.[0]?.action === "continueConversation")) throw Error("요청 크기가 너무 큽니다.");
          checkScope(requestScope,requestOwner);
          if (
            !allowed.has(input.method) ||
            !Array.isArray(input.args) ||
            input.args.length > 5
          )
            throw Error("지원하지 않는 모바일 작업입니다.");
          if (isLocked()) throw Error("데스크톱 Flowrium이 잠겨 있습니다.");
          const handler = handlers.get(input.method);
          if (input.method === "approval" || input.method === "answerInput") {
            const id = input.args[0]?.requestId,
              isAnswer = input.method === "answerInput";
            if (input.args.length !== 1 || typeof id !== "string" || !id)
              throw Error("요청 식별자를 확인해 주세요.");
            const pending = await readPending();
            const found = pending.find(
              (event) =>
                event.requestId === id &&
                event.type === (isAnswer ? "input" : "approval"),
            );
            if (!found || (isAnswer && answeredInputs.has(id)))
              throw Error("이미 처리됐거나 해당 유형의 대기 요청이 없습니다.");
            if (isAnswer && mobileInput(found).desktopOnly) {
              json(res, 403, {
                error: "이 질문에는 데스크톱에서 답해 주세요.",
              });
              return;
            }
            if (isAnswer) answeredInputs.add(id);
            try {
              const result = await guard(input.method, () =>
                handler(input.args[0]),
              );
              approvals.delete(id);
              if (isLocked()) {
                json(res, 403, {
                  locked: true,
                  error: "데스크톱 Flowrium이 잠겨 있습니다.",
                });
                return;
              }
              json(res, 200, { result });
            } catch (error) {
              if (isAnswer) answeredInputs.delete(id);
              throw error;
            }
            return;
          }
          const result = await guard(input.method, () => mobileCall(input.method,input.args,requestScope,requestOwner));
          checkScope(requestScope,requestOwner);
          json(res, 200, { result });
        } catch (e) {
          json(res, 400, { error: require("./errors.cjs").publicMessage(e) });
        }
        return;
      }
      json(res, 404, { error: "모바일 경로를 찾을 수 없습니다." });
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/composer-parse-worker.js": "composer-parse-worker.js",
      "/composer-syntax.js": "composer-syntax.js",
      "/composer-markdown.js": "composer-markdown.js",
      "/composer-markdown.css": "composer-markdown.css",
      "/chat-reader.js": "chat-reader.js",
      "/question-reply.js": "question-reply.js",
      "/work-time.js": "work-time.js",
      "/project-mode.js": "project-mode.js",
      "/request-upload.js": "request-upload.js",
      "/large-draft-editor.js": "large-draft-editor.js",
      "/draft-editor-events.js": "draft-editor-events.js",
      "/answer-followup.js": "answer-followup.js",
      "/chat-input.js": "chat-input.js",
      "/file-citations.js": "file-citations.js",
      "/attachment-text.js": "attachment-text.js",
      "/markdown-engine.js": "markdown-engine.js",
      "/navigation.js": "navigation.js",
      "/date-picker.js": "date-picker.js",
      "/date-picker.css": "date-picker.css",
      "/confirmation.js": "confirmation.js",
      "/decision-notice.js": "decision-notice.js",
      "/chatgpt.svg": "chatgpt.svg",
      "/mobile-shell.css": "mobile-shell.css",
      "/model-display.js": "model-display.js",
      "/usage-credits.js": "usage-credits.js",
      "/style.css": "style.css",
      "/install.js": "install.js",
      "/mobile-update.js": "mobile-update.js",
      "/install.css": "install.css",
      "/icon-192.png": "icon-192.png",
      "/icon-512.png": "icon-512.png",
      "/fonts/NanumSquareRoundL.woff2": "fonts/NanumSquareRoundL.woff2",
      "/fonts/NanumSquareRoundR.woff2": "fonts/NanumSquareRoundR.woff2",
      "/fonts/NanumSquareRoundB.woff2": "fonts/NanumSquareRoundB.woff2",
      "/fonts/NanumSquareRoundEB.woff2": "fonts/NanumSquareRoundEB.woff2",
      "/fonts/OFL.txt": "fonts/OFL.txt",

      "/sw.js": "sw.js",
      "/manifest.webmanifest": "manifest.webmanifest",
      "/icon.png": "../../assets/flowrium.png",
    };
    await mobileUpdater.restore();
    const packaged = files[u.pathname], name = packaged || u.pathname.slice(1);
    const updated = mobileUpdater.contents(name);
    if (!packaged && updated === undefined) {
      res.writeHead(404).end();
      return;
    }
    try {
      let content = updated ?? await fs.readFile(path.join(__dirname, "mobile", name));
      if (name === 'index.html') {
        const stamp = String(mobileUpdater.version).replace(/[^\w.-]/g, '');
        content = content.toString().replace('name="flowrium-mobile-version" content=""', 'name="flowrium-mobile-version" content="'+stamp+'"');
      }
      res.writeHead(200, {
        "Content-Type": name.endsWith(".html")
          ? "text/html; charset=utf-8"
          : name.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".woff2") ? "font/woff2" : name.endsWith(".txt") ? "text/plain; charset=utf-8" : name.endsWith(".png") ? "image/png" : name.endsWith(".webmanifest") ? "application/manifest+json" : "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(content);
    } catch {
      res.writeHead(503).end("모바일 화면을 준비하고 있습니다.");
    }
  }
  async function stop(revoke = true) {
    clearTimeout(reconnectTimer);
    pairedLink?.close(); pairedLink = undefined;
    sequence++;
    const child = tunnel;
    const active = server;
    tunnel = null;
    server = null;
    key = null;
    connectionOwner = "";
    publicOrigin = undefined;
    onContextChanged();
    status = "";
    running.clear();
    approvals.clear();
    answeredInputs.clear();
    handoffs.clear();
    const closed = active
      ? new Promise((resolve) => {
          active.closeAllConnections();
          active.close(resolve);
        })
      : Promise.resolve();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
    await closed;
    await requestUploads.clear();
    if(revoke && pairing) await pairing.revoke();
    return state();
  }
  register("remoteAccess", () => state());
  register("stopRemoteAccess", () => stop(true));
  function scheduleRestore(delay=0) {
    if (!pairing || shuttingDown || server || startFlight || !accountOwner() || !controller.status.authenticated || isLocked()) return;
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(()=>begin(false).catch(()=>scheduleRestore(30000)),delay);
    reconnectTimer.unref?.();
  }
  function begin(explicit) {
    if (startFlight) return explicit ? startFlight.then(value=>value.enabled?value:begin(true)) : startFlight;
    startFlight=start(explicit).finally(()=>{startFlight=undefined;});
    return startFlight;
  }
  register("startRemoteAccess", () => begin(true));
  async function start(explicit) {
    const expectedOwner=accountOwner(), previousSequence=sequence;
    if(!explicit) {
      if (!expectedOwner || isLocked() || !controller.status.authenticated || (await pairing?.read())?.owner!==expectedOwner || previousSequence!==sequence || shuttingDown) return state();
    }
    if (server && connectionOwner !== String(accountRevision())) await stop();
    if (server) return state();
    if (!controller.status.authenticated)
      throw Error("먼저 이 컴퓨터에서 ChatGPT 계정을 연결해 주세요.");
    const attempt = ++sequence;
    connectionOwner = String(accountRevision());
    key = randomBytes(32).toString("base64url");
    onContextChanged();
    server = http.createServer((req, res) =>
      handle(req, res).catch(() => {
        if (!res.headersSent)
          json(res, 500, { error: "모바일 요청을 처리하지 못했습니다." });
        else res.end();
      }),
    );
    const ownServer = server;
    try {
      await new Promise((resolve, reject) => {
        ownServer.once("error", reject);
        ownServer.listen(0, "127.0.0.1", resolve);
      });
      if (attempt !== sequence || server !== ownServer) {
        ownServer.close();
        throw Error("휴대폰 연결 준비가 취소됐습니다.");
      }
      for (const run of controller.runs.values()) running.add(run.sessionId);
      if (pairing) {
        const onDisconnect=()=>{if(sequence===attempt)void stop(false).then(()=>scheduleRestore(2000));};
        const link=await pairing.open(expectedOwner,ownServer,onDisconnect,explicit);
        if(!link || attempt!==sequence || expectedOwner!==accountOwner() || shuttingDown){link?.close();throw Error("휴대폰 연결이 취소됐습니다.");}
        pairedLink=link; publicOrigin=link.origin;key=link.key;status="";
        checkScope(scopeId(),connectionOwner);
        ownServer.unref();onContextChanged();
        return state();
      }
      let command = "cloudflared",
        env = { ...process.env };
      try {
        const runtime = require("./runtime.cjs");
        env = runtime.runtimeEnvironment();
        const paths = runtime.runtimePaths();
        if (paths.cloudflared) command = paths.cloudflared;
      } catch {}
      tunnel = tunnelFactory(
        command,
        [
          "tunnel",
          "--url",
          "http://127.0.0.1:" + server.address().port,
          "--no-autoupdate",
        ],
        { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const spawned = tunnel;
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(
                "HTTPS 터널을 준비하지 못했습니다. 네트워크 상태를 확인해 주세요.",
              ),
            ),
          35000,
        );
        let output = "";
        let candidate;
        let connected = false;
        const line = (chunk) => {
          output = (output + chunk.toString()).slice(-16000);
          const match = output.match(
            /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
          );
          if (match) candidate = match[0];
          if (output.includes("Registered tunnel connection")) connected = true;
          if (
            candidate &&
            connected &&
            attempt === sequence &&
            tunnel === spawned &&
            server === ownServer
          ) {
            publicOrigin = candidate;
            clearTimeout(timer);
            resolve();
          }
        };
        spawned.stdout.on("data", line);
        spawned.stderr.on("data", line);
        spawned.once("error", () => {
          clearTimeout(timer);
          reject(
            Error(
              "cloudflared 실행 파일을 찾지 못했습니다. 공식 cloudflared를 설치한 뒤 다시 시도해 주세요.",
            ),
          );
        });
        spawned.once("exit", () => {
          clearTimeout(timer);
          if (tunnel === spawned) {
            publicOrigin = undefined;
            onContextChanged();
            status =
              "휴대폰 연결이 끊겼습니다. 연결을 종료한 뒤 다시 켜 주세요.";
          }
          reject(Error("HTTPS 터널이 종료됐습니다."));
        });
      });
      await ready;
      if (attempt !== sequence || server !== ownServer)
        throw Error("휴대폰 연결이 취소됐습니다.");
      checkScope(scopeId(),connectionOwner);
      ownServer.unref();
      return state();
    } catch (e) {
      if (attempt === sequence) await stop(false);
      else ownServer.close();
      throw e;
    }
  }
  controller.on("event", update);
  scheduleRestore();
  return {
    stopAccess: () => stop(true),
    restore: scheduleRestore,
    state,
    getLink: state,
    pushContext: () => ({enabled:!!server?.listening && !!publicOrigin && !isLocked() && connectionOwner === String(accountRevision()),origin:publicOrigin,scopeId:scopeId()}),
    issueLink: ({ttlMinutes=15}={}) => {
      const scope=scopeId(),owner=String(accountRevision());checkScope(scope,owner);
      if(!publicOrigin)throw Error("휴대폰 HTTPS 연결을 먼저 켜 주세요.");
      if(![5,15,60].includes(ttlMinutes))throw Error("연결 유효 시간은 5분 / 15분 / 60분 중에서 고르세요.");
      for(const [id,record]of handoffs)if(record.expiresAt<=now())handoffs.delete(id);
      if(handoffs.size>=100)throw Error("사용하지 않은 연결 주소가 많습니다. 잠시 후 다시 시도하세요.");
      const nonce=randomBytes(32).toString("base64url"),expiresAt=now()+ttlMinutes*60000;
      handoffs.set(createHash("sha256").update(nonce).digest("hex"),{scopeId:scope,owner,expiresAt});
      return {url:publicOrigin+"/#handoff="+nonce,expiresAt,scopeId:scope};
    },
    shutdown: async () => {
      shuttingDown=true;
      controller.off("event", update);
      await stop(false);
    },
  };
}
module.exports = { registerRemote };
