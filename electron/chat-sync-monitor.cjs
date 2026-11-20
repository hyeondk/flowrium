const {sync}=require('./chat-sync.cjs');
const D=require('./codex-transfer-data.cjs');

// The foreground view also checks its selected conversation. This poller keeps
// other attached conversations current while the dashboard or mobile is open.
const interval=4000;
function state(runtime){
  return runtime.syncMonitor??={cursor:0,stamps:new Map(),active:new Set(),priority:new Set(),errors:new Map()};
}
function canScan(runtime){
  return !runtime.closed&&!runtime.isBusy()&&!runtime.options.foregroundBusy?.()&&runtime.controller.status?.authenticated&&
    !runtime.controller.shuttingDown&&runtime.options.canRun?.()!==false;
}
function guard(runtime,context){runtime.guard(context.owner,context.revision,context.epoch);}
async function catalog(runtime,context){
  const params={archived:false,limit:100,sortKey:'updated_at',sortDirection:'desc',
    sourceKinds:['appServer','cli','vscode','unknown'],useStateDbOnly:true};
  for(;;){
    try{
      const result=await runtime.client.request('thread/list',params);
      guard(runtime,context);
      if(!Array.isArray(result.data))throw Error('대화 목록을 확인하지 못했습니다.');
      return {rows:result.data,info:{nextCursor:result.nextCursor,params}};
    }catch(error){
      if(error.code!=='PROTOCOL_FRAME_TOO_LARGE'||params.limit===1)throw error;
      await runtime.recover(context);
      params.limit=Math.max(1,Math.floor(params.limit/2));
    }
  }
}
async function section(runtime,watch,context,name,task){
  try{const result=await task();watch.errors.delete(name);return result;}
  catch(error){
    guard(runtime,context);
    if(watch.errors.get(name)!==error.message){
      watch.errors.set(name,error.message);
      runtime.controller.emitEvent({type:'error',text:name+' 동기화를 다시 시도합니다. '+error.message});
    }
  }
}
async function poll(runtime,watch){
  if(!canScan(runtime))return;
  const context=await runtime.ready(true),owner=context.owner;
  if(watch.owner!==owner){
    watch.owner=owner;watch.cursor=0;watch.projectNamesAt=0;watch.errors.clear();watch.stamps.clear();watch.active.clear();watch.priority.clear();
    watch.catalogPresence=undefined;
    runtime.syncStamps=new WeakMap();
  }
  const {rows,info}=await catalog(runtime,context);
  if(!canScan(runtime))return;
  const knownIds = new Set(runtime.store.visibleSessions().map(session=>session.threadId).filter(Boolean));
  const present = new Set(rows.filter(row=>knownIds.has(row.id)).map(row=>row.id));
  const missingFromCompleteList = !info.nextCursor && [...(watch.catalogPresence || [])]
    .some(id=>knownIds.has(id) && !present.has(id));
  watch.catalogPresence = present;
  // A missing row only advances the check. The trash reconciler still verifies
  // both complete lists, the exact thread and its account before moving anything.
  const trash=await section(runtime,watch,context,'휴지통',()=>runtime.controller.trashRuntime?.syncNative?.(rows,context,runtime,{
    ...info, force:missingFromCompleteList,
  }));
  guard(runtime,context);
  if(trash?.changed){
    const restored=(trash.restored||[]).map(id=>runtime.store.peekSession(id)).filter(Boolean);
    runtime.controller.emitEvent({type:'sessionList',removedSessionIds:trash.removed||[],restoredSessions:structuredClone(restored),
      ...(trash.projectsChanged&&{projectsChanged:true,restoredProjectIds:trash.restoredProjectIds||[]})});
  }
  if(!canScan(runtime))return;
  await section(runtime,watch,context,'새 대화',()=>runtime.options.discoverProjectThreads?.(rows,context,runtime,info));
  guard(runtime,context);
  if(!canScan(runtime))return;
  if(Date.now()-watch.projectNamesAt>=15000){
    watch.projectNamesAt=Date.now();
    await section(runtime,watch,context,'프로젝트 이름',()=>runtime.options.syncProjectNames?.(context));
  }
  guard(runtime,context);
  const sessions=(runtime.store.visibleSessions?.()||runtime.store.state.sessions).filter(s=>
    s.codexLink?.mode==='linked'&&s.codexLink.ownerHash===owner||
    !s.codexLink&&s.threadId&&s.desktopThread?.ownerHash===owner);
  if(!sessions.length)return;
  const byThread=new Map(sessions.map(s=>[s.threadId,s]));
  for(const row of rows){
    const s=byThread.get(row.id);
    if(!s)continue;
    const stamp=JSON.stringify([row.updatedAt,row.status?.type,row.name]);
    const previous=watch.stamps.get(s.id);
    if(D.active(row)||(previous!==undefined?previous!==stamp:D.at(row.updatedAt)>=(s.codexLink?.sourceUpdatedAt||s.updatedAt)))watch.priority.add(s.id);
    watch.stamps.set(s.id,stamp);
  }
  const live=new Set(sessions.map(s=>s.id));
  for(const table of [watch.stamps,watch.active,watch.priority]){
    for(const id of table.keys())if(!live.has(id))table.delete(id);
  }
  // Always reserve a fair slice for older or archived conversations, including
  // multiple completed turns with the same catalog timestamp.
  const ids=new Set([...watch.priority].slice(0,3));
  for(const id of [...watch.active].slice(0,3)){ids.add(id);watch.active.delete(id);}
  const count=Math.min(3,sessions.length);
  for(let i=0;i<count;i++)ids.add(sessions[(watch.cursor+i)%sessions.length].id);
  watch.cursor=(watch.cursor+count)%sessions.length;
  for(const id of ids){
    if(!canScan(runtime))return;
    guard(runtime,context);
    try{
      const result=await sync(runtime,id,false,true);
      const provisional=runtime.liveTurn(runtime.store.session(id));
      if(result.sync==='active'||provisional)watch.active.add(id);
      if(result.sync!=='deferred'||provisional)watch.priority.delete(id);
    }catch(error){
      guard(runtime,context);
      watch.priority.delete(id);
      // Selected conversations expose the detailed error and manual retry.
      // Keep tracking the rest if one original is unavailable on this device.
      if(error.code==='PROTOCOL_FRAME_TOO_LARGE')await runtime.recover(context);
    }
  }
}
function scan(runtime){
  const watch=state(runtime);
  if(watch.flight)return watch.flight;
  watch.flight=poll(runtime,watch).finally(()=>{watch.flight=null;});
  return watch.flight;
}
function start(runtime){
  const watch=state(runtime);
  if(watch.started)return;
  watch.started=true;
  const next=()=>{
    if(runtime.closed||!watch.started)return;
    watch.timer=setTimeout(async()=>{
      try{await scan(runtime);watch.lastError=null;}
      catch(error){
        if(canScan(runtime)&&error.message!==watch.lastError){
          watch.lastError=error.message;
          runtime.controller.emitEvent({type:'error',text:'자동 대화 동기화를 다시 시도합니다. '+error.message});
        }
      }finally{next();}
    },interval);
    watch.timer.unref?.();
  };
  next();
}
async function stop(runtime){
  const watch=runtime.syncMonitor;
  if(!watch)return;
  watch.started=false;
  clearTimeout(watch.timer);
  await watch.flight?.catch(()=>{});
}
module.exports={scan,start,stop};
