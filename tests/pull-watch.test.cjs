const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {WorkflowRuntime} = require('../electron/workflow.cjs');
const {pullRequestUrl, pullWatchInterval, scanPullRequests} = require('../electron/pull-watch.cjs');
const {Store} = require('../electron/store.cjs');
const {addTrustedFixtureProject} = require('./project-trust-fixture.cjs');

const exec = promisify(execFile);
async function temporary(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-pr-watch-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:70}));
  return root;
}
function notices(value) {return value.notifications.filter(item=>item.kind==='github-pr');}

test('연결한 저장소만 감시하고, 같은 원격은 한 번 조회하며, 직접 닫힌 변경 요청과 다음 페이지도 읽는다',async t=>{
  const root=await temporary(t);
  const store=new Store(path.join(root,'profile'));
  await store.load();
  async function project(name,remote,trusted) {
    const dir=path.join(root,name);
    await fs.mkdir(dir);
    await exec('git',['init'],{cwd:dir});
    await exec('git',['remote','add','origin',remote],{cwd:dir});
    if(trusted)await addTrustedFixtureProject(store,dir);
    else await store.addProject(dir);
  }
  await project('repository-one','https://github.com/sample/guide.git',true);
  await project('repository-mirror','git@github.com:Sample/Guide.git',true);
  await project('untrusted','https://github.com/other/hidden.git',false);
  await project('different-host','https://other.example/other/hidden.git',true);
  const now=Date.UTC(2026,10,24,2,0,0), query=[];
  const record=(number,at)=>({number,title:`가상 요청 ${number}`,created_at:new Date(at).toISOString()});
  const pages=[Array.from({length:100},(_,offset)=>record(150-offset,now-1000-offset)),[record(50,now-2000),record(49,now-9000)]];
  const summary=await scanPullRequests(store,{enabledAt:now-4000,cursors:{}},now,{
    signal:new AbortController().signal,guard:()=>{},
    execute:async (command,args,options)=>{
      if(command==='git')return exec(command,args,options);
      assert.equal(command,'gh');
      assert.deepEqual(args.slice(0,3),['api','--hostname','github.com']);
      assert.match(args.at(-1),/^repos\/sample\/guide\/pulls\?state=all&sort=created&direction=desc&per_page=100&page=\d$/i);
      query.push(args.at(-1));
      return {stdout:JSON.stringify(pages[query.length-1])};
    },
  });
  assert.equal(query.length,2);
  assert.equal(summary.failures,0);
  assert.equal(summary.scanned[0].pulls.length,101);
  assert.equal(summary.scanned[0].key,'sample/guide');
  assert(summary.scanned[0].pulls.some(row=>row.number===50));
  assert(!summary.scanned[0].pulls.some(row=>row.number===49));
  assert.equal(pullRequestUrl('sample/guide',50),'https://github.com/sample/guide/pull/50');
  assert.throws(()=>pullRequestUrl('evil.example/../../path',50));
});

test('기본 비활성 / 10분 간격 / 재시작과 삭제 뒤 중복 없음 / 연결한 계정만 알림을 연다',async t=>{
  const root=await temporary(t);
  const controller=new EventEmitter();
  controller.status={authenticated:true};
  controller.options={modelAccount:()=> 'a'.repeat(64)};
  controller.runs=new Map();
  const store={file:path.join(root,'workspace.json'),state:{projects:[],sessions:[]}};
  let now=Date.UTC(2026,10,24,1),owner=1, calls=0, opened='',locked=false;
  const config={
    now:()=>now, accountRevision:()=>owner, canRun:()=>!locked, intervalMs:120000,
    scanPullRequests:async (_,at)=>{
      calls++;
      return {scanned:[{key:'demo/store',name:'demo/store',pulls:[{number:11,title:'가상 테스트 요청',created:at}]}],failures:0};
    },
    openPullRequest:async url=>{opened=url;},
  };
  let workflow=new WorkflowRuntime(store,controller,config);
  t.after(()=>workflow.shutdown());
  await workflow.checkPullRequests();
  assert.equal(calls,0);
  assert.equal((await workflow.state()).pullWatch.enabled,false);
  await workflow.action({action:'pullWatchSettings',enabled:true});
  await workflow.checkPullRequests();
  const first=await workflow.state(), [notice]=notices(first);
  assert.equal(calls,1);
  assert.equal(first.preferences.enabled,false);
  assert.equal(first.pullWatch.nextCheckAt,new Date(now+pullWatchInterval).toISOString());
  assert.equal(notice.body,'#11 가상 테스트 요청');
  await workflow.action({action:'pullWatchOpen',notificationId:notice.id});
  assert.equal(opened,'https://github.com/demo/store/pull/11');
  await workflow.action({action:'deleteNotifications',ids:[notice.id]});
  await workflow.shutdown();
  workflow=new WorkflowRuntime(store,controller,config);
  now+=pullWatchInterval-1;
  await workflow.checkPullRequests();
  assert.equal(calls,1);
  now++;
  locked=true;
  await workflow.checkPullRequests();
  assert.equal(calls,1);
  locked=false;
  await workflow.checkPullRequests();
  assert.equal(calls,2);
  assert.equal(notices(await workflow.state()).length,0);
  owner++;
  assert.equal((await workflow.state()).pullWatch.enabled,false);
  await assert.rejects(workflow.action({action:'pullWatchOpen',notificationId:notice.id}),/알림에서 다시 선택/);
});

test('조회 중 계정 전환 결과를 폐기하고 실패한 저장소만 마지막 확인 위치를 유지한다',async t=>{
  const root=await temporary(t);
  const controller=new EventEmitter();
  controller.status={authenticated:true};
  controller.options={modelAccount:()=> 'd'.repeat(64)};
  controller.runs=new Map();
  const started=Promise.withResolvers(), resume=Promise.withResolvers();
  let owner=7, scans=0, now=Date.UTC(2026,10,24,3);
  const inputSnapshots=[];
  const workflow=new WorkflowRuntime({file:path.join(root,'workspace.json'),state:{projects:[],sessions:[]}},controller,{
    now:()=>now,accountRevision:()=>owner,canRun:()=>true,intervalMs:120000,
    scanPullRequests:async (watch,at)=>{
      inputSnapshots.push(watch.cursors);
      if(++scans===3){started.resolve();await resume.promise;}
      return {scanned:[{key:'demo/ready',name:'demo/ready',pulls:scans===3?[{number:12,title:'계정을 바꾸기 전 시작한 조회',created:at}]:[]},
        {key:'demo/private',name:'demo/private'}],failures:1};
    },
  });
  t.after(()=>workflow.shutdown());
  await workflow.action({action:'pullWatchSettings',enabled:true});
  await workflow.checkPullRequests();
  assert.equal((await workflow.state()).pullWatch.failures,1);
  now+=pullWatchInterval;
  await workflow.checkPullRequests();
  assert.deepEqual(inputSnapshots[1],{'demo/ready':now-pullWatchInterval});
  now+=pullWatchInterval;
  const stale=workflow.checkPullRequests();
  await started.promise;
  owner++;
  assert.equal((await workflow.state()).pullWatch.enabled,false);
  resume.resolve();
  await stale;
  assert.equal(notices(await workflow.state()).length,0);
  owner--;
  assert.equal(notices(await workflow.state()).length,0);
});
