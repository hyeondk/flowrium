const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { UUID, readJSON } = require("./project-store.cjs");
const run = promisify(execFile);
const copy = value => structuredClone(value);
const invalid = () => new Error("업무 연결과 알림 요청의 형식을 확인해 주세요.");
const stale = () => new Error("업무 연결 기록이나 계정이 바뀌었습니다. 최신 목록을 열고 다시 시도해 주세요.");
function text(value, max = 12000, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if(typeof value!=="string"||!value.trim()||value.length>max||value.includes("\0"))throw invalid();
  return value.trim();
}
function id(value){if(!UUID.test(value))throw invalid();return value;}
function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw invalid();return value;}
function preferences(input,current={}){
  const next={enabled:false,aiReports:true,github:false,mail:false,intervalMinutes:60,startHour:9,endHour:18,
    weekdays:[1,2,3,4,5],timezone:"Asia/Seoul",projectId:null,...current};
  if(!input||typeof input!=="object"||Array.isArray(input))throw invalid();
  for(const [key,value] of Object.entries(input)){
    if(["enabled","aiReports","github","mail"].includes(key)){if(typeof value!=="boolean")throw invalid();next[key]=value;}
    else if(key==="intervalMinutes")next[key]=integer(value,5,1440);
    else if(["startHour","endHour"].includes(key))next[key]=integer(value,0,23);
    else if(key==="weekdays"){
      if(!Array.isArray(value)||value.length>7||new Set(value).size!==value.length)throw invalid();
      next[key]=value.map(n=>integer(n,0,6));
    }else if(key==="timezone"){
      const zone=text(value,100);try{new Intl.DateTimeFormat("ko-KR",{timeZone:zone}).format();}catch{throw invalid();}next[key]=zone;
    }else if(key==="projectId")next[key]=value===null?null:id(value);
    else throw invalid();
  }
  return next;
}
function fresh(){return{version:1,revision:0,notifications:[],proposals:[],deliveries:[],reminders:[],reports:[],recommendations:[],goalFirings:[],toolCalls:[],preferences:preferences({}),lastReport:0,quota:[]};}
const objectSchema = properties => ({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const string = description=>({type:"string",description});
const TOOL_SPECS = [
  {name:"flowrium_chat_list",description:"연결된 프로젝트의 최근 대화 목록. 다른 대화에 업무를 전하라는 사용자의 지시가 있을 때 대상 id를 찾습니다.",inputSchema:objectSchema({query:string("제목 또는 프로젝트 이름 검색. 전체 목록은 빈 문자열")})},
  {name:"flowrium_chat_send",description:"다른 대화에 필요한 메시지를 한 번 전달합니다. 받는 대화가 작업 중이면 끝난 뒤 전달합니다. 무한 왕복이나 불필요한 재촉에 사용하지 마세요.",inputSchema:objectSchema({targetId:string("받는 대화 id"),text:string("전할 내용과 필요한 근거")})},
  {name:"flowrium_session_request",description:"다른 대화 또는 새 대화에 조사/작업을 요청합니다. 사용자가 결정함에서 승인해야 실행되며 완료 결과를 원대화로 한 번 돌려줍니다.",inputSchema:objectSchema({targetId:string("기존 대화 id. 새 대화에 맡기려면 빈 문자열"),title:string("요청 제목"),text:string("구체적인 목표와 완료 기준")})},
  {name:"flowrium_memory_list",description:"현재 프로젝트와 기기에 저장한 장기 기억을 읽습니다.",inputSchema:objectSchema({query:string("제목 또는 본문 검색. 전체는 빈 문자열")})},
  {name:"flowrium_memory_save",description:"사용자가 기억해 달라고 지정했거나 확인한 프로젝트 지식만 저장합니다. 암호·인증정보는 저장하지 않습니다. 기존 메모를 바꿀 때 list에서 받은 id/revision을 그대로 사용합니다.",inputSchema:objectSchema({scope:{type:"string",enum:["project","personal"]},id:string("새 기억은 빈 문자열"),revision:string("새 기억은 빈 문자열"),title:string("제목"),body:string("확인한 장기 기억"),role:string("역할을 한정할 때 이름. 공통은 빈 문자열")})},
  {name:"flowrium_reminder_add",description:"사용자가 요청한 시각의 알림을 등록합니다. 앱이 켜져 있고 잠금이 해제됐을 때 알림을 전달하며 놓친 알림은 다음 실행 때 한 번 전달합니다.",inputSchema:objectSchema({when:string("시간대가 포함된 ISO8601 시각"),text:string("알림 내용"),repeatDays:{type:"integer",minimum:0,maximum:365,description:"반복하지 않으면 0, 매일은 1, 매주는 7"}})},
  {name:"flowrium_reminder_list",description:"아직 취소하지 않은 예약 알림과 최근 전달 상태를 조회합니다.",inputSchema:objectSchema({})},
  {name:"flowrium_reminder_cancel",description:"사용자가 취소하라고 지정한 알림을 취소합니다.",inputSchema:objectSchema({id:string("알림 id")})},
  {name:"flowrium_secretary_notify",description:"필요한 업무 결과를 개인 비서에게 한 번 알립니다. 사용자가 요청했거나 위임한 업무의 결과를 전할 때만 사용합니다.",inputSchema:objectSchema({text:string("알릴 결과와 근거")})},
  {name:"flowrium_team_list",description:"현재 프로젝트의 등록한 역할 팀과 최근 팀 업무를 확인합니다.",inputSchema:objectSchema({})},
  {name:"flowrium_team_assign",description:"팀에 새 업무를 맡기거나 진행 중 팀원에게 추가 지시를 전달할 제안을 만듭니다. 사용자가 결정함에서 승인해야 실행됩니다.",inputSchema:objectSchema({teamId:string("등록한 팀 id"),runId:string("기존 팀 업무 id. 새 업무는 빈 문자열"),index:{type:"integer",minimum:0,maximum:7,description:"기존 팀의 담당 역할 번호. 새 업무는 0"},text:string("맡길 구체적 과업"),automatic:{type:"boolean",description:"새 업무의 계획 후 자동 배부를 사용자가 명시한 경우만 true"}})},
  {name:"flowrium_repository_list",description:"현재 프로젝트의 저장소와 변경 파일을 읽습니다. 원격 변경을 실행하지 않습니다.",inputSchema:objectSchema({})},
  {name:"flowrium_repository_propose",description:"선택한 저장소 파일의 커밋/푸시/변경 요청/병합/업무완료를 검토할 계획으로 만듭니다. 결정함에서 사용자가 파일과 단계 내용을 승인해야만 실행합니다.",inputSchema:objectSchema({rows:{type:"array",maxItems:32,items:{type:"object",additionalProperties:false,required:["repositoryId","files","message","base","title","body","through"],properties:{repositoryId:string("조회한 저장소 id"),files:{type:"array",items:{type:"string"}},message:string("커밋 메시지"),base:string("대상 브랜치. 기본값은 빈 문자열"),title:string("변경 요청 제목"),body:string("변경 요청 본문"),through:{type:"string",enum:["commit","push","pr","merge","done"]}}}}})},
];

class WorkflowRuntime {
  constructor(store,controller,options={}){
    this.store=store;this.controller=controller;this.options=options;this.queue=Promise.resolve();this.record=null;
    this.owner=null;this.closed=false;this.transitions=0;this.runOwners=new Map();this.tickRunning=false;
    this.now=options.now||Date.now;
    this.listener=e=>{
      if(e.type==="status"&&e.status==="running")this.runOwners.set(e.sessionId,this.account());
      const owner=this.runOwners.get(e.sessionId);
      if(e.type==="done")this.runOwners.delete(e.sessionId);
      if(owner!==undefined&&owner!==this.account())return;
      if(["done","approval","input"].includes(e.type))void this.serial(()=>this.onEvent(e)).catch(error=>this.noticeError(error));
    };
    controller.on("event",this.listener);
    this.timer=setInterval(()=>{void this.tick().catch(error=>this.noticeError(error));},options.intervalMs||15000);
    this.timer.unref?.();
  }
  account(){return this.options.accountRevision?.()??0;}
  stamp(){return new Date(this.now()).toISOString();}
  ready(){if(this.closed||this.options.canRun?.()===false)throw new Error("잠금과 계정 전환 또는 앱 업데이트를 마친 뒤 실행해 주세요.");}
  noticeError(error){this.options.onError?.(error);}
  file(){return path.join(path.dirname(this.store.file),`workflow-${this.owner}.json`);}
  async load(){
    const account=this.account();
    if(account===this.owner&&this.record)return;
    integer(account,0,Number.MAX_SAFE_INTEGER);
    this.owner=account;
    try{
      const record=await readJSON(this.file());
      if(record?.version!==1||!Number.isSafeInteger(record.revision)||["notifications","proposals","deliveries","reminders","reports","quota"].some(k=>!Array.isArray(record[k])||record[k].length>10000))throw invalid();
      record.preferences=preferences(record.preferences);
      record.recommendations ||= [];record.goalFirings ||= [];record.toolCalls ||= [];
      for(const field of ["notifications","proposals","deliveries","reminders","reports"])for(const value of record[field])id(value.id);
      this.record=record;
      let changed=false;
      for(const p of record.proposals)if(p.status==="running"){
        p.status="held";p.result="이전 실행이 종료되기 전에 중단됐습니다. 중복 실행을 피하기 위해 직접 결과를 확인해 주세요.";p.revision++;changed=true;
      }
      for(const d of record.deliveries)if(d.status==="dispatching"){
        d.status="held";d.error="전달 도중 앱이 종료됐습니다. 대화 기록을 확인한 뒤 다시 전송하세요.";changed=true;
      }
      for(const report of record.reports)if(report.status==="writing"){
        report.status="failed";report.error="보고 작성 중 앱이 종료됐습니다. 보고 대화의 결과를 확인한 뒤 다시 요청하세요.";changed=true;
      }
      for(const recommendation of record.recommendations)if(recommendation.status==="running"){
        recommendation.status="failed";recommendation.error="이전 결정 추천이 중단됐습니다. 중복 실행하지 않았습니다.";changed=true;
      }
      if(changed)await this.save();
    }catch(error){if(error.code!=="ENOENT"){this.owner=null;this.record=null;throw error;}this.record=fresh();}
  }
  async save(){
    if(this.owner!==this.account())throw stale();
    this.record.revision++;
    const directory=path.dirname(this.store.file);await fs.mkdir(directory,{recursive:true,mode:0o700});
    const file=this.file(),temporary=file+"."+randomUUID()+".tmp";
    try{await fs.writeFile(temporary,JSON.stringify(this.record,null,2),{flag:"wx",mode:0o600});await fs.rename(temporary,file);}
    finally{await fs.rm(temporary,{force:true});}
  }
  serial(action){
    this.transitions++;
    const next=this.queue.catch(()=>{}).then(async()=>{await this.load();const owner=this.owner;const result=await action();if(owner!==this.account())throw stale();return result;});
    this.queue=next.catch(()=>{});
    return next.finally(()=>this.transitions--);
  }
  notification(kind,title,body,sessionId,group){
    const record={id:randomUUID(),kind,title:String(title).slice(0,200),body:String(body||"").slice(0,6000),sessionId:sessionId||null,
      group:group||sessionId||kind,createdAt:this.stamp(),readAt:null};
    this.record.notifications.unshift(record);
    this.record.notifications=this.record.notifications.slice(0,2000);
    try{Promise.resolve(this.options.notify?.(record)).catch(error=>this.noticeError(error));}catch(error){this.noticeError(error);}
    return record;
  }
  async state(){
    return this.serial(async()=>{this.ready();return{...copy(this.record),pending:await this.options.pending?.()||[],
      projects:this.store.state.projects.map(p=>({id:p.id,name:p.name})),
      sessions:this.store.state.sessions.slice(0,200).map(s=>({id:s.id,projectId:s.projectId,title:s.title,running:this.controller.runs.has(s.id)}))};});
  }
  proposal(input){
    const source=input.sourceId?this.store.session(id(input.sourceId)):null;
    const projectId=input.projectId||source?.projectId||null;
    if(projectId)this.store.project(id(projectId));
    if(input.targetId)this.store.session(id(input.targetId));
    if(!["request","external","next","report","team"].includes(input.kind))throw invalid();
    const duplicate=input.key&&this.record.proposals.find(p=>p.key===input.key);
    if(duplicate)return duplicate;
    const p={id:randomUUID(),revision:1,key:input.key||null,kind:input.kind,title:text(input.title,180),body:text(input.body,16000,true),
      sourceId:source?.id||null,projectId,targetId:input.targetId||null,status:"pending",createdAt:this.stamp(),hidden:false,
      snoozedUntil:null,replyVia:input.replyVia==="assistant"?"assistant":"direct",method:input.method||null,args:input.args||null,preview:input.preview||null,result:""};
    if(this.record.proposals.filter(p=>p.status==="pending").length>=200)throw new Error("먼저 기존 결정 항목을 처리해 주세요.");
    this.record.proposals.unshift(p);
    this.notification("decision",p.title,p.body,p.sourceId,"결정");
    return p;
  }
  quota(sourceId){
    const now=this.now();this.record.quota=this.record.quota.filter(q=>now-q.at<600000);
    if(this.record.quota.filter(q=>q.sourceId===sourceId).length>=8)throw new Error("같은 대화에서는 10분에 8번까지만 다른 업무로 전달할 수 있습니다.");
    this.record.quota.push({sourceId,at:now});
  }
  async sendMessage(sourceId,targetId,body,options={}){
    this.ready();const source=sourceId?this.store.session(id(sourceId)):null,target=this.store.session(id(targetId));
    if(source?.id===target.id)throw new Error("같은 대화에는 추가 지시 입력창을 사용해 주세요.");
    if(this.record.deliveries.filter(d=>d.targetId===targetId&&d.status==="queued").length>=100)throw new Error("받는 대화의 대기 지시가 많습니다. 먼저 처리해 주세요.");
    if(this.record.deliveries.filter(d=>["queued","dispatching"].includes(d.status)).length>=500)throw new Error("먼저 전달 대기 중인 업무를 처리해 주세요.");
    const message={id:randomUUID(),sourceId:source?.id||null,targetId,text:text(body),createdAt:this.stamp(),status:"queued",kind:options.kind||"message",proposalId:options.proposalId||null,reportId:options.reportId||null};
    this.record.deliveries.unshift(message);
    const active=this.record.deliveries.filter(d=>["queued","dispatching"].includes(d.status));
    const history=this.record.deliveries.filter(d=>!["queued","dispatching"].includes(d.status)).slice(0,500);
    this.record.deliveries=[...active,...history].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    await this.save();
    await this.flush(target.id);
    return copy(message);
  }
  async flush(targetId){
    if(this.closed||this.options.canRun?.()===false||this.controller.runs.has(targetId)||this.controller.editingSessions?.has(targetId))return;
    const message=this.record.deliveries.findLast(d=>d.targetId===targetId&&d.status==="queued");
    if(!message)return;
    let target;
    try{target=this.store.session(targetId);}catch{message.status="failed";message.error="받는 대화가 삭제됐습니다.";await this.save();return;}
    if(target.workflow?.status==="done"){message.status="held";message.error="완료된 업무는 재개한 뒤 전달해 주세요.";await this.save();return;}
    const source=message.sourceId&&(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.id===message.sourceId);
    message.status="dispatching";message.before=target.messages.length;
    const report=message.reportId&&this.record.reports.find(r=>r.id===message.reportId);
    if(report){report.status="writing";report.sessionId=target.id;report.deliveryId=message.id;}
    await this.save();
    try{
      await this.controller.send({sessionId:targetId,text:`[Flowrium 업무 전달 / ${source?.title||"사용자"}]\n${message.text}`,mode:message.kind==='request'&&source?.scope==='integrated'?'build':target.workflow?.teamSlot?.mode||"plan"});
      message.status="sent";message.sentAt=this.stamp();
    }catch(error){message.status="failed";message.error=String(error.message).slice(0,2000);if(report){report.status="failed";report.error=message.error;}}
    await this.save();
  }
  async collect(){
    const projects=[];
    for(const project of this.store.state.projects){
      const sessions=this.store.state.sessions.filter(s=>s.projectId===project.id);
      const row={id:project.id,name:project.name,running:sessions.filter(s=>this.controller.runs.has(s.id)).length,
        open:sessions.filter(s=>s.workflow&&s.workflow.status!=="done").length,latest:sessions.slice(0,8).map(s=>({id:s.id,title:s.title,status:s.workflow?.status||"대화",updatedAt:s.updatedAt}))};
      try{const [status,commits]=await Promise.all([run("git",["status","--porcelain"],{cwd:project.path,timeout:5000,maxBuffer:200000}),
        run("git",["log","-6","--format=%h %s"],{cwd:project.path,timeout:5000,maxBuffer:200000})]);
        row.changedFiles=status.stdout.trim()?status.stdout.trim().split(/\r?\n/).length:0;row.commits=commits.stdout.trim().split(/\r?\n/).filter(Boolean);
      }catch{row.changedFiles=null;row.commits=[];}
      projects.push(row);
      if(this.options.readProjectDetails){
        try{const details=await this.options.readProjectDetails(project.id);row.goals=details.periodGoals||[];row.schedule=details.schedule||[];}
        catch(error){row.detailsError=String(error.message).slice(0,400);}
      }
    }
    const prefs=this.record.preferences;
    const external=(prefs.github||prefs.mail)&&this.options.collectExternal?await this.options.collectExternal({github:prefs.github,mail:prefs.mail}):null;
    return{at:this.stamp(),projects,external,pending:this.record.proposals.filter(p=>p.status==="pending"&&!p.hidden).length};
  }
  async report(reason="사용자 요청"){
    this.ready();const owner=this.owner,snapshot=await this.collect();if(owner!==this.account())throw stale();this.ready();
    const body=[reason,...snapshot.projects.map(p=>`${p.name} / 실행 ${p.running}개 / 미완료 ${p.open}개 / 변경 파일 ${p.changedFiles??"확인 필요"}개\n${p.commits.join("\n")}`),
      `결정 대기 / ${snapshot.pending}개`,snapshot.external&&JSON.stringify(snapshot.external)].filter(Boolean).join("\n\n");
    const record={id:randomUUID(),at:this.stamp(),reason,body:this.record.preferences.aiReports?"":body,evidence:{at:snapshot.at,projectIds:snapshot.projects.map(p=>p.id)},status:this.record.preferences.aiReports?"queued":"completed"};
    this.record.reports.unshift(record);this.record.reports=this.record.reports.slice(0,300);this.record.lastReport=this.now();
    if(!this.record.preferences.aiReports)this.notification("report","프로젝트 현황 원문",body,null,"보고");await this.save();
    if(this.record.preferences.aiReports){
      try{
        const memory=this.options.memory;
        if(!memory)throw new Error("개인 비서 연결을 먼저 확인해 주세요.");
        const home=await memory.assistantHome();
        if(home.connected&&this.record.preferences.projectId&&home.projectId!==this.record.preferences.projectId)throw new Error("비서의 보고 보관 프로젝트와 연결된 개인 비서 프로젝트가 다릅니다. 개인 비서 연결을 확인해 주세요.");
        const projectId=home.connected?home.projectId:this.record.preferences.projectId||this.store.state.projects[0]?.id;
        if(!projectId)throw new Error("보고를 보관할 프로젝트를 연결해 주세요.");
        const session=await memory.openAssistant(projectId);
        record.sessionId=session.id;
        await this.sendMessage(null,session.id,"[개인 비서 상태 보고] 다음 실제 수집 결과를 바탕으로 완성된 한국어 보고서를 작성하세요. 결론 / 프로젝트별 수행 현황과 근거 / 결정할 사항 / 다음 행동 순서로 정리하세요. 원자료 JSON을 그대로 출력하거나 사용자가 본문을 다시 쓰게 하지 마세요. 확인하지 않은 완료나 배포를 주장하지 마세요. 사용자가 요청하지 않은 외부 변경은 실행하지 마세요.\n"+body,{kind:"report",reportId:record.id});
      }catch(error){record.status="failed";record.error=String(error.message).slice(0,1000);this.notification("report","비서 보고 연결 확인",record.error,null,"보고");await this.save();throw error;}
    }
    return copy(record);
  }
  async recommend(){
    this.ready();
    const projectId=this.record.preferences.projectId||this.store.state.projects[0]?.id;
    if(!projectId)throw new Error("결정 추천을 보관할 프로젝트를 먼저 연결해 주세요.");
    const pending=this.record.proposals.filter(p=>p.status==="pending"&&!p.hidden).slice(0,40).map(p=>({id:p.id,title:p.title,body:p.body,targetId:p.targetId,projectId:p.projectId}));
    const session=await this.store.createSession(projectId,{title:"결정 묶음 검토"});
    const job={id:randomUUID(),sessionId:session.id,before:session.messages.length,status:"running",at:this.stamp()};
    this.record.recommendations.unshift(job);this.record.recommendations=this.record.recommendations.slice(0,100);await this.save();
    const schema={
      type:"object",additionalProperties:false,required:["summary","recommendations"],
      properties:{summary:{type:"string"},recommendations:{type:"array",items:{
        type:"object",additionalProperties:false,required:["title","body","targetId"],
        properties:{title:{type:"string"},body:{type:"string"},targetId:{type:"string"}}
      }}}
    };
    try{await this.controller.send({sessionId:session.id,mode:"plan",text:"아래 대기 결정을 주제와 선후 관계로 묶고 실행 가능한 다음 업무를 최대 8개 추천하세요. 서로 모순되는 선택은 임의로 결정하지 말고 설명하세요. targetId는 아래에 있는 대화 id 또는 빈 문자열만 사용하세요. 추천은 사용자가 승인하기 전 실행되지 않습니다.\n"+JSON.stringify(pending)}, {outputSchema:schema});}
    catch(error){job.status="failed";job.error=String(error.message);await this.save();throw error;}
    return copy(session);
  }
  async addReminder(input){
    const at=Date.parse(text(input.when,100));
    if(!Number.isFinite(at)||at<this.now()-60000||at>this.now()+5*366*86400000)throw invalid();
    const repeatDays=integer(input.repeatDays??0,0,365);
    const reminder={id:randomUUID(),text:text(input.text,2000),at,nextAt:at,repeatDays,createdAt:this.stamp(),cancelled:false,firedAt:null};
    this.record.reminders.unshift(reminder);await this.save();return copy(reminder);
  }
  async approve(p){
    this.ready();p.status="running";p.revision++;p.startedAt=this.stamp();await this.save();
    try{
      if(p.kind==="external"){
        if(!this.options.executeExternal)throw new Error("이 외부 작업의 실행 연결이 없습니다.");
        const result=await this.options.executeExternal({method:p.method,args:copy(p.args),sessionId:p.sourceId,proposalId:p.id});
        p.status=result?.state==="failed"?"failed":"completed";p.result=JSON.stringify(result).slice(0,12000);p.doneAt=this.stamp();
      }else if(p.kind==="team"){
        const api=this.options.teamRuntime?.api;if(!api)throw new Error("팀 업무 연결을 확인해 주세요.");
        const input=p.args;
        let result;
        if(input.runId){
          const board=await api.readTeams(p.projectId),run=board.runs.find(r=>r.id===input.runId);
          if(!run?.directed||run.teamId!==input.teamId)throw stale();
          result=await api.changeTeamRun(p.projectId,run.id,{action:"instruct",index:input.index,text:input.text},run.directed.revision);
        }else result=await api.directTeam(p.projectId,input.teamId,input.text,p.id,{strategy:"plan",autoDispatch:input.automatic===true,autoReport:true});
        p.teamRunId=result.id;p.targetId=result.directed?.lead?.sessionId||null;p.result="팀 업무를 시작했습니다. 결과를 확인한 뒤 요청 대화에 전달합니다.";
      }else if(p.kind==="report"){
        const result=await this.report(p.title);p.status="completed";p.result=result.body;
      }else{
        if(!p.targetId){
          if(!p.projectId)throw invalid();
          const target=await this.store.createSession(p.projectId,{title:p.title});p.targetId=target.id;await this.save();
        }
        const delivery=await this.sendMessage(p.sourceId,p.targetId,`사용자가 승인한 업무 / ${p.title}\n${p.body}\n완료 결과와 검증 근거를 답변으로 보고하세요. Flowrium이 원래 요청에 결과를 전달합니다.`,{kind:"request",proposalId:p.id});
        if(["failed","held"].includes(delivery.status)){p.status=delivery.status;p.result=delivery.error||"업무 전달을 확인해 주세요.";}
      }
    }catch(error){p.status="failed";p.result=String(error.message).slice(0,4000);}
    p.revision++;await this.save();return copy(p);
  }
  async action(input){
    return this.serial(async()=>{
      this.ready();if(!input||typeof input!=="object")throw invalid();
      switch(input.action){
        case "preferences":{
          const next=preferences(input.value,this.record.preferences);if(next.projectId)this.store.project(next.projectId);
          if(next.enabled&&next.aiReports&&!next.projectId)throw new Error("자동 보고를 보관할 프로젝트를 선택해 주세요.");
          if(next.aiReports&&next.projectId&&this.options.memory){
            const home=await this.options.memory.assistantHome();
            if(home.connected&&home.projectId!==next.projectId)throw new Error("개인 비서 대화가 보관된 프로젝트를 선택해 주세요. 기존 비서 대화와 기록을 유지합니다.");
          }
          this.record.preferences=next;await this.save();return copy(next);
        }
        case "send":return this.sendMessage(input.sourceId||null,input.targetId,input.text);
        case "request":{const p=this.proposal({kind:"request",sourceId:input.sourceId,projectId:input.projectId,targetId:input.targetId,title:input.title,body:input.text});await this.save();return copy(p);}
        case "propose":{
          if(!["next","report"].includes(input.kind))throw invalid();
          const p=this.proposal({kind:input.kind,sourceId:input.sourceId,projectId:input.projectId,targetId:input.targetId,title:input.title,body:input.text});await this.save();return copy(p);
        }
        case "approve":case "reject":case "hide":case "restore":case "snooze":{
          const p=this.record.proposals.find(p=>p.id===id(input.id));
          if(!p||!Number.isSafeInteger(input.revision)||(["approve","reject"].includes(input.action)&&p.revision!==input.revision))throw stale();
          if(input.action==="approve"){
            if(p.status!=="pending")throw stale();return this.approve(p);
          }
          if(input.action==="reject"){if(p.status!=="pending")throw stale();p.status="rejected";}
          if(input.action==="hide")p.hidden=true;
          if(input.action==="restore"){p.hidden=false;p.snoozedUntil=null;}
          if(input.action==="snooze")p.snoozedUntil=this.now()+integer(input.minutes,1,10080)*60000;
          p.revision++;await this.save();return copy(p);
        }
        case "bulk":{
          if(!Array.isArray(input.items)||input.items.length>50||new Set(input.items.map(v=>v.id)).size!==input.items.length||!["hide","restore","reject","approve"].includes(input.operation))throw invalid();
          const rows=input.items.map(v=>{const p=this.record.proposals.find(p=>p.id===id(v.id));if(!p||!Number.isSafeInteger(v.revision)||(["approve","reject"].includes(input.operation)&&p.revision!==v.revision))throw stale();return p;});
          if(input.operation==="approve"){
            if(rows.some(p=>p.status!=="pending"))throw stale();
            const results=[];for(const p of rows)results.push(await this.approve(p));return results;
          }
          for(const p of rows){if(input.operation==="hide")p.hidden=true;else if(input.operation==="restore"){p.hidden=false;p.snoozedUntil=null;}else if(p.status==="pending")p.status="rejected";p.revision++;}
          await this.save();return rows.map(copy);
        }
        case "read":{
          const ids=input.ids;if(!Array.isArray(ids)||ids.length>2000)throw invalid();const wanted=new Set(ids.map(id));
          for(const n of this.record.notifications)if(wanted.has(n.id))n.readAt=this.stamp();await this.save();return true;
        }
        case "readSession":{
          const sessionId=id(input.sessionId);this.store.session(sessionId);for(const n of this.record.notifications)if(n.sessionId===sessionId)n.readAt=this.stamp();await this.save();return true;
        }
        case "clearNotifications":{
          if(input.readOnly!==true)throw new Error("미확인 알림은 먼저 확인해 주세요.");
          this.record.notifications=this.record.notifications.filter(n=>!n.readAt);await this.save();return true;
        }
        case "reportNow":return this.report();
        case "recommend":return this.recommend();
        case "collect":return this.collect();
        case "reminderAdd":return this.addReminder(input);
        case "reminderCancel":{
          const reminder=this.record.reminders.find(r=>r.id===id(input.id));if(!reminder)throw stale();reminder.cancelled=true;await this.save();return copy(reminder);
        }
        case "retryDelivery":{
          const d=this.record.deliveries.find(d=>d.id===id(input.id));if(!d||!["failed","held"].includes(d.status))throw stale();d.status="queued";delete d.error;await this.save();await this.flush(d.targetId);return copy(d);
        }
        case "resumeExternal":{
          const p=this.record.proposals.find(p=>p.id===id(input.id));
          if(!p||!["failed","held"].includes(p.status)||p.revision!==input.revision||p.kind!=="external"||p.method!=="repositoryFlow"||!Array.isArray(p.args)||p.args.length!==1)throw stale();
          p.args=[{action:"resume",id:p.args[0].id}];return this.approve(p);
        }
        default:throw invalid();
      }
    });
  }
  async proposeExternal(input){return this.serial(async()=>{
    this.ready();if(typeof input.method!=="string"||!this.options.externalMethods?.includes(input.method)||JSON.stringify(input.args||{}).length>32000||JSON.stringify(input.preview||{}).length>32000)throw invalid();
    const p=this.proposal({kind:"external",sourceId:input.sessionId,title:input.title,body:input.body||JSON.stringify(input.preview||input.args,null,2),method:input.method,args:input.args,preview:copy(input.preview||null),key:input.key});
    await this.save();return copy(p);
  });}
  toolsFor(){return copy(TOOL_SPECS);}
  async callTool(input){
    return this.serial(async()=>{
      this.ready();const session=this.store.session(id(input.sessionId)),args=input.arguments;
      const spec=TOOL_SPECS.find(t=>t.name===input.name);if(!spec||!args||typeof args!=="object"||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(spec.inputSchema.properties,k))||spec.inputSchema.required.some(k=>!Object.hasOwn(args,k)))throw invalid();
      const memo=this.options.memory,key=input.callId?session.id+":"+text(input.callId,300):null;
      const cached=key&&this.record.toolCalls.find(c=>c.key===key);
      if(cached){if(cached.name!==input.name)throw stale();return copy(cached.result);}
      const dispatch=async()=>{switch(input.name){
        case "flowrium_chat_list":{
          const query=text(args.query,300,true).toLowerCase();
          return this.store.state.sessions.filter(s=>!query||`${s.title} ${this.store.project(s.projectId).name}`.toLowerCase().includes(query)).slice(0,80).map(s=>({id:s.id,title:s.title,project:this.store.project(s.projectId).name,running:this.controller.runs.has(s.id)}));
        }
        case "flowrium_chat_send":this.quota(session.id);return this.sendMessage(session.id,args.targetId,args.text);
        case "flowrium_session_request":{
          this.quota(session.id);const p=this.proposal({kind:"request",sourceId:session.id,targetId:args.targetId||null,title:args.title,body:args.text,key:input.callId?session.id+":"+input.callId:null});await this.save();return{id:p.id,status:p.status,notice:"사용자가 결정함에서 승인한 뒤 실행합니다."};
        }
        case "flowrium_memory_list":{
          if(!memo)throw invalid();const query=text(args.query,300,true).toLowerCase();
          return(await memo.listMemory(session.projectId)).filter(n=>!n.deleted&&(!query||`${n.title}\n${n.body}`.toLowerCase().includes(query)));
        }
        case "flowrium_memory_save":{
          if(!memo)throw invalid();return memo.changeMemory(session.projectId,{action:"save",scope:args.scope,id:args.id||undefined,revision:args.revision||null,title:args.title,body:args.body,role:args.role,link:"",linked:true});
        }
        case "flowrium_reminder_add":return this.addReminder(args);
        case "flowrium_reminder_list":return copy(this.record.reminders.filter(r=>!r.cancelled).slice(0,100));
        case "flowrium_reminder_cancel":{const r=this.record.reminders.find(r=>r.id===id(args.id));if(!r)throw stale();r.cancelled=true;await this.save();return copy(r);}
        case "flowrium_secretary_notify":{
          if(!memo)throw invalid();this.quota(session.id);const home=await memo.assistantHome();const assistant=await memo.openAssistant(home.connected?home.projectId:session.projectId);
          if(assistant.id===session.id){const n=this.notification("report","비서에게 전달한 결과",text(args.text),session.id,"비서 전달");await this.save();return{id:n.id,status:"recorded"};}
          return this.sendMessage(session.id,assistant.id,args.text);
        }
        case "flowrium_team_list":{
          const api=this.options.teamRuntime?.api;if(!api)throw invalid();const data=await api.readTeams(session.projectId);
          return{teams:data.teams,runs:data.runs.slice(0,30).map(r=>({id:r.id,teamId:r.teamId,name:r.name,prompt:r.prompt,phase:r.directed?.phase||"공동 실행",roles:r.roles.map((a,index)=>({index,name:a.name,status:a.status}))}))};
        }
        case "flowrium_team_assign":{
          const api=this.options.teamRuntime?.api;if(!api||typeof args.automatic!=="boolean")throw invalid();
          id(args.teamId);if(args.runId)id(args.runId);integer(args.index,0,7);this.quota(session.id);
          const board=await api.readTeams(session.projectId);if(!board.teams.some(t=>t.id===args.teamId))throw new Error("현재 프로젝트에 등록한 팀을 선택해 주세요.");
          const p=this.proposal({kind:"team",sourceId:session.id,projectId:session.projectId,title:"팀 업무 위임",body:text(args.text)+"\n"+(args.runId?"기존 팀원에게 추가 지시":args.automatic?"계획 후 자동 배부와 완료 보고":"계획 작성 후 사용자 배정 검토"),args:copy(args),key:key});
          await this.save();return copy(p);
        }
        case "flowrium_repository_list":{
          if(!this.options.repositoryAction)throw invalid();const rows=await this.options.repositoryAction(session.projectId,{action:"repositories"});
          return Promise.all(rows.filter(r=>!r.hidden).slice(0,32).map(async r=>({...r,changes:await this.options.repositoryAction(session.projectId,{action:"changes",repositoryId:r.id}).catch(e=>({error:e.message}))})));
        }
        case "flowrium_repository_propose":{
          if(!this.options.repositoryFlow||!Array.isArray(args.rows)||!args.rows.length||args.rows.length>32)throw invalid();
          const rows=args.rows.map(row=>({...row,...(row.through==="done"&&{sessionId:session.id})}));
          const plan=await this.options.repositoryFlow({action:"plan",projectId:session.projectId,rows});
          const preview={kind:"repository",projectName:this.store.project(session.projectId).name,rows:plan.rows};
          if(!this.options.externalMethods?.includes("repositoryFlow"))throw new Error("저장소 실행 승인 연결을 확인해 주세요.");
          const body=plan.rows.map(row=>`${row.name} / 선택 파일 ${row.files.length}개 / 마지막 단계 ${row.through}\n커밋 메시지 / ${row.message}`).join("\n\n");
          const p=this.proposal({kind:"external",sourceId:session.id,title:"저장소 실행 계획",body,method:"repositoryFlow",args:[{action:"execute",id:plan.id}],preview,key});
          await this.save();return copy(p);
        }
        default:throw invalid();
      }};
      const result=await dispatch();
      if(key&&!input.name.endsWith("_list")){
        this.record.toolCalls.unshift({key,name:input.name,result:copy(result)});this.record.toolCalls=this.record.toolCalls.slice(0,300);await this.save();
      }
      return result;
    });
  }
  async onEvent(event){
    if(event.type==="done"){
      const session=(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.id===event.sessionId);if(!session)return;
      const body=session.messages.findLast(m=>m.role==="assistant")?.text||event.text||"";
      this.notification(event.status==="completed"?"done":"error",session.title,body,session.id,session.workflow?.teamSlot?.runId||session.id);
      for(const delivery of this.record.deliveries.filter(d=>d.targetId===session.id&&d.reportId&&d.status==="sent"&&!d.completedAt)){
        const report=this.record.reports.find(r=>r.id===delivery.reportId);if(!report||report.status!=="writing")continue;
        delivery.completedAt=this.stamp();
        const answer=session.messages.slice(delivery.before||0).findLast(m=>m.role==="assistant");
        if(event.status==="completed"&&answer){
          report.body=answer.text;report.status="completed";report.completedAt=this.stamp();
          try{const artifact=await require("./workbench.cjs").saveArtifact(this.store,session.id,answer.id,"md");report.artifactPath=artifact.path;}
          catch(error){report.status="failed";report.error=String(error.message).slice(0,1000);}
          this.notification("report","개인 비서 보고 완료",report.body,session.id,"보고");
        }else{report.status="failed";report.error=event.text||"보고 작성이 중단됐습니다.";}
      }
      const recommendation=this.record.recommendations.find(r=>r.sessionId===session.id&&r.status==="running");
      if(recommendation){
        try{
          if(event.status!=="completed")throw new Error("결정 추천 응답이 중단됐습니다.");
          const parsed=JSON.parse(body.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,""));
          if(!Array.isArray(parsed.recommendations)||parsed.recommendations.length>8)throw invalid();
          for(const item of parsed.recommendations)this.proposal({kind:"next",projectId:session.projectId,targetId:item.targetId||null,title:item.title,body:item.body,sourceId:session.id});
          recommendation.status="completed";recommendation.summary=text(parsed.summary,4000,true);
          this.notification("report","결정 묶음 추천",recommendation.summary,session.id,"결정 추천");
        }catch(error){recommendation.status="failed";recommendation.error=String(error.message).slice(0,1000);}
      }
      for(const proposal of this.record.proposals.filter(p=>p.kind!=="team"&&p.status==="running"&&p.targetId===session.id)){
        proposal.status=event.status==="completed"?"completed":"failed";proposal.result=body.slice(0,12000);proposal.doneAt=this.stamp();proposal.revision++;
        this.notification("report",proposal.title,proposal.result,proposal.sourceId,"위임 결과");
        await this.save();
        if(proposal.sourceId&&event.status==="completed")await this.sendMessage(session.id,proposal.sourceId,`요청한 업무 결과 / ${proposal.title}\n${proposal.result}`,{kind:"result",proposalId:proposal.id});
      }
      if(this.options.teamRuntime?.api){
        for(const proposal of this.record.proposals.filter(p=>p.kind==="team"&&p.status==="running"&&p.teamRunId)){
          const board=await this.options.teamRuntime.api.readTeams(proposal.projectId),run=board.runs.find(r=>r.id===proposal.teamRunId);
          if(!run?.directed||run.directed.phase!=="done")continue;
          proposal.status="completed";proposal.result=run.directed.artifactPath||run.directed.nodes.map(n=>n.summary).join("\n\n");proposal.doneAt=this.stamp();proposal.revision++;
          this.notification("report","위임한 팀 업무 완료",proposal.result,proposal.sourceId,"팀 위임");await this.save();
          if(proposal.sourceId&&proposal.sourceId!==proposal.targetId)await this.sendMessage(proposal.targetId,proposal.sourceId,"위임한 팀 업무 결과 / "+proposal.result,{kind:"result",proposalId:proposal.id});
        }
      }
      await this.save();await this.flush(session.id);
    }else{
      const session=(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.id===event.sessionId);
      const secret=event.type==="input"&&event.questions?.some(q=>q.isSecret);
      this.notification("approval",session?.title||"사용자 결정 필요",secret?"비밀 질문은 데스크톱 승인함에서 확인하세요.":event.text||"작업에 필요한 결정을 확인해 주세요.",event.sessionId,"승인");await this.save();
    }
  }
  async tick(){
    if(this.tickRunning||this.closed||this.options.canRun?.()===false)return;
    this.tickRunning=true;
    try{await this.serial(async()=>{
      this.ready();const now=this.now();let changed=false;
      for(const reminder of this.record.reminders){
        if(reminder.cancelled||reminder.nextAt>now||(!reminder.repeatDays&&reminder.firedAt))continue;
        this.notification("reminder","예약 알림",reminder.text,null,"예약");reminder.firedAt=this.stamp();
        if(reminder.repeatDays)while(reminder.nextAt<=now)reminder.nextAt+=reminder.repeatDays*86400000;
        changed=true;
      }
      if(changed)await this.save();
      for(const target of new Set(this.record.deliveries.filter(d=>d.status==="queued").map(d=>d.targetId)))await this.flush(target);
      const prefs=this.record.preferences;
      if(!prefs.enabled)return;
      if(this.options.readProjectDetails){
        const localParts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:prefs.timezone,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
        const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(localParts.weekday),date=`${localParts.year}-${localParts.month}-${localParts.day}`,clock=`${localParts.hour}:${localParts.minute}`;
        for(const project of this.store.state.projects){
          const details=await this.options.readProjectDetails(project.id);
          for(const goal of details.schedule||[]){
            if(goal.day!==day||goal.time>clock)continue;
            const key=`${project.id}:${goal.id}:${date}`;
            if(this.record.goalFirings.includes(key))continue;
            this.record.goalFirings.push(key);this.record.goalFirings=this.record.goalFirings.slice(-3000);
            this.notification("reminder",project.name+" / 반복 목표",text(goal.text,2000),null,"반복 목표");changed=true;
          }
        }
        if(changed)await this.save();
      }
      if(now-this.record.lastReport<prefs.intervalMinutes*60000)return;
      const parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:prefs.timezone,weekday:"short",hour:"2-digit",hourCycle:"h23"}).formatToParts(now).map(p=>[p.type,p.value]));
      const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday),hour=Number(parts.hour);
      const inHours=prefs.startHour===prefs.endHour||
        (prefs.startHour<prefs.endHour?hour>=prefs.startHour&&hour<prefs.endHour:hour>=prefs.startHour||hour<prefs.endHour);
      if(prefs.weekdays.includes(weekday)&&inHours)await this.report("설정한 주기의 상태 보고");
    });}finally{this.tickRunning=false;}
  }
  isBusy(){return this.transitions>0||this.tickRunning;}
  async shutdown(){this.closed=true;clearInterval(this.timer);this.controller.off("event",this.listener);await this.queue;}
}
function registerWorkflow(register,store,controller,options={}){
  const runtime=new WorkflowRuntime(store,controller,options);
  register("workflowState",()=>runtime.state());register("workflowAction",input=>runtime.action(input));return runtime;
}
module.exports={WorkflowRuntime,registerWorkflow,TOOL_SPECS,preferences};
