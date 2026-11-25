const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {Store} = require('../electron/store.cjs');
const {Controller} = require('../electron/controller.cjs');
const {nativeSnapshot} = require('../electron/migration.cjs');
const {prepareTeamWorktrees} = require('../electron/team-worktrees.cjs');
const {randomUUID} = require('node:crypto');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-trust-')));
  const folder = path.join(root,'검증 프로젝트');
  const profile = path.join(root,'기기');
  await fs.mkdir(folder);
  let owner='시험 계정';
  const instance = () => new Store(profile,{projectTrustOwner:()=>owner});
  const store = instance();
  await store.load();
  const project = await store.addProject(folder);
  const session = await store.createSession(project.id);
  const controller = new Controller(store,{descriptor:{command:process.execPath,node:true,
    label:'격리된 시험 모델',prefix:[path.join(__dirname,'backend-fake-codex.cjs')]}});
  t.after(async()=>{
    await controller.shutdown();
    await fs.rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  });
  return {root,folder,profile,store,project,session,controller,instance,account:value=>{owner=value;}};
}
test('신뢰한 프로젝트는 계정과 실제 폴더가 같을 때만 다시 열리며 이관 자료에 승인을 포함하지 않는다',async t=>{
  const f=await fixture(t);
  assert.equal(await f.store.isProjectTrusted(f.project.id),false);
  await assert.rejects(f.store.requireProjectTrust(f.project.id),/먼저 신뢰/);
  assert.equal(await f.store.requestProjectTrust(f.project.id,async()=>false),false);
  let calls=0, resume;
  const gate=new Promise(resolve=>{resume=resolve;});
  const confirm=async target=>{
    calls++;
    assert.deepEqual(target,{name:f.project.name,path:f.folder});
    await gate;
    return true;
  };
  const checks=Array.from({length:8},()=>f.store.requestProjectTrust(f.project.id,confirm));
  resume();
  assert.deepEqual(await Promise.all(checks),Array(8).fill(true));
  assert.equal(calls,1);
  f.store.project(f.project.id).name='새 표시 이름';
  await f.store.save();
  const another=f.instance();await another.load();
  assert.equal(await another.requestProjectTrust(f.project.id,()=>assert.fail('중복 팝업')),true);
  f.account('다른 계정');
  assert.equal(await another.isProjectTrusted(f.project.id),false);
  await assert.rejects(another.requestProjectTrust(f.project.id,async()=>{f.account('첫 승인 이후 계정');return true;}),/먼저 신뢰/);
  f.account('signed-out');assert.equal(await another.isProjectTrusted(f.project.id),false);
  f.account('시험 계정');
  const snapshot=await nativeSnapshot(f.store,{includeFiles:true,includePrivate:false});
  assert(!snapshot.entries.some(entry=>entry.path.includes('project-trust')));
  const moved=path.join(f.root,'이동');
  await fs.rename(f.folder,moved);
  assert.equal(await f.store.isProjectTrusted(f.project.id),false);
  assert.equal((await f.store.addProject(moved)).id,f.project.id);
  assert.equal(await f.store.isProjectTrusted(f.project.id),false);
  await f.store.requestProjectTrust(f.project.id,async target=>target.path===moved);
  const original=path.join(f.root,'보존');
  await fs.rename(moved,original);await fs.cp(original,moved,{recursive:true});
  assert.equal(await f.store.isProjectTrusted(f.project.id),false);
});

test('최초 신뢰 전에는 일반 전송·긴 원문·대기열·팀 작업·분기·위조 승인 모두 초기 상태를 보존한다',async t=>{
  const f=await fixture(t);
  const api={};
  require('../electron/conversation-tools.cjs').registerConversationTools((name,handler)=>{api[name]=handler;},f.controller);
  const before=structuredClone(f.store.session(f.session.id));
  const input={sessionId:f.session.id,text:'가'.repeat(50000),mode:'build',trusted:true,trustedForFileAccess:true};
  for (const call of [
    ()=>f.controller.send(input),
    ()=>f.controller.send({...input,delivery:'steer'}),
    ()=>f.controller.messageQueue.enqueue(input),
    ()=>api.editConversation(f.session.id,{action:'branch'}),
    ()=>prepareTeamWorktrees(f.store,f.project.id,randomUUID(),[{name:'지정',mode:'build'}]),
    ()=>require('../electron/workbench.cjs').startWork(f.store,{projectId:f.project.id,kind:'task',title:'시작 확인'})
  ]) await assert.rejects(call(),/먼저 신뢰/);
  assert.deepEqual(f.store.session(f.session.id),before);
  assert.equal(f.controller.runs.size,0);
  assert.equal(f.store.state.sessions.length,1);
  for(const part of ['teams','attachments'])await assert.rejects(fs.stat(path.join(f.folder,'.flowrium',part)),{code:'ENOENT'});
});

test('계획·검토·새 대화·재개에서 과거 권한과 관계없이 실제 하위 폴더만 쓰고 기존 승인 정책을 유지한다',async t=>{
  const f=await fixture(t);
  await f.store.requestProjectTrust(f.project.id,async()=>true);
  const sub=path.join(f.folder,'작업 영역');await fs.mkdir(sub);
  f.controller.options.resolveProjectDirectory=async()=>sub;
  const calls=[];
  const request=f.controller.client.request.bind(f.controller.client);
  f.controller.client.request=(method,params,...rest)=>{calls.push({method,params});return request(method,params,...rest);};
  const record=f.store.session(f.session.id);
  for(const [mode,existing] of [['plan','read-only'],['build','danger-full-access'],['review','workspace-write']]){
    f.store.state.settings.chatDefaults={sandbox:'read-only',approval:'never'};
    record.preferences={sandbox:existing,networkAccess:false,approval:'on-request'};
    f.controller.loadedThreads.clear();
    const done=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('종료 이벤트 시간 초과')),6500);
      const listen=event=>{if(event.type==='done'&&event.sessionId===record.id){clearTimeout(timer);f.controller.off('event',listen);resolve(event);}};
      f.controller.on('event',listen);
    });
    await f.controller.send({sessionId:record.id,text:'폴더 확인',mode});
    assert.equal((await done).status,'completed');
    const current=calls.findLast(row=>row.method==='thread/start'||row.method==='thread/resume').params;
    assert.equal(current.sandbox,'workspace-write');assert.equal(current.cwd,sub);assert.equal(current.approvalPolicy,'on-request');assert.equal(current.approvalsReviewer,'auto_review');
    const turn=calls.findLast(row=>row.method==='turn/start').params;
    assert.equal(turn.cwd,sub);assert.equal(turn.approvalPolicy,'on-request');assert.equal(turn.approvalsReviewer,'auto_review');
    assert.deepEqual(turn.sandboxPolicy,{type:'workspaceWrite',writableRoots:[sub],excludeSlashTmp:true,excludeTmpdirEnvVar:true,networkAccess:false});
  }
  f.controller.options.resolveProjectDirectory=async()=>f.root;
  await assert.rejects(f.controller.conversationThreadParams(record),/신뢰한 프로젝트 안/);
});
