const assert=require('node:assert/strict');

async function editorDigest(input) {
  return input.evaluate(async el=>{
    let raw=el.value;
    if(el.dataset.draftWindowed) {
      const copy=new DataTransfer();
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}));
      el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:copy,bubbles:true,cancelable:true}));
      raw=copy.getData('text/plain');
      el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    }
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    return {length:raw.length,hash:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
  });
}

async function checkInlineDraft(page,input,draft) {
  const shortcut=process.platform==='darwin'?'Meta':'Control';
  const ink=input.locator('..').locator('.markdown-input-ink');
  const visiblyHidden=()=>ink.locator('.md-marker').evaluateAll(rows=>
    rows.length>0&&rows.every(row=>getComputedStyle(row).visibility==='hidden'));
  assert.equal(await page.getByRole('group',{name:'입력 서식'}).count(),0);
  await input.fill('현장 자료');
  await input.evaluate(el=>el.select());
  await input.press(shortcut+'+b');
  assert.equal(await input.inputValue(),'**현장 자료**');
  assert.equal(await ink.locator('.md-strong').textContent(),'현장 자료');
  assert(await visiblyHidden(),'굵게 기호가 화면에 표시되지 않음');
  assert(await input.evaluate(el=>{
    const flow=el.nextElementSibling, first=flow.querySelector('.md-strong');
    const range=document.createRange();range.selectNodeContents(first);
    return Math.abs(range.getBoundingClientRect().left-flow.getBoundingClientRect().left-parseFloat(getComputedStyle(flow).paddingLeft))<=1;
  }), '첫 줄 시작에서 굵게 기호가 들여쓰기 폭을 만들지 않음');
  await input.press(shortcut+'+i');
  assert.equal(await input.inputValue(),'***현장 자료***');
  assert.equal(await ink.locator('.md-em .md-strong').textContent(),'현장 자료');
  await input.press(shortcut+'+i');
  assert.equal(await input.inputValue(),'**현장 자료**','겹쳐 적용한 기울임만 해제');
  await input.fill('현장 자료');
  await input.evaluate(el=>el.select());
  await input.press(shortcut+'+b');
  await input.press(shortcut+'+z');
  assert.equal(await input.inputValue(),'현장 자료','단축키 서식도 기본 실행 취소로 복구');
  await input.evaluate(el=>el.select());
  await input.press(shortcut+'+i');
  assert.equal(await ink.locator('.md-em').textContent(),'현장 자료');
  await input.press(shortcut+'+i');
  assert.equal(await input.inputValue(),'현장 자료','같은 서식 단축키로 선택한 영역의 서식 해제');

  await input.fill('첫 항목\n둘째 항목');
  await input.evaluate(el=>el.select());
  await input.press(shortcut+'+Shift+Digit8');
  assert.equal(await input.inputValue(),'- 첫 항목\n- 둘째 항목');
  assert.equal(await ink.locator('.md-bullet[data-unordered]').count(),2);
  assert.match(await ink.locator('.md-bullet[data-unordered]').first().evaluate(el=>getComputedStyle(el,'::before').content),/•/);
  await input.press(shortcut+'+Shift+Digit7');
  assert.equal(await input.inputValue(),'1. 첫 항목\n2. 둘째 항목');
  await input.evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'1. 첫 항목\n2. 둘째 항목\n3. ');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'1. 첫 항목\n2. 둘째 항목\n','내용 없는 항목에서 줄을 바꾸면 번호 목록 종료');

  await input.fill('');
  await input.press(shortcut+'+b');
  assert(await visiblyHidden(),'입력을 시작하기 전 열린 굵게 기호도 숨김');
  await page.keyboard.insertText('굵게 입력');
  assert.equal(await input.inputValue(),'**굵게 입력**');
  assert.equal(await ink.locator('.md-strong').textContent(),'굵게 입력');
  await input.press('Space');
  assert(await visiblyHidden(),'굵게 작성 중 마지막 어절 뒤 공백에도 기호 표시 없음');
  await page.keyboard.insertText('이어서');
  assert.equal(await ink.locator('.md-strong').textContent(),'굵게 입력 이어서');
  await input.press('Space');
  await input.press(shortcut+'+b');
  await page.keyboard.insertText('보통 입력');
  assert.equal(await input.inputValue(),'**굵게 입력 이어서** 보통 입력','같은 단축키로 새 입력의 굵게를 끔');
  assert.equal(await ink.locator('.md-strong').textContent(),'굵게 입력 이어서');
  await input.fill('');
  await input.press(shortcut+'+i');
  assert(await visiblyHidden(),'입력 전 열린 기울임 기호도 숨김');
  await page.keyboard.insertText('기울여 입력');
  assert.equal(await input.inputValue(),'*기울여 입력*');
  assert.equal(await ink.locator('.md-em').textContent(),'기울여 입력');

  await input.fill('');
  await page.keyboard.type('*');
  assert.equal(await ink.locator('.md-bullet').count(),0,'별표 하나만 입력할 때에는 목록을 만들지 않음');
  await input.press('Space');
  assert.equal(await input.inputValue(),'* ');
  assert.match(await ink.locator('.md-bullet[data-unordered]').evaluate(el=>getComputedStyle(el,'::before').content),/•/);
  await page.keyboard.insertText('목록');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'* 목록\n* ');
  await input.fill('앞 문장\n');
  await page.keyboard.type('2.');
  assert.equal(await ink.locator('.md-bullet').count(),0);
  await input.press('Space');
  assert.equal(await input.inputValue(),'앞 문장\n\n2. ','문단 다음의 번호 목록은 Markdown 블록 경계를 함께 기록');
  assert.equal(await ink.locator('.md-bullet').textContent(),'2.');
  await page.keyboard.insertText('다음');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'앞 문장\n\n2. 다음\n3. ');
  await input.fill('```\n');
  await page.keyboard.type('* ');
  await input.press('Shift+Enter');
  assert.equal(await input.inputValue(),'```\n* \n','코드 블록의 별표는 목록으로 바꾸지 않음');

  await input.fill(draft);
  await ink.waitFor();
  assert.equal(await page.getByText('서식 미리보기',{exact:true}).count(),0);
  assert.equal(await ink.locator('.md-heading').textContent(),draft.split('\n')[0].slice(2));
  assert.equal(await ink.locator('.md-strong').textContent(),'강조');
  assert.equal(await ink.locator('.md-code').textContent(),'코드');
  assert.equal(await ink.locator('.md-task').textContent(),'[x]');
  assert.equal(await ink.getAttribute('aria-hidden'),'true');
  assert.equal(await input.inputValue(),draft);
  assert.equal(await ink.textContent(),draft);
  assert(await visiblyHidden());
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
    assert(await visiblyHidden(),'한글 조합 중 기존 서식 기호가 드러나지 않음');
    assert.match(await ink.textContent(),/ㄱ$/,'조합 중인 글자도 같은 서식 레이어에서 확인');
    await ime.send('Input.imeSetComposition',{text:'가',selectionStart:1,selectionEnd:1});
    await ime.send('Input.insertText',{text:'각'});
    assert.equal(await input.inputValue(),'**한글** 각');
    await ink.waitFor();
  }finally{await ime.detach();}
  const medium='**중간 길이**\n'+('한글 문장 유지 / '.repeat(16)+'\n').repeat(70);
  await input.fill(medium);
  await ink.locator('.md-strong').filter({hasText:'중간 길이'}).waitFor();
  assert(await input.evaluate(el=>{
    el.setRangeText('여기에서도 바로 표시',el.value.length,el.value.length,'end');
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    return el.nextElementSibling.textContent.endsWith('여기에서도 바로 표시');
  }),'분석 대기 중에도 이미 적용한 서식과 새 입력이 같은 위치에 즉시 표시');
  assert(await visiblyHidden());
  const bulk='# 긴 문서\n'+('긴 본문 '.repeat(100)+'\n').repeat(400)+'\n**끝**';
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
  const shortLines='합성 줄\n'.repeat(8500);
  const hiddenLine=shortLines+'가'.repeat(60_000)+'🚦\n'+shortLines.repeat(2);
  await input.evaluate((el,source)=>{
    const transfer=new DataTransfer(); transfer.setData('text/plain',source);
    el.focus();el.select();
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
  },hiddenLine);
  assert.equal(await input.getAttribute('data-draft-windowed'),'true','짧은 문단들 사이에 있는 긴 한 줄도 구간 편집');
  assert.equal((await editorDigest(input)).hash,require('node:crypto').createHash('sha256').update(hiddenLine).digest('hex'));
  await input.press(process.platform==='darwin'?'Meta+a':'Control+a');
  await input.press('Backspace');
  await input.fill(draft);
}
async function checkLargeDraft(page,input,verifyFailedSend,send,folder,{verifyLargeFailure=false}={}) {
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
      if(el.dataset.draftWindowed)el.dispatchEvent(new KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}));
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
    const actual=await editorDigest(input);
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
  const originals=page.locator('.messages article.message.user, .mobile-timeline article.message[data-role="user"]').getByText(/^긴 요청 원문 \([\d.,]+MB\)$/);
  await send.click();
  await originals.first().waitFor();
  await page.waitForFunction(()=>document.querySelector('.markdown-input textarea')?.value==='');
  const fs=require('node:fs/promises'),path=require('node:path');
  const attachments=path.join(folder,'.flowrium','attachments');
  const {createReadStream} = require('node:fs');
  async function sourceCount(expected) {
    const sizes=Buffer.byteLength(expected), expectedHash=hash(expected);
    let matches=0;
    for (const dir of await fs.readdir(attachments)) {
      const file=path.join(attachments,dir,'request.txt');
      const stat=await fs.stat(file).catch(()=>null);
      if (stat?.size!==sizes) continue;
      const digest=createHash('sha256');
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      if (digest.digest('hex')===expectedHash) matches++;
    }
    return matches;
  }
  assert.equal(await sourceCount(pasted),1,'실제 전송에서 전체 원문이 UTF-8 한 파일로 보존');
  const bytes=20*1024*1024+1,unit='한글 원문 '.repeat(25)+'\n';
  const oversized=unit.repeat(Math.floor(bytes/Buffer.byteLength(unit)))+'!'.repeat(bytes%Buffer.byteLength(unit));
  await send.waitFor();
  const before=await originals.count();
  await paste(oversized);
  await persisted(oversized);
  if (verifyLargeFailure) {
    await verifyFailedSend(oversized);
    await persisted(oversized);
    assert.equal(await sourceCount(oversized),0);
  }
  await send.click();
  await originals.nth(before).waitFor({timeout:45000});
  await page.waitForFunction(()=>document.querySelector('.markdown-input textarea')?.value==='');
  assert.equal(await originals.count(),before+1,'긴 요청은 대화 내 한 건으로 표시');
  assert.equal(await sourceCount(oversized),1,'20MiB를 넘는 원문 해시와 크기 일치');
  console.log('2,000,001자 붙여넣기',elapsed,'밀리초 / 실행 취소·다시 실행 / 2,000,000자 실패 복원 / 2,000,001자 정상 전송 및 첨부 해시 일치 / 20MiB + 1바이트 단일 메시지 전송 및 전체 SHA-256 일치');
}
module.exports={checkInlineDraft,checkLargeDraft,editorDigest};
