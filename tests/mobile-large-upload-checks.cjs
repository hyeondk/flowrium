const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const path=require('node:path');

async function checkLargeMobileUpload(page,store,project,controller,origin){
  const session=await store.createSession(project.id,{title:'긴 원문 전송 확인'});
  const open=page.getByRole('button',{name:/긴 원문 전송 확인/});
  await open.click();
  const input=page.getByLabel('요청',{exact:true});
  const submit=page.getByRole('button',{name:'요청 보내기',exact:true});
  const expected=await input.evaluate(async el=>{
    const unit='한글조각경계🌿긴한줄',total=26*1024*1024+11,unitSize=new Blob([unit]).size;
    const raw=unit.repeat(Math.floor(total/unitSize))+' '.repeat(total%unitSize);
    const transfer=new DataTransfer();transfer.setData('text/plain',raw);el.focus();el.select();
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});el.dispatchEvent(event);
    const bytes=new TextEncoder().encode(raw),sum=await crypto.subtle.digest('SHA-256',bytes);
    return {size:bytes.length,length:raw.length,hash:Array.from(new Uint8Array(sum),b=>b.toString(16).padStart(2,'0')).join('')};
  });
  async function checkDraft(){
    await page.getByRole('button',{name:'전체 선택',exact:true}).click();
    const actual=await page.evaluate(async()=>{
      const el=document.querySelector('.chat-compose textarea');
      const clipboard=new DataTransfer();
      el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:clipboard,bubbles:true,cancelable:true}));
      const raw=clipboard.getData('text/plain'),sum=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
      return {visible:el.value.length,length:Number(el.dataset.draftLength),hash:Array.from(new Uint8Array(sum),b=>b.toString(16).padStart(2,'0')).join('')};
    });
    assert(actual.visible>0&&actual.visible<=12001);
    assert.equal(actual.length,expected.length);assert.equal(actual.hash,expected.hash);
  }
  await checkDraft();
  await page.getByRole('button',{name:'프로젝트로',exact:true}).click();await open.click();await checkDraft();
  const part=page.getByRole('textbox',{name:'원문 편집 구간'});
  await part.fill('2');await part.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="원문 편집 구간"]').value==='2');
  if(process.env.FLOWRIUM_MOBILE_LARGE_SCREENSHOT){
    await page.locator('.mobile-draft-pages').scrollIntoViewIfNeeded();
    await page.screenshot({path:process.env.FLOWRIUM_MOBILE_LARGE_SCREENSHOT,animations:'disabled'});
  }
  await checkDraft();
  const uploadPattern='**/api/mobile/request-upload?**',sendPattern=origin+'/api/mobile/call';
  const offsets=[],begins=[],receiptIds=[];
  let offline=true,loseReceipt=true,maxWireSize=0,turns=0;
  const client=controller.client,original=client.request;
  client.request=function(method,...args){if(method==='turn/start')turns++;return original.call(this,method,...args);};
  async function upload(route){
    const request=route.request(),address=new URL(request.url()),action=address.searchParams.get('action');
    if(request.method()==='POST'&&action==='begin'){
      const response=await route.fetch();const record=await response.json();begins.push(record.offset);return route.fulfill({response});
    }
    if(action==='part'){
      const offset=Number(address.searchParams.get('offset'));
      offsets.push(offset);maxWireSize=Math.max(maxWireSize,request.postDataBuffer().length);
      if(offline&&offset>=2*1024*1024)return route.fulfill({status:503,json:{error:'검증용 통신 중단'}});
    }
    return route.continue();
  }
  async function send(route){
    const body=route.request().postDataJSON();
    if(body.method!=='send' || body.args[0].sessionId!==session.id)return route.continue();
    receiptIds.push(body.args[0].submissionId);
    if(loseReceipt){
      loseReceipt=false;const response=await route.fetch();assert.equal(response.status(),200,await response.text());
      return route.fulfill({status:503,json:{error:'검증용 접수 응답 유실'}});
    }
    return route.continue();
  }
  await page.route(uploadPattern,upload);await page.route(sendPattern,send);
  try{
    await submit.click();await page.getByText('검증용 통신 중단',{exact:true}).waitFor();
    await checkDraft();
    assert.equal(turns,0);assert.equal(receiptIds.length,0);
    offline=false;await submit.click();await page.getByText('검증용 접수 응답 유실',{exact:true}).waitFor({timeout:60000});
    await checkDraft();
    await submit.click({timeout:60000});
    await page.waitForFunction(()=>document.querySelector('.chat-compose textarea').value==='',null,{timeout:60000});
    assert.deepEqual(begins,[0,2*1024*1024,expected.size]);
    assert.equal(receiptIds.length,2);assert.equal(new Set(receiptIds).size,1);
    const sent=store.session(session.id).messages.filter(x=>x.role==='user');
    assert.equal(turns,1);assert.equal(sent.length,1);assert.equal(sent[0].id,receiptIds[0]);
    assert.equal(sent[0].requestSource.sha256,expected.hash);assert.equal(sent[0].requestSource.size,expected.size);
    const bytes=createHash('sha256');
    for await(const chunk of createReadStream(path.join(project.path,'.flowrium','attachments',sent[0].requestSource.id,'request.txt')))bytes.update(chunk);
    assert.equal(bytes.digest('hex'),expected.hash);assert.equal(maxWireSize,1024*1024);
    assert.equal(offsets.filter(offset=>offset===0).length,1);
    console.log('모바일 실제 한 줄 입력 '+expected.size+'바이트 / 원문 12,000자씩 편집·재열기·전체 복사 / HTTP 최대 '+maxWireSize+'바이트 / '+begins[1]+'바이트에서 재개 / 접수 응답 유실 후 같은 ID로 재시도 / Codex 실행과 사용자 기록 각 1회 / 전체 SHA-256 일치');
  }finally{
    client.request=original;await page.unroute(uploadPattern,upload);await page.unroute(sendPattern,send);
  }
  await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
}
module.exports={checkLargeMobileUpload};
