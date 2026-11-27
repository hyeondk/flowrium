const fs = require("node:fs/promises");
const path = require("node:path");
const {samePath, relativePath} = require("./path-boundary.cjs");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { CodexClient, resolveCodex } = require("./codex.cjs");
const { text } = require("./store.cjs");
const { publicMessage, chatFailure } = require("./errors.cjs");
const { HistoryImporter } = require("./history.cjs");
const currentRequest = require("./scoped-request.cjs");
const { projectWorkStep } = require('./work-step.cjs');
const { activityText } = require('./mobile/work-activity.js');

const MODE_INSTRUCTIONS = {
  plan: "계획을 세우고 설명해 주세요. 사용자가 수정을 요청하면 프로젝트 범위에서 반영하세요.",
  build:
    "요청한 구현을 수행하고 적절히 검증해 주세요. 프로젝트 범위에서 작업해 주세요.",
  review:
    "코드와 변경 사항을 검토하세요. 사용자가 요청한 수정은 프로젝트 범위에서 반영하고 결과를 설명하세요.",
};
class Controller extends EventEmitter {
  constructor(store, options = {}) {
    super();
    this.store = store;
    this.options = options;
    this.client = options.client || new CodexClient(options);
    this.client.options ||= {};
    this.client.options.captureTurnGuard=params=>{const run=this.findRun(params.threadId);return run?()=>this.runs.get(run.sessionId)===run&&!run.cancelled&&!run.finalized&&run.ownerRevision===(this.options.queueOwner?.()??'local'):()=>true;};
    this.runs = new (require('./conversation-runs.cjs').ConversationRuns)();
    this.editingSessions = new Set();
    this.loadedThreads = new Set();
    this.shuttingDown = false;
    this.messageQueue = new (require("./chat-queue.cjs").ChatQueue)(this);
    this.status = { available: false, authenticated: false };
    this.history = new HistoryImporter(store, this.client, () =>
      this.client.start(this.store.state.settings.codexPath),
    );
    this.client.on("notification", (message) => {
      this.notification(message).catch((error) =>
        this.emitEvent({
          type: "error",
          text: `작업 기록을 갱신하지 못했습니다. ${error.message}`,
        }),
      );
    });
    this.client.on("input", request => this.forwardInput(request));
    this.client.on("inputResolved", request => this.forwardInputResolved(request));
    this.client.on("approval", (request) => this.forwardApproval(request));
    this.client.on("tool", async ({requestId,params}) => {
      const run=this.findRun(params.threadId,params.turnId);
      try {
        if(!run || !params.threadId || params.threadId!==run.threadId || (run.client&&run.client!==this.client) || (run.turnId&&run.turnId!==params.turnId) || !this.canExecuteRun(run)) throw Error("이 작업의 도구 요청은 종료됐습니다.");
        const session=this.store.session(run.sessionId);
        if(session.scope)throw Error('일반 대화와 통합 채팅은 프로젝트 실행 도구를 사용할 수 없습니다.');
        if(params.tool===currentRequest.reader.name){
          this.client.answerTool(requestId,await currentRequest.projectPage(session,run,params.arguments));
          return;
        }
        if(this.options.canRun?.()===false)throw Error('잠금 해제 후 앱 기능을 이용해 주세요.');
        const tools=await this.options.applicationTools?.(session)||[];
        if(!tools.some(t=>t.name===params.tool)) throw Error("허용되지 않은 앱 도구입니다.");
        const result=await this.options.callApplicationTool?.({sessionId:run.sessionId,name:params.tool,arguments:params.arguments,callId:params.callId});
        this.client.answerTool(requestId,{contentItems:[{type:"inputText",text:JSON.stringify(result??null)}],success:true});
      } catch(e) { this.client.answerTool(requestId,{contentItems:[{type:"inputText",text:publicMessage(e)}],success:false}); }
    });
    this.client.on("unsupported", (message) => {
      const run = this.findRun(message.params?.threadId);
      this.emitEvent({
        type: "error",
        sessionId: run?.sessionId,
        text: "Codex가 Flowrium에서 지원하지 않는 추가 입력을 요청했습니다. 요청은 거절됐습니다.",
      });
    });
    this.client.on("disconnect", (error) => {
      this.loadedThreads.clear();
      this.status.authenticated = false;
      this.loginId = null;
      this.loginPending = false;
      for (const run of [...this.runs.values()])
        if(run.provider !== 'claude' && !run.claimingWriter && (!run.client || run.client===this.client))this.finish(run, "failed", error).catch(() => {});
      this.emitEvent({
        type: "status",
        status: "disconnected",
        text: chatFailure(error).message,
      });
    });
  }
  emitEvent(event) {
    if(event.sessionId&&this.store.isCurrentConversation?.(event.sessionId)===false)return;
    if(event.sessionId&&['status','session','delta','done'].includes(event.type)){
      const runningProviders=this.runs.providers(event.sessionId);
      if(runningProviders.length || event.type==='done')event={...event,runningProviders};
    }
    if(event.type==='session' && event.session){
      const source=this.store.peekSession?.(event.sessionId);
      const preview=source&&this.codexTransfer?.liveTurn?.(source);
      const context=source&&this.codexTransfer?.contextUsage?.(source);
      if(context&&context.updatedAt>=(event.session.context?.updatedAt||''))event={...event,session:{...event.session,context}};
      if(preview)event={...event,session:{...event.session,messages:require('./mobile/live-turn.js').withLiveTurn(event.session.messages,preview.turnId,preview.rows)}};
    }
    this.emit("event", event);
  }
  canContinueWork(){return !this.shuttingDown&&(this.options.canContinue ?? this.options.canRun)?.()!==false;}
  canExecuteRun(run){
    // A saved submission already belongs to this account. Screen lock gates
    // new actions from the renderer, while the accepted request stays active.
    return !this.shuttingDown && this.runs.owns(run) && !run.cancelled && !run.finalized &&
      run.ownerRevision===(this.options.queueOwner?.()??'local') &&
      (run.accepted ? this.canContinueWork() : this.options.canRun?.()!==false);
  }
  clients(){return [...new Set([this.client,...[...(this.scopeClients?.values()||[])].map(entry=>entry.client),...[...(this.linkedClients?.values()||[])]].filter(Boolean))];}
  requestClient(requestId,kind='approvals'){return this.clients().find(client=>client[kind]?.has(requestId));}
  decideApproval(requestId,decision){
    const client=this.requestClient(requestId),request=client?.approvals.get(requestId),run=request&&this.findRun(request.params?.threadId);
    if(!client||!run||run.finalized||run.cancelled||(run.client&&run.client!==client)||(run.turnId&&request.params?.turnId&&run.turnId!==request.params.turnId)||this.options.canRun?.()===false||(this.options.queueOwner&&run.ownerRevision!==this.options.queueOwner()))throw Error('이 승인 요청은 이미 종료됐습니다.');
    const result=client.decide(requestId,decision);
    this.noteRequest(run,'approval:'+requestId,decision==='decline'?'실행 권한을 거절했어요':'실행 권한에 응답했어요',decision==='decline'?'interrupted':'completed');
    this.emitEvent({type:'inputResolved',sessionId:run.sessionId,requestId});
    return result;
  }
  conversationClient(session){return session.scope?require('./conversation-scopes.cjs').scopeClient(this,session):Promise.resolve(this.client);}
  async projectAccess(session,mode) {
    const trusted = await this.store.requireProjectTrust(session.projectId);
    const project = this.store.project(session.projectId);
    const slot = await require('./team-worktrees.cjs').teamSessionAccess(this.store,session,mode,this);
    let cwd = slot.cwd;
    if (!session.workflow?.teamSlot?.isolated) {
      const selected = this.options.resolveProjectDirectory
        ? await this.options.resolveProjectDirectory(project,session)
        : await require('./project-repositories.cjs').resolveProjectDirectory(this.store,project,session);
      cwd = await fs.realpath(selected);
      const relative = relativePath(trusted.path,cwd);
      if (!samePath(selected,cwd) || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative) || !(await fs.stat(cwd)).isDirectory())
        throw Error('신뢰한 프로젝트 안의 실제 작업 폴더를 선택해 주세요.');
    }
    const prefs = require('./chat-preferences.cjs').resolved(this.store.state.settings.chatDefaults,session.preferences);
    const approvalPolicy = prefs.approval === 'never' || (!prefs.approval && slot.sharedReview) ? 'never' : 'on-request';
    const approvalsReviewer = approvalPolicy === 'on-request' && prefs.approval !== 'manual' ? 'auto_review' : 'user';
    const sandbox = slot.sharedReview ? 'read-only' : 'workspace-write';
    return {key:trusted.key, prefs, cwd, sandbox, approvalPolicy, approvalsReviewer};
  }
  async conversationThreadParams(session) {
    if (session.scope) return require('./conversation-scopes.cjs').scopeThreadParams(this,session);
    const mode = require('./mobile/project-mode.js').projectMode(session);
    const {cwd,sandbox,approvalPolicy,approvalsReviewer} = await this.projectAccess(session,mode);
    return {cwd,sandbox,approvalPolicy,approvalsReviewer};
  }
  cancelStructuredAnalyses({backgroundOnly=false}={}){
    for(const analysis of this.analysisRuns?.values()||[])
      if(!backgroundOnly||analysis.background)analysis.cancel?.();
  }
  runStructuredAnalysis(input){return require("./structured-analysis.cjs").runStructuredAnalysis(this,input);}
  continueConversation(input){return require('./chat-continuation.cjs').continueConversation(this,input);}
  listQueuedMessages(id){return this.messageQueue.list(id);}
  cancelQueuedMessage(id,queueId){return this.messageQueue.cancel(id,queueId);}
  resumeQueuedMessages(id){return this.messageQueue.resume(id);}
  listCodexHistory(projectId) {
    return this.history.list(projectId);
  }
  importCodexHistory(projectId, ids) {
    return this.history.import(projectId, ids);
  }
  async connectionStatus() {
    if (this.client.ready) return { ...this.status };
    try {
      const descriptor =
        this.options.descriptor ||
        (await resolveCodex(this.store.state.settings.codexPath, this.options));
      return {
        available: !!descriptor,
        authenticated: false,
        ...(descriptor ? { cliPath: descriptor.label } : {}),
        ...(!descriptor ? { error: "Codex 실행 파일을 찾지 못했습니다." } : {}),
      };
    } catch (error) {
      return { available: false, authenticated: false, error: error.message };
    }
  }
  async connect(quiet=false, linkAccount=false) {
    await this.client.start(this.store.state.settings.codexPath);
    const {account:record}=await this.client.request("account/read",{refreshToken:false});
    const changed=await this.accountObserved?.(record, linkAccount);
    const owner=this.options.queueOwner?.();
    // Complete sign-in without waiting for the model catalog to load.
    const models=linkAccount ? [] : (await this.client.request("model/list",{limit:100,includeHidden:false})).data || [];
    if(this.options.queueOwner?.()!==owner)throw Error('연결 계정이 바뀌었습니다. 다시 확인해 주세요.');
    const previous=this.status.authenticated, previousDots=this.status.dotsEligible;
    const authenticated = record?.type === "chatgpt";
    const plan = typeof record?.planType === "string" ? record.planType.trim().toLowerCase() : "";
    const accountLabel = authenticated
      ? `ChatGPT${plan ? `(${plan[0].toUpperCase()}${plan.slice(1)})` : ""}`
      : undefined;
    this.status = {
      available: true,
      authenticated,
      ...(authenticated && plan ? { accountPlan:plan } : {}),
      dotsEligible: authenticated && record.planType?.toLowerCase() === "pro",
      cliPath: this.client.descriptor?.label,
      ...(accountLabel ? { accountLabel } : {}),
      ...(!authenticated ? { error: "ChatGPT 계정으로 로그인해 주세요." } : {}),
    };
    if(!quiet || changed || previous!==authenticated || previousDots!==this.status.dotsEligible)this.emitEvent({
      type: "status",
      status: authenticated ? "connected" : "login-required",
      text: authenticated
        ? "Codex에 연결됐습니다."
        : "ChatGPT 계정으로 로그인해 주세요.",
    });
    if(authenticated && (!quiet || !previous)) setImmediate(()=>this.messageQueue.flushAll());
    return {
      status: { ...this.status },
      modelAccount:authenticated ? this.options.modelAccount?.() : undefined,
      models: models.map((model) => ({
        id: model.model || model.id,
        displayName: model.displayName || model.id,
        description: model.description || undefined,
        supportedSpeeds: require('./model-speed.cjs').supportedSpeeds(model),
        supportedReasoningEfforts:Array.isArray(model.supportedReasoningEfforts)?model.supportedReasoningEfforts.filter(row=>row&&['none','minimal','low','medium','high','xhigh','max','ultra'].includes(row.reasoningEffort)).map(row=>({reasoningEffort:row.reasoningEffort,description:row.description})):undefined,
        defaultReasoningEffort:model.defaultReasoningEffort,
        isDefault:model.isDefault===true,
      })),
      accountLabel,
    };
  }
  async login() {
    await this.client.start(this.store.state.settings.codexPath);
    const result = await this.client.request("account/login/start", {
      type: "chatgpt",
    });
    if (typeof result.authUrl !== "string")
      throw new Error("로그인 주소를 받지 못했습니다. 다시 시도해 주세요.");
    const url = new URL(result.authUrl);
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "chatgpt.com", "auth0.openai.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password
    )
      throw new Error("확인되지 않은 로그인 주소를 차단했습니다.");
    this.loginId = result.loginId || null;
    this.loginPending = true;
    return { authUrl: result.authUrl };
  }
  async saveSettings(input, {mergeChatDefaults=false}={}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("설정 형식이 올바르지 않습니다.");
    let changedPath=false;
    const next=await this.store.saveSettings(input,{mergeChatDefaults,beforeSave:previous=>{
      changedPath=Object.hasOwn(input,"codexPath") && (input.codexPath||undefined)!==previous.codexPath;
      if(changedPath && this.runs.size)
        throw new Error("실행 중인 작업을 종료한 뒤 경로를 변경해 주세요.");
    }});
    if (changedPath) {
      this.client.close();
      for(const entry of this.scopeClients?.values()||[])entry.client?.close();
      this.scopeClients?.clear();
      this.loadedThreads.clear();
      this.status = { available: false, authenticated: false };
    }
    return next;
  }
  async deleteSession(id) {
    if(this.trashRuntime)return this.trashRuntime.deleteLocalSession(id);
    if (this.runs.has(id) || this.editingSessions.has(id))
      throw new Error(
        "실행 중인 대화는 삭제할 수 없습니다. 먼저 작업을 중지해 주세요.",
      );
    if(this.codexTransfer?.isBusy())throw Error('대화 연결 작업을 마친 뒤 삭제해 주세요.');
    await this.store.deleteSession(id);
  }
  async send(input, internal = {}) {
    if(input?.submissionId===undefined || internal.fromQueue)return this.sendOnce(input,internal);
    if(!require('./project-store.cjs').UUID.test(input.submissionId))throw Error('요청 식별자를 확인해 주세요.');
    if(this.shuttingDown || this.options.canRun?.()===false)throw Error('현재 계정과 잠금 상태를 확인해 주세요.');
    const session=this.store.session(input.sessionId),id=input.submissionId;
    const receipt=session.messages.find(row=>row.role==='user' && row.id===id);
    if(receipt)return {accepted:true};
    const queued=session.queuedMessages?.find(row=>row.id===id);
    if(queued)return {accepted:true,queued:queued.status==='queued'||queued.status==='sending',queueId:id,
      waitingForWriter:queued.waitingForWriter,nativeDelivery:queued.nativeDelivery,nativeQueueAvailable:queued.nativeQueueAvailable};
    const key=JSON.stringify([this.options.queueOwner?.()??'local',session.id,id]);
    this.pendingSubmissions ??=new Map();
    if(this.pendingSubmissions.has(key))return this.pendingSubmissions.get(key);
    const sending=this.sendOnce(input,internal);
    this.pendingSubmissions.set(key,sending);
    try{return await sending;}finally{this.pendingSubmissions.delete(key);}
  }
  async sendOnce(input, internal = {}) {
    if(this.shuttingDown||this.options.canRun?.()===false)throw Error("잠금과 계정 전환 또는 업데이트를 마친 뒤 요청해 주세요.");
    if(this.codexTransfer?.isBusy())throw Error('대화 연결 작업을 마친 뒤 보내 주세요.');
    const ownerRevision=this.options.queueOwner?.()??'local';
    if (!input || typeof input !== "object")
      throw new Error("작업 요청 형식이 올바르지 않습니다.");
    const attachmentIds = input.attachments || [];
    const {chatInput,maxChatInput} = require("./mobile/chat-input.js");
    if (input.mode === undefined) {
      const session = this.store.session(input.sessionId);
      input = {...input, mode:require("./mobile/project-mode.js").projectMode(session, undefined, this.store.state.settings.chatDefaults)};
    }
    if (!Object.hasOwn(MODE_INSTRUCTIONS, input.mode))
      throw new Error("작업 방식을 선택해 주세요.");
    if (input.effort && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(input.effort))
      throw new Error("추론 강도를 확인해 주세요.");
    require('./model-speed.cjs').serviceTier(input.speed);
    if (input.model) text(input.model, "모델", 300);
    const session = this.store.session(input.sessionId);
    const settings = this.store.state.settings;
    const {providerFor,allowsParallel}=require('./ai-provider.cjs');
    const provider = providerFor(session, input.provider, settings);
    const parallel=()=>allowsParallel(session,this.store.state.settings);
    const active=()=>parallel()?this.runs.forProvider(session.id,provider):this.runs.get(session.id);
    if (provider==='codex' && this.codexTransfer?.refreshDone) await this.codexTransfer.waitForRefresh();
    if (provider === 'claude') {
      if (!settings.claudeEnabled) throw Error('설정에서 Claude 사용을 켜 주세요.');
      if (!(await this.options.claude?.status())?.configured) throw Error('설정에서 Claude API 키를 연결해 주세요.');
    }
    const selectedReferences=require('./codex-plugins.cjs').checkedReferences(input.codexReferences);
    if(selectedReferences.length){
      if(provider === 'claude') throw Error('Codex 연결 도구를 해제한 뒤 Claude로 보내 주세요.');
      if(session.scope)throw Error('외부 연결 도구는 프로젝트 대화에서 사용할 수 있습니다.');
      if(!input.requestSourceId && !/\S/.test(input.text || '') && !attachmentIds.length)
        throw Error('선택한 연결 도구로 할 작업을 적어 주세요.');
      if(!this.options.resolveCodexReferences)throw Error('현재 앱에서 연결 도구를 조회할 수 없습니다.');
      input={...input,codexReferences:await this.options.resolveCodexReferences(selectedReferences)};
    }
    if (!session.scope) {
      await this.store.requireProjectTrust(session.projectId);
      for (const id of session.workflow?.reportProjects || []) if (id!==session.projectId) await this.store.requireProjectTrust(id);
    }
    const requests=require('./chat-long-request.cjs');
    let source, message, titleRequest;
    const {defaultTitles,suggestConversationTitle}=require('./chat-title.cjs');
    const needsTitle=()=>!session.threadId && !session.pendingThreadName && !session.workflow &&
      !session.personalAssistant && !session.generalAssistant && defaultTitles.has(session.title) &&
      !session.messages.some(item=>item.role==='user');
    if(input.requestSourceId){
      const file=await requests.sourceRecord(this.store,session.projectId,input.requestSourceId);
      source=require('./chat-request-source.cjs').checkedRequestSource(file);
      message=requests.sourceLabel(source);
      if(needsTitle())titleRequest=await require('./chat-request-source.cjs').filePage(file,0).catch(()=>undefined);
    } else {
      message=chatInput(input.text,Boolean(attachmentIds.length));
      if(needsTitle() && input.text.trim())titleRequest=input.text.slice(0,6000);
      if(message.length > maxChatInput){
        source=await require('./chat-attachments.cjs').storeRequestSource(this.store,session.projectId,message,{guard:()=>{
          if(this.options.canRun?.()===false || ownerRevision!==(this.options.queueOwner?.()??'local'))throw Error('계정이나 잠금 상태가 바뀌었습니다.');
        }});
        message=requests.sourceLabel(source);
      }
    }
    if(source)input={...input,requestSourceId:source.id};
    const own = (session.preferences?.provider || session.provider || 'codex') === provider ? session.preferences || {} : {};
    // Capture the selection before any asynchronous work, including time in the queue.
    const queuedSelection = internal.useCapturedSelection || (internal.fromQueue && input.model !== undefined);
    const inheritsModel = !queuedSelection && !own.model &&
      (!input.model || input.model === settings.model || input.model === settings.chatDefaults?.model);
    input = provider === 'claude' ? {
      ...input, provider,
      model: queuedSelection ? input.model : own.model || input.model || settings.claudeModel || null,
      effort: queuedSelection ? input.effort : own.effort || input.effort || settings.claudeEffort,
      speed: undefined,
    } : {
      ...input,
      provider,
      model: queuedSelection ? input.model : own.model || settings.chatDefaults?.model || input.model || settings.model || null,
      effort: queuedSelection ? input.effort : own.effort || settings.chatDefaults?.effort || input.effort || settings.effort,
      speed: (queuedSelection ? input.speed : own.speed ?? settings.chatDefaults?.speed ?? input.speed ?? settings.speed) ?? 'standard',
    };
    const checkContinuation=()=>{
      const expected=internal.expectedContinuation;if(!expected)return;
      const last=require('./execution-state.js').continuationAnswer(session);
      if(session.completedContinuationId===expected.messageId)throw Error('이미 완료로 표시한 후속 작업입니다.');
      if(!last||last.id!==expected.messageId||last.text!==expected.text||ownerRevision!==expected.owner||ownerRevision!==(this.options.queueOwner?.()??'local')||this.runs.has(session.id)||this.editingSessions.has(session.id)||this.codexTransfer?.liveTurn?.(session)||session.compacting||this.messageQueue.pending(session.id)||session.workflow?.status==='done')throw Error('대화나 계정 상태가 바뀌었습니다. 최신 답변을 확인하고 다시 선택해 주세요.');
    };
    checkContinuation();
    if (session.workflow?.status === "done") throw new Error("완료한 업무입니다. 다시 진행하려면 업무를 재개해 주세요.");
    if (this.editingSessions.has(session.id)) throw new Error("대화 편집을 마친 뒤 다시 보내 주세요.");
    if (input.delivery === 'steer' && !internal.fromQueue) {
      const currentRun=active();
      if(currentRun && provider !== 'claude' && await require('./chat-steer.cjs').steer(this,session,currentRun,input,message,ownerRevision))
        return {accepted:true,steered:true};
      if(currentRun) return this.messageQueue.enqueue({...input,text:message,ownerRevision});
    }
    if (!internal.fromQueue && (active() || (session.compacting&&provider==='codex') || this.messageQueue.pending(session.id,parallel()?provider:undefined)))
      return this.messageQueue.enqueue({...input,text:message,ownerRevision});
    if(provider==='codex' && session.codexLink){
      if(!this.codexTransfer)throw Error('Codex 대화 연결을 준비한 뒤 다시 요청해 주세요.');
      try {
        await this.codexTransfer.beforeSend(session.id,{waitingForWriter:internal.waitingForWriter});
      } catch(error) {
        if(error.code!=='THREAD_ACTIVE'||internal.fromQueue||internal.outputSchema)throw error;
        return this.messageQueue.enqueue({...input,text:message,ownerRevision,waitingForWriter:true});
      }
    }
    const project = this.store.project(session.projectId);
    if (!(await fs.stat(project.path)).isDirectory())
      throw new Error("프로젝트 폴더를 찾을 수 없습니다.");
    const attachments = await require("./chat-attachments.cjs").resolveAttachments(this.store,session.projectId,attachmentIds,provider === 'claude');
    if(this.options.canRun?.()===false||ownerRevision!==(this.options.queueOwner?.()??'local'))throw Error('계정이나 잠금 상태가 바뀌었습니다. 다시 보내 주세요.');
    providerFor(session,provider,this.store.state.settings);
    if(provider === 'claude'&&!this.store.state.settings.claudeEnabled)throw Error('설정에서 Claude 사용을 켜 주세요.');
    checkContinuation();
    const run = {
      ownerRevision,
      userMessageId: null,
      ...(source && {requestSource:source}),
      attachments,
      provider,
      conversationMode:this.store.state.settings.providerMode==='mixed'?'mixed':'sync',
      ...(provider === 'claude' && {abortController:new AbortController()}),
      sessionId: session.id,
      threadId: provider==='codex' ? session.threadId : undefined,
      useAvailableDefaultModel: Boolean(session.scope && !session.threadId && inheritsModel),
      creatingThread: !session.threadId,
      turnId: null,
      items: new Map(),
      itemOrder: [],
      toolItems: new Map(),
      assistant: null,
      cancelled: false,
      finalized: false,
      saveTimer: null,
      mode: input.mode,
      ...(internal.outputSchema && { outputSchema: internal.outputSchema }),
    };
    if (active() || this.editingSessions.has(session.id)) {
      if(!internal.fromQueue)return this.messageQueue.enqueue({...input,text:message,ownerRevision});
      throw new Error("현재 작업이 끝난 뒤 대기 지시를 다시 전달해 주세요.");
    }
    if(internal.queueItem?.status==='cancelled')throw Error('대기 요청을 취소했습니다.');
    this.runs.set(session.id, run);
    // Claim an existing conversation before committing a user message. A busy
    // owner must leave one cancellable queued request and no unsent transcript row.
    if(run.threadId && (session.scope || session.codexLink?.mode==='linked' || session.desktopThread)){
      run.claimingWriter=true;
      try{
        run.prepared=session.scope
          ? await require('./conversation-scopes.cjs').prepareScopedRun(this,run,input,session)
          : await this.prepareProjectRun(run,input,project);
        if(run.cancelled||run.finalized||this.shuttingDown||this.options.canRun?.()===false||
           ownerRevision!==(this.options.queueOwner?.()??'local')||
           internal.queueItem?.status==='cancelled')throw Error('대화 전송이 취소되었습니다.');
      }catch(error){
        run.finalized=true;
        await (run.releaseClient||run.releaseScopedWriter)?.();
        this.runs.remove(run);
        if(error.code!=='THREAD_WRITER_BUSY'||internal.fromQueue||internal.outputSchema)throw error;
        return this.messageQueue.enqueue({...input,text:message,ownerRevision,waitingForWriter:true});
      }finally{run.claimingWriter=false;}
    }
    const previous = { title: session.title, updatedAt: session.updatedAt, provider:session.provider };
    const userMessage = {
      id: internal.queueItem?.id || input.submissionId || randomUUID(),
      role: "user",
      ...(provider==='claude' && {provider}),
      text: message,
      ...(source && {requestSource:source,sourceOnly:true}),
      ...(attachments.length ? {attachments:require("./chat-attachments.cjs").checkedAttachments(attachments)} : {}),
      ...(input.codexReferences?.length && {codexReferences:input.codexReferences}),
      createdAt: new Date().toISOString(),
    };
    run.userMessageId=userMessage.id;
    if(internal.queueItem)internal.queueItem.status='sending';
    if(needsTitle())session.title=suggestConversationTitle(titleRequest || '',attachments);
    const generatedName=provider !== 'claude' && !!this.codexTransfer?.bindNative && !session.pendingThreadName && !session.threadId &&
      !session.codexLink && !session.sourceThreadId && !session.messages.some(item=>item.role==='user');
    if(provider === 'claude' || session.provider) session.provider=provider;
    session.messages.push(userMessage);
    const sentTitle=session.title;
    if(generatedName)session.pendingThreadName=sentTitle;
    session.updatedAt = new Date().toISOString();
    try {
      await this.store.save();
    } catch (error) {
      if(generatedName && session.pendingThreadName === sentTitle)delete session.pendingThreadName;
      session.messages = session.messages.filter(
        (item) => item.id !== userMessage.id,
      );
      if(session.title===sentTitle && !session.pendingThreadName)session.title = previous.title;
      session.updatedAt = previous.updatedAt;
      if(previous.provider)session.provider=previous.provider;
      else delete session.provider;
      this.runs.remove(run);
      await (run.releaseClient||run.releaseScopedWriter)?.();
      throw error;
    }
    run.accepted=true;
    this.emitEvent({
      type: "session",
      sessionId: session.id,
      session: structuredClone(session),
    });
    this.emitEvent({
      type: "status",
      sessionId: session.id,
      provider,
      status: "running",
      text: provider === 'claude' ? 'Claude 작업을 준비하고 있습니다.' : "Codex 작업을 준비하고 있습니다.",
    });
    const starting=this.startRun(run, input, message, project)
      .catch(async (error) => {
        const client=run.client||this.client;
        if (provider !== 'claude' && error.code === "RPC_TIMEOUT" && !run.finalized) client.close();
        else if (provider !== 'claude' && run.turnId && client.ready && !run.finalized)
          await client
            .request(
              "turn/interrupt",
              { threadId: run.threadId, turnId: run.turnId },
              2500,
            )
            .catch(() => client.close());
        await this.finish(
          run,
          run.cancelled ? "interrupted" : "failed",
          run.cancelled && provider==='claude' ? undefined : error,
        );
        if(internal.queueItem)throw error;
      });
    if(internal.queueItem){
      await starting;
      if(!run.turnId)throw Error('선택한 AI 서비스가 대기 지시를 받기 전에 작업이 종료됐습니다.');
    }else void starting.catch(()=>{});
    return { accepted: true };
  }
  async applyInitialTitle(run,session,client) {
    if (!session.pendingThreadName || session.desktopThread?.threadId !== run.threadId) return;
    try {
      await require('./chat-sync.cjs').flushInitialTitle(session,client,run.threadId,()=>run.ownerRevision===(this.options.queueOwner?.()??'local'));
    } catch { /* The completion handler retries after the thread is persisted. */ }
  }
  async prepareProjectRun(run,input,project) {
    const linked=this.store.session(run.sessionId).codexLink?.mode==='linked';
    const client=linked?require('./codex-transfer-client.cjs').createRunClient(this,run):this.client;
    run.client=client;
    await client.start(this.store.state.settings.codexPath);
    if (run.cancelled || run.finalized) throw Error("작업 준비를 취소했습니다.");
    const account = await client.request("account/read", {
      refreshToken: false,
    });
    if (await this.accountObserved?.(account.account)) throw new Error("연결 계정이 바뀌었습니다. 현재 계정으로 요청할 내용을 확인한 뒤 다시 보내 주세요.");
    if(run.ownerRevision!==(this.options.queueOwner?.()??'local'))throw Error("연결 계정이 바뀌었습니다. 요청을 다시 확인해 주세요.");
    if (account.account?.type !== "chatgpt")
      throw new Error("작업하려면 ChatGPT 계정으로 로그인해 주세요.");
    const access = await this.projectAccess(this.store.session(run.sessionId),input.mode);
    const {cwd,prefs,sandbox,approvalPolicy,approvalsReviewer} = access;
    const verifyAccess = async () => {
      const current = await this.projectAccess(this.store.session(run.sessionId),input.mode);
      if (access.key!==current.key || !samePath(cwd,current.cwd) || sandbox!==current.sandbox || approvalPolicy!==current.approvalPolicy || approvalsReviewer!==current.approvalsReviewer)
        throw Error('프로젝트 작업 폴더나 권한이 변경됐습니다. 폴더를 확인하고 다시 보내 주세요.');
    };
    run.approvalsAllowed=approvalPolicy === "on-request" && approvalsReviewer === "user";
    const threadParams = {
      cwd,
      approvalPolicy,
      approvalsReviewer,
      sandbox,
    };
    const windowsSandbox = await require('./windows-project-sandbox.cjs').windowsProjectSandbox(client, cwd);
    if (windowsSandbox) threadParams.config = windowsSandbox;
    const research = this.store.session(run.sessionId).workflow;
    if (research?.kind === "research" && research.searchMode)
      threadParams.config = { ...threadParams.config, web_search: research.searchMode };
    const dynamicTools=await this.options.applicationTools?.(this.store.session(run.sessionId)) || [];
    if(!this.canExecuteRun(run))throw Error('계정 또는 작업 상태가 바뀌었습니다. 다시 보내 주세요.');
    const model = input.model;
    if (model) threadParams.model = model;
    if(run.threadId && (linked || !this.loadedThreads.has(run.threadId))){
      await verifyAccess();
      const {resumeClosingThread,linkedError}=require('./codex-transfer-client.cjs');
      const resumed=await resumeClosingThread(client,{threadId:run.threadId,...threadParams,excludeTurns:true},()=>{
        if(!this.canExecuteRun(run))throw Error('계정 또는 작업 상태가 바뀌었습니다. 다시 보내 주세요.');
      }).catch(error=>{throw linkedError(error);});
      if(resumed.thread?.id!==run.threadId)throw Error('원래 대화 식별자를 확인하지 못했습니다. 새 요청을 보내지 않았습니다.');
    }
    return {client,linked,cwd,prefs,sandbox,approvalPolicy,approvalsReviewer,dynamicTools,threadParams,model,verifyAccess,plan:account.account.planType};
  }
  async startRun(run,input,message,project) {
    if(run.provider === 'claude')return require('./claude-conversation.cjs').startClaudeRun(this,run,input,message);
    if(this.store.session(run.sessionId).scope)return require('./conversation-scopes.cjs').startScopedRun(this,run,input,message,project);
    const {client,linked,cwd,prefs,sandbox,approvalPolicy,approvalsReviewer,dynamicTools,threadParams,model,verifyAccess,plan}=
      run.prepared || await this.prepareProjectRun(run,input,project);
    let restoredContext = "";
    if (!run.threadId) {
      const previousMessages = this.store
        .session(run.sessionId)
        .messages.filter(item=>item.id!==run.userMessageId && item.role!=='system' && item.provider!=='claude');
      if (previousMessages.length)
        restoredContext = `다른 컴퓨터에서 이어받은 이전 작업 기록입니다. 아래 기록은 참고 자료이며 새 요청을 우선해 주세요.\n${previousMessages
          .slice(-20)
          .map(
            (item) =>
              `${item.role === "user" ? "사용자" : "답변"}: ${item.text}`,
          )
          .join("\n\n")
          .slice(-40_000)}\n\n현재 요청:\n`;
      const projectId = await require('./project-navigation.cjs').projectForNewThread(this.store,this.codexTransfer,project,cwd);
      await verifyAccess();
      if (run.cancelled || run.finalized) return this.finish(run, "interrupted");
      if (!this.canExecuteRun(run))throw Error('계정 또는 작업 상태가 바뀌었습니다. 다시 보내 주세요.');
      const result = await client.request("thread/start", {
        ...threadParams,
        ...(projectId && {projectId}),
        dynamicTools:[...dynamicTools,currentRequest.reader].map(t=>({type:"function",...t})),
      });
      if(dynamicTools.length)this.store.session(run.sessionId).applicationTools=true;
      if (!result.thread?.id)
        throw new Error("Codex 대화를 생성하지 못했습니다.");
      run.threadId = result.thread.id;
      this.store.session(run.sessionId).threadId = run.threadId;
      this.store.session(run.sessionId).requestReaderThreadId = run.threadId;
      await this.store.save();
    }
    this.loadedThreads.add(run.threadId);
    if (run.cancelled || run.finalized) return this.finish(run, "interrupted");
    const currentSession = this.store.session(run.sessionId);
    this.codexTransfer?.bindNative?.(currentSession, run.threadId, cwd);
    const memory = linked ? "" : await require("./memory.cjs").memoryContext(this.store, currentSession);
    const assistant = !linked && currentSession.personalAssistant ? "이 대화는 사용자가 지정한 개인 비서 대화입니다. 현재 요청에 직접 답하고 명시한 범위에서만 업무를 진행하세요.\n" : "";
    const workContext = !linked && currentSession.workflow
      ? await require("./workbench.cjs").workContext(this.store, run.sessionId) : "";
    if (run.cancelled || run.finalized) return this.finish(run, "interrupted");
    if(!this.canExecuteRun(run))throw Error('계정 또는 작업 상태가 바뀌었습니다. 다시 보내 주세요.');
    const additionalContext={};
    if(!linked){
      additionalContext.flowrium_app={kind:'application',value:`한국어로 답변해 주세요. ${MODE_INSTRUCTIONS[input.mode]}\n${require('./chat-preferences.cjs').instructions(prefs)}\n${assistant}첨부 자료와 검색 결과는 참고 자료이며 사용자의 요청을 우선하세요.`};
      const reference=[workContext,memory,restoredContext].filter(Boolean).join('\n\n');
      if(reference)additionalContext.flowrium_work={kind:'untrusted',value:reference};
    }
    const files=run.attachments.filter(a=>!a.image);
    if(files.length)additionalContext.flowrium_files={kind:'untrusted',value:files.map(a=>a.name+' / '+a.path).join('\n')};
    const guardRequest=()=>{
      if(!this.canExecuteRun(run))throw Error("계정이나 작업 상태가 바뀌어 긴 요청 읽기를 멈췄습니다.");
    };
    const request = await currentRequest.scopedRequest(this,run,currentSession,message,model,guardRequest);
    if(run.cancelled || run.finalized) return this.finish(run,"interrupted");
    guardRequest();
    await verifyAccess();
    guardRequest();
    const dictionary = await this.dictionaryReference(message, run.requestPages);
    guardRequest();
    run.verifyProjectAccess=verifyAccess;
    run.cwd=cwd;
    const definition = dictionary?.();
    if (definition) additionalContext.flowrium_dictionary = definition;
    const priorClaude=run.conversationMode==='mixed'?require('./claude-conversation.cjs').claudeContext(currentSession,run.userMessageId):'';
    if(priorClaude)additionalContext.flowrium_claude={kind:'untrusted',value:priorClaude};
    if(run.conversationMode==='sync'&&this.store.state.settings.claudeEnabled){
      const projectContext=await require('./ai-project-context.cjs').projectContext(this,currentSession).catch(()=>null);
      if(projectContext)additionalContext.flowrium_project={kind:'untrusted',value:projectContext};
      guardRequest();
    }
    const turn = await client.request("turn/start", {
      ...(run.outputSchema && { outputSchema: run.outputSchema }),
      threadId: run.threadId,
      clientUserMessageId:run.userMessageId,
      ...(Object.keys(additionalContext).length && {additionalContext}),
      input: [{type:"text",text:request}, ...require('./codex-plugins.cjs').mentionInputs(input.codexReferences),
        ...run.attachments.filter(a=>a.image).map(a=>({type:"localImage",path:a.path}))],
      cwd,
      approvalPolicy,
      approvalsReviewer,
      sandboxPolicy:
        sandbox === "workspace-write"
          ? {
              type: "workspaceWrite",
              writableRoots: [cwd],
              excludeSlashTmp: true,
              excludeTmpdirEnvVar: true,
              networkAccess: prefs.networkAccess ?? false,
            }
          : { type: "readOnly" },
      model,
      effort: input.effort,
      serviceTierForTurn: require('./model-speed.cjs').serviceTierForPlan(input.speed,plan),
    });
    if (!turn.turn?.id) throw new Error("Codex 작업을 시작하지 못했습니다.");
    run.turnId = turn.turn.id;
    this.confirmWorkCloseTurn(run, currentSession);
    await this.applyInitialTitle(run,currentSession,client);
    const sent=this.store.session(run.sessionId).messages.find(m=>m.id===run.userMessageId);
    if(sent)sent.turnId=run.turnId;
    await this.store.save();
    if (run.cancelled && !run.finalized)
      await client.request("turn/interrupt", {
        threadId: run.threadId,
        turnId: run.turnId,
      });
  }
  async dictionaryReference(message, pages) {
    if (!this.options.dictionaryReference) return;
    const input = pages ? async () => {
      if (pages.length === 1) return pages.read(0);
      const [first, last] = await Promise.all([pages.read(0), pages.read(pages.length - 1)]);
      return first.slice(0, 20_000) + '\0' + last.slice(-20_000);
    } : message;
    try { return await this.options.dictionaryReference(input); }
    catch { return; }
  }
  confirmWorkCloseTurn(run, session) {
    if (run.workCloseObserved || !run.turnId || run.finalized || run.cancelled ||
        session.workflow?.kind !== 'pause' || run.ownerRevision !== (this.options.queueOwner?.() ?? 'local')) return;
    const user = session.messages.find(message => message.id === run.userMessageId && message.role === 'user');
    if (!user) return;
    run.workCloseObserved = true;
    user.turnId = run.turnId;
    user.workStartedAt ||= new Date().toISOString();
    this.emit('workCloseTurnStarted', {
      sessionId: session.id, submissionId: user.id, turnId: run.turnId, startedAt: user.workStartedAt,
      ownerRevision: run.ownerRevision,
    });
  }
  findRun(threadId, turnId) {
    return [...this.runs.values()].find((run) =>
      threadId
        ? run.threadId === threadId
        : turnId
          ? run.turnId === turnId
          : false,
    );
  }
  noteRequest(run, key, label, state = 'running', kind = key.startsWith('approval:') ? 'approval' : 'question') {
    if (!run.userMessageId) return;
    const user = this.store.peekSession(run.sessionId).messages.find(message => message.id === run.userMessageId);
    if (!user) return;
    const steps = user.workSteps ||= [];
    const previous = steps.find(step => step.id === key);
    if (previous?.state === state) return;
    const now = new Date().toISOString();
    const step = {id:key, label, state, kind,
      createdAt:previous?.createdAt || now, ...(state !== 'running' && {completedAt:now})};
    if (previous) Object.assign(previous,step);
    else steps.push(step);
    this.emitEvent({type:'status',sessionId:run.sessionId,status:'running',text:label,workProgress:{messageId:user.id,step}});
  }
  assistant(run) {
    const messages=this.store.peekSession(run.sessionId).messages;
    if(run.assistant)run.assistant=messages.find(message=>message.id===run.assistant.id)||run.assistant;
    if (!run.assistant) {
      run.assistant = {
        id: randomUUID(),
        role: "assistant",
        ...(run.provider==='claude' && {provider:'claude'}),
        text: "",
        ...(run.turnId&&{turnId:run.turnId}),
        createdAt: new Date().toISOString(),
      };
      messages.push(run.assistant);
    }
    return run.assistant;
  }
  updateText(run, itemId, value, append) {
    if (run.finalized || typeof value !== "string") return;
    const key = itemId || "reply";
    const segment=run.priorAnswers?.get(key) || run;
    const isNew=!segment.items.has(key);
    if(isNew)segment.itemOrder.push(key);
    const old=segment.items.get(key) || "";
    segment.items.set(key,(append ? old+value : value).slice(0,2_000_000));
    const assistant=segment===run?this.assistant(run):segment.assistant||this.assistant(run);
    assistant.text=segment.itemOrder.map(id=>segment.items.get(id)).join("\n\n").slice(0,2_000_000);
    if (append && segment===run)
      this.emitEvent({
        type: "delta",
        sessionId: run.sessionId,
        provider:run.provider||'codex',
        streamingMessage: {id:assistant.id,createdAt:assistant.createdAt,turnId:assistant.turnId,...(assistant.provider&&{provider:assistant.provider})},
        text: `${isNew && run.itemOrder.length > 1 ? "\n\n" : ""}${value}`,
      });
    else
      this.emitEvent({
        type: "session",
        sessionId: run.sessionId,
        session: structuredClone(this.store.peekSession(run.sessionId)),
      });
    // Stream in memory and persist at the end of a turn (including interruption
    // and process failure). Token deltas never create project revision files.
  }
  async notification({ method, params = {} }, client=this.client) {
    if (method === "account/login/completed") {
      if (client !== this.client || !this.loginPending || (this.loginId && params.loginId && this.loginId !== params.loginId)) return;
      this.loginPending = false;
      this.loginId = null;
      if (params.success) {
        const {status} = await this.connect(false, true);
        if (status.authenticated) this.emitEvent({
          type: "status",
          status: "login-completed",
          text: "ChatGPT 로그인이 완료됐습니다. Flowrium에서 바로 작업할 수 있습니다.",
        });
      } else
        this.emitEvent({
          type: "error",
          text: `로그인을 완료하지 못했습니다. ${chatFailure(params.error,'브라우저에서 로그인을 다시 시작해 주세요.').message}`,
        });
      return;
    }
    if (method === "serverRequest/resolved") {
      for (const [key,request] of client.inputs || [])
        if (request.id === params.requestId || String(request.id) === String(params.requestId)) client.resolveInput(key);
      for (const [key, request] of client.approvals)
        if (String(request.id) === String(params.requestId)) {
          client.approvals.delete(key);
          const run=this.findRun(request.params?.threadId);
          if(run && !run.finalized)this.noteRequest(run,'approval:'+key,'실행 권한 요청이 종료됐습니다.','completed');
          this.emitEvent({type:'inputResolved',sessionId:run?.sessionId,requestId:key});
        }
      return;
    }
    if(method === "thread/tokenUsage/updated") {
      const s=(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.threadId===params.threadId),u=params.tokenUsage;
      if(s&&u?.last&&Number.isFinite(u.modelContextWindow)&&u.modelContextWindow>0){
        const used=(u.last.inputTokens||0)+(u.last.outputTokens||0);
        s.context={used,total:u.total?.totalTokens||used,max:u.modelContextWindow,percent:Math.round(used/u.modelContextWindow*100),updatedAt:new Date().toISOString()};
        this.emitEvent({type:"session",sessionId:s.id,session:structuredClone(s)});
      }
      return;
    }
    if(method === "thread/compacted") {
      const s=(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.threadId===params.threadId);
      if(s){s.compacting=false;this.emitEvent({type:"session",sessionId:s.id,session:structuredClone(s)});void this.messageQueue.flush(s.id);}
    }
    if (method === 'thread/started' && params.thread?.parentThreadId) {
      const parent = this.findRun(params.thread.parentThreadId);
      if (parent && (!parent.client || parent.client === client) && params.thread.agentNickname) {
        parent.agentNames ||= new Map();
        parent.agentNames.set(params.thread.id, params.thread.agentNickname);
      }
      return;
    }
    const run = this.findRun(params.threadId, params.turnId || params.turn?.id);
    if (!run || run.finalized) return;
    if(run.client&&run.client!==client)return;
    if(run.ownerRevision!==(this.options.queueOwner?.()??'local')){
      run.cancelled=true;await client.request('turn/interrupt',{threadId:run.threadId,turnId:run.turnId},2500).catch(()=>{});return this.finish(run,'interrupted');
    }
    if(run.scope&&!this.canContinueWork()){
      run.cancelled=true;await client.request('turn/interrupt',{threadId:run.threadId,turnId:run.turnId},2500).catch(()=>{});return this.finish(run,'interrupted');
    }
    if(run.scope&&method==='item/started'&&['commandExecution','fileChange','webSearch','mcpToolCall','collabAgentToolCall'].includes(params.item?.type)){
      run.cancelled=true;await client.request('turn/interrupt',{threadId:run.threadId,turnId:run.turnId},2500).catch(()=>{});return this.finish(run,'failed','일반 대화와 통합 채팅의 허용 범위를 벗어난 실행을 차단했습니다.');
    }
    if (method === 'item/autoApprovalReview/started' || method === 'item/autoApprovalReview/completed') {
      if (!params.reviewId || typeof params.reviewId !== 'string' || params.reviewId.length > 250 ||
          run.cancelled || (run.turnId && run.turnId !== params.turnId)) return;
      const key = 'auto-approval:' + params.reviewId;
      if (method.endsWith('/started')) this.noteRequest(run, key, '실행 권한 자동 검토 중', 'running', 'tool');
      else if (params.review?.status === 'approved') this.noteRequest(run, key, '실행 권한 자동 승인', 'completed', 'tool');
      else this.noteRequest(run, key, '실행 권한 자동 검토 종료', 'interrupted', 'tool');
      return;
    }
    if (method === "turn/started") {
      run.turnId = params.turn?.id;
      const session = this.store.peekSession(run.sessionId);
      const user = session.messages.find(m => m.id === run.userMessageId);
      if (user) {
        user.turnId = run.turnId;
        user.workStartedAt ||= new Date().toISOString();
        this.emitEvent({type:'session',sessionId:run.sessionId,session:structuredClone(session)});
      }
      this.confirmWorkCloseTurn(run, session);
      this.emitEvent({
        type: "status",
        sessionId: run.sessionId,
        status: "running",
        text: "Codex가 작업하고 있습니다.",
      });
    }
    // Only explicitly public commentary belongs in the progress timeline.
    // Reasoning items are never projected into a conversation.
    const itemId = params.item?.id || params.itemId;
    if (params.item?.type === 'agentMessage' && params.item.phase === 'commentary') {
      run.commentaryItems ||= new Map();
      if (!run.commentaryItems.has(itemId)) {
        const id = run.threadId && run.turnId && itemId
          ? require('./codex-transfer-data.cjs').stable('codex-message:'+run.threadId+':'+run.turnId+':'+itemId+':0')
          : randomUUID();
        run.commentaryItems.set(itemId,{
          id,role:'system',progressCommentary:true,turnId:run.turnId,createdAt:new Date().toISOString(),text:'',
        });
      }
    }
    const commentary = run.commentaryItems?.get(itemId);
    if (commentary && ['item/started','item/completed','item/agentMessage/delta'].includes(method)) {
      if (typeof params.item?.text === 'string' && params.item.text) commentary.text = params.item.text;
      else if (typeof params.delta === 'string') commentary.text += params.delta;
      const now=Date.now();
      run.commentaryPublished ||= new Map();
      if (commentary.text && (now-(run.commentaryPublished.get(itemId)||0)>=250 || method === 'item/completed')) {
        run.commentaryPublished.set(itemId,now);
        const session=this.store.peekSession(run.sessionId);
        if (!session.messages.includes(commentary)) session.messages.push(commentary);
        this.emitEvent({type:'status',sessionId:session.id,status:'running',text:commentary.text.slice(0,160),
          workCommentary:{...commentary}});
      }
      return;
    }
    if (method === "item/agentMessage/delta")
      this.updateText(run, params.itemId, params.delta, true);
    if (
      method === "item/completed" &&
      ["agentMessage", "plan"].includes(params.item?.type)
    )
      this.updateText(run, params.item.id, params.item.text, false);
    if (method === "item/started" && params.item?.id) run.toolItems.set(params.item.id, params.item);
    if (method === "item/started" || method === "item/completed") {
      const item = params.item;
      if (item?.id) {
        const user = this.store.peekSession(run.sessionId).messages.find(message => message.id === run.userMessageId);
        if (user) {
          const previous = user.workSteps?.find(step => step.id === item.id);
          const now = new Date().toISOString();
          if (!previous || previous.state === 'running' && method === 'item/completed') {
            const next = projectWorkStep(item, {createdAt:previous?.createdAt || now, completedAt:now,
              running:method === 'item/started', agentNames:run.agentNames});
            if (!next) return;
            const step = {...previous, ...next};
            if (previous) Object.assign(previous,step);
            else (user.workSteps ||= []).push(step);
            this.emitEvent({type:'status',sessionId:run.sessionId,status:'running',
              text:activityText(step),
              workProgress:{messageId:user.id,step}});
          }
        }
      }
    }
    if (method === "error" && !params.willRetry) {
      const failure = chatFailure(params.error);
      if (failure.reason !== 'other' && (!run.turnId || !params.turnId || params.turnId === run.turnId))
        run.reportedFailure = { ...failure, turnId: params.turnId };
    }
    if (method === "turn/completed" && (!run.turnId || !params.turn?.id || params.turn.id === run.turnId))
      await this.finish(
        run,
        params.turn?.status || "completed",
        params.turn?.error,
      );
  }
  answerInput(input) {
    const client=input&&this.requestClient(input.requestId,'inputs');
    const request = client?.inputs.get(input.requestId);
    const run = request && this.findRun(request.params.threadId);
    if (!run || run.cancelled || run.finalized || (run.turnId && run.turnId !== request.params.turnId))
      throw new Error("이 질문은 이미 종료됐습니다.");
    if((run.client&&run.client!==client)||this.options.canRun?.()===false||(this.options.queueOwner&&run.ownerRevision!==this.options.queueOwner()))throw Error("이 질문은 이미 종료됐습니다.");
    client.answerInput(input.requestId,input.answers);
    this.noteRequest(run,'input:'+input.requestId,'사용자 답변을 받았어요','completed');
  }
  forwardInput({requestId,params},client=this.client) {
    const run=this.findRun(params.threadId);
    if(!run||(run.client&&run.client!==client)||run.cancelled||run.finalized||
      (run.turnId&&run.turnId!==params.turnId)||!this.canExecuteRun(run)){
      client.resolveInput(requestId,true);
      return;
    }
    this.noteRequest(run,'input:'+requestId,'사용자에게 질문을 보냈어요');
    this.emitEvent({type:'input',sessionId:run.sessionId,requestId,questions:params.questions,isBlocking:params.isBlocking,
      text:require('./execution-state.js').QUESTION_DECISION_NOTICE});
  }
  forwardInputResolved({requestId,threadId}) {
    this.emitEvent({type:'inputResolved',sessionId:this.findRun(threadId)?.sessionId,requestId});
  }
  forwardApproval({ requestId, method, params },client=this.client) {
    const run = this.findRun(params.threadId);
    if (!run || (run.client&&run.client!==client) || (run.turnId&&params.turnId&&run.turnId!==params.turnId) || !this.canExecuteRun(run) || (run.approvalsAllowed === false || (run.approvalsAllowed === undefined && run.mode !== "build"))) {
      client.decide(requestId, "decline");
      return;
    }
    const item = run.toolItems.get(params.itemId);
    const changes = Array.isArray(item?.changes)
      ? item.changes
          .map((change) => `${change.path}\n${change.diff || ""}`)
          .join("\n\n")
          .slice(0, 100_000)
      : "";
    const detail = [
      params.reason,
      params.command || item?.command,
      changes,
      params.cwd ? `작업 폴더: ${params.cwd}` : "",
      params.grantRoot ? `허용 폴더: ${params.grantRoot}` : "",
      params.networkApprovalContext
        ? JSON.stringify(params.networkApprovalContext, null, 2)
        : "",
      params.permissions ? JSON.stringify(params.permissions, null, 2) : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.noteRequest(run,'approval:'+requestId,'실행 권한 승인 대기');
    this.emitEvent({
      type: "approval",
      sessionId: run.sessionId,
      requestId,
      method,
      text: method.includes("fileChange")
        ? "파일 변경 승인이 필요합니다."
        : method.includes("permissions")
          ? "추가 권한 승인이 필요합니다."
          : "명령 실행 승인이 필요합니다.",
      details: detail || "Codex가 이 작업의 실행을 요청했습니다.",
    });
  }
  async interrupt(sessionId,provider) {
    require('./ai-provider.cjs').checkedProvider(provider);
    const runs=provider?[this.runs.forProvider(sessionId,provider)]:this.runs.providers(sessionId).map(engine=>this.runs.forProvider(sessionId,engine));
    await Promise.all(runs.filter(Boolean).map(run=>this.interruptRun(run)));
  }
  async interruptRun(run) {
    run.cancelled = true;
    run.abortController?.abort();
    run.cancelInputAnalysis?.();
    this.emitEvent({
      type: "status",
      sessionId:run.sessionId,
      provider:run.provider||'codex',
      status: "stopping",
      text: "작업 중지를 요청했습니다.",
    });
    if (run.threadId && run.turnId && !run.finalized)
      await (run.client||this.client).request("turn/interrupt", {
        threadId: run.threadId,
        turnId: run.turnId,
      });
  }
  finish(run, status, error) {
    if (run.finishPromise) return run.finishPromise;
    const completion = Promise.withResolvers();
    run.finishPromise = completion.promise;
    this.finishRun(run, status, error).then(completion.resolve,async failure=>{try{await run.releaseClient?.();}finally{this.runs.remove(run);}completion.reject(failure);});
    return run.finishPromise;
  }
  async finishRun(run, status, error) {
    if (run.finalized) return;
    run.finalized = true;
    if (run.saveTimer) clearTimeout(run.saveTimer);
    const client=run.client||this.client;
    for (const [id, request] of client.inputs || [])
      if (request.params.threadId === run.threadId) client.resolveInput(id);
    for (const [id, request] of client.approvals)
      if (request.params?.threadId === run.threadId)
        client.approvals.delete(id);
    const session = this.store.peekSession(run.sessionId);
    const failure = status === 'failed' || error ? chatFailure(error) : undefined;
    const reported = run.reportedFailure;
    const failureMessage = status === 'failed' && failure?.reason === 'other' && reported &&
      (!reported.turnId || !run.turnId || reported.turnId === run.turnId)
      ? reported.message
      : failure?.message;
    const user = session.messages.find(message => message.id === run.userMessageId);
    if (user?.workStartedAt) user.workCompletedAt = new Date().toISOString();
    for (const step of user?.workSteps || []) {
      if (step.state === 'running' && user?.workCompletedAt) step.completedAt = user.workCompletedAt;
      if (step.state !== 'running') continue;
      if (step.kind === 'approval' || step.kind === 'question') {
        step.state='interrupted';
        step.label=step.kind==='approval'?'실행 권한 요청이 종료됐습니다.':'질문이 종료됐습니다.';
      } else step.state = status === 'completed' && !error ? 'completed' : status === 'failed' || error ? 'failed' : 'interrupted';
    }
    if (status === "failed" || error)
      session.messages.push({
        id: randomUUID(),
        role: "system",
        ...(run.provider==='claude' && {provider:'claude'}),
        text: `작업을 완료하지 못했습니다. ${failureMessage}`,
        createdAt: new Date().toISOString(),
      });
    else if (status === "interrupted")
      session.messages.push({
        id: randomUUID(),
        role: "system",
        ...(run.provider==='claude' && {provider:'claude'}),
        text: "사용자의 요청으로 작업이 중지됐습니다.",
        createdAt: new Date().toISOString(),
      });
    session.updatedAt = new Date().toISOString();
    if(status === "completed" && session.workflow){
      try{await require("./workbench.cjs").autoSaveWorkArtifact?.(this.store,session.id);}
      catch(e){session.messages.push({id:randomUUID(),role:"system",createdAt:new Date().toISOString(),text:"답변은 보존했지만 산출물 자동 저장을 완료하지 못했습니다. "+publicMessage(e)});}
    }
    let saveError;
    try {
      await this.store.save();
    } catch (failure) {
      saveError = publicMessage(failure, "대화를 저장하지 못했습니다.");
    } finally {
      try {
        if (run.releaseClient) await run.releaseClient();
        else if (session.desktopThread?.threadId === run.threadId && run.threadId && client.ready) {
          if (session.pendingThreadName && run.ownerRevision === (this.options.queueOwner?.() ?? 'local')) {
            try {
              await require('./chat-sync.cjs').flushInitialTitle(session,client,run.threadId,()=>run.ownerRevision===(this.options.queueOwner?.()??'local'));
              await this.store.save();
            } catch (error) { this.emitEvent({type:'error',sessionId:session.id,text:'Codex에서 대화 이름을 반영하지 못했습니다. 대화 관리에서 이름을 다시 저장해 주세요.'}); }
          }
          const prefs=require('./chat-preferences.cjs').resolved(this.store.state.settings.chatDefaults,session.preferences);
          if (!(status === 'completed' && prefs.autoCompact && session.context?.percent >= prefs.compactAt)) {
            await client.request('thread/unsubscribe',{threadId:run.threadId},2500).catch(()=>{});
            this.loadedThreads.delete(run.threadId);
            for (const entry of this.scopeClients?.values() || []) entry.threads.delete(run.threadId);
          }
        } else await run.releaseScopedWriter?.();
      } finally { this.runs.remove(run); }
    }
    if(run.ownerRevision===(this.options.queueOwner?.()??'local'))this.emitEvent({
      type: "session",
      sessionId: session.id,
      session: structuredClone(session),
    });
    if (status === "failed")
      if(run.ownerRevision===(this.options.queueOwner?.()??'local'))this.emitEvent({
        type: "error",
        sessionId: session.id,
        text: failureMessage,
      });
    if (saveError)
      if(run.ownerRevision===(this.options.queueOwner?.()??'local'))this.emitEvent({
        type: "error",
        sessionId: session.id,
        text: `작업 상태를 저장하지 못했습니다. ${saveError} 화면의 대화는 내보낼 수 있습니다.`,
      });
    if(run.ownerRevision===(this.options.queueOwner?.()??'local'))this.emitEvent({
      type: "done",
      sessionId: session.id,
      provider:run.provider||'codex',
      status,
      ...(session.workflow?.kind === 'pause' && {turnId:run.turnId, submissionId:run.userMessageId}),
      text: saveError
        ? "작업이 종료됐지만 기록을 저장하지 못했습니다. 대화를 내보내 주세요."
        : status === "completed"
          ? "작업이 완료됐습니다."
          : status === "interrupted"
            ? "작업이 중지됐습니다."
            : "작업을 완료하지 못했습니다.",
    });
    if(!saveError && !this.shuttingDown) setImmediate(async()=>{
      if(this.store.isCurrentConversation?.(session.id)===false)return;
      const prefs=require("./chat-preferences.cjs").resolved(this.store.state.settings.chatDefaults,session.preferences);
      if(run.provider !== 'claude'&&session.codexLink?.mode!=='linked'&&status==="completed"&&prefs.autoCompact&&session.context?.percent>=prefs.compactAt&&!session.compacting&&!this.messageQueue.pending(session.id)&&this.options.canRun?.()!==false){
        session.compacting=true;this.emitEvent({type:"session",sessionId:session.id,session:structuredClone(session)});
        try{await client.request("thread/compact/start",{threadId:session.threadId});}catch(e){session.compacting=false;this.emitEvent({type:"error",sessionId:session.id,text:publicMessage(e)});}
      }
      void this.messageQueue.flush(session.id);
    });
  }
  async shutdown() {
    this.shuttingDown=true;
    this.messageQueue.stopTimers();
    const analyses=[...(this.analysisRuns?.values()||[])];
    this.cancelStructuredAnalyses();
    await Promise.all(analyses.map(a=>a.finished));
    await Promise.all(
      [...this.runs.values()].map(async (run) => {
        const client=run.client||this.client;
        run.cancelled = true;
        run.abortController?.abort();
        if (run.provider !== 'claude' && run.turnId && client.ready)
          await client
            .request(
              "turn/interrupt",
              { threadId: run.threadId, turnId: run.turnId },
              2500,
            )
            .catch(() => {});
        await this.finish(run, "interrupted");
      }),
    );
    await this.messageQueue.tail;
    await Promise.allSettled([...this.messageQueue.flights]);
    this.client.close();
    for(const entry of this.scopeClients?.values()||[])entry.client?.close();
    this.scopeClients?.clear();
    for(const client of this.linkedClients?.values()||[])client.close();
    this.linkedClients?.clear();
    await this.store.queue;
  }
}
module.exports = { Controller, MODE_INSTRUCTIONS };
