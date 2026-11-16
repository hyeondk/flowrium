const D = require('./codex-transfer-data.cjs');
const {projectInlineLimit} = require('./chat-long-request.cjs');
const {UUID} = require('./project-store.cjs');
const {createHash} = require('node:crypto');
const {resolveAttachments} = require('./chat-attachments.cjs');

function eligible(session, entry) {
  const shared = session.codexLink?.mode === 'linked' || !session.codexLink && session.desktopThread;
  return Boolean(shared && !session.scope && !session.workflow && !session.personalAssistant &&
    !session.applicationTools && !entry.requestSourceId &&
    (entry.attachments || []).every(a => ['image/png','image/jpeg','image/webp','image/gif'].includes(a.type)) &&
    entry.text.trim() && entry.text.length <= projectInlineLimit);
}

async function access(queue, session, entry) {
  const controller = queue.controller, runtime = controller.codexTransfer;
  if (!runtime || !eligible(session,entry) || controller.options.canRun?.() === false ||
      controller.shuttingDown || !controller.status.authenticated || entry.owner !== await queue.owner())
    throw Error('현재 기기와 연결 계정의 원본 대기 지시를 선택해 주세요.');
  const context = await runtime.ready(true);
  const deviceHash = await runtime.device();
  if (entry.nativeDeviceHash && entry.nativeDeviceHash !== deviceHash)
    throw Error('원본 대기를 등록한 기기에서 다시 확인해 주세요.');
  const link = session.codexLink;
  if (link) {
    require('./codex-transfer-link.cjs').validateLink(link);
    if (link.ownerHash !== context.owner || link.deviceHash !== deviceHash)
      throw Error('이 대화의 원본 계정과 기기를 확인해 주세요.');
    if (!session.threadId) await runtime.resolveLinkedThread(session,runtime.store.project(session.projectId),context);
  }
  const threadId = session.threadId;
  const guard = () => {
    runtime.guard(context.owner,context.revision,context.epoch);
    const bound = session.codexLink || session.desktopThread;
    if (!UUID.test(threadId) || session.threadId !== threadId || (entry.nativeThreadId && entry.nativeThreadId !== threadId) ||
        !bound || bound.ownerHash !== context.owner || (link ? bound.mode !== 'linked' || bound.sourceThreadId !== threadId : bound.threadId !== threadId) ||
        runtime.store.session(session.id) !== session || !session.queuedMessages?.includes(entry) || controller.shuttingDown)
      throw Error('대화의 원본 연결 또는 요청 상태가 바뀌었습니다.');
  };
  guard();
  const cwd = link ? runtime.store.project(session.projectId).path : session.desktopThread.cwd;
  await D.readThread(runtime.client,threadId,cwd);
  guard();
  return {client:runtime.client,threadId,deviceHash,guard};
}

function matchesInput(input,entry) {
  const photos=entry.attachments||[];
  if(!Array.isArray(input)||input.length!==1+photos.length||input[0]?.type!=='text'||input[0].text!==entry.text)return false;
  return photos.every((photo,index)=>{
    const part=input[index+1],prefix='data:'+photo.type+';base64,';
    if(part?.type!=='image'||typeof part.url!=='string'||!part.url.startsWith(prefix)||
       part.url.length-prefix.length!==4*Math.ceil(photo.size/3))return false;
    return createHash('sha256').update(part.url.slice(prefix.length),'base64').digest('hex')===photo.sha256;
  });
}

async function queuedItem(connection, entry) {
  const {client,threadId,guard} = connection;
  // Each submission can contain 50 MiB of images. Release its page before reading the next.
  let cursor,match;
  const seen=new Set();
  do {
    const page=await client.request('thread/queue/list',{threadId,limit:1,...(cursor&&{cursor})});
    guard();
    if(!Array.isArray(page.data))throw Error('원본 대기열 목록을 확인하지 못했습니다.');
    for(const row of page.data) {
      if(row.clientUserMessageId!==entry.id)continue;
      if(match||!UUID.test(row.id)||entry.nativeQueueId && entry.nativeQueueId!==row.id||!matchesInput(row.input,entry))
        throw Error('원본 대기열의 접수 정보가 일치하지 않습니다.');
      match={id:row.id};
    }
    cursor=page.nextCursor;
    if(cursor!=null && (typeof cursor!=='string'||!cursor||seen.has(cursor)))throw Error('원본 대기열의 다음 위치를 확인하지 못했습니다.');
    seen.add(cursor);
  } while(cursor);
  return match;
}

async function delivered(connection, entry) {
  const {client,threadId,guard} = connection;
  const cursors = new Set();
  let cursor;
  for (;;) {
    // Small summaries carry the stable clientId even when the stored item id is new.
    const page = await client.request('thread/turns/list',{threadId,limit:5,sortDirection:'desc',itemsView:'summary',...(cursor && {cursor})});
    guard();
    if (!Array.isArray(page.data)) throw Error('원본의 요청 수신 기록을 확인하지 못했습니다.');
    for (const turn of page.data) {
      if (turn.items?.some(item=>item.type==='userMessage' && item.clientId===entry.id)) return true;
      if (turn.id === entry.nativeAfterTurnId) return false;
    }
    if (!page.nextCursor) return false;
    if (typeof page.nextCursor!=='string' || cursors.has(page.nextCursor)) throw Error('원본 수신 기록의 다음 위치를 확인하지 못했습니다.');
    cursors.add(page.nextCursor);cursor=page.nextCursor;
  }
}

async function save(queue, session, entry, patch) {
  const before = {};
  for (const key of Object.keys(patch)) {
    before[key]=entry[key];
    if(patch[key]===undefined)delete entry[key];else entry[key]=patch[key];
  }
  try { await queue.store.save(); }
  catch(error) {
    for (const [key,value] of Object.entries(before)) if(value===undefined)delete entry[key];else entry[key]=value;
    throw error;
  }
  const controller=queue.controller;
  if(!controller.shuttingDown && controller.options.canRun?.()!==false &&
     entry.owner===await queue.owner() && queue.store.peekSession(session.id)===session)queue.emit(session);
}

async function reconcile(queue, session, entry, connection) {
  connection ||= await access(queue,session,entry);
  const row = await queuedItem(connection,entry);
  if (row) {
    if(entry.nativeDelivery!=='queued' || entry.nativeQueueId!==row.id)
      await save(queue,session,entry,{nativeDelivery:'queued',nativeQueueId:row.id,error:undefined});
  } else if (await delivered(connection,entry)) {
    await save(queue,session,entry,{status:'sent',sentAt:new Date().toISOString(),waitingForWriter:undefined,
      nativeDelivery:undefined,nativeQueueAvailable:undefined,error:undefined});
  } else if (entry.nativeDelivery!=='uncertain') {
    await save(queue,session,entry,{nativeDelivery:'uncertain',error:undefined});
  }
  return row;
}

async function submit(queue, session, entry) {
  const connection = await access(queue,session,entry);
  if (entry.nativeDelivery) { await reconcile(queue,session,entry,connection); return; }
  // Persist intent *before* sending. A repeated add with the same client id is
  // accepted twice by Codex. Once intent exists all retries are reads only.
  let existing;
  try { existing=await queuedItem(connection,entry); }
  catch(error) {
    if(error.rpcCode!==-32601)throw error;
    await save(queue,session,entry,{nativeQueueAvailable:false});
    throw Error('이 Codex 버전은 원본 대기열을 지원하지 않습니다. 요청은 Flowrium 대기열에 있습니다.');
  }
  if(existing) {
    await save(queue,session,entry,{nativeThreadId:connection.threadId,nativeDeviceHash:connection.deviceHash,nativeDelivery:'queued',nativeQueueId:existing.id,nativeQueueAvailable:undefined});
    return;
  }
  const input=[{type:'text',text:entry.text}];
  if (entry.attachments?.length) {
    const files = await resolveAttachments(queue.store,session.projectId,entry.attachments.map(a=>a.id),true);
    if (files.some((file,index)=>!file.image || file.sha256!==entry.attachments[index].sha256 || file.type!==entry.attachments[index].type))
      throw Error('대기 중인 첨부 사진의 원본을 확인해 주세요.');
    for(const file of files)input.push({type:'image',url:file.dataUrl || 'data:'+file.type+';base64,'+file.bytes.toString('base64')});
    connection.guard();
  }
  const recent=await connection.client.request('thread/turns/list',{threadId:connection.threadId,limit:1,sortDirection:'desc',itemsView:'notLoaded'});
  connection.guard();
  if(!Array.isArray(recent.data))throw Error('원본 대화의 현재 작업 위치를 확인하지 못했습니다.');
  await save(queue,session,entry,{nativeDelivery:'submitting',nativeThreadId:connection.threadId,nativeDeviceHash:connection.deviceHash,
    nativeAfterTurnId:recent.data[0]?.id,nativeQueueAvailable:undefined,error:undefined});
  connection.guard();
  try {
    const {queuedSubmission:row}=await connection.client.request('thread/queue/add',{
      threadId:connection.threadId,clientUserMessageId:entry.id,input
    });
    connection.guard();
    if(!UUID.test(row?.id)||row.clientUserMessageId!==entry.id)throw Error('원본 접수 식별자를 확인하지 못했습니다.');
    await save(queue,session,entry,{nativeDelivery:'queued',nativeQueueId:row.id});
  } catch(error) {
    connection.guard();
    if(error.rpcCode===-32601){
      await save(queue,session,entry,{nativeDelivery:undefined,nativeThreadId:undefined,nativeDeviceHash:undefined,nativeAfterTurnId:undefined,nativeQueueAvailable:false});
      throw Error('이 Codex 버전은 원본 대기열을 지원하지 않습니다. 요청은 Flowrium 대기열에 있습니다.');
    }
    await save(queue,session,entry,{nativeDelivery:'uncertain'});
  }
}

async function cancel(queue, session, entry) {
  const connection = await access(queue,session,entry);
  const row = await reconcile(queue,session,entry,connection);
  if(!row)throw Error(entry.status==='sent'?'원래 앱이 이미 이 요청을 실행했습니다.':'원본의 수신 상태를 확인하고 있습니다.');
  connection.guard();
  const result=await connection.client.request('thread/queue/delete',{threadId:connection.threadId,queuedSubmissionId:row.id});
  connection.guard();
  if(result.deleted!==true) {
    await reconcile(queue,session,entry,connection);
    throw Error('원래 앱이 요청을 가져갔습니다. 대화의 진행 상태를 확인해 주세요.');
  }
  await save(queue,session,entry,{status:'cancelled',nativeDelivery:undefined,nativeQueueAvailable:undefined,waitingForWriter:undefined,error:undefined});
}

async function clearUnconfirmed(queue, session, entry) {
  const row=await reconcile(queue,session,entry);
  if(row)throw Error('원본 대기열에서 접수를 확인했습니다. 취소하려면 대기 취소를 선택해 주세요.');
  if(entry.status==='sent')return;
  if(entry.nativeDelivery!=='uncertain')throw Error('원본의 수신 상태를 다시 확인해 주세요.');
  await save(queue,session,entry,{status:'cancelled',nativeCleared:true,nativeDelivery:undefined,nativeQueueAvailable:undefined,waitingForWriter:undefined,error:undefined});
}

module.exports = {eligible,submit,reconcile,cancel,clearUnconfirmed};
