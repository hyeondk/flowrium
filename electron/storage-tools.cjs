const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {gzip,gunzip}=require('node:zlib'),{promisify}=require('node:util');
const compress=promisify(gzip),expand=promisify(gunzip),hash=b=>createHash('sha256').update(b).digest('hex');
const {atomic}=require('./portfolio-operations.cjs'),{UUID}=require('./project-store.cjs');
async function walk(root,base=root){
  const result=[];let list;try{list=await fs.readdir(base,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
  for(const d of list){const file=path.join(base,d.name);if(d.isSymbolicLink())continue;if(d.isDirectory())result.push(...await walk(root,file));else if(d.isFile()){const st=await fs.lstat(file);result.push({file,relative:path.relative(root,file).split(path.sep).join('/'),size:st.size,mtime:st.mtimeMs});}}
  return result;
}
function safeRelative(value){if(typeof value!=='string'||path.isAbsolute(value)||value.includes('\\')||/[\x00-\x1f:]/.test(value)||value.split('/').some(p=>!p||p==='..')||!/^\.flowrium\/(sessions|teams|attachments|drive-cache)\//.test(value))throw Error('보관할 기록 경로를 확인해 주세요.');return value;}
async function recordPath(root,relative,create=false){
  const parts=safeRelative(relative).split('/'),name=parts.pop();let at=await fs.realpath(root);
  for(const part of parts){at=path.join(at,part);if(create)await fs.mkdir(at).catch(e=>{if(e.code!=='EEXIST')throw e;});const stat=await fs.lstat(at);if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(at,await fs.realpath(at)))throw Error('기록 폴더가 다른 위치를 가리켜 작업을 멈췄습니다.');}
  return path.join(at,name);
}
function registerStorageTools(register,store,{isRunning=()=>false,isTeamRunning=()=>false,getTeamRuns,canRun=()=>true}={}){
  const directory=path.join(path.dirname(store.file),'storage-backups'),plans=new Map();let busy=false;
  async function teamRuns(projectId){if(getTeamRuns)return getTeamRuns(projectId);const helper=require('./teams.cjs').listRunsForStorage;return helper?helper(store,projectId):[];}
  async function report(){
    const rows=[];for(const p of store.state.projects){
      const groups={sessions:0,teams:0,attachments:0,driveCache:0,other:0};
      for(const f of await walk(path.join(p.path,'.flowrium'))){const prefix=f.relative.split('/')[0];groups[prefix==='sessions'?'sessions':prefix==='teams'?'teams':prefix==='attachments'?'attachments':prefix==='drive-cache'?'driveCache':'other']+=f.size;}
      rows.push({projectId:p.id,name:p.name,...groups,total:Object.values(groups).reduce((n,b)=>n+b,0)});
    }
    const backups=await walk(directory),total=rows.reduce((n,r)=>n+r.total,0),sessions=store.state.sessions.length;
    const warnings=[...(sessions>400?['대화 '+sessions+'개']:[]),...(total>500*1024*1024?['기록 '+Math.round(total/1024/1024)+'MB']:[])];
    return {projects:rows,total,sessionCount:sessions,backupBytes:backups.reduce((n,r)=>n+r.size,0),warnings};
  }
  async function references(excluded){
    const used=new Set();for(const s of store.state.sessions){if(excluded.has(s.id))continue;for(const m of [...s.messages,...(s.queuedMessages||[])])for(const a of m.attachments||[])used.add(a.id);}
    for(const f of await walk(path.join(path.dirname(store.file),'composer-drafts'))){if(f.size>16*1024*1024||!f.file.endsWith('.json'))continue;const content=await fs.readFile(f.file,'utf8');for(const m of content.matchAll(/"id"\s*:\s*"([0-9a-f-]{36})"/g))used.add(m[1]);}
    return used;
  }
  async function candidate(input){
    if(![3,7,30].includes(input.days)||!Array.isArray(input.kinds)||input.kinds.some(k=>!['sessions','teams','attachments','driveCache'].includes(k)))throw Error('기간과 자료 종류를 선택해 주세요.');
    const cutoff=Date.now()-input.days*86400000,plan={id:randomUUID(),createdAt:new Date().toISOString(),days:input.days,kinds:input.kinds,sessions:[],teams:[],files:[],bytes:0};
    const protect=new Set();
    for(const p of store.state.projects)for(const run of await teamRuns(p.id)){
      if(run.active||isTeamRunning(run.id)||Date.parse(run.updatedAt)>=cutoff||!input.kinds.includes('teams'))for(const id of run.sessionIds)protect.add(id);
      else plan.teams.push({...run,projectId:p.id});
    }
    const selectedTeamSessions=new Set(plan.teams.flatMap(r=>r.sessionIds));
    for(const s of store.state.sessions)if((input.kinds.includes('sessions')||selectedTeamSessions.has(s.id))&&Date.parse(s.updatedAt)<cutoff&&!isRunning(s.id)&&!s.personalAssistant&&!protect.has(s.id)&&(!s.workflow?.teamSlot||selectedTeamSessions.has(s.id))){plan.sessions.push({id:s.id,projectId:s.projectId,title:s.title,key:hash(JSON.stringify(s))});}
    const excluded=new Set(plan.sessions.map(s=>s.id)),refs=await references(excluded);
    for(const p of store.state.projects){
      const add=async relative=>{const file=await recordPath(p.path,relative),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||path.relative(file,await fs.realpath(file)))throw Error('일반 기록 파일만 보관할 수 있습니다.');const bytes=await fs.readFile(file);plan.files.push({projectId:p.id,path:relative,size:st.size,key:hash(bytes)});plan.bytes+=st.size;};
      for(const f of await walk(path.join(p.path,'.flowrium','sessions'))){const id=f.relative.split('--')[0];if(excluded.has(id))await add('.flowrium/sessions/'+f.relative);}
      for(const r of plan.teams.filter(r=>r.projectId===p.id))for(const f of r.files)await add(f);
      if(input.kinds.includes('attachments')){
        const groups=new Map();for(const f of await walk(path.join(p.path,'.flowrium','attachments'))){const id=f.relative.split('/')[0];if(!groups.has(id))groups.set(id,[]);groups.get(id).push(f);}
        for(const [id,files] of groups)if(UUID.test(id)&&!refs.has(id)&&files.every(f=>f.mtime<cutoff))for(const f of files)await add('.flowrium/attachments/'+f.relative);
      }
      if(input.kinds.includes('driveCache'))for(const f of await walk(path.join(p.path,'.flowrium','drive-cache')))if(f.mtime<cutoff)await add('.flowrium/drive-cache/'+f.relative);
    }
    const unique=new Map(plan.files.map(f=>[f.projectId+'/'+f.path,f]));plan.files=[...unique.values()];plan.bytes=plan.files.reduce((n,f)=>n+f.size,0);return plan;
  }
  register('storageAction',async input=>{
    if(!input||typeof input!=='object')throw Error('저장 공간 요청을 확인해 주세요.');
    if(input.action==='report')return report();
    if(input.action==='plan'){const plan=await candidate(input);plans.clear();plans.set(plan.id,plan);return {...plan,sessionCount:plan.sessions.length,teamCount:plan.teams.length};}
    if(input.action==='backups'){
      const list=await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const out=[];
      for(const id of list.filter(v=>UUID.test(v))){try{const m=JSON.parse(await fs.readFile(path.join(directory,id,'manifest.json'),'utf8'));out.push({id,at:m.createdAt,restored:!!m.restored,sessions:m.sessions.length,files:m.files.length});}catch{}}
      return out.sort((a,b)=>b.at.localeCompare(a.at));
    }
    if(input.action==='apply'){
      if(busy||!canRun())throw Error('다른 작업이 끝난 뒤 정리하세요.');const plan=plans.get(input.id);if(!plan||Date.now()-Date.parse(plan.createdAt)>15*60*1000)throw Error('정리 미리보기를 다시 확인해 주세요.');busy=true;
      const backup=path.join(directory,plan.id);let before,moved=false;
      try{
        for(const s of plan.sessions){const current=store.session(s.id);if(isRunning(s.id)||hash(JSON.stringify(current))!==s.key)throw Error('대화가 변경됐거나 실행 중입니다. 계획을 다시 만드세요.');}
        for(const t of plan.teams){const now=(await teamRuns(t.projectId)).find(r=>r.id===t.id);if(!now||now.active||isTeamRunning(t.id))throw Error('팀이 다시 실행 중입니다. 계획을 다시 만드세요.');}
        const refs=await references(new Set(plan.sessions.map(s=>s.id)));
        for(const f of plan.files){const project=store.project(f.projectId),file=await recordPath(project.path,f.path);if(f.path.startsWith('.flowrium/attachments/')&&refs.has(f.path.split('/')[2]))throw Error('대화나 초안이 첨부를 사용 중입니다.');const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||hash(await fs.readFile(file))!==f.key)throw Error('기록 파일이 변경됐습니다. 미리보기를 다시 여세요.');}
        before=structuredClone(store.state.sessions);const saved=before.filter(s=>plan.sessions.some(r=>r.id===s.id));
        await fs.mkdir(backup,{recursive:true});
        store.state.sessions=store.state.sessions.filter(s=>!plan.sessions.some(r=>r.id===s.id));await store.save();
        // 저장 과정에서 생긴 삭제 개정도 함께 보관해야 프로젝트 기록의 연결이 남지 않는다.
        for(const p of store.state.projects)for(const f of await walk(path.join(p.path,'.flowrium','sessions'))){if(plan.sessions.some(s=>s.projectId===p.id&&f.relative.startsWith(s.id+'--'))&&!plan.files.some(v=>v.projectId===p.id&&v.path==='.flowrium/sessions/'+f.relative)){const bytes=await fs.readFile(f.file);plan.files.push({projectId:p.id,path:'.flowrium/sessions/'+f.relative,size:f.size,key:hash(bytes)});}}
        const manifest={id:plan.id,createdAt:plan.createdAt,sessions:saved,teams:plan.teams,files:[],restored:false};
        for(const [index,f] of plan.files.entries()){const source=await recordPath(store.project(f.projectId).path,f.path),bytes=await fs.readFile(source);if(hash(bytes)!==f.key)throw Error('보관 중 기록이 변경돼 정리를 중단했습니다.');const name=String(index)+'.gz';await fs.writeFile(path.join(backup,name),await compress(bytes),{flag:'wx',mode:0o600});manifest.files.push({...f,archive:name});}
        await atomic(path.join(backup,'manifest.json'),manifest);
        for(const f of manifest.files){const source=await recordPath(store.project(f.projectId).path,f.path);if(hash(await fs.readFile(source))!==f.key)throw Error('보관 후 기록이 변경돼 원본을 유지했습니다.');await fs.unlink(source);moved=true;}
        for(const p of store.state.projects)await store.repositories.get(p.id)?.refresh();await store.save();plans.delete(plan.id);return {id:plan.id,files:manifest.files.length,sessions:saved.length,report:await report()};
      }catch(e){
        if(before){
          try{
            if(moved){
              const manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
              for(const f of manifest.files){const target=await recordPath(store.project(f.projectId).path,f.path,true);try{await fs.lstat(target);}catch(missing){if(missing.code!=='ENOENT')throw missing;const bytes=await expand(await fs.readFile(path.join(backup,f.archive)));if(hash(bytes)!==f.key)throw Error('백업 확인값이 다릅니다.');await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}}
              for(const p of store.state.projects)await store.repositories.get(p.id)?.refresh();
            }
            store.state.sessions=before;await store.save();
          }catch{throw Error(e.message+' / 복구용 보관 기록을 유지했습니다. 다른 기기 동기화 상태를 확인해 주세요.');}
        }
        throw e;
      }finally{busy=false;}
    }
    if(input.action==='restore'){
      if(busy||!canRun()||!UUID.test(input.id||''))throw Error('복원할 보관 기록을 확인해 주세요.');busy=true;
      try{
        const backup=path.join(directory,input.id),m=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
        if(m.id!==input.id||m.restored)throw Error('이미 복원했거나 잘못된 보관 기록입니다.');
        if(m.sessions.some(s=>store.state.sessions.some(c=>c.id===s.id)))throw Error('같은 대화가 있어 덮어쓰지 않았습니다.');
        if(!Array.isArray(m.files)||new Set(m.files.map(f=>f.projectId+'/'+f.path)).size!==m.files.length||new Set(m.files.map(f=>f.archive)).size!==m.files.length)throw Error('보관 파일 목록을 확인해 주세요.');
        for(const f of m.files){safeRelative(f.path);if(!/^\d+\.gz$/.test(f.archive)||!Number.isSafeInteger(f.size)||f.size<0)throw Error('보관 파일 이름과 크기를 확인해 주세요.');const target=await recordPath(store.project(f.projectId).path,f.path,true);try{await fs.lstat(target);throw Error('같은 위치의 기록을 덮어쓰지 않았습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}const bytes=await expand(await fs.readFile(path.join(backup,f.archive)),{maxOutputLength:Math.max(1,f.size+1)});if(bytes.length!==f.size||hash(bytes)!==f.key)throw Error('백업 확인값이 다릅니다.');}
        for(const f of m.files){const bytes=await expand(await fs.readFile(path.join(backup,f.archive)),{maxOutputLength:Math.max(1,f.size+1)});if(bytes.length!==f.size||hash(bytes)!==f.key)throw Error('백업 확인값이 다릅니다.');const target=await recordPath(store.project(f.projectId).path,f.path,true);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});}
        for(const p of store.state.projects)await store.repositories.get(p.id)?.refresh();store.state.sessions.push(...m.sessions);await store.save();m.restored=true;await atomic(path.join(backup,'manifest.json'),m);return report();
      }finally{busy=false;}
    }
    throw Error('지원하지 않는 저장 공간 요청입니다.');
  });
  return {isBusy:()=>busy};
}
module.exports={registerStorageTools,walk};
