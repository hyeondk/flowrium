const assert=require('node:assert/strict');

async function checkInlineDraft(page,input,draft) {
  await input.fill(draft);
  const ink=input.locator('..').locator('.markdown-input-ink');
  await ink.waitFor();
  assert.equal(await page.getByText('서식 미리보기',{exact:true}).count(),0);
  assert.equal(await ink.locator('.md-heading').textContent(),draft.split('\n')[0].slice(2));
  assert.equal(await ink.locator('.md-strong').textContent(),'강조');
  assert.equal(await ink.locator('.md-code').textContent(),'코드');
  assert.equal(await ink.locator('.md-task').textContent(),'[x]');
  assert.equal(await ink.getAttribute('aria-hidden'),'true');
  assert.equal(await input.inputValue(),draft);
  assert.equal(await ink.textContent(),draft);
  assert(await ink.locator('.md-heading').evaluate(el=>parseFloat(getComputedStyle(el).webkitTextStrokeWidth)>0));
  assert.notEqual(await ink.locator('.md-code').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');

  const longLine='한글로 이어지는 문장 '.repeat(36)+'**강조** 직접 수정';
  await input.fill(longLine);
  await input.scrollIntoViewIfNeeded();
  await input.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.waitForFunction(()=>{const input=document.querySelector('.markdown-input textarea'), ink=input.nextElementSibling;return input.scrollTop>0 && Math.abs(input.scrollTop-ink.scrollTop)<=1;});
  const point=await ink.locator('.md-strong').evaluate(el=>{
    const range=document.createRange();range.setStart(el.firstChild,1);range.setEnd(el.firstChild,2);
    const box=range.getBoundingClientRect();return {x:box.x+box.width*.12,y:box.y+box.height*.55};
  });
  await page.mouse.click(point.x,point.y);
  const pos=longLine.lastIndexOf('강조')+1;
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[pos,pos],'줄바꿈된 강조 글자 위치와 편집 커서 일치');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'조');
  await page.keyboard.insertText('한');
  assert.equal(await input.inputValue(),longLine.replace('강조','강한'));
  await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
  assert.equal(await input.inputValue(),longLine);
  const ime=await page.context().newCDPSession(page);
  try {
    await input.fill('**한글** ');
    await ime.send('Input.imeSetComposition',{text:'ㄱ',selectionStart:1,selectionEnd:1});
    assert.equal(await ink.isVisible(),false,'조합 중 본문은 운영체제 입력창에 표시');
    await ime.send('Input.imeSetComposition',{text:'가',selectionStart:1,selectionEnd:1});
    await ime.send('Input.insertText',{text:'각'});
    assert.equal(await input.inputValue(),'**한글** 각');
    await ink.waitFor();
  }finally{await ime.detach();}
  const bulk='# 긴 문서\n'+('긴 본문 '.repeat(40000))+'\n**끝**';
  // Programmatic assignment, like a native paste, independently measures the
  // synchronous input handler without timing Playwright IPC or the OS clipboard.
  const elapsed=await input.evaluate((el,value)=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,value);
    const before=performance.now();
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
    return performance.now()-before;
  },bulk);
  assert(elapsed<500,'대량 붙여넣기 이벤트가 주 스레드를 장시간 점유하지 않아야 합니다: '+elapsed);
  assert.equal(await input.inputValue(),bulk);
  // Native defaults stay readable while the worker parses the pasted draft.
  await ink.locator('.md-strong').filter({hasText:'끝'}).waitFor({timeout:12000});
  assert.equal(await ink.textContent(),bulk);
  console.log('대량 원문 입력',bulk.length,'자 / 입력 이벤트',Math.round(elapsed),'밀리초 / 실제 한글 조합 완료');
  await input.fill(draft);
}
async function checkLargeDraft(page,input,verifyFailedSend,send,folder) {
  const {createHash}=require('node:crypto');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const head='  [원문 시작]\n',middle='[검증용 가운데]',tail='\n[원문 끝]  ';
  const line='줄바꿈과  공백이 있는 **강조** 입력 / 문맥 보존 확인.\n';
  const fill=count=>line.repeat(Math.ceil(count/line.length)).slice(0,count);
  const block=head+fill(1_000_000-head.length)+middle;
  const exact=block+fill(2_000_000-block.length-tail.length)+tail;
  async function paste(value) {
    return page.evaluate(raw=>{
      // Resolve the live control after the large protocol argument arrives.
      // Mobile state polling may have replaced the previously located element.
      const el=document.querySelector('.markdown-input textarea');
      el.focus();el.select();
      const data=new DataTransfer();data.setData('text/plain',raw);
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
      const start=performance.now();
      if(el.dispatchEvent(event))throw Error('긴 붙여넣기 처리기가 호출되지 않았습니다.');
      return Math.round(performance.now()-start);
    },value);
  }
  const pasted=exact+'!';
  const original=await input.inputValue();
  const elapsed=await paste(pasted);
  async function persisted(value) {
    const actual=await input.evaluate(async el=>{
      const raw=el.value,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
      return {length:raw.length,hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
    });
    assert.equal(actual.length,value.length);
    assert.equal(actual.hash,hash(value),'처음·가운데·끝과 공백을 포함한 전체 원문 보존');
    assert(await input.isVisible());
    assert.equal(await input.locator('..').getAttribute('data-formatted'),null,'대형 입력은 운영체제의 편집 가능한 본문을 표시');
  }
  await input.press(process.platform==='darwin'?'Meta+z':'Control+z');
  assert.equal(await input.inputValue(),original);
  await input.press(process.platform==='darwin'?'Meta+Shift+z':'Control+Shift+z');
  await persisted(exact+'!');
  await input.evaluate(el=>el.setSelectionRange(el.value.length-1,el.value.length));
  await input.press('Backspace');
  await persisted(exact);
  await verifyFailedSend(exact);
  await persisted(exact);
  await paste(pasted);
  await send.click();
  await page.getByText(/긴 요청 원문 \(/).first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.markdown-input textarea')?.value==='');
  const fs=require('node:fs/promises'),path=require('node:path');
  const attachments=path.join(folder,'.flowrium','attachments');
  const dirs=await fs.readdir(attachments);
  const files=await Promise.all(dirs.map(dir=>fs.readFile(path.join(attachments,dir,'request.txt')).catch(()=>null)));
  assert(files.some(raw=>raw&&hash(raw)===hash(pasted)),'실제 전송에서 전체 원문이 UTF-8 첨부로 보존');
  const bytes=20*1024*1024+1,unit='한글 원문 '.repeat(25)+'\n';
  const oversized=unit.repeat(Math.floor(bytes/Buffer.byteLength(unit)))+'!'.repeat(bytes%Buffer.byteLength(unit));
  await paste(oversized);
  await send.click();
  await page.getByText(/한 번에 보낼 수 있는 원문은 UTF-8 기준 20(?:MiB|MB)/).first().waitFor();
  await persisted(oversized);
  console.log('2,000,001자 붙여넣기',elapsed,'밀리초 / 실행 취소·다시 실행 / 2,000,000자 실패 복원 / 2,000,001자 정상 전송 및 첨부 해시 일치 / 20MiB + 1바이트 거절 후 전체 원문 보존');
}
module.exports={checkInlineDraft,checkLargeDraft};
