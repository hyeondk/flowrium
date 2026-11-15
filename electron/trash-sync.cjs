const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {readJSON, UUID} = require('./project-store.cjs');
const {samePath} = require('./path-boundary.cjs');
const D = require('./codex-transfer-data.cjs');

const empty = () => ({changed:false,removed:[],restored:[],projectsChanged:false,removedProjectIds:[],restoredProjectIds:[]});
const sourceKinds = ['cli','vscode','exec','appServer','unknown'];
const missingThread = (e,id) => e.rpcCode===-32600 && ['thread not loaded: '+id,'no rollout found for thread id '+id].includes(e.rpcMessage);
const missingProject = (e,id) => e.rpcCode===-32602 && e.rpcMessage==='project not found: '+id;

async function catalog(client,method,params,guard) {
  const rows=new Map(), cursors=new Set();
  let cursor;
  do {
    guard();
    const result=await client.request(method,{...params,limit:100,...(cursor?{cursor}:{})});
    guard();
    if(!Array.isArray(result?.data) || !Object.hasOwn(result,'nextCursor') || (result.nextCursor!==null && (typeof result.nextCursor!=='string'||!result.nextCursor)) || cursors.has(result.nextCursor))throw Error('Codex 목록의 다음 페이지를 확인해 주세요.');
    for(const row of result.data){
      if(!row || typeof row.id!=='string' || !row.id || rows.has(row.id))throw Error('Codex 목록이 바뀌었습니다. 다음 확인 때 다시 처리합니다.');
      rows.set(row.id,row);
    }
    cursor=result.nextCursor;
    if(cursor)cursors.add(cursor);
  }while(cursor);
  return rows;
}

function binding(session,project,owner,device) {
  if(!session?.threadId)return;
  const link=session.codexLink;
  if(link?.mode==='linked' && link.ownerHash===owner && link.deviceHash===device && link.sourceThreadId===session.threadId)return {id:session.threadId,cwd:project.path};
  const native=session.desktopThread;
  if(!link && native?.ownerHash===owner && native.threadId===session.threadId && path.isAbsolute(native.cwd||''))return {id:session.threadId,cwd:native.cwd};
}
function oneRoot(row,folder){return row?.roots?.length===1 && typeof row.roots[0].path==='string' && samePath(row.roots[0].path,folder);}
function recordIds(entry,owner,device){
  if(entry.kind==='session'){const source=binding(entry.session,entry.project,owner,device);return source?[source.id]:[];}
  const trusted=entry.native.ownerHash===owner && entry.native.deviceHash===device;
  return [...new Set([...(trusted?entry.native.roots.map(row=>row.id):[]),...(entry.bindings||[]).filter(row=>row.desktopThread?.ownerHash===owner||row.linkOwner===owner&&row.linkDevice===device).map(row=>row.threadId)])];
}

class TrashSync {
  constructor(trash) {this.trash=trash;this.memo=new Map();this.next=0;this.pending=false;}
  async state(context) {
    const file=path.join(await this.trash.folder(context.owner),'sync-state.json');
    try{
      const data=await readJSON(file);
      if(data.version!==1 || !Array.isArray(data.hidden) || !data.projects || Array.isArray(data.projects))throw Error('삭제 동기화 상태를 확인해 주세요.');
      return {file,data};
    }catch(e){if(e.code!=='ENOENT')throw e;return {file,data:{version:1,hidden:[],projects:{}}};}
  }
  async save(file,data,context){
    const temporary=file+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify(data),{mode:0o600,flag:'wx'});this.trash.guard(context);await fs.rename(temporary,file);}
    finally{await fs.rm(temporary,{force:true});}
  }
  async records(context,device) {
    const dir=await this.trash.folder(context.owner), entries=[];
    const names=(await fs.readdir(dir)).filter(name=>UUID.test(name.replace(/\.json$/,''))&&name.endsWith('.json'));
    const keys=new Set();
    for(const name of names){
      const file=path.join(dir,name),stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('휴지통 기록을 확인해 주세요.');
      const key=file+'|'+device;keys.add(key);
      let row=this.memo.get(key);
      if(!row || row.ino!==stat.ino || row.size!==stat.size || row.mtime!==stat.mtimeMs){
        const e=await this.trash.read(name.slice(0,-5),context);
        row={ino:stat.ino,size:stat.size,mtime:stat.mtimeMs,id:e.id,kind:e.kind,status:e.status,target:e.kind==='session'?e.session.id:e.project.id,
          ids:recordIds(e,context.owner,device),archived:e.native.mode==='archive' && e.native.ownerHash===context.owner && e.native.deviceHash===device && e.native.status==='completed' && e.native.archivedIds.includes(e.session?.threadId),
          pendingProjectRemoval:e.syncPending==='projectRemoval',pendingProjectRestore:e.syncPending==='projectRestore',pendingUnarchive:e.syncPending==='unarchive',pendingArchive:e.syncPending==='archive',removedProject:e.syncProject?.deleted===true && e.syncProject.device===device,folder:e.project.path};
        this.memo.set(key,row);
      }
      if(row.pendingUnarchive||row.pendingProjectRestore||row.status==='deleted'||row.status==='prepared'&&!this.trash.present(row.kind,row.target))entries.push(row);
    }
    for(const key of this.memo.keys())if(!keys.has(key))this.memo.delete(key);
    this.trash.guard(context);return entries;
  }
  async excluded() {
    const t=this.trash, context=t.context();t.guard(context);
    const device=await t.controller.codexTransfer?.device();
    if(!device)return new Set();
    const {data}=await this.state(context), records=await this.records(context,device);
    return new Set([...data.hidden.filter(row=>row.device===device).map(row=>row.id),...records.filter(row=>!row.pendingUnarchive&&!row.pendingProjectRestore).flatMap(row=>row.ids)]);
  }
  async retainBeforePurge(entry,context) {
    if(!this.trash.purgeVisible(entry))return;
    const device=await this.trash.controller.codexTransfer?.device();
    if(!device)return;
    const ids=recordIds(entry,context.owner,device);if(!ids.length)return;
    const {file,data}=await this.state(context);
    const already=new Set(data.hidden.filter(row=>row.device===device).map(row=>row.id));
    const added=ids.filter(id=>!already.has(id));if(!added.length)return;
    data.hidden.push(...added.map(id=>({id,device})));await this.save(file,data,context);
  }
  async knownProject(target,context,transfer){
    const device=await transfer.device(),{data}=await this.state(context),row=data.projects[device]?.[target.id];
    if(!row)return;
    return {id:typeof row==='string'?row:row.id,name:target.project.name,device,members:row.members||[],offline:true};
  }
  async project(target,transfer,context) {
    if(target.kind!=='project'||!transfer)return;
    const guard=()=>this.trash.guard(context);
    const rows=await catalog(transfer.client,'project/list',{sortKey:'position',sortDirection:'asc'},guard);
    const matches=[...rows.values()].filter(row=>row.roots?.some(root=>samePath(root.path,target.project.path)));
    if(matches.length!==1 || !oneRoot(matches[0],target.project.path))return;
    return {id:matches[0].id,name:matches[0].name,device:await transfer.device()};
  }
  async members(ref,transfer,context) {
    const members=[];
    for(const archived of [false,true]){
      const rows=await catalog(transfer.client,'thread/list',{projectId:ref.id,archived,modelProviders:[],useStateDbOnly:true},()=>this.trash.guard(context));
      for(const row of rows.values())if(row.projectId===ref.id&&typeof row.cwd==='string')members.push({id:row.id,cwd:row.cwd});
    }
    return members;
  }
  async reconnectMembers(ref,projectId,transfer,context){
    for(const member of ref.members||[]){
      this.trash.guard(context);
      let row;
      try{row=(await transfer.client.request('thread/read',{threadId:member.id,includeTurns:false})).thread;}
      catch(error){if(missingThread(error,member.id))continue;throw error;}
      if(row?.id!==member.id||!samePath(row.cwd,member.cwd)||row.projectId||D.active(row))continue;
      this.trash.guard(context);
      await transfer.client.request('thread/metadata/update',{threadId:member.id,projectId});
    }
  }
  async removeProject(entry,context,transfer) {
    const ref=entry.syncProject;
    const row=(await transfer.client.request('project/read',{projectId:ref.id})).project;
    if(row?.id!==ref.id||!oneRoot(row,entry.project.path))throw Error('Codex 프로젝트의 작업 폴더가 달라졌습니다.');
    ref.members=await this.members(ref,transfer,context);await this.trash.write(entry);
    this.trash.guard(context);
    await transfer.client.request('project/delete',{projectId:ref.id});
    this.trash.guard(context);ref.deleted=true;await this.trash.write(entry);
  }
  async restoreProject(entry,context,transfer) {
    const ref=entry.syncProject;if(!ref?.deleted)return;
    const ready=await transfer.ready(true);
    if(ready.owner!==context.owner||await transfer.device()!==ref.device)throw Error('원래 계정과 기기에서 프로젝트 등록을 복원해 주세요.');
    const rows=await catalog(transfer.client,'project/list',{},()=>this.trash.guard(context));
    const existing=[...rows.values()].filter(row=>row.roots?.some(root=>samePath(root.path,entry.project.path)));
    if(existing.length){if(existing.length!==1||!oneRoot(existing[0],entry.project.path))throw Error('Codex 프로젝트 경로가 겹칩니다. 등록을 확인해 주세요.');await this.reconnectMembers(ref,existing[0].id,transfer,context);return;}
    this.trash.guard(context);
    const created=await transfer.client.request('project/create',{idempotencyKey:entry.id,name:ref.name||entry.project.name,roots:[{path:entry.project.path}]});
    if(!oneRoot(created?.project,entry.project.path))throw Error('다시 등록된 프로젝트를 확인해 주세요.');
    await this.reconnectMembers(ref,created.project.id,transfer,context);
  }
  async sync(_recent,sessionContext,transfer,options={}) {
    const t=this.trash;
    if(!transfer || this.pending || t.busy)return empty();
    const context=sessionContext||t.context();
    const identity=[context.owner,context.revision,context.epoch].join(':');
    if(!options.force && this.identity===identity && Date.now()<this.next)return empty();
    this.pending=true;this.identity=identity;this.next=Date.now()+12000;
    try{return await this.reconcile(context,transfer);}finally{this.pending=false;}
  }
  async reconcile(context,transfer) {
    const t=this.trash, guard=()=>{t.guard(context);transfer.guard?.(context.owner,context.revision,context.epoch);};
    guard();const device=await transfer.device(), before=await this.records(context,device);
    const sessions=t.store.visibleSessions().flatMap(session=>{
      const project=t.store.project(session.projectId), source=binding(session,project,context.owner,device);
      return source?[{session,source}]:[];
    });
    const result=empty();
    // Read all pages before the first local change. An incomplete catalog never
    // implies deletion. Query metadata directly for candidates absent on both sides.
    const threads={};
    if(sessions.length||before.some(row=>row.archived||row.pendingArchive||row.pendingUnarchive)){
      for(const archived of [false,true])threads[archived?'archived':'active']=await catalog(transfer.client,'thread/list',{archived,sourceKinds,modelProviders:[],useStateDbOnly:true},guard);
    }
    let projects;
    try{projects=await catalog(transfer.client,'project/list',{sortKey:'position',sortDirection:'asc'},guard);}
    catch(error){if(error.rpcCode!==-32601)throw error;}
    const candidates=[], pendingRestores=new Map(before.filter(row=>row.pendingUnarchive).map(row=>[row.target,row]));
    for(const {session,source} of sessions){
      guard();
      if(pendingRestores.has(session.id))continue;
      const live=threads.active.get(source.id),archived=threads.archived.get(source.id);
      if(live || archived && (!samePath(archived.cwd,source.cwd)||D.active(archived)))continue;
      let missing=false;
      try{const metadata=await D.readThread(transfer.client,source.id,source.cwd);if(!archived||D.active(metadata))continue;}
      catch(e){if(archived||!missingThread(e,source.id))continue;missing=true;}
      candidates.push({session,source,missing});
    }
    const confirmedProjects=new Map();
    if(projects){
      const {data}=await this.state(context);
      for(const project of [...t.store.state.projects]){
        const known=data.projects[device]?.[project.id],id=typeof known==='string'?known:known?.id;
        if(!id||projects.has(id)||[...projects.values()].some(row=>row.roots?.some(root=>samePath(root.path,project.path))))continue;
        guard();
        try{await transfer.client.request('project/read',{projectId:id});}catch(e){if(missingProject(e,id))confirmedProjects.set(project.id,id);}
      }
    }
    guard();if(t.busy||transfer.isBusy())return result;
    t.busy=true;
    try{
      for(const {session,source,missing} of candidates){
        guard();if(t.store.peekSession(session.id)!==session||session.threadId!==source.id)continue;
        const target=t.target('session',session.id);
        try{t.idle(target);}catch{continue;}
        const entry=await t.receiveRemoval(target,context,device,source.id,missing);
        result.removed.push(entry.session.id);
      }
      for(const {session,source} of sessions){
        const pending=pendingRestores.get(session.id);
        if(!pending||t.store.peekSession(session.id)!==session||session.threadId!==source.id)continue;
        guard();try{t.idle(t.target('session',session.id));}catch{continue;}
        await this.resumeRestore(pending,session,source,threads,transfer,context);
      }
      for(const row of before){
        guard();
        if(row.pendingProjectRemoval||row.pendingProjectRestore){
          if(!projects)continue;
          const entry=await t.read(row.id,context),ref=entry.syncProject;
          if(ref?.device!==device)continue;
          if(row.pendingProjectRestore){
            if(!t.present('project',row.target))continue;
            await this.restoreProject(entry,context,transfer);
          }else if(projects.has(ref.id)){
            if(!oneRoot(projects.get(ref.id),entry.project.path))continue;
            await this.removeProject(entry,context,transfer);
          }else{
            try{await transfer.client.request('project/read',{projectId:ref.id});continue;}catch(e){if(!missingProject(e,ref.id))continue;}
            ref.deleted=true;
          }
          guard();delete entry.syncPending;await t.write(entry);continue;
        }
        if(row.kind!=='session'||row.ids.length!==1 || t.present('session',row.target))continue;
        const id=row.ids[0],live=threads.active?.get(id);
        const archived=threads.archived?.get(id);
        if(row.pendingArchive&&archived&&!live&&!D.active(archived)){
          const entry=await t.read(row.id,context);await t.finishPendingArchive(entry,context,transfer);continue;
        }
        if(row.pendingArchive&&!live&&!archived){
          const entry=await t.read(row.id,context),source=binding(entry.session,entry.project,context.owner,device);if(!source)continue;
          try{await D.readThread(transfer.client,id,source.cwd);continue;}catch(e){if(!missingThread(e,id))continue;}
          guard();entry.native.missing=[id];entry.native.status='completed';entry.native.mode='delete';entry.notice='원래 Codex 대화가 삭제되어 휴지통 기록은 독립 사본으로 복원할 수 있습니다.';delete entry.syncPending;await t.write(entry);continue;
        }
        if(!live||archived||D.active(live))continue;
        const entry=await t.read(row.id,context),source=binding(entry.session,entry.project,context.owner,device);
        if(!source||!samePath(live.cwd,source.cwd))continue;
        try{t.store.project(entry.project.id);}catch{continue;}
        if(row.pendingArchive){await t.finishPendingArchive(entry,context,transfer);continue;}
        if(row.archived){await t.restore({id:entry.id},{fromCodex:true});result.restored.push(row.target);}
      }
      if(projects)await this.projectChanges(context,device,projects,transfer,result,before,threads,confirmedProjects);
    }finally{t.busy=false;}
    result.projectsChanged=Boolean(result.removedProjectIds.length||result.restoredProjectIds.length);
    result.changed=Boolean(result.removed.length||result.restored.length||result.projectsChanged);return result;
  }
  async resumeRestore(row,session,source,threads,transfer,context){
    const t=this.trash,entry=await t.read(row.id,context),live=threads.active.get(source.id),archived=threads.archived.get(source.id);
    if(live&&archived)return;
    if(live||archived){
      if(!samePath((live||archived).cwd,source.cwd)||D.active(live||archived))return;
      t.guard(context);
      if(archived)await transfer.client.request('thread/unarchive',{threadId:source.id});
    }else{
      try{await D.readThread(transfer.client,source.id,source.cwd);return;}catch(e){if(!missingThread(e,source.id))return;}
      t.guard(context);
      delete session.threadId;delete session.desktopThread;if(session.codexLink)session.codexLink.mode='copy';
      await t.store.save();
    }
    t.guard(context);delete entry.syncPending;await t.write(entry);
  }
  async projectChanges(context,device,projects,transfer,result,before,threads,confirmedProjects){
    const t=this.trash,{file,data}=await this.state(context),map=data.projects[device]||{};
    let changed=false;
    for(const project of [...t.store.state.projects]){
      if(before.some(row=>row.pendingProjectRestore&&row.target===project.id))continue;
      const rows=[...projects.values()].filter(row=>row.roots?.some(root=>samePath(root.path,project.path)));
      if(rows.length){
        if(rows.length===1&&oneRoot(rows[0],project.path)){
          const matched=rows[0].id,previous=map[project.id],members=threads.active?[...threads.active.values(),...threads.archived.values()].filter(row=>row.projectId===matched&&typeof row.cwd==='string').map(row=>({id:row.id,cwd:row.cwd})).sort((a,b)=>a.id.localeCompare(b.id)):previous?.members||[];
          const next={id:matched,members};if(JSON.stringify(previous)!==JSON.stringify(next)){map[project.id]=next;changed=true;}
        }
        continue;
      }
      const known=map[project.id],id=typeof known==='string'?known:known?.id;if(!id||confirmedProjects.get(project.id)!==id)continue;
      t.guard(context);
      const target=t.target('project',project.id);try{t.idle(target);}catch{continue;}
      await t.receiveRemoval(target,context,device,null,false,{id,name:project.name,device,deleted:true,members:known?.members||[]});
      delete map[project.id];changed=true;result.removedProjectIds.push(project.id);result.removed.push(...target.sessions.map(s=>s.id));
    }
    for(const receipt of before){
      if(!receipt.removedProject||t.present('project',receipt.target))continue;
      const rows=[...projects.values()].filter(row=>row.roots?.some(root=>samePath(root.path,receipt.folder)));
      if(rows.length!==1||!oneRoot(rows[0],receipt.folder))continue;
      t.guard(context);const record=await t.read(receipt.id,context);await this.reconnectMembers(record.syncProject,rows[0].id,transfer,context);
      await t.restore({id:receipt.id},{fromCodex:true});
      map[receipt.target]={id:rows[0].id,members:[]};result.restoredProjectIds.push(receipt.target);changed=true;
    }
    for(const id of Object.keys(map))if(!t.present('project',id)){delete map[id];changed=true;}
    if(changed){data.projects[device]=map;await this.save(file,data,context);}
  }
}
module.exports={TrashSync,binding,recordIds,missingThread,catalog};
