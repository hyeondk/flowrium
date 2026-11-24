const fs = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {originName, slug} = require('./repository-inspection.cjs');
const {repositoriesFor} = require('./project-repositories.cjs');
const {accountEnvironment} = require('./repository-auth.cjs');
const {runtimeEnvironment} = require('./runtime.cjs');
const {UUID} = require('./project-store.cjs');

const run = promisify(execFile);
const pullWatchInterval = 10 * 60 * 1000;

function pullRequestUrl(repository, number) {
  const name = slug(repository);
  if (!Number.isSafeInteger(number) || number < 1) throw Error('깃허브 변경 요청 번호를 확인해 주세요.');
  return `https://github.com/${name}/pull/${number}`;
}

function validTime(value) {
  return Number.isSafeInteger(value) && value>0 && value<8640000000000000-pullWatchInterval;
}

function savedPullWatch(value) {
  if (value?.enabled!==true || !UUID.test(value.key) || !validTime(value.enabledAt)) return;
  const cursors={};
  if (value.cursors && typeof value.cursors==='object' && !Array.isArray(value.cursors)) {
    for (const [name,at] of Object.entries(value.cursors)) {
      if (validTime(at)) {
        try { cursors[slug(name).toLowerCase()]=at; } catch { /* Previous invalid repository key. */ }
      }
    }
  }
  return {
    enabled:true,key:value.key,enabledAt:value.enabledAt,cursors,
    lastCheckedAt:validTime(value.lastCheckedAt)?value.lastCheckedAt:undefined,
    repositories:Number.isSafeInteger(value.repositories)&&value.repositories>=0?value.repositories:0,
    failures:Number.isSafeInteger(value.failures)&&value.failures>=0?value.failures:0,
  };
}

function watchSummary(watch, running) {
  return {
    enabled: watch?.enabled === true,
    running,
    ...(watch?.lastCheckedAt && {
      lastCheckedAt:new Date(watch.lastCheckedAt).toISOString(),
      nextCheckAt:new Date(watch.lastCheckedAt+pullWatchInterval).toISOString(),
    }),
    repositories: watch?.repositories || 0,
    failures: watch?.failures || 0,
  };
}

async function listPullTargets(store, execute, env, signal, guard) {
  const projects = store.state.projects;
  const targets = new Map();
  let failures = 0;
  for (let index=0;index<projects.length;index+=4) {
    await Promise.all(projects.slice(index,index+4).map(async project=>{
      guard();
      if (!await store.isProjectTrusted(project.id)) return;
      try {
        for (const repository of await repositoriesFor(store,project)) {
          guard();
          const invokeGit = async args=>(await execute('git',args,{
            cwd:repository.cwd,env,signal,timeout:5000,windowsHide:true,maxBuffer:128*1024,
          })).stdout.trim();
          let root;
          try { root=await invokeGit(['rev-parse','--show-toplevel']); }
          catch { continue; }
          if (await fs.realpath(root)!==repository.cwd) continue;
          let name;
          if (repository.github) name=slug(repository.github);
          else {
            const origin=await invokeGit(['remote','get-url','origin']).catch(()=> '');
            name=originName(origin);
          }
          if (!name) continue;
          const key=name.toLowerCase();
          if (!targets.has(key) || (!targets.get(key).account && repository.account)) {
            targets.set(key,{key,name,account:repository.account,cwd:repository.cwd});
          }
        }
      } catch { failures++; }
    }));
  }
  return {targets:[...targets.values()],failures};
}

async function fetchPullRequests(target, since, until, execute, env, signal, guard) {
  const selected = await accountEnvironment(target.account,env,target.cwd,execute);
  const rows = [];
  for (let page=1;;page++) {
    guard();
    const query=`repos/${target.name}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`;
    const {stdout}=await execute('gh',['api','--hostname','github.com','--jq','map({number,title,created_at})',query],{
      cwd:target.cwd,env:selected,signal,timeout:12000,windowsHide:true,maxBuffer:1024*1024,
    });
    const pageRows=JSON.parse(stdout);
    if (!Array.isArray(pageRows)) throw Error('깃허브 변경 요청 목록을 읽지 못했습니다.');
    if (!pageRows.length) return rows;
    for (const item of pageRows) {
      const created=Date.parse(item?.created_at);
      if (!Number.isFinite(created) || !Number.isSafeInteger(item.number) || item.number<1 || typeof item.title!=='string')
        throw Error('깃허브 변경 요청의 형식을 확인해 주세요.');
      if (created<since) return rows;
      if (created<=until) rows.push({number:item.number,title:item.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300),created});
    }
    if (pageRows.length<100) return rows;
  }
}

async function scanPullRequests(store, watch, now, {signal,guard,execute=run}) {
  const env={...runtimeEnvironment(),GH_PROMPT_DISABLED:'true',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
  if (process.platform==='darwin') env.PATH+=':/opt/homebrew/bin:/usr/local/bin';
  const result=await listPullTargets(store,execute,env,signal,guard);
  const scanned=[];
  for (let index=0;index<result.targets.length;index+=4) {
    const rows=await Promise.all(result.targets.slice(index,index+4).map(async target=>{
      const since=Math.max(watch.enabledAt,(watch.cursors[target.key]||watch.enabledAt)-1000);
      try { return {key:target.key,name:target.name,pulls:await fetchPullRequests(target,since,now,execute,env,signal,guard)}; }
      catch { return {key:target.key,name:target.name}; }
    }));
    scanned.push(...rows);
  }
  guard();
  return {scanned,failures:result.failures+scanned.filter(row=>!row.pulls).length};
}

module.exports={pullWatchInterval,pullRequestUrl,savedPullWatch,scanPullRequests,watchSummary};
