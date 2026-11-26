const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

const action='Codex 대화 설정으로 보내기';
const confirmation='원래 Codex 대화에서 실행할까요?';
const labels={submitting:'Codex 접수 중',queued:'Codex에서 실행 대기',uncertain:'Codex 접수 확인 중'};
function fixtureRows(){
  const base={mode:'plan',createdAt:new Date().toISOString(),status:'queued',attachments:[],owner:'synthetic-queue'};
  return [
    {text:'사용자가 선택할 요청',waitingForWriter:true,nativeQueueAvailable:true},
    {text:'외부 전달 불가 요청',waitingForWriter:true,nativeQueueAvailable:false},
    {text:'보통의 대기 요청'},
    {text:'이미 취소한 추가 지시',status:'cancelled'},
    {text:'이미 보낸 추가 지시',status:'sent'},
    ...Object.keys(labels).map(state=>({text:'이미 시작된 요청 '+state,waitingForWriter:true,nativeQueueAvailable:true,nativeDelivery:state}))
  ].map(row=>({...base,...row,id:randomUUID()}));
}

async function verify(page,selector,rows,calls,clearCalls,sessionId,role){
  const row=item=>page.locator(selector).filter({has:page.getByText(item.text,{exact:true})});
  const target=row(rows[0]),trigger=target.getByRole('button',{name:action,exact:true});
  const dialog=page.getByRole(role,{name:confirmation,exact:true});
  await trigger.waitFor();
  assert.equal(await page.getByRole('button',{name:/지금 분기해 실행|지금 전달 재개/}).count(),0);
  for(const item of rows.slice(1)){
    const other=row(item);
    if(item.status==='sent'||item.status==='cancelled'){
      assert.equal(await other.count(),0,item.text);
      continue;
    }
    await other.getByText(item.text,{exact:true}).waitFor();
    assert.equal(await other.getByRole('button',{name:action,exact:true}).count(),0,item.text);
    assert.equal(await other.getByRole('button',{name:'이 기기의 대기 해제',exact:true}).count(),item.nativeDelivery==='uncertain'?1:0);
    if(item.nativeDelivery){
      await other.getByText(labels[item.nativeDelivery],{exact:true}).waitFor();
      assert.equal(await other.getByRole('button',{name:/지금 전달 재개|대기 지시 다시 시작/}).count(),0);
    }
  }
  assert.deepEqual(await calls(),[],'행 표시만으로 원래 앱에 전송하지 않습니다.');
  await trigger.click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(),/모델[\s\S]*파일 접근 권한[\s\S]*승인 설정/);
  assert.deepEqual(await calls(),[],'첫 클릭은 확인창만 엽니다.');
  await dialog.getByRole('button',{name:'취소',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await calls(),[],'취소 뒤 전송이 없어야 합니다.');
  await trigger.click();
  await dialog.getByRole('button',{name:action,exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await target.getByText(labels.queued,{exact:true}).waitFor();
  assert.equal(await trigger.count(),0,'접수된 요청을 다시 전송하는 버튼이 없어야 합니다.');
  assert.deepEqual(await calls(),[[sessionId,rows[0].id]],'사용자가 확인한 해당 대기 요청 한 건만 보냅니다.');

  const uncertain=rows.find(item=>item.nativeDelivery==='uncertain');
  const clear=row(uncertain).getByRole('button',{name:'이 기기의 대기 해제',exact:true});
  const clearDialog=page.getByRole(role,{name:'이 기기에서 대기를 해제할까요?',exact:true});
  assert.deepEqual(await clearCalls(),[]);
  await clear.click();
  await clearDialog.waitFor();
  await clearDialog.getByRole('button',{name:'취소',exact:true}).click();
  await clearDialog.waitFor({state:'hidden'});
  assert.deepEqual(await clearCalls(),[],'취소하면 로컬 대기 상태를 보존합니다.');
  await clear.click();
  await clearDialog.getByRole('button',{name:'이 기기의 대기 해제',exact:true}).click();
  await clearDialog.waitFor({state:'hidden'});
  await row(uncertain).waitFor({state:'detached'});
  assert.equal(await clear.count(),0);
  assert.deepEqual(await clearCalls(),[[sessionId,uncertain.id]]);
  assert.deepEqual(await calls(),[[sessionId,rows[0].id]],'로컬 대기를 해제해도 원본에는 추가 제출하지 않습니다.');
}

async function desktop(app,page,session){
  const rows=fixtureRows();
  const actual=await page.evaluate(()=>window.flowrium.bootstrap());
  const view=actual.sessions.find(s=>s.id===session.id);
  await app.evaluate(({app,ipcMain,BrowserWindow},{view,rows})=>{
    const win=BrowserWindow.getAllWindows()[0];
    globalThis.__nativeQueueUiCalls=[];
    globalThis.__clearQueueUiCalls=[];
    view.queuedMessages=rows;
    const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    const {Store}=req('./electron/store.cjs'),snapshot=Store.prototype.snapshot;
    Store.prototype.snapshot=function(){
      const result=snapshot.call(this),selected=result.sessions.find(s=>s.id===view.id);
      if(selected)selected.queuedMessages=rows;
      return result;
    };
    const publish=()=>win.webContents.send('flowrium:event',{type:'session',sessionId:view.id,session:view});
    ipcMain.removeHandler('flowrium:sendQueuedToCodex');
    ipcMain.handle('flowrium:sendQueuedToCodex',(_,sessionId,queueId)=>{
      globalThis.__nativeQueueUiCalls.push([sessionId,queueId]);
      const item=rows.find(q=>q.id===queueId);
      item.nativeDelivery='queued';
      publish();
      return {accepted:true};
    });
    ipcMain.removeHandler('flowrium:clearUnconfirmedCodexQueue');
    ipcMain.handle('flowrium:clearUnconfirmedCodexQueue',(_,sessionId,queueId)=>{
      globalThis.__clearQueueUiCalls.push([sessionId,queueId]);
      const item=rows.find(q=>q.id===queueId);
      Object.assign(item,{status:'cancelled',nativeCleared:true,nativeDelivery:undefined});
      publish();
      return structuredClone(item);
    });
    publish();
  },{view,rows});
  await verify(page,'.chat-queue-panel > div',rows,()=>app.evaluate(()=>globalThis.__nativeQueueUiCalls),()=>app.evaluate(()=>globalThis.__clearQueueUiCalls),session.id,'dialog');
  console.log('데스크톱 원래 앱 대기 전달 / 별도 동의 / 취소 / 수락 / 전송 상태 3개 / 중복 버튼 제거 / 불확실 대기 해제와 원격 추가 전송 0건 통과');
}

async function mobile(page,handlers,session){
  const rows=fixtureRows(),calls=[],clearCalls=[];
  const previousList=handlers.get('listQueuedMessages');
  const previousSend=handlers.get('sendQueuedToCodex');
  const previousClear=handlers.get('clearUnconfirmedCodexQueue');
  handlers.set('listQueuedMessages',id=>id===session.id?rows:previousList(id));
  handlers.set('sendQueuedToCodex',(sid,qid)=>{
    calls.push([sid,qid]);rows.find(q=>q.id===qid).nativeDelivery='queued';
    return {accepted:true};
  });
  handlers.set('clearUnconfirmedCodexQueue',(sid,qid)=>{
    clearCalls.push([sid,qid]);
    const item=rows.find(q=>q.id===qid);
    Object.assign(item,{status:'cancelled',nativeCleared:true,nativeDelivery:undefined});
    return structuredClone(item);
  });
  try{
    await verify(page,'.queue-line',rows,()=>calls,()=>clearCalls,session.id,'alertdialog');
    console.log('모바일 원래 앱 대기 전달 / 하단 확인창 취소·수락 / 상태 표시 / 중복 버튼 제거 / 불확실 대기 해제와 원격 추가 전송 0건 통과');
  }finally{
    handlers.set('listQueuedMessages',previousList);
    if(previousSend)handlers.set('sendQueuedToCodex',previousSend);else handlers.delete('sendQueuedToCodex');
    if(previousClear)handlers.set('clearUnconfirmedCodexQueue',previousClear);else handlers.delete('clearUnconfirmedCodexQueue');
  }
}
module.exports={desktop,mobile};
