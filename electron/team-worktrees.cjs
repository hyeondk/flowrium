const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { UUID, createJSON, readJSON, projectDirectory } = require('./project-store.cjs');

const jobs = new Map();
const hash = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const validIndex = (n) => Number.isInteger(n) && n >= 0 && n <= 7;
const invalid = () => new Error('팀 작업 폴더 정보를 확인해 주세요.');
const changed = () => new Error('검토한 브랜치가 변경됐습니다. 차이를 다시 확인해 주세요.');
function serial(key, fn) {
  const next = (jobs.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  jobs.set(key, next);
  return next.finally(() => { if (jobs.get(key) === next) jobs.delete(key); });
}
async function git(cwd, args) {
  const env = { ...require('./runtime.cjs').runtimeEnvironment(), GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', GIT_PAGER: 'cat' };
  for (const name of ['GIT_DIR', 'GIT_INDEX_FILE','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[name];
  try {
    return (await execute('git', ['-C', cwd, '--literal-pathspecs','-c','core.fsmonitor=false',
      '-c','core.quotepath=false', ...args], { env, windowsHide:true, timeout: 90000, maxBuffer: 12 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git 실행 파일을 찾지 못했습니다.');
    const reason = (error.stderr || error.stdout || '').trim().replace(/(https?:\/\/)[^/\s]*@/g, '$1').slice(-1600);
    const e = new Error('Git 작업을 완료하지 못했습니다.' + (reason ? '\n' + reason : '')); e.code = error.code;
    throw e;
  }
}
async function verifyRef(cwd, ref) {
  try { return (await git(cwd, ['rev-parse','--verify','--quiet',ref + '^{commit}'])).trim(); }
  catch (e) { if (e.code === 1) return ''; throw e; }
}
async function ancestor(cwd, older, newer) {
  try { await git(cwd, ['merge-base','--is-ancestor',older,newer]); return true; }
  catch (e) { if (e.code === 1) return false; throw e; }
}
function samePath(a,b) { return path.relative(path.resolve(a),path.resolve(b)) === ''; }
async function checkedDir(folder, create) {
  if (create) await projectDirectory(folder);
  if (!(await fs.lstat(folder)).isDirectory() || !samePath(folder, await fs.realpath(folder))) throw invalid();
  return folder;
}
async function location(store, projectId, runId, create = false) {
  if (!UUID.test(projectId) || !UUID.test(runId)) throw invalid();
  const root = await checkedDir(store.project(projectId).path, false);
  let top;
  try { top = (await git(root,['rev-parse','--show-toplevel'])).trim(); }
  catch { throw new Error('격리된 팀 작업은 첫 커밋이 있는 Git 저장소를 프로젝트로 연결한 뒤 사용할 수 있습니다.'); }
  if (!top || !samePath(root, top)) throw new Error('연결할 프로젝트는 Git 저장소의 최상위 폴더여야 합니다.');
  let records = await checkedDir(path.join(root,'.flowrium'), false);
  const meta = await readJSON(path.join(records,'project.json'));
  if (meta.id !== projectId) throw invalid();
  for (const name of ['teams','worktrees']) records = await checkedDir(path.join(records,name), create);
  const localRoot = await fs.realpath(path.dirname(store.file));
  const local = path.join(localRoot,'team-worktrees',runId);
  if (create) {
    await checkedDir(path.dirname(local), true);
    await checkedDir(local,true);
  }
  return { root, projectId, runId, file:path.join(records,runId+'.json'), local };
}
function normalizeRoles(roles) {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > 8) throw invalid();
  return roles.map((r, index) => {
    if (!r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || !['plan','build','review'].includes(r.mode)) throw invalid();
    let owner = index;
    if (r.targetIndex != null) {
      if (r.mode === 'build' || !validIndex(r.targetIndex) || roles[r.targetIndex]?.mode !== 'build') throw invalid();
      owner = r.targetIndex;
    }
    return { name:r.name, mode:r.mode, owner };
  });
}
async function manifest(ctx) {
  const m = await readJSON(ctx.file);
  if (m.version !== 1 || m.runId !== ctx.runId || m.projectId !== ctx.projectId ||
    typeof m.baseBranch !== 'string' || !hash.test(m.base) || !Array.isArray(m.roles) || !m.roles.length || m.roles.length > 8) throw invalid();
  await git(ctx.root,['check-ref-format','refs/heads/'+m.baseBranch]);
  const roles = normalizeRoles(m.roles.map((r,i) => ({...r,targetIndex:r.owner !== i ? r.owner : undefined})));
  if (roles.some((r,i) => r.owner !== m.roles[i].owner)) throw invalid();
  return { ...ctx, base:m.base, baseBranch:m.baseBranch, roles };
}
function slot(ctx, index) {
  if (index !== -1 && (!validIndex(index) || !ctx.roles[index])) throw invalid();
  const owner = index === -1 ? -1 : ctx.roles[index].owner;
  const leaf = owner === -1 ? 'integration' : 'role-' + (owner+1);
  const branch = 'flowrium/' + ctx.runId + '/' + leaf;
  return { owner, branch, dir:path.join(ctx.local,leaf), archive:'refs/flowrium/archive/'+ctx.runId+'/'+leaf };
}
async function registered(ctx, selected) {
  const parts=(await git(ctx.root,['worktree','list','--porcelain','-z'])).split('\0\0');
  for (const part of parts) {
    const fields=part.split('\0'), location=fields.find((x) => x.startsWith('worktree '))?.slice(9);
    if (!location) continue;
    const branch = fields.find((x) => x.startsWith('branch '))?.slice(7);
    if (!samePath(location, selected.dir)) {
      if (branch === 'refs/heads/'+selected.branch) throw new Error('이 역할 브랜치는 다른 작업 폴더에서 열려 있습니다. 기존 폴더를 먼저 확인해 주세요.');
      continue;
    }
    if (branch !== 'refs/heads/'+selected.branch) throw new Error('역할 폴더에서 다른 브랜치를 사용하고 있습니다. 변경을 보존한 뒤 원래 브랜치로 돌아와 주세요.');
    for (const dir of [path.dirname(ctx.local),ctx.local,selected.dir]) await checkedDir(dir,false);
    if (!samePath((await git(selected.dir,['rev-parse','--show-toplevel'])).trim(),selected.dir)) throw invalid();
    return true;
  }
  return false;
}
async function openSlot(ctx, selected) {
  if (await registered(ctx,selected)) return;
  const existing = await verifyRef(ctx.root,'refs/heads/'+selected.branch);
  const archived = await verifyRef(ctx.root,selected.archive);
  await checkedDir(path.dirname(ctx.local),true); await checkedDir(ctx.local,true);
  try { await fs.lstat(selected.dir); throw new Error('작업 폴더 자리의 기존 파일을 보존했습니다. 경로를 확인해 주세요.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await git(ctx.root,['worktree','add',...(existing ? [selected.dir,selected.branch] :
    ['-b',selected.branch,selected.dir,archived || ctx.base])]);
}
async function prepareTeamWorktrees(store, projectId, runId, roles, {indices} = {}) {
  return serial(projectId,async () => {
    const ctx=await location(store,projectId,runId,true), planned=normalizeRoles(roles);
    try { await fs.access(ctx.file); }
    catch (e) {
      if (e.code!=='ENOENT') throw e;
      let baseBranch;
      try { baseBranch=(await git(ctx.root,['symbolic-ref','--quiet','--short','HEAD'])).trim(); }
      catch { throw new Error('격리 작업을 시작할 로컬 브랜치를 먼저 체크아웃해 주세요.'); }
      const base=await verifyRef(ctx.root,'HEAD');
      if (!hash.test(base)) throw new Error('프로젝트에 첫 커밋을 만든 뒤 격리 작업을 시작해 주세요.');
      await createJSON(ctx.file,{version:1,projectId,runId,baseBranch,base,roles:planned});
    }
    const data=await manifest(ctx);
    if (JSON.stringify(planned)!==JSON.stringify(data.roles)) throw new Error('처음 배정한 팀 역할과 현재 역할이 다릅니다.');
    const chosen=indices || planned.map((_,i)=>i);
    if (!Array.isArray(chosen) || !chosen.length || chosen.some((i)=>!validIndex(i)||!planned[i])) throw invalid();
    for (const owner of new Set(chosen.map((i)=>planned[i].owner))) await openSlot(data,slot(data,owner));
    return { base:data.base, baseBranch:data.baseBranch };
  });
}
async function teamSessionDirectory(store, session, mode, controller) {
  const assignment=session?.workflow?.teamSlot;
  if (!assignment?.isolated) return store.project(session.projectId).path;
  if (jobs.has(session.projectId)) await jobs.get(session.projectId).catch(()=>{});
  const data=await manifest(await location(store,session.projectId,assignment.runId));
  const selected=slot(data,assignment.integration===true?-1:assignment.index);
  if (!assignment.integration && selected.owner !== assignment.index && mode === 'build') throw new Error('다른 역할의 작업 폴더는 읽기 전용으로 검토할 수 있습니다.');
  for (const other of controller?.runs.values() || []) {
    if (other.sessionId === session.id || (mode !== 'build' && other.mode !== 'build')) continue;
    const assigned = store.state.sessions.find((s)=>s.id===other.sessionId)?.workflow?.teamSlot;
    const owner=assigned?.integration===true?-1:data.roles[assigned?.index]?.owner;
    if (assigned?.isolated && assigned.runId===assignment.runId && owner===selected.owner)
      throw new Error('이 격리 폴더를 사용하는 다른 역할 작업을 마친 뒤 다시 요청해 주세요.');
  }
  if (!await registered(data,selected)) throw new Error('이 역할의 작업 폴더를 팀 실행의 변경 검토 화면에서 다시 열어 주세요.');
  return selected.dir;
}
async function changes(dir) {
  return (await git(dir,['status','--porcelain=v1','--no-renames','--untracked-files=all','-z'])).split('\0')
    .filter(Boolean).map((s)=>({code:s.slice(0,2),file:s.slice(3)}));
}
async function mergeHead(dir) { return verifyRef(dir,'MERGE_HEAD'); }
async function info(ctx,index) {
  const selected=slot(ctx,index), exists=await registered(ctx,selected);
  const head=await verifyRef(ctx.root,'refs/heads/'+selected.branch);
  const archivedHead=head?'':await verifyRef(ctx.root,selected.archive);
  const files=exists ? await changes(selected.dir) : [];
  const conflicts=exists ? (await git(selected.dir,['diff','--name-only','--diff-filter=U','-z'])).split('\0').filter(Boolean) : [];
  return {index,name:index===-1?'통합':ctx.roles[index].name,owner:selected.owner,branch:selected.branch,
    directory:exists?selected.dir:'',head:head||archivedHead,archived:!!archivedHead,files,conflicts,mergeHead:exists?await mergeHead(selected.dir):''};
}
async function summary(ctx) {
  const result=[];
  for (let i=0;i<ctx.roles.length;i++) result.push(await info(ctx,i));
  return {base:ctx.base,baseBranch:ctx.baseBranch,roles:result,integration:await info(ctx,-1)};
}
function validFile(p) {
  return typeof p==='string' && p.length>0 && !p.includes('\0') && !path.isAbsolute(p) &&
    !p.split(/[\\/]/).some((part)=>part==='..'||part.toLowerCase()==='.git'||part.toLowerCase()==='.flowrium');
}
async function selectedFiles(dir,files) {
  if (!Array.isArray(files)||!files.length||files.length>250||files.some((p)=>!validFile(p))) throw invalid();
  const actual=new Set((await changes(dir)).map((r)=>r.file));
  if (files.some((p)=>!actual.has(p))) throw changed();
  return [...new Set(files)];
}
async function diff(ctx,current,file) {
  if (file !== undefined) {
    const [name]=await selectedFiles(current.dir,[file]);
    const listed=await changes(current.dir);
    if (listed.some((r)=>r.file===name && r.code==='??')) {
      const target=path.join(current.dir,name), stat=await fs.lstat(target);
      if (stat.isSymbolicLink()) return '새 심볼릭 링크 / '+await fs.readlink(target);
      if (!stat.isFile() || !samePath(await fs.realpath(target),target)) throw invalid();
      const handle=await fs.open(target,'r');
      try {
        const bytes=Buffer.alloc(Math.min(80000,stat.size)); await handle.read(bytes,0,bytes.length,0);
        return bytes.includes(0)?'바이너리 파일 / '+stat.size+' 바이트':bytes.toString('utf8')+(stat.size>bytes.length?'\n…':'');
      } finally { await handle.close(); }
    }
    return (await git(current.dir,['diff','--no-ext-diff','--no-textconv','HEAD','--',name])).slice(0,100000);
  }
  const tip=await verifyRef(ctx.root,'refs/heads/'+current.branch);
  if (!tip) throw changed();
  return (await git(ctx.root,['diff','--no-ext-diff','--no-textconv',ctx.base+'...'+tip])).slice(0,100000) || '기준 커밋과 차이가 없습니다.';
}
async function ensureClean(dir) {
  if ((await changes(dir)).length || await mergeHead(dir)) throw new Error('작업 폴더의 변경이나 병합을 먼저 마무리해 주세요.');
}
function hasActive(controller,store,ctx,owner) {
  return [...controller.runs.keys()].some((id)=>{
    const s=store.state.sessions.find((item)=>item.id===id), a=s?.workflow?.teamSlot;
    return s?.projectId===ctx.projectId && a?.isolated && a.runId===ctx.runId && (a.integration===true?-1:ctx.roles[a.index]?.owner)===owner;
  });
}
async function githubRepo(dir) {
  const url=(await git(dir,['remote','get-url','--push','origin'])).trim();
  const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (!match || match[1].split('/').some((s)=>s==='.'||s==='..')) throw new Error('GitHub 원격 저장소 origin을 연결해 주세요.');
  return match[1];
}
async function gh(dir,args) {
  try {return (await execute('gh',args,{cwd:dir,env:{...require('./runtime.cjs').runtimeEnvironment(),GH_PROMPT_DISABLED:'true'},timeout:90000,windowsHide:true})).stdout;}
  catch(e) { throw new Error('GitHub 요청을 완료하지 못했습니다. CLI 설치, 로그인, 저장소 권한을 확인해 주세요. '+
    (e.stderr||'').replace(/(https?:\/\/)[^/\s]*@/g,'$1').trim().slice(-900)); }
}
async function remoteStatus(ctx,current) {
  const repository=await githubRepo(ctx.root);
  const result=JSON.parse(await gh(ctx.root,['pr','list','--repo',repository,'--head',current.branch,'--base',ctx.baseBranch,
    '--state','all','--limit','20','--json','number,title,url,headRefOid,state,mergeable,isCrossRepository']));
  return {repository,branch:current.branch,pr:result.find((p)=>!p.isCrossRepository&&p.state==='OPEN')||
    result.find((p)=>!p.isCrossRepository)||null};
}
function registerTeamWorktrees(register,store,controller,canChange=()=>true) {
  register('teamWorktrees',async (projectId,runId)=>summary(await manifest(await location(store,projectId,runId))));
  register('teamWorktreeAction',(projectId,runId,input)=>serial(projectId,async ()=>{
    if (!input || typeof input!=='object') throw invalid();
    const ctx=await manifest(await location(store,projectId,runId)), current=slot(ctx,input.index);
    if (input.action==='remote' && input.index===-1) return remoteStatus(ctx,current);
    if (input.action==='diff') {
      if (input.file !== undefined && !await registered(ctx,current)) throw invalid();
      return diff(ctx,current,input.file);
    }
    if (input.index!==-1 && current.owner!==input.index) throw new Error('읽기 전용 검토 역할의 변경은 담당 역할에서 진행해 주세요.');
    if (!canChange() || hasActive(controller,store,ctx,current.owner)) throw new Error('진행 중인 역할 작업 또는 업데이트를 마친 뒤 다시 시도해 주세요.');
    if (input.action==='restore') { await openSlot(ctx,current); return '작업 폴더를 열었습니다.'; }
    if (!await registered(ctx,current)) throw new Error('역할 작업 폴더를 먼저 열어 주세요.');
    const dir=current.dir, head=await verifyRef(dir,'HEAD');
    if (head!==input.head) throw changed();
    switch(input.action) {
      case 'commit': {
        if (await mergeHead(dir)) throw new Error('충돌을 해결한 뒤 통합 완료를 선택해 주세요.');
        const files=await selectedFiles(dir,input.files);
        if (typeof input.message!=='string'||!input.message.trim()||input.message.length>240) throw invalid();
        await git(dir,['add','-A','--',...files]);
        await git(dir,['commit','--only','-m',input.message.trim(),'--',...files]);
        return '선택한 파일을 커밋했습니다.';
      }
      case 'integrate': {
        if (input.index===-1) throw invalid();
        await ensureClean(dir);
        const target=slot(ctx,-1);
        const targetHead=await verifyRef(ctx.root,'refs/heads/'+target.branch) || await verifyRef(ctx.root,target.archive) || ctx.base;
        if (targetHead!==input.integrationHead) throw changed();
        await openSlot(ctx,target); await ensureClean(target.dir);
        if (head===ctx.base || await ancestor(ctx.root,head,targetHead)) return '이미 통합된 커밋입니다.';
        try { await git(target.dir,['merge','--no-ff','--no-edit',head]); }
        catch(e) { if (await mergeHead(target.dir)) return '통합 폴더에 충돌을 보존했습니다. 파일별로 해결한 뒤 통합을 완료해 주세요.'; throw e; }
        return '검토한 역할 커밋을 통합 브랜치에 병합했습니다.';
      }
      case 'resolve': {
        if (input.index!==-1 || !await mergeHead(dir) || !['ours','theirs','manual'].includes(input.side) || !validFile(input.file)) throw invalid();
        const unmerged=(await git(dir,['ls-files','--unmerged','-z','--',input.file])).split('\0').filter(Boolean);
        if (!unmerged.length) throw changed();
        if (input.side==='manual') await git(dir,['add','-A','--',input.file]);
        else if (unmerged.some((line)=>line.split('\t')[0].endsWith(input.side==='ours'?' 2':' 3'))) {
          await git(dir,['checkout','--'+input.side,'--',input.file]); await git(dir,['add','--',input.file]);
        } else await git(dir,['rm','--',input.file]);
        return '선택한 파일의 충돌 해결을 기록했습니다.';
      }
      case 'finish': {
        if (input.index!==-1 || !await mergeHead(dir)) throw invalid();
        if ((await git(dir,['ls-files','--unmerged','-z'])).length) throw new Error('남은 충돌을 모두 해결해 주세요.');
        await git(dir,['commit','--no-edit']); return '통합 커밋을 만들었습니다.';
      }
      case 'abort': {
        if (input.index!==-1 || !await mergeHead(dir)) throw invalid();
        await git(dir,['merge','--abort']); return '진행하던 병합을 취소했습니다. 각 역할 브랜치는 보존했습니다.';
      }
      case 'publish':
      case 'openPR':
      case 'mergePR': {
        if (input.index !== -1) throw invalid();
        await ensureClean(dir);
        const repository=await githubRepo(ctx.root);
        if (input.action==='publish') {
          await git(dir,['push','--set-upstream','origin','refs/heads/'+current.branch+':refs/heads/'+current.branch]);
          return '검토한 통합 브랜치를 원격 저장소에 푸시했습니다.';
        }
        const status=await remoteStatus(ctx,current);
        if (input.action==='openPR') {
          if (status.pr?.state==='OPEN') return '이미 열린 변경 요청 / '+status.pr.url;
          if (typeof input.title!=='string'||!input.title.trim()||input.title.length>250||typeof input.body!=='string'||input.body.length>10000) throw invalid();
          const refs=await git(ctx.root,['ls-remote','--heads','origin','refs/heads/'+current.branch]);
          if (refs.split(/\s/)[0]!==head) throw new Error('검토한 통합 커밋을 먼저 푸시해 주세요.');
          const tmp=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'flowrium-pr-'));
          try {
            const body=path.join(tmp,'body.md');await fs.writeFile(body,input.body,{mode:0o600});
            return (await gh(dir,['pr','create','--repo',repository,'--head',current.branch,'--base',ctx.baseBranch,
              '--title',input.title.trim(),'--body-file',body])).trim();
          } finally { await fs.rm(tmp,{recursive:true,force:true}); }
        }
        if (!status.pr || status.pr.state!=='OPEN' || status.pr.number!==input.number || status.pr.headRefOid!==head) throw changed();
        await gh(dir,['pr','merge',String(input.number),'--repo',repository,'--merge','--match-head-commit',head]);
        return 'GitHub에서 검토한 변경 요청을 병합했습니다.';
      }
      case 'cleanup': {
        await ensureClean(dir);
        if ((await git(dir,['ls-files','--others','--directory','--no-empty-directory','-z'])).length)
          throw new Error('추적하지 않거나 무시한 파일이 남아 있어 작업 폴더를 보존했습니다.');
        await git(ctx.root,['update-ref',current.archive,head]);
        await git(ctx.root,['worktree','remove',dir]);
        await git(ctx.root,['update-ref','-d','refs/heads/'+current.branch,head]);
        return '작업 폴더와 역할 브랜치를 정리했습니다. 보존한 커밋에서 다시 열 수 있습니다.';
      }
      default: throw invalid();
    }
  }));
  return ()=>jobs.size>0;
}
module.exports={prepareTeamWorktrees,teamSessionDirectory,registerTeamWorktrees};
