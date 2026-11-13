const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs'),{registerTeams}=require('../electron/teams.cjs');
const {startWork}=require('../electron/workbench.cjs');

test('종료는 실제 Controller의 마지막 팀 보고 이벤트와 뒤늦은 산출물 저장까지 끝난 후에만 팀 큐를 배출한다',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-team-exit-'));let controller,release,closing=false,blocked=0,runtime;
  const originalLstat=fs.lstat;
  try{
    await fs.mkdir(path.join(root,'project'));
    const store=new Store(path.join(root,'profile'));await store.load();const project=await store.addProject(path.join(root,'project')),api={};
    controller=new Controller(store,{descriptor:{command:process.execPath,node:true,label:'종료 검증 연결',prefix:[path.join(__dirname,'backend-fake-codex.cjs')]}});
    runtime=registerTeams((name,handler)=>api[name]=handler,store,controller,{canRun:()=>!closing});
    const team=await api.saveTeam(project.id,{name:'마지막 팀 보고',roles:[{name:'구현',mode:'build',instruction:'역할 결과 확인'},{name:'검토',mode:'review',instruction:'근거 확인'}]});
    const rows=[{index:0,title:'구현',task:'첫 결과',steps:[]},{index:1,title:'검토',task:'둘째 결과',steps:[]}];
    let run=await api.directTeam(project.id,team.id,'대기검증 종료 보고',randomUUID(),{strategy:'manual',assignments:rows,autoReport:true});
    run=await api.changeTeamRun(project.id,run.id,{action:'dispatch',assignments:rows},run.directed.revision);
    async function finish(one,text){
      store.session(one.sessionId).messages.push({id:randomUUID(),role:'assistant',text,createdAt:new Date().toISOString()});
      await controller.finish(one,'completed');
    }
    for(const role of [...controller.runs.values()]){await finish(role,'역할 수행 근거를 확인했습니다.');await api.readTeams(project.id);}
    run=(await api.readTeams(project.id)).runs.find(row=>row.id===run.id);assert.equal(run.directed.phase,'reporting');
    const report=controller.runs.get(run.directed.lead.sessionId);assert(report);
    const gate=new Promise(resolve=>release=resolve),teamFolder=path.join(project.path,'.flowrium','teams');
    fs.lstat=async function(file,...args){if(closing&&String(file)===teamFolder){blocked++;await gate;}return originalLstat.call(this,file,...args);};
    closing=true;await finish(report,'# 최종 팀 보고\n\n구현과 검토의 최종 결과입니다.');await controller.shutdown();
    assert.equal(controller.runs.size,0);assert.equal(runtime.isBusy(),true);
    for(let index=0;index<200&&!blocked;index++)await delay(5);assert(blocked>0);
    const folder=path.join(project.path,'.flowrium','teams','directed',run.id),records=await Promise.all((await fs.readdir(folder)).filter(name=>name.endsWith('.json')).map(async name=>JSON.parse(await fs.readFile(path.join(folder,name),'utf8'))));
    const before=records.sort((a,b)=>b.directed.revision-a.directed.revision)[0];assert.equal(before.directed.phase,'reporting');assert.equal(before.directed.artifactPath,undefined);
    let flushed=false;const shutdown=runtime.flush().then(()=>flushed=true);await delay(20);assert.equal(flushed,false);
    fs.lstat=originalLstat;release();await shutdown;assert.equal(flushed,true);assert.equal(runtime.isBusy(),false);
    const after=(await api.readTeams(project.id)).runs.find(row=>row.id===run.id);assert.equal(after.directed.phase,'done');assert(after.directed.artifactPath);
    assert.match(await fs.readFile(path.join(project.path,after.directed.artifactPath),'utf8'),/최종 팀 보고/);
    const restored=new Store(path.join(root,'profile'));await restored.load();assert.match(restored.session(report.sessionId).messages.findLast(message=>message.role==='assistant').text,/최종 팀 보고/);
  }finally{
    fs.lstat=originalLstat;release?.();if(controller)await controller.shutdown();if(runtime)await runtime.flush();
    await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
});

test('이미 완료 처리 중인 대화의 산출물이 늦어도 종료는 같은 완료 약속과 마지막 이벤트를 기다린다',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-finish-exit-'));
  const originalLstat=fs.lstat;let controller,release,finish,shutdown;
  try{
    await fs.mkdir(path.join(root,'project'));const store=new Store(path.join(root,'profile'));await store.load();
    const project=await store.addProject(path.join(root,'project'));
    const session=await startWork(store,{projectId:project.id,kind:'task',title:'완료 중 종료 확인',brief:'격리된 기록 보관 검증',role:'검토'});
    controller=new Controller(store,{descriptor:{command:process.execPath,node:true,label:'완료 중 종료 검증',prefix:[path.join(__dirname,'backend-fake-codex.cjs')]}});
    await controller.send({sessionId:session.id,mode:'plan',text:'대기검증'});
    let run;for(let index=0;index<500;index++){run=controller.runs.get(session.id);if(run?.turnId)break;await delay(10);}assert(run?.turnId);
    store.session(session.id).messages.push({id:randomUUID(),role:'assistant',text:'최종 응답과 보관 근거',createdAt:new Date().toISOString()});
    let blocked=0,done=0,exited=false;controller.on('event',event=>{if(event.type==='done'&&event.sessionId===session.id)done++;});
    const gate=new Promise(resolve=>release=resolve),artifactRoot=path.join(project.path,'산출물');
    fs.lstat=async function(file,...args){if(String(file)===artifactRoot){blocked++;await gate;}return originalLstat.call(this,file,...args);};
    finish=controller.finish(run,'completed');
    for(let index=0;index<500&&!blocked;index++)await delay(10);assert(blocked>0);assert.equal(run.finalized,true);
    assert.equal(controller.finish(run,'interrupted'),finish);
    shutdown=controller.shutdown().then(()=>exited=true);await delay(30);assert.equal(exited,false);assert.equal(done,0);
    fs.lstat=originalLstat;release();await Promise.all([finish,shutdown]);assert.equal(exited,true);assert.equal(done,1);assert.equal(controller.runs.size,0);
    const restored=new Store(path.join(root,'profile'));await restored.load();assert.match(restored.session(session.id).messages.findLast(message=>message.role==='assistant').text,/최종 응답과 보관 근거/);
  }finally{
    fs.lstat=originalLstat;release?.();if(finish)await finish;if(shutdown)await shutdown;if(controller)await controller.shutdown();
    await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
});
