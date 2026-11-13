const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os");
const {randomUUID}=require("node:crypto"),{execFile}=require("node:child_process"),{promisify}=require("node:util");
const run=promisify(execFile),{setTimeout:delay}=require("node:timers/promises");
const {Store}=require("../electron/store.cjs"),{Controller}=require("../electron/controller.cjs");
const {registerTeams,listRunsForStorage}=require("../electron/teams.cjs"),{registerTeamWorktrees,teamSessionDirectory}=require("../electron/team-worktrees.cjs");
async function setup(t,roles){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-team-auto-")),folder=path.join(root,"검증 프로젝트");await fs.mkdir(folder);
  const store=new Store(path.join(root,"설정"));await store.load();const project=await store.addProject(folder);
  const controller=new Controller(store,{descriptor:{command:process.execPath,node:true,label:"격리 검증 연결",prefix:[path.join(__dirname,"backend-fake-codex.cjs")]}}),api={};
  const register=(name,fn)=>api[name]=fn;registerTeamWorktrees(register,store,controller);
  const teams=registerTeams(register,store,controller,{worktreeState:(...args)=>api.teamWorktrees(...args),worktreeAction:(...args)=>api.teamWorktreeAction(...args)});
  const team=await api.saveTeam(project.id,{name:"자동 운영 검증",roles});
  t.after(async()=>{await controller.shutdown();await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
  async function wait(id,fn){for(let i=0;i<250;i++){const item=(await api.readTeams(project.id)).runs.find(r=>r.id===id);if(item&&fn(item.directed))return item;await delay(20);}throw Error("자동 팀 완료 대기 시간 초과");}
  return{root,folder,store,project,controller,api,teams,team,wait,create:(goal,options)=>api.directTeam(project.id,team.id,goal,randomUUID(),options)};
}
const roles=[{name:"구현",mode:"build",instruction:"작업을 구현하세요."},{name:"검수",mode:"review",instruction:"실제 구현 근거를 검토하세요."},{name:"추가 조사",mode:"plan",instruction:"빠진 근거를 보완하세요."}];
const picks=[{index:0,title:"구현 과업",task:"문제를 구현하세요.",steps:["변경 검증"]},{index:1,title:"검수 과업",task:"구현 결과를 검수하세요.",steps:["근거 대조"],targetIndex:0}];
test("자동 배부를 명시하면 팀장이 결과 뒤 추가 담당을 배정하고 실제 역할 대화와 종합 보고를 보관한다",async t=>{
  const s=await setup(t,roles);const r=await s.create("동적추가시험",{strategy:"plan",autoDispatch:true,autoPM:true,maxPMRounds:3,autoReport:true});
  const done=await s.wait(r.id,d=>d.phase==="done");assert.equal(done.directed.nodes.length,3);assert.equal(done.directed.pmRounds,2);
  assert(done.directed.notes.some(n=>n.type==="추가 배정"));assert(done.directed.nodes.every(n=>n.status==="done"));
  assert(done.directed.artifactPath);assert.match(await fs.readFile(path.join(s.folder,done.directed.artifactPath),"utf8"),/팀 결과 보고/);
  const usage=s.store.state.sessions.filter(v=>v.workflow?.teamSlot?.runId===r.id);assert.equal(usage.length,3);
});
test("자동 검수 보완은 구현과 검수를 실제 Codex 대화로 반복하고 사용자가 정한 횟수에 멈춘다",async t=>{
  const s=await setup(t,roles);
  let r=await s.create("자동QA시험",{strategy:"manual",assignments:picks,autoQA:true,maxQaRounds:2,autoReport:true});
  r=await s.api.changeTeamRun(s.project.id,r.id,{action:"dispatch",assignments:picks},r.directed.revision);
  r=await s.wait(r.id,d=>d.phase==="done");assert.equal(r.directed.nodes.find(n=>n.index===1).qaRounds,1);
  assert(r.directed.notes.some(n=>n.type==="자동 보완"));
  const build=s.store.session(r.directed.nodes.find(n=>n.index===0).sessionId);assert.equal(build.messages.filter(m=>m.role==="user").length,2);
  let limited=await s.create("자동QA한도시험",{strategy:"manual",assignments:picks,autoQA:true,maxQaRounds:1});
  limited=await s.api.changeTeamRun(s.project.id,limited.id,{action:"dispatch",assignments:picks},limited.directed.revision);
  limited=await s.wait(limited.id,d=>d.phase==="decisions");assert.equal(limited.directed.nodes.find(n=>n.index===1).qaRounds,1);
  assert(limited.directed.decisions.some(q=>!q.answer&&q.question.includes("보완")));
});
test("PM 반복 한도는 사용자 결정으로 끝내거나 연장하고 활성 팀 기록은 저장 공간 정리에서 보호한다",async t=>{
  const s=await setup(t,roles);let r=await s.create("동적추가시험",{strategy:"plan",autoDispatch:true,autoPM:true,maxPMRounds:1,autoReport:true});
  r=await s.wait(r.id,d=>d.phase==="decisions"&&d.decisions.some(q=>q.node===-3));
  const storage=await listRunsForStorage(s.store,s.project.id,s.controller);assert.equal(storage.find(x=>x.id===r.id).active,true);assert(storage[0].files.every(p=>p.startsWith(".flowrium/teams/")));
  const q=r.directed.decisions.find(q=>q.node===-3&&!q.answer);await s.api.changeTeamRun(s.project.id,r.id,{action:"answer",decisionId:q.id,text:"현재 결과로 마무리"},r.directed.revision);
  r=await s.wait(r.id,d=>d.phase==="done");assert.equal((await listRunsForStorage(s.store,s.project.id,s.controller)).find(x=>x.id===r.id).active,false);
});
test("선택한 자동 통합은 실제 역할 변경만 커밋하고 통합 담당자의 별도 작업 폴더에서 검증해 원래 브랜치를 보존한다",async t=>{
  const s=await setup(t,roles);await run("git",["init","--initial-branch=main"],{cwd:s.folder});await run("git",["config","user.name","검증 사용자"],{cwd:s.folder});await run("git",["config","user.email","fixture@example.invalid"],{cwd:s.folder});
  await run('git',['config','core.autocrlf','false'],{cwd:s.folder});
  await fs.writeFile(path.join(s.folder,".gitignore"),".flowrium/\n");await fs.writeFile(path.join(s.folder,"원본.txt"),"원래 프로젝트\n");await run("git",["add","."],{cwd:s.folder});await run("git",["commit","-m","검증 기준"],{cwd:s.folder});
  const original=(await run("git",["rev-parse","HEAD"],{cwd:s.folder})).stdout.trim();
  const send=s.controller.send.bind(s.controller);s.controller.send=async(input,internal)=>{
    const session=s.store.session(input.sessionId),slot=session.workflow?.teamSlot;
    if(slot?.isolated&&slot.mode==="build"){
      const cwd=await teamSessionDirectory(s.store,session,"build",s.controller);
      await fs.writeFile(path.join(cwd,slot.integration?"통합 검증.txt":"담당 변경.txt"),slot.integration?"통합 담당 검증\n":"역할 작업 결과\n");
    }
    return send(input,internal);
  };
  let r=await s.create("실제 통합 검증",{strategy:"manual",assignments:picks,isolate:true,autoIntegrate:true,integrationRoleIndex:0,autoReport:true});
  await s.api.changeTeamRun(s.project.id,r.id,{action:"dispatch",assignments:picks},r.directed.revision);
  r=await s.wait(r.id,d=>d.phase==="done");assert.equal(r.directed.integrationDone,true);
  const board=await s.api.teamWorktrees(s.project.id,r.id);assert.notEqual(board.integration.head,original);assert.equal(board.integration.conflicts.length,0);assert.equal(board.integration.files.length,0);
  assert.equal(await fs.readFile(path.join(board.integration.directory,"담당 변경.txt"),"utf8"),"역할 작업 결과\n");assert.equal(await fs.readFile(path.join(board.integration.directory,"통합 검증.txt"),"utf8"),"통합 담당 검증\n");
  assert.equal((await run("git",["rev-parse","HEAD"],{cwd:s.folder})).stdout.trim(),original);await assert.rejects(fs.access(path.join(s.folder,"담당 변경.txt")),{code:"ENOENT"});
  assert(s.store.state.sessions.some(session=>session.workflow?.teamSlot?.integration===true));
});
