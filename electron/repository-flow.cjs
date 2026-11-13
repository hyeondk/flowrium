const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { repositoryFor, repositoriesFor } = require('./project-repositories.cjs');
const { atomic } = require('./portfolio-operations.cjs');
const exec=promisify(execFile);
const steps=['commit','push','pr','merge','done'];
const hash=(text)=>createHash('sha256').update(text).digest('hex');
function safeFile(value){if(typeof value!=='string'||!value||value.length>1500||path.isAbsolute(value)||value.includes('\\')||/[\x00-\x1f:]/.test(value)||value.split('/').some(p=>!p||['..','.git','.flowrium'].includes(p)))throw Error('선택한 파일 경로를 확인해 주세요.');return value;}
async function git(cwd,args){try{return (await exec('git',args,{cwd,env:{...require('./runtime.cjs').runtimeEnvironment(),GIT_TERMINAL_PROMPT:'0'},windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})).stdout;}catch(e){throw Error((e.stderr||e.message).trim().slice(-1500));}}
async function snapshot(repo,files=[]){
  const head=(await git(repo.cwd,['rev-parse','HEAD']).catch(()=>'' )).trim(),branch=(await git(repo.cwd,['branch','--show-current'])).trim();
  const status=await git(repo.cwd,['status','--porcelain=v1','--no-renames','-z','--untracked-files=all','--','.',':(exclude).flowrium',':(exclude).flowrium/**']);
  const values=[];
  for(const file of files){safeFile(file);const target=path.join(repo.cwd,...file.split('/'));try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32*1024*1024||path.relative(target,await fs.realpath(target)))throw Error('정리할 파일을 확인해 주세요.');values.push([file,hash(await fs.readFile(target))]);}catch(e){if(e.code==='ENOENT')values.push([file,'deleted']);else throw e;}}
  const indexPath=(await git(repo.cwd,['rev-parse','--git-path','index'])).trim();
  const remotes=await git(repo.cwd,['remote','-v']);
  const index=await fs.readFile(path.resolve(repo.cwd,indexPath)).catch(e=>{if(e.code==='ENOENT')return Buffer.alloc(0);throw e;});
  return {head,branch,key:hash(JSON.stringify([head,branch,status,values,hash(index),hash(remotes)]))};
}
function registerRepositoryFlow(register,store,action,{isUpdating=()=>false,isSessionRunning=()=>false,onEvent=()=>{}}={}){
  const directory=path.join(path.dirname(store.file),'repository-flows'),backups=path.join(path.dirname(store.file),'repository-backups');
  let busy=false;
  const file=id=>{if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw Error('실행 기록을 확인해 주세요.');return path.join(directory,id+'.json');};
  const save=run=>atomic(file(run.id),run);
  async function load(id){return JSON.parse(await fs.readFile(file(id),'utf8'));}
  async function check(run){for(const row of run.rows){const repo=await repositoryFor(store,run.projectId,row.repositoryId);const current=await snapshot(repo,row.files);if(current.key!==row.expected.key)throw Error(repo.name+' 저장소가 변경됐습니다. 실행 계획을 다시 확인해 주세요.');}}
  async function execute(run){
    if(busy||isUpdating())throw Error('다른 작업이 끝난 뒤 다시 실행하세요.');busy=true;
    try{
      await check(run);run.state='running';run.error='';await save(run);
      for(const row of run.rows){
        const repo=await repositoryFor(store,run.projectId,row.repositoryId),invoke=input=>action(run.projectId,{...input,repositoryId:row.repositoryId});
        for(const stage of steps.slice(0,steps.indexOf(row.through)+1)){
          if(row.completed.includes(stage))continue;
          if(isUpdating())throw Error('앱 상태가 변경되어 실행을 멈췄습니다.');
          const actual=await snapshot(repo,row.files);if(actual.key!==row.expected.key)throw Error(repo.name+'의 파일이나 브랜치가 변경됐습니다.');
          if(stage==='commit'&&row.files.length)row.log.push(await invoke({action:'commit',files:row.files,message:row.message}));
          if(stage==='push')row.log.push(await invoke({action:'push'}));
          if(stage==='pr'||stage==='merge'){
            let list=await invoke({action:'prs'}),pr=list.find(p=>p.headRefName===row.expected.branch&&p.baseRefName===row.base);
            if(!pr&&stage==='pr'){
              row.log.push(await invoke({action:'createPR',base:row.base,title:row.title,body:row.body}));
              list=await invoke({action:'prs'});pr=list.find(p=>p.headRefName===row.expected.branch&&p.baseRefName===row.base);
            }
            if(!pr)throw Error('현재 브랜치의 변경 요청을 찾지 못했습니다.');
            if(pr.headRefOid!==row.expected.head)throw Error('변경 요청의 커밋이 현재 계획과 다릅니다.');
            row.pull={number:pr.number,head:pr.headRefOid};
            if(stage==='merge')row.log.push(await invoke({action:'merge',number:pr.number,head:pr.headRefOid}));
          }
          if(stage==='done'&&row.sessionId){
            if(isSessionRunning(row.sessionId))throw Error('실행 중인 업무는 완료할 수 없습니다.');
            const session=store.session(row.sessionId);if(session.projectId!==run.projectId)throw Error('프로젝트 업무를 확인해 주세요.');
            session.workflow ||= require('./workbench.cjs').validateWorkflow({kind:'task',status:'active',role:'프로젝트 실무 담당자',brief:'',audience:'',from:'',to:'',checklist:[]});
            session.workflow.status='done';session.workflow.completion={at:new Date().toISOString(),summary:row.message,commits:row.expected.head?[{hash:row.expected.head,at:new Date().toISOString(),subject:row.message}]:[]};
            session.updatedAt=new Date().toISOString();await store.save();
          }
          row.completed.push(stage);row.expected=await snapshot(repo,row.files);run.updatedAt=new Date().toISOString();await save(run);
        }
      }
      run.state='done';await save(run);onEvent({kind:'repository',title:'저장소 통합 실행 완료',runId:run.id});return run;
    }catch(e){run.state='failed';run.error=e.message;await save(run);return run;}finally{busy=false;}
  }
  register('repositoryFlow',async input=>{
    if(!input||typeof input!=='object')throw Error('저장소 실행 요청을 확인해 주세요.');
    if(input.action==='list'){
      const names=await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      const runs=await Promise.all(names.filter(n=>/^[0-9a-f-]{36}\.json$/.test(n)).map(async n=>JSON.parse(await fs.readFile(path.join(directory,n),'utf8'))));
      return runs.filter(r=>r.projectId===input.projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
    }
    if(input.action==='read')return load(input.id);
    if(input.action==='plan'){
      if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>32||new Set(input.rows.map(r=>r.repositoryId)).size!==input.rows.length)throw Error('저장소 실행 항목을 확인해 주세요.');
      const run={version:1,id:randomUUID(),projectId:input.projectId,state:'planned',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:'',rows:[]};
      for(const row of input.rows){
        if(!steps.includes(row.through)||!Array.isArray(row.files)||row.files.length>200)throw Error('실행 단계를 확인해 주세요.');
        const repo=await repositoryFor(store,input.projectId,row.repositoryId),files=[...new Set(row.files.map(safeFile))];
        const selected=await action(input.projectId,{action:'changes',repositoryId:repo.id});
        if(files.some(f=>!selected.some(c=>c.file===f)))throw Error('선택한 변경 파일이 없습니다. 새로고침해 주세요.');
        if(files.length&&(!row.message?.trim()||row.message.length>240))throw Error('커밋 제목을 입력해 주세요.');
        if(steps.indexOf(row.through)>=2&&(!row.title?.trim()||row.title.length>240||!row.body?.trim()||row.body.length>10000))throw Error('변경 요청 제목과 설명을 입력해 주세요.');
        const expected=await snapshot(repo,files);if(!expected.branch)throw Error('이름이 있는 브랜치를 선택해 주세요.');
        const base=row.base||repo.base||'main';await git(repo.cwd,['check-ref-format','--branch',base]);
        if(row.sessionId&&store.session(row.sessionId).projectId!==input.projectId)throw Error('완료할 업무를 확인해 주세요.');
        run.rows.push({repositoryId:repo.id,name:repo.name,files,message:row.message||'',base,title:row.title||'',body:row.body||'',through:row.through,sessionId:row.sessionId||null,expected,completed:[],log:[]});
      }
      await save(run);return run;
    }
    if(input.action==='execute'||input.action==='resume'){const run=await load(input.id);const allowed=input.action==='resume'?['planned','failed','running']:['planned','failed'];if(!allowed.includes(run.state)||run.kind)throw Error('실행 가능한 계획을 선택해 주세요.');return execute(run);}
    if(input.action==='planClean'){
      const repo=await repositoryFor(store,input.projectId,input.repositoryId);
      const files=[...new Set((input.files||[]).map(safeFile))];if(files.length>200)throw Error('정리할 파일은 200개까지 선택하세요.');
      if(files.some(f=>/(^|\/)(\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)$)/i.test(f)))throw Error('인증 정보 파일은 이 정리 도구에서 제외됩니다.');
      const changes=await action(input.projectId,{action:'changes',repositoryId:repo.id});if(files.some(f=>!changes.some(c=>c.file===f)))throw Error('확인한 변경 파일만 정리할 수 있습니다.');
      const expected=await snapshot(repo,files),upstream=(await git(repo.cwd,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']).catch(()=>'' )).trim();
      const commits=upstream?(await git(repo.cwd,['log','--format=%H%x09%s',upstream+'..HEAD'])).trim().split(/\r?\n/).filter(Boolean):[];
      if(input.dropCommits&&(!upstream||!commits.length))throw Error('정리할 미푸시 커밋이 없습니다.');
      const plan={version:1,id:randomUUID(),kind:'clean',projectId:input.projectId,repositoryId:repo.id,state:'planned',createdAt:new Date().toISOString(),files,dropCommits:input.dropCommits===true,expected,upstream,commits};await save(plan);return plan;
    }
    if(input.action==='clean'){
      if(busy||isUpdating())throw Error('실행 중인 작업이 끝난 뒤 정리하세요.');busy=true;
      let plan,repo,changed=false;
      try{
        plan=await load(input.id);if(plan.kind!=='clean'||plan.state!=='planned')throw Error('정리 계획을 다시 확인해 주세요.');
        repo=await repositoryFor(store,plan.projectId,plan.repositoryId);if((await snapshot(repo,plan.files)).key!==plan.expected.key)throw Error('파일이나 브랜치가 변경됐습니다. 정리 계획을 다시 만드세요.');
        const backup=path.join(backups,plan.id);await fs.mkdir(path.join(backup,'files'),{recursive:true});
        const originals=[];
        for(const f of plan.files){try{const bytes=await fs.readFile(path.join(repo.cwd,...f.split('/'))),to=path.join(backup,'files',...f.split('/'));await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes,{mode:0o600,flag:'wx'});originals.push({path:f,exists:true,key:hash(bytes)});}catch(e){if(e.code!=='ENOENT')throw e;originals.push({path:f,exists:false});}}
        const ref='refs/flowrium-backups/'+plan.id;if(plan.expected.head)await git(repo.cwd,['update-ref',ref,plan.expected.head]);
        const indexPath=path.resolve(repo.cwd,(await git(repo.cwd,['rev-parse','--git-path','index'])).trim());
        const originalIndex=await fs.readFile(indexPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(originalIndex)await fs.writeFile(path.join(backup,'git-index'),originalIndex,{flag:'wx',mode:0o600});
        await atomic(path.join(backup,'manifest.json'),{...plan,backupRef:ref,originals,index:originalIndex?hash(originalIndex):null});
        if((await snapshot(repo,plan.files)).key!==plan.expected.key)throw Error('백업 중 저장소가 변경돼 정리를 멈췄습니다.');changed=true;
        if(plan.dropCommits){const upstream=(await git(repo.cwd,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}'])).trim();if(upstream!==plan.upstream)throw Error('원격 추적 브랜치가 변경됐습니다.');await git(repo.cwd,['reset','--mixed',plan.upstream]);}
        const base=plan.dropCommits?plan.upstream:'HEAD';
        for(const f of plan.files){const tracked=await git(repo.cwd,['ls-tree','-r','--name-only',base,'--',':(literal)'+f]).catch(()=>'' );if(tracked.trim())await git(repo.cwd,['restore','--source='+base,'--staged','--worktree','--',':(literal)'+f]);else await fs.rm(path.join(repo.cwd,...f.split('/')),{force:true});}
        plan.state='done';plan.backup=plan.id;plan.after=await snapshot(repo,plan.files);await save(plan);return plan;
      }catch(error){if(changed){plan.state='failedClean';plan.error=error.message;plan.after=await snapshot(repo,plan.files);plan.backup=plan.id;await save(plan);return plan;}throw error;}finally{busy=false;}
    }
    if(input.action==='restoreClean'){
      if(busy||isUpdating())throw Error('실행 중인 작업이 끝난 뒤 복원하세요.');busy=true;
      try{
      const plan=await load(input.id);if(plan.kind!=='clean'||!['done','failedClean'].includes(plan.state))throw Error('복원할 정리 기록을 선택하세요.');const repo=await repositoryFor(store,plan.projectId,plan.repositoryId);
      if((await snapshot(repo,plan.files)).key!==plan.after.key)throw Error('정리 후 저장소가 변경됐습니다. 백업을 보존한 상태로 수동 비교해 주세요.');
      const backup=path.join(backups,plan.id),manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
      if(manifest.id!==plan.id||!Array.isArray(manifest.originals)||JSON.stringify(manifest.originals.map(f=>f.path))!==JSON.stringify(plan.files))throw Error('복원할 백업 목록을 확인하지 못했습니다.');
      const originals=[];for(const original of manifest.originals){const bytes=original.exists?await fs.readFile(path.join(backup,'files',...safeFile(original.path).split('/'))):null;if(bytes&&hash(bytes)!==original.key)throw Error('백업 파일이 변경돼 복원을 멈췄습니다.');originals.push({...original,bytes});}
      const originalIndex=manifest.index?await fs.readFile(path.join(backup,'git-index')):null;if(originalIndex&&hash(originalIndex)!==manifest.index)throw Error('백업 인덱스가 변경돼 복원을 멈췄습니다.');
      if(plan.dropCommits)await git(repo.cwd,['reset','--mixed','refs/flowrium-backups/'+plan.id]);
      for(const f of originals){const to=path.join(repo.cwd,...f.path.split('/'));if(f.bytes){await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,f.bytes,{mode:0o600});}else await fs.rm(to,{force:true});}
      const indexPath=path.resolve(repo.cwd,(await git(repo.cwd,['rev-parse','--git-path','index'])).trim());
      if(originalIndex)await fs.writeFile(indexPath,originalIndex);else await fs.rm(indexPath,{force:true});
      plan.state='restored';await save(plan);return plan;
      }finally{busy=false;}
    }
    throw Error('지원하지 않는 저장소 실행 요청입니다.');
  });
  return ()=>busy;
}
module.exports={registerRepositoryFlow,snapshot};
