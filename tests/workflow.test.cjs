const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const {EventEmitter}=require("node:events");
const {randomUUID}=require("node:crypto");
const {Store}=require("../electron/store.cjs");
const {registerMemory}=require("../electron/memory.cjs");
const {WorkflowRuntime}=require("../electron/workflow.cjs");
const {setTimeout:delay}=require("node:timers/promises");

class TestController extends EventEmitter{
  constructor(store){super();this.store=store;this.runs=new Map();this.editingSessions=new Set();this.sent=[];}
  async send(input,options){
    if(this.runs.has(input.sessionId))throw Error("이미 실행 중");
    const session=this.store.session(input.sessionId);
    session.messages.push({id:randomUUID(),role:"user",text:input.text,createdAt:new Date().toISOString()});
    await this.store.save();this.sent.push({input,options});this.runs.set(input.sessionId,{sessionId:input.sessionId});
    this.emit("event",{type:"status",status:"running",sessionId:session.id});return{accepted:true};
  }
  async finish(id,text="완료 근거",status="completed"){
    const session=this.store.session(id);session.messages.push({id:randomUUID(),role:"assistant",text,createdAt:new Date().toISOString()});
    await this.store.save();this.runs.delete(id);this.emit("event",{type:"done",status,sessionId:id});
  }
}
async function setup(t,extra={}){
  const base=path.resolve(__dirname,"../.flowrium-tmp/qa-261115_03");await fs.mkdir(base,{recursive:true});const temporary=await fs.mkdtemp(path.join(base,"workflow-"));
  const store=new Store(path.join(temporary,"설정"));await store.load();
  const folder=path.join(temporary,"프로젝트 & 기록");await fs.mkdir(folder);const project=await store.addProject(folder);
  const a=await store.createSession(project.id,{title:"원래 요청"}),b=await store.createSession(project.id,{title:"받는 대화"});
  const controller=new TestController(store),api={};let account=0,allowed=true,now=Date.parse("2026-11-16T01:15:00Z");
  const memory=registerMemory((name,fn)=>api[name]=fn,store,{accountRevision:()=>account});
  const options={memory,accountRevision:()=>account,canRun:()=>allowed,now:()=>now,intervalMs:3600000,...extra};
  let workflow=new WorkflowRuntime(store,controller,options);
  t.after(async()=>{await workflow.shutdown();await fs.rm(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
  async function wait(fn){for(let i=0;i<100;i++){const data=await workflow.state();if(fn(data))return data;await delay(10);}throw Error("업무 연결 대기 시간 초과");}
  return{store,project,a,b,controller,memory,api,get workflow(){return workflow;},wait,
    changeAccount:n=>{account=n;},setAllowed:n=>{allowed=n;},advance:n=>{now+=n;},
    reload:async()=>{await workflow.shutdown();workflow=new WorkflowRuntime(store,controller,options);return workflow.state();}};
}

test("작업 중인 상대 대화의 지시를 영속 대기시킨 뒤 종료 후 순서대로 전달하고 실패 지시는 명시 재시도한다",async t=>{
  const s=await setup(t);await s.controller.send({sessionId:s.b.id,text:"현재 진행 중",mode:"plan"});
  const first=await s.workflow.action({action:"send",sourceId:s.a.id,targetId:s.b.id,text:"첫 번째 추가 지시"});
  const second=await s.workflow.action({action:"send",sourceId:s.a.id,targetId:s.b.id,text:"두 번째 추가 지시"});
  assert.equal(first.status,"queued");assert.equal(second.status,"queued");assert.equal(s.controller.sent.length,1);
  await s.controller.finish(s.b.id,"현재 업무 완료");await s.wait(d=>d.deliveries.find(x=>x.id===first.id)?.status==="sent");
  assert.match(s.controller.sent[1].input.text,/원래 요청[\s\S]*첫 번째 추가 지시/);
  await s.controller.finish(s.b.id,"첫 번째 결과");await s.wait(d=>d.deliveries.find(x=>x.id===second.id)?.status==="sent");
  assert.match(s.controller.sent[2].input.text,/두 번째 추가 지시/);
  await s.controller.finish(s.b.id,"두 번째 결과");await s.wait(d=>d.notifications.length>=3);
  const data=await s.reload();assert.equal(data.deliveries.length,2);assert.equal(data.notifications.length,3);
});

test("다른 대화 조사 요청은 사용자 승인 전 시작하지 않고 한 번만 실행한 뒤 원대화에 결과를 회신한다",async t=>{
  const s=await setup(t);
  const tool={sessionId:s.a.id,name:"flowrium_session_request",callId:"조사-한번",arguments:{targetId:"",title:"근거 조사",text:"소스 근거 확인"}};
  const proposal=await s.workflow.callTool(tool);const replay=await s.workflow.callTool(tool);
  assert.equal(proposal.id,replay.id);assert.equal(s.controller.sent.length,0);
  const row=(await s.workflow.state()).proposals[0];assert.equal(row.status,"pending");
  const results=await Promise.allSettled([1,2].map(()=>s.workflow.action({action:"approve",id:row.id,revision:row.revision})));
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(s.controller.sent.length,1);
  const current=(await s.workflow.state()).proposals[0];assert.notEqual(current.targetId,s.a.id);
  await s.controller.finish(current.targetId,"실제 근거 파일 / 검증 성공");
  const after=await s.wait(d=>d.proposals[0].status==="completed");
  assert.match(after.proposals[0].result,/근거 파일/);assert.equal(s.controller.sent.length,2);
  assert.equal(s.controller.sent[1].input.sessionId,s.a.id);assert.match(s.controller.sent[1].input.text,/요청한 업무 결과[\s\S]*검증 성공/);
  const p=after.proposals[0];await s.workflow.action({action:"hide",id:p.id,revision:p.revision});
  const hidden=(await s.workflow.state()).proposals[0];assert.equal(hidden.hidden,true);
  await s.workflow.action({action:"restore",id:hidden.id,revision:hidden.revision});
  await s.workflow.action({action:"readSession",sessionId:s.a.id});
  assert((await s.workflow.state()).notifications.filter(n=>n.sessionId===s.a.id).every(n=>n.readAt));
});

test("외부 변경은 검토 자료와 함께 보관하고 승인에만 한 번 실행하며 잠금·계정 변경은 과거 제안을 실행하지 않는다",async t=>{
  const calls=[];const s=await setup(t,{externalMethods:["commitMacEvent"],executeExternal:async value=>{calls.push(value);return{saved:true};}});
  const preview={action:"update",calendarName:"검증 캘린더",previous:{title:"이전 제목",at:"2026-11-16T10:00:00+09:00"},event:{title:"새 제목",description:"검토할 본문"}};
  const row=await s.workflow.proposeExternal({sessionId:s.a.id,title:"일정 수정",method:"commitMacEvent",args:["검토 티켓"],preview});
  assert.deepEqual((await s.workflow.state()).proposals[0].preview,preview);assert.equal(calls.length,0);
  s.setAllowed(false);await assert.rejects(s.workflow.action({action:"approve",id:row.id,revision:row.revision}),/잠금/);await s.workflow.tick();assert.equal(calls.length,0);
  s.setAllowed(true);await s.workflow.action({action:"approve",id:row.id,revision:row.revision});assert.equal(calls.length,1);assert.deepEqual(calls[0].args,["검토 티켓"]);
  await assert.rejects(s.workflow.action({action:"approve",id:row.id,revision:row.revision}),/바뀌/);
  s.changeAccount(1);assert.equal((await s.workflow.state()).proposals.length,0);
  await assert.rejects(s.workflow.action({action:"approve",id:row.id,revision:row.revision}),/바뀌/);assert.equal(calls.length,1);
});

test('모델의 일정 제안 도구는 같은 호출을 한 제안으로 모으고 사용자 승인 뒤에만 정확히 한 번 적용한다',async t=>{
 const writes=[],s=await setup(t,{externalMethods:['commitMacEvent'],executeExternal:async value=>{writes.push(value);return{saved:true}}});
 const {createExternalTools}=require('../electron/external-tools.cjs');let tickets=0;
 const tools=createExternalTools({store:s.store,workflow:s.workflow,handlers:new Map([['prepareMacEvent',async input=>({id:'ticket-'+(++tickets),action:input.action,calendarName:'시험 일정',event:{title:input.summary}})]])});
 assert(!tools.definitions.some(d=>/approve|commit/.test(d.name)));
 const input={sessionId:s.a.id,callId:'stable-call',name:'flowrium_mac_calendar_propose',arguments:{action:'create',calendarId:'primary',eventId:'',summary:'검토할 일정',start:'2026-11-16T10:00:00+09:00',end:'2026-11-16T11:00:00+09:00',description:'검토 본문',location:''}};
 const first=await tools.call(input),repeat=await tools.call(input);assert.equal(first.id,repeat.id);assert.equal(writes.length,0);
 const row=(await s.workflow.state()).proposals[0];assert.equal(row.preview.event.title,'검토할 일정');
 await s.workflow.action({action:'approve',id:row.id,revision:row.revision});assert.deepEqual(writes[0].args,['ticket-1']);assert.equal(writes.length,1);
 await assert.rejects(tools.call({...input,arguments:{...input.arguments,action:'arbitrary'}}),/값/);
});

test("예약·반복 알림은 앱 재실행에도 중복 없이 전달하고 비서 감시와 반복 목표는 명시 설정 뒤에만 실행한다",async t=>{
  const goal={id:randomUUID(),day:1,time:"10:00",text:"수치 목표 확인"};
  const s=await setup(t,{readProjectDetails:async()=>({schedule:[goal]})});
  await s.workflow.tick();assert.equal((await s.workflow.state()).reports.length,0);
  const reminder=await s.workflow.action({action:"reminderAdd",when:"2026-11-16T10:16:00+09:00",text:"정해진 알림",repeatDays:1});
  s.advance(120000);await s.workflow.tick();let data=await s.workflow.state();assert.equal(data.notifications.filter(n=>n.kind==="reminder").length,1);
  assert(data.reminders[0].nextAt>reminder.at);await s.reload();await s.workflow.tick();assert.equal((await s.workflow.state()).notifications.filter(n=>n.kind==="reminder").length,1);
  await s.workflow.action({action:"preferences",value:{enabled:true,aiReports:false,projectId:s.project.id,weekdays:[1],startHour:9,endHour:18}});
  await s.workflow.tick();data=await s.workflow.state();assert.equal(data.reports.length,1);assert.equal(data.notifications.filter(n=>n.title.includes("반복 목표")).length,1);assert.equal(s.controller.sent.length,0);
  await s.workflow.tick();assert.equal((await s.workflow.state()).notifications.filter(n=>n.title.includes("반복 목표")).length,1);
  await s.workflow.action({action:"reminderCancel",id:reminder.id});s.advance(86400000);await s.workflow.tick();
  assert.equal((await s.workflow.state()).notifications.filter(n=>n.body==="정해진 알림").length,1);
});

test("AI 기억 저장은 실제 개정 파일을 만들며 동일 도구 호출을 재실행하지 않고 잘못된 입력·계정 이후 id 재사용을 거절한다",async t=>{
  const s=await setup(t);const input={sessionId:s.a.id,name:"flowrium_memory_save",callId:"메모한번",arguments:{scope:"project",id:"",revision:"",title:"확정한 기준",body:"작성한 실제 내용",role:""}};
  const first=await s.workflow.callTool(input),second=await s.workflow.callTool(input);assert.equal(first.id,second.id);
  assert.equal((await s.memory.listMemory(s.project.id)).length,1);assert.equal((await s.memory.memoryVersions(s.project.id,"project",first.id)).length,1);
  await assert.rejects(s.workflow.callTool({...input,callId:"변경",arguments:{...input.arguments,scope:"../../외부"}}));
  await assert.rejects(s.workflow.callTool({...input,name:"not_registered"}));
  await assert.rejects(s.workflow.callTool({...input,arguments:{...input.arguments,unexpected:true}}));
  assert.equal((await s.memory.listMemory(s.project.id)).length,1);
});

test("결정 묶음 추천은 실제 대화 결과를 새 승인 항목으로 만들고 숨김·일괄 처리·읽은 알림 정리를 구분한다",async t=>{
  const s=await setup(t);
  await s.workflow.action({action:"request",sourceId:s.a.id,targetId:s.b.id,title:"기존 결정",text:"자료 확인"});
  const session=await s.workflow.action({action:"recommend"});assert.equal(s.controller.sent.length,1);
  await s.controller.finish(session.id,JSON.stringify({summary:"먼저 근거를 정리하세요.",recommendations:[{title:"자료 정리",body:"근거 정리 과업",targetId:s.b.id}]}));
  let data=await s.wait(d=>d.proposals.length===2);assert.equal(data.proposals[0].kind,"next");assert.equal(data.proposals[0].status,"pending");assert.equal(s.controller.sent.length,1);
  const items=data.proposals.map(p=>({id:p.id,revision:p.revision}));
  await assert.rejects(s.workflow.action({action:"bulk",operation:"approve",items:[items[0],items[0]]}));
  await s.workflow.action({action:"bulk",operation:"hide",items});data=await s.workflow.state();assert(data.proposals.every(p=>p.hidden));
  await s.workflow.action({action:"bulk",operation:"restore",items:data.proposals.map(p=>({id:p.id,revision:p.revision}))});
  await s.workflow.action({action:"read",ids:data.notifications.map(n=>n.id)});await s.workflow.action({action:"clearNotifications",readOnly:true});
  assert.equal((await s.workflow.state()).notifications.length,0);
});
test("비서 보고는 실제 모델 요청 뒤 생성한 답변을 본문과 산출물로 보관하고 원자료를 완료 보고로 표시하지 않는다",async t=>{
  const s=await setup(t,{collectExternal:async()=>({mail:[{subject:"검토 요청",snippet:"회의 자료"}]})});
  await s.workflow.action({action:"preferences",value:{projectId:s.project.id,mail:true}});
  const report=await s.workflow.action({action:"reportNow"});assert.equal(report.status,"writing");assert.equal(report.body,"");
  assert.equal(s.controller.sent.length,1);assert.match(s.controller.sent[0].input.text,/개인 비서 상태 보고[\s\S]*검토 요청/);
  const session=s.controller.sent[0].input.sessionId,body="# 프로젝트 현황 보고\n\n검토 요청에 맞춰 근거 자료를 확인합니다.\n\n## 다음 행동\n\n회의 자료의 담당자를 확인합니다.";
  await s.controller.finish(session,body);const data=await s.wait(d=>d.reports[0].status==="completed");
  assert.equal(data.reports[0].body,body);assert(data.reports[0].artifactPath);
  assert((await fs.readFile(path.join(s.project.path,data.reports[0].artifactPath),"utf8")).includes(body));
  assert(data.notifications.some(n=>n.title==="개인 비서 보고 완료"&&n.body===body));
});
test("저장소 실행 도구는 파일·브랜치·단계 검토 계획만 만들고 승인 후 실행하며 실패 지점의 명시 재개만 허용한다",async t=>{
  const planId=randomUUID(),calls=[];
  const repositoryFlow=async input=>{
    calls.push(input);
    if(input.action==="plan")return{id:planId,state:"planned",rows:input.rows.map(row=>({...row,name:"검증 저장소",expected:{head:"a".repeat(40),branch:"task"}}))};
    return input.action==="execute"?{state:"failed",error:"원격 연결을 확인하세요.",rows:[{completed:["commit"]}]}:{state:"done",rows:[{completed:["commit","push"]}]};
  };
  const s=await setup(t,{repositoryFlow,externalMethods:["repositoryFlow"],executeExternal:({args})=>repositoryFlow(args[0])});
  const proposal=await s.workflow.callTool({sessionId:s.a.id,name:"flowrium_repository_propose",callId:"저장소계획1",arguments:{rows:[{repositoryId:"root",files:["app.js"],message:"검증 변경",base:"main",title:"검증 요청",body:"변경 근거",through:"push"}]}});
  assert.equal(calls.length,1);assert.equal(calls[0].action,"plan");assert.equal(proposal.preview.rows[0].expected.branch,"task");assert.equal(proposal.preview.projectName,s.project.name);
  let result=await s.workflow.action({action:"approve",id:proposal.id,revision:proposal.revision});assert.equal(result.status,"failed");assert.equal(calls[1].action,"execute");
  result=await s.workflow.action({action:"resumeExternal",id:result.id,revision:result.revision});assert.equal(result.status,"completed");assert.equal(calls[2].action,"resume");
  await assert.rejects(s.workflow.action({action:"resumeExternal",id:result.id,revision:result.revision}));
});
test("비서 보고 연결 오류는 무한 작성 대기로 남기지 않고 실패와 알림을 보관한다",async t=>{
  const s=await setup(t);await s.workflow.action({action:"preferences",value:{projectId:s.project.id}});
  s.memory.assistantHome=async()=>({connected:true,projectId:randomUUID()});
  await assert.rejects(s.workflow.action({action:"reportNow"}),/프로젝트가 다릅니다/);
  const state=await s.workflow.state();assert.equal(state.reports[0].status,"failed");assert.equal(state.reports[0].body,"");assert.equal(s.controller.sent.length,0);assert.equal(state.notifications[0].title,"비서 보고 연결 확인");
});
test("일반 대화의 팀 위임은 사용자 승인 뒤 시작하고 계획 완료를 최종 결과로 잘못 회신하지 않는다",async t=>{
  const teamId=randomUUID(),runId=randomUUID();let phase="planning",s,starts=0;
  const api={
    readTeams:async()=>({teams:[{id:teamId,name:"검증 팀",roles:[]}],runs:[{id:runId,teamId,directed:{phase,artifactPath:"산출물/팀 보고.md",nodes:[]}}]}),
    directTeam:async()=>{starts++;await s.controller.send({sessionId:s.b.id,text:"팀 배정안 작성",mode:"plan"});return{id:runId,directed:{lead:{sessionId:s.b.id}}};}
  };
  s=await setup(t,{teamRuntime:{api}});
  const proposed=await s.workflow.callTool({sessionId:s.a.id,name:"flowrium_team_assign",callId:"팀위임",arguments:{teamId,runId:"",index:0,text:"근거를 팀으로 조사하세요.",automatic:false}});
  assert.equal(starts,0);await s.workflow.action({action:"approve",id:proposed.id,revision:proposed.revision});assert.equal(starts,1);
  phase="draft";await s.controller.finish(s.b.id,"역할별 배정안");await s.wait(d=>d.notifications.length>=2);
  assert.equal((await s.workflow.state()).proposals[0].status,"running");assert.equal(s.controller.sent.length,1);
  phase="done";await s.controller.send({sessionId:s.b.id,text:"팀 최종 보고",mode:"plan"});await s.controller.finish(s.b.id,"검증한 결과 보고");
  await s.wait(d=>d.proposals[0].status==="completed");assert.equal(s.controller.sent.at(-1).input.sessionId,s.a.id);assert.match(s.controller.sent.at(-1).input.text,/위임한 팀 업무 결과/);
});
