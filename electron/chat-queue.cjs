const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path');
const {readJSON,createJSON,UUID}=require('./project-store.cjs');
const {checkedAttachments,resolveAttachments}=require('./chat-attachments.cjs');
function validateQueue(items=[]) {
  if(!Array.isArray(items)||items.length>150)throw Error('대기 지시 목록을 확인해 주세요.');
  const seen=new Set();
  for(const q of items){
    if(!q||!/^[a-f0-9-]{36}$/i.test(q.id)||seen.has(q.id)||typeof q.text!=='string'||q.text.length>200000||
      !['plan','build','review'].includes(q.mode)||!['queued','sending','sent','cancelled'].includes(q.status)||
      !Number.isFinite(Date.parse(q.createdAt))||typeof q.owner!=='string'||q.owner.length>200||
      (q.model!==undefined&&(typeof q.model!=='string'||q.model.length>300))||
      (q.effort!==undefined&&!['low','medium','high'].includes(q.effort))) throw Error('저장된 대기 지시 형식이 올바르지 않습니다.');
    checkedAttachments(q.attachments||[]);seen.add(q.id);
  }
}
class ChatQueue {
  constructor(controller){this.controller=controller;this.store=controller.store;this.busy=new Set();this.tail=Promise.resolve();this.flights=new Set();}
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
    const revision=input.ownerRevision??this.controller.options.queueOwner?.()??'local', owner=await this.owner(revision);
    const files=await resolveAttachments(this.store,s.projectId,input.attachments||[]);
    const history=s.queuedMessages||[];
    if(history.filter(q=>q.status==='queued'||q.status==='sending').length>=50)throw Error('이 대화의 대기 지시는 50개까지 보관할 수 있습니다.');
    const q={id:randomUUID(),text:input.text.trim(),mode:input.mode,...(input.model?{model:input.model}:{}),...(input.effort?{effort:input.effort}:{}),attachments:checkedAttachments(files),createdAt:new Date().toISOString(),status:'queued',owner};
    if((this.controller.options.queueOwner?.()??'local')!==revision||this.controller.options.canRun?.()===false)throw Error('계정이나 잠금 상태가 바뀌었습니다. 추가 지시를 다시 확인해 주세요.');
    const before=s.queuedMessages;
    s.queuedMessages=[...history.filter(q=>q.status==='queued'||q.status==='sending'||history.indexOf(q)>=history.length-90),q];
    try{await this.store.save();}catch(e){if(before)s.queuedMessages=before;else delete s.queuedMessages;throw e;}
    this.emit(s);queueMicrotask(()=>this.flush(s.id));return {accepted:true,queued:true,queueId:q.id};
  });}
  cancel(id,queueId){return this.serial(async()=>{
    const s=this.store.session(id),q=(s.queuedMessages||[]).find(q=>q.id===queueId);
    if(!q||q.status!=='queued')throw Error('이미 전달했거나 취소한 지시입니다.');
    q.status='cancelled';
    try{await this.store.save();}catch(e){q.status='queued';throw e;}
    this.emit(s);
  });}
  async resume(id){
    await this.serial(async()=>{
      const s=this.store.session(id);
      const owner=await this.owner();for(const q of s.queuedMessages||[])if(q.status==='queued'||q.status==='sending'){q.status='queued';q.owner=owner;delete q.error;}
      await this.store.save();this.emit(s);
    });
    await this.flush(id);
  }
  flushAll(){for(const s of this.store.state.sessions)void this.flush(s.id);}
  flush(id){const task=this._flush(id).catch(e=>{this.controller.emitEvent({type:'error',text:e.message});});this.flights.add(task);task.finally(()=>this.flights.delete(task)).catch(()=>{});return task;}
  async _flush(id){
    const c=this.controller;
    if(this.busy.has(id)||c.runs.has(id)||c.editingSessions.has(id)||c.shuttingDown||!c.status.authenticated||c.options.canRun?.()===false)return;
    const s=this.store.state.sessions.find(s=>s.id===id);if(!s||s.compacting)return;
    const q=(s.queuedMessages||[]).find(q=>q.status==='queued'||q.status==='sending');
    if(!q||q.owner!==await this.owner()||q.error)return;
    this.busy.add(id);
    try{
      q.status='sending';await this.store.save();this.emit(s);
      if(q.owner!==await this.owner()||c.options.canRun?.()===false)throw Error('계정이나 잠금 상태가 바뀌었습니다.');
      await c.send({sessionId:id,text:q.text,mode:q.mode,model:q.model,effort:q.effort,attachments:q.attachments.map(a=>a.id)},{fromQueue:true});
      q.status='sent';q.sentAt=new Date().toISOString();await this.store.save();this.emit(s);
    }catch(e){q.status='queued';q.error=e.message;await this.store.save().catch(()=>{});this.emit(s);}
    finally{this.busy.delete(id);}
  }
}
module.exports={ChatQueue,validateQueue};
