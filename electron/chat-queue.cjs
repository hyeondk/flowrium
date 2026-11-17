const {randomUUID}=require('node:crypto');
const native=require('./codex-native-queue.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const {readJSON,createJSON,UUID}=require('./project-store.cjs');
const {checkedAttachments,resolveAttachments}=require('./chat-attachments.cjs');
const {maxChatInput}=require("./mobile/chat-input.js");
function validateQueue(items=[]) {
  if(!Array.isArray(items)||items.length>150)throw Error('대기 지시 목록을 확인해 주세요.');
  const seen=new Set();
  for(const q of items){
    if(!q||!/^[a-f0-9-]{36}$/i.test(q.id)||seen.has(q.id)||typeof q.text!=='string'||q.text.length>maxChatInput||
      !['plan','build','review'].includes(q.mode)||!['queued','sending','sent','cancelled'].includes(q.status)||
      !Number.isFinite(Date.parse(q.createdAt))||typeof q.owner!=='string'||q.owner.length>200||
      (q.model!=null&&(typeof q.model!=='string'||q.model.length>300))||
      (q.effort!==undefined&&!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(q.effort))) throw Error('저장된 대기 지시 형식이 올바르지 않습니다.');
    if(q.requestSourceId!==undefined&&!UUID.test(q.requestSourceId))throw Error('대기 요청의 원문 식별자를 확인해 주세요.');
    if(q.nativeDelivery!==undefined && (!['submitting','queued','uncertain'].includes(q.nativeDelivery) || q.status!=='queued' || !UUID.test(q.nativeThreadId)) ||
       q.nativeQueueAvailable!==undefined && typeof q.nativeQueueAvailable!=='boolean' ||
       q.nativeCleared!==undefined && (q.nativeCleared!==true || q.status!=='cancelled') ||
       q.nativeDeviceHash!==undefined && !/^[a-f0-9]{64}$/.test(q.nativeDeviceHash) ||
       q.nativeQueueId!==undefined && !UUID.test(q.nativeQueueId) ||
       q.nativeAfterTurnId!==undefined && !UUID.test(q.nativeAfterTurnId))throw Error('원본 대기열 접수 정보를 확인해 주세요.');
    checkedAttachments(q.attachments||[]);seen.add(q.id);
  }
}
class ChatQueue {
  constructor(controller){this.controller=controller;this.store=controller.store;this.busy=new Set();this.tail=Promise.resolve();this.flights=new Set();this.timers=new Map();this.processing=new Map();this.nativeActions=new Map();}
  async owner(revision=this.controller.options.queueOwner?.()??'local'){
    if(!this.installation)this.installation=(async()=>{
      const file=path.join(path.dirname(this.store.file),'chat-queue-installation.json');
      await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try {const record=await readJSON(file);if(!UUID.test(record.id))throw Error('대기 지시의 기기 식별자를 확인해 주세요.');return record.id;}
      catch(e){if(e.code!=='ENOENT')throw e;const id=randomUUID();try{await createJSON(file,{id});return id;}catch(e){if(e.code!=='EEXIST')throw e;const r=await readJSON(file);if(!UUID.test(r.id))throw e;return r.id;}}
    })();
    return await this.installation+':'+String(revision);
  }
  emit(session){this.controller.emitEvent({type:'session',sessionId:session.id,session:structuredClone(session)});}
  list(id){return structuredClone(this.store.session(id).queuedMessages||[]);}
  pending(id){return (this.store.session(id).queuedMessages||[]).some(q=>q.status==='queued'||q.status==='sending');}
  serial(action){const task=this.tail.then(action);this.tail=task.catch(()=>{});return task;}
  enqueue(input){return this.serial(async()=>{
    const s=this.store.session(input.sessionId);
    if (!s.scope) await this.store.requireProjectTrust(s.projectId);
    const revision=input.ownerRevision??this.controller.options.queueOwner?.()??'local', owner=await this.owner(revision);
    const files=await resolveAttachments(this.store,s.projectId,input.attachments||[]);
    const history=s.queuedMessages||[];
    if(history.filter(q=>q.status==='queued'||q.status==='sending').length>=50)throw Error('이 대화의 대기 지시는 50개까지 보관할 수 있습니다.');
    const q={id:input.submissionId || randomUUID(),text:input.text,...(input.requestSourceId&&{requestSourceId:input.requestSourceId}),mode:input.mode,model:input.model,...(input.effort?{effort:input.effort}:{}),attachments:checkedAttachments(files),createdAt:new Date().toISOString(),status:'queued',...(input.waitingForWriter&&{waitingForWriter:true}),owner};
    if((this.controller.options.queueOwner?.()??'local')!==revision||this.controller.options.canRun?.()===false)throw Error('계정이나 잠금 상태가 바뀌었습니다. 추가 지시를 다시 확인해 주세요.');
    if(q.waitingForWriter && native.eligible(s,q))q.nativeQueueAvailable=true;
    const before=s.queuedMessages;
    s.queuedMessages=[...history.filter(q=>q.status==='queued'||q.status==='sending'||history.indexOf(q)>=history.length-90),q];
    try{await this.store.save();}catch(e){if(before)s.queuedMessages=before;else delete s.queuedMessages;throw e;}
    this.emit(s);
    if(q.waitingForWriter)this.schedule(s.id);else queueMicrotask(()=>this.flush(s.id));
    return {accepted:true,queued:true,queueId:q.id,...(q.waitingForWriter&&{waitingForWriter:true}),...(q.nativeQueueAvailable&&{nativeQueueAvailable:true})};
  });}
  withNativeAction(id,action){
    const previous=this.nativeActions.get(id)||this.tail;
    const task=previous.catch(()=>{}).then(async()=>{
      await this.processing.get(id);
      return action();
    });
    this.nativeActions.set(id,task);this.flights.add(task);
    return task.finally(()=>{
      this.flights.delete(task);
      if(this.nativeActions.get(id)!==task)return;
      this.nativeActions.delete(id);
      if(!this.controller.shuttingDown && this.store.peekSession?.(id) && this.pending(id))this.schedule(id);
    });
  }
  clearUnconfirmed(id,queueId){return this.withNativeAction(id,async()=>{
    const session=this.store.session(id), entry=session.queuedMessages?.find(q=>q.id===queueId);
    if(entry?.nativeCleared && entry.status==='cancelled')return;
    if(!entry || entry.status!=='queued' || entry.nativeDelivery!=='uncertain')throw Error('수신을 확인할 수 없는 대기 지시를 선택해 주세요.');
    await native.clearUnconfirmed(this,session,entry);
  });}
  sendToCodex(id,queueId){return this.withNativeAction(id,async()=>{
    const session=this.store.session(id), entry=session.queuedMessages?.find(q=>q.id===queueId);
    if(!entry || entry.status==='cancelled')throw Error('원본에 보낼 대기 지시를 선택해 주세요.');
    if(entry.status==='sent')return {accepted:true,queued:false,queueId};
    const first=session.queuedMessages.find(q=>q.status==='queued'||q.status==='sending');
    if(first!==entry)throw Error('앞선 대기 지시를 먼저 처리해 주세요.');
    if(entry.status!=='queued' || !entry.nativeDelivery && (!entry.waitingForWriter || entry.error ||
       session.messages.some(m=>m.id===queueId) || this.controller.runs.has(id)))throw Error('원본에 전달할 수 있는 대기 지시를 선택해 주세요.');
    if (!session.scope) await this.store.requireProjectTrust(session.projectId);
    try {await native.submit(this,session,entry);}
    finally {if(entry.nativeDelivery)this.schedule(id);}
    return {accepted:true,queued:entry.status==='queued',queueId,...(entry.nativeDelivery&&{nativeDelivery:entry.nativeDelivery})};
  });}
  cancel(id,queueId){return this.withNativeAction(id,async()=>{
    const s=this.store.session(id),q=(s.queuedMessages||[]).find(q=>q.id===queueId);
    if(!q||q.status!=='queued')throw Error('이미 전달했거나 취소한 지시입니다.');
    if(q.nativeDelivery){await native.cancel(this,s,q);return;}
    q.status='cancelled';
    try{await this.store.save();}catch(e){q.status='queued';throw e;}
    this.emit(s);
  });}
  async resume(id){
    await this.serial(async()=>{
      const s=this.store.session(id);
      const owner=await this.owner();for(const q of s.queuedMessages||[])if(!q.nativeDelivery&&(q.status==='queued'||q.status==='sending')){q.status='queued';q.owner=owner;delete q.error;}
      await this.store.save();this.emit(s);
    });
    await this.flush(id);
  }
  flushAll(){for(const s of this.store.visibleSessions?.()||this.store.state.sessions)void this.flush(s.id);}
  flush(id){
    if(this.nativeActions.has(id))return Promise.resolve();
    if(this.processing.has(id))return this.processing.get(id);
    const task=this._flush(id).catch(e=>{this.controller.emitEvent({type:'error',text:e.message});});
    this.processing.set(id,task);this.flights.add(task);
    task.finally(()=>{this.flights.delete(task);this.processing.delete(id);}).catch(()=>{});
    return task;
  }
  async _flush(id){
    const c=this.controller;
    if(this.busy.has(id)||c.runs.has(id)||c.editingSessions.has(id)||c.shuttingDown||!c.status.authenticated||c.options.canRun?.()===false)return;
    const s=(this.store.visibleSessions?.()||this.store.state.sessions).find(s=>s.id===id);if(!s||s.compacting)return;
    const q=(s.queuedMessages||[]).find(q=>q.status==='queued'||q.status==='sending');
    if(!q||q.error)return;
    this.busy.add(id);
    try{
      if(q.owner!==await this.owner()||q.status==='cancelled'||c.options.canRun?.()===false||c.shuttingDown)return;
      if(q.nativeDelivery){
        try{await native.reconcile(this,s,q);}finally{if(q.status==='queued')this.schedule(id);}
        if(q.status==='sent' && this.pending(id))setImmediate(()=>this.flush(id));
        return;
      }
      // The transcript row and its stable submission ID are persisted before
      // sending. Never replay an ambiguous transmission on restart.
      const receipt=s.messages.find(m=>m.role==='user'&&m.id===q.id);
      if(receipt && !receipt.turnId)throw Error('앱이 종료되기 전 요청의 수신 여부가 확인되지 않았습니다. 원래 대화를 확인하고, 다시 보내려면 이 대기 지시를 취소한 뒤 새 요청으로 보내 주세요.');
      if(!receipt){
        if(!s.scope && !await this.store.isProjectTrusted(s.projectId))return;
        await c.send({sessionId:id,text:q.text,requestSourceId:q.requestSourceId,mode:q.mode,model:q.model,effort:q.effort,attachments:q.attachments.map(a=>a.id)},
          {fromQueue:true,queueItem:q,waitingForWriter:q.waitingForWriter});
      }
      q.status='sent';delete q.waitingForWriter;q.sentAt=new Date().toISOString();
      await this.store.save();this.emit(s);
      if(!c.runs.has(id)&&this.pending(id))setImmediate(()=>this.flush(id));
    }catch(error){
      if(q.status==='cancelled' || q.nativeDelivery)return;
      q.status='queued';
      if(c.shuttingDown && !s.messages.some(m=>m.id===q.id))return;
      if(error.code==='THREAD_WRITER_BUSY'||error.code==='THREAD_ACTIVE'){
        const offer=q.nativeQueueAvailable===undefined && native.eligible(s,q);
        const changed=!q.waitingForWriter || offer;
        q.waitingForWriter=true;
        if(offer)q.nativeQueueAvailable=true;
        this.schedule(id);
        if(!changed)return;
      }else q.error=error.message;
      await this.store.save();this.emit(s);
    }finally{this.busy.delete(id);}
  }
  schedule(id){
    if(this.timers.has(id)||this.controller.shuttingDown)return;
    const timer=setTimeout(()=>{this.timers.delete(id);void this.flush(id);},5000);
    timer.unref?.();this.timers.set(id,timer);
  }
  stopTimers(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
}
module.exports={ChatQueue,validateQueue};
