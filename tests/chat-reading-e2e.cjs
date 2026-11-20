const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, randomBytes} = require('node:crypto');
const {_electron} = require('playwright');
const {expect} = require('playwright/test');
const {Store} = require('../electron/store.cjs');
const {openConversation} = require('./shell-test-helpers.cjs');

async function checkQueuedOriginal(app,page,input,sessionId) {
  const button=name=>page.getByRole('button',{name,exact:true});
  await input.fill('대기검증');
  await input.press('Enter');
  await button('작업 중지').waitFor();
  const expected=await input.evaluate(async el=>{
    const source='  다음 작업\n'+('한글 후속 지시 🚦 '.repeat(900000))+'\n끝  ';
    el.focus();el.select();
    const transfer=new DataTransfer();
    transfer.setData('text/plain',source);
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
    const bytes=new TextEncoder().encode(source);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return {bytes:bytes.length,hash:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
  });
  assert(expected.bytes>20*1024*1024);
  await button('현재 작업에 추가 지시 보내기').click();
  await page.locator('.chat-queue-panel').getByText(/긴 요청 원문/).waitFor();
  await button('작업 중지').click();
  const findSource=()=>page.evaluate(async({sessionId,hash})=>{
    const session=(await window.flowrium.bootstrap()).sessions.find(row=>row.id===sessionId);
    const sources=session.messages.filter(row=>row.role==='user'&&row.requestSource?.sha256===hash);
    return {ids:sources.map(row=>row.id),sent:session.queuedMessages.some(row=>row.status==='sent'&&row.requestSourceId===sources[0]?.requestSource?.id),
      answered:sources.length>0&&session.messages.some(row=>row.role==='assistant'&&row.turnId===sources[0].turnId)};
  },{sessionId,hash:expected.hash});
  let state;
  for(let attempt=0;attempt<240;attempt++) {
    state=await findSource();
    if(state.sent&&state.answered)break;
    await new Promise(resolve=>setTimeout(resolve,125));
  }
  assert(state.sent&&state.answered,'긴 후속 원문 대기열 전달 및 같은 턴 답변');
  assert.equal(state.ids.length,1);
  const messageId=state.ids[0];
  await app.evaluate(({clipboard})=>{
    clipboard.writeText=value=>{
      globalThis.flowriumCopiedDigest=process.getBuiltinModule('node:crypto').createHash('sha256').update(value).digest('hex');
    };
  });
  const row=page.locator('[data-message-id="'+messageId+'"]');
  await row.getByRole('button',{name:'메시지 복사',exact:true}).click();
  await page.getByText('메시지를 복사했습니다.',{exact:true}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.flowriumCopiedDigest),expected.hash);
  await button('작업 보내기').waitFor();
  await button('대화 관리').click();
  await page.getByRole('combobox',{name:'기준 요청'}).selectOption(messageId);
  await button('이 요청 전으로 되감기').click();
  await button('되감기 확인').click();
  const paging=page.getByRole('navigation',{name:'긴 입력 편집 범위'});
  await paging.waitFor();
  await paging.getByRole('button',{name:'마지막',exact:true}).click();
  assert((await input.inputValue()).endsWith('\n끝  '));
  await paging.getByRole('button',{name:'처음',exact:true}).click();
  assert((await input.inputValue()).startsWith('  다음 작업'));
  assert((await input.inputValue()).length<=12001);
  const {editorDigest}=require('./inline-draft-checks.cjs');
  assert.equal((await editorDigest(input)).hash,expected.hash);
  await input.press(process.platform==='darwin'?'Meta+a':'Control+a');
  await input.press('Backspace');
  await paging.waitFor({state:'detached'});
  assert.equal(await input.inputValue(),'');
  await input.press(process.platform==='darwin'?'Meta+z':'Control+z');
  await paging.waitFor();
  assert.equal((await editorDigest(input)).hash,expected.hash);
  console.log('후속 입력 '+expected.bytes+'바이트 / 기존 작업 대기열에서 한 번 전송 / 단일 턴 답변 / 원문 복사·되감기 입력 복원 전체 SHA-256 일치');
}

async function checkWorkProgress(page,input,popup,gate,title) {
  const send=page.getByRole('button',{name:'작업 보내기',exact:true});
  await send.waitFor();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{
    const history=document.querySelector('.messages');
    const watch=new MutationObserver(()=>{
      const row=[...history.querySelectorAll('.message.user[data-outgoing=true]')]
        .find(message=>message.querySelector('.message-prose')?.textContent==='작업 단계 스트림 시험');
      if(!row)return;
      window.firstOutgoing=row;
      window.outgoingAnimation=getComputedStyle(row).animationName;
      watch.disconnect();
    });
    watch.observe(history,{childList:true,subtree:true});
  });
  await input.fill('작업 단계 스트림 시험');
  await expect(send).toBeEnabled();
  await input.press('Enter');
  const historyButton=page.locator('.turn-progress-trigger').last();
  await page.getByText('요청을 처리하고 있어요',{exact:true}).waitFor();
  const live=page.getByRole('list',{name:'실시간 작업 과정',exact:true});
  await live.getByText('명령 실행',{exact:true}).waitFor();
  await live.getByText('작업 중',{exact:true}).waitFor();
  await live.getByText('준비 작업: 작업을 시작했습니다',{exact:true}).waitFor();
  assert.equal(await live.getByText('실시간 설명 맨 앞입니다.',{exact:true}).count(),1);
  assert.equal(await live.getByText('실시간 설명 맨 끝입니다.',{exact:true}).count(),1);
  await live.evaluate(el=>{el.scrollTop=0;});
  await expect.poll(()=>live.evaluate(el=>el.scrollTop)).toBe(0);
  await fs.writeFile(gate+'.search','검색');
  await expect(live.getByText('×6',{exact:true})).toBeAttached();
  const scroll=await live.evaluate(el=>{
    const note=el.querySelector('.work-timeline-commentary'),first=note.querySelector('p');
    return {top:el.scrollTop,client:el.clientHeight,height:el.scrollHeight,width:el.clientWidth,contentWidth:el.scrollWidth,
      first:first.getBoundingClientRect().top-el.getBoundingClientRect().top,clamp:getComputedStyle(note).webkitLineClamp,
      text:note.textContent.length};
  });
  assert(scroll.text>6000&&scroll.height>scroll.client&&scroll.contentWidth<=scroll.width+1);
  assert.equal(scroll.clamp,'none');
  assert.equal(scroll.top,0);
  assert(scroll.first>=0&&scroll.first<scroll.client);
  assert.equal(await page.locator('.messages .turn-progress-list').count(),0);
  const answer=page.locator('.chat-live-response .answer-progress');
  const readPercent=async()=>Number((await answer.innerText()).match(/([\d.]+)%/)?.[1]);
  const firstPercent=await readPercent();
  await expect.poll(readPercent).toBeGreaterThan(firstPercent);
  const gap=await page.locator('.composer-live-work-heading').evaluate(el=>parseFloat(getComputedStyle(el).gap));
  assert.equal(gap,6);
  assert(!(await live.innerText()).includes('표시하지 않을 에이전트 전문'));
  const prior=page.locator('.message.assistant .message-prose p').first();
  const renderedSize=el=>({font:getComputedStyle(el).fontSize,height:getComputedStyle(el).lineHeight,zoom:getComputedStyle(el.closest('.message-history-items')).zoom});
  const stableSize=await prior.evaluate(renderedSize);
  const outgoing=await page.evaluate(()=>({
    name:window.outgoingAnimation,same:window.firstOutgoing?.isConnected,
    count:document.querySelectorAll('[data-message-id="'+window.firstOutgoing?.dataset.messageId+'"]').length,
    date:window.firstOutgoing?.querySelector('.message-date')?.textContent,
    above:window.firstOutgoing?.querySelector('.message-date')?.getBoundingClientRect().bottom<=window.firstOutgoing?.querySelector('time span:last-child')?.getBoundingClientRect().top,
  }));
  assert.equal(outgoing.name,'chat-message-arrival');
  assert(outgoing.same&&outgoing.above);
  assert.equal(outgoing.count,1);
  assert.match(outgoing.date,/^\d{2}\.\d{2}\.\d{2}\.$/);
  await fs.writeFile(gate+'.stream','응답');
  const typed=page.locator('.chat-message-typing .message-prose p');
  await typed.waitFor();
  const initialText=await typed.textContent();
  assert(initialText&&!initialText.endsWith('답변 타이핑 끝 문장.'));
  assert.deepEqual(await typed.evaluate(renderedSize),stableSize);
  await expect(typed).toContainText('답변 타이핑 끝 문장.');
  const answerId=await typed.evaluate(el=>el.closest('[data-message-id]').dataset.messageId);
  await fs.writeFile(gate,'완료');
  await expect(answer).toContainText('답변 작성 완료 (100.0%)');
  await live.waitFor({state:'hidden'});
  const finalAnswer=page.locator('[data-message-id="'+answerId+'"] .message-prose p');
  assert.equal(await finalAnswer.count(),1);
  assert.deepEqual(await finalAnswer.evaluate(renderedSize),stableSize);
  await expect(finalAnswer).toContainText('답변 타이핑 끝 문장.');
  await historyButton.click();
  await popup.getByText('준비 작업: 작업을 마쳤습니다',{exact:true}).waitFor();
  assert.equal(await popup.getByText('실시간 설명 맨 앞입니다.',{exact:true}).count(),1);
  assert.equal(await popup.getByText('실시간 설명 맨 끝입니다.',{exact:true}).count(),1);
  assert(await popup.getByText(/^×[67]$/).count());
  const workTools=page.locator('.work-tool-details');
  const settings=page.getByLabel('대화 연결 및 작업 도구',{exact:true});
  await settings.click();
  await workTools.getByText('변경 사항',{exact:true}).click();
  await expect(workTools).toContainText('작업 기록.md');
  await expect(workTools).toContainText('+2 −1');
  await workTools.getByText('하위 에이전트',{exact:true}).click();
  await expect(workTools).toContainText('준비 작업');
  await workTools.getByText('소스',{exact:true}).click();
  await expect(workTools).toContainText('https://example.test/work');
  await settings.click();
  await page.reload();
  await openConversation(page,title);
  await historyButton.click();
  await popup.getByText('준비 작업: 작업을 마쳤습니다',{exact:true}).waitFor();
  await historyButton.click();
  console.log('6,000자 넘는 작업 원문과 맨 앞 스크롤 보존 / 연속 검색 모아 보기 / 실시간·완료 기록 중복 제거 / 답변 타이핑과 글자 크기 일치 / 발신 말풍선 지속·날짜 위아래 정렬 / 작업 도구 및 재시작 기록 복원 확인');
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(root, '.flowrium-tmp', 'chat-reading-'));
  const baseline = process.argv.includes('--baseline');
  const title = '채팅 읽기 화면 시험';
  const turnId = randomUUID();
  const note = (role, text) => ({id:randomUUID(), role, text, turnId, createdAt:new Date().toISOString()});
  const messages = [note('user','화면을 살펴보세요.'),note('system','실행 도구 / 명령\n\n첫 기록'),note('assistant','진행 상황을 확인했습니다.'),note('system','파일 변경 기록\n둘째 기록 / '+('아주긴로그토큰'.repeat(400))),note('system','도구 실행 기록\n셋째 기록'),note('assistant','결과 안내\n\n- 첫 항목\n- 둘째 항목\n- 셋째 항목\n\n후속 계획입니다.')];
  let app;
  try {
    const profile=path.join(temp,'profile'), folder=path.join(temp,'project');
    await fs.mkdir(folder);
    const store = new Store(profile); await store.load();
    const project = await addTrustedFixtureProject(store, folder, {account: backendFixtureAccount});
    const session=await store.createSession(project.id,{title,messages});
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const gate=path.join(temp,'finish-step');
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_STEP_GATE:gate};
    delete env.ELECTRON_RENDERER_URL; delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({args:[root],env});
    const page=await app.firstWindow();
    await page.setViewportSize({width:1450,height:920});
    await page.locator('.app-shell').waitFor();
    await page.evaluate(()=>window.flowrium.connect());
    await openConversation(page,title);
    const coords=await page.evaluate(()=>{
      const body=i=>document.querySelectorAll('.message-body')[i].getBoundingClientRect();
      const message=document.querySelector('.message.assistant:last-child');
      const p=message.querySelector('.message-prose p'),li=message.querySelectorAll('li');
      return {userLeft:body(0).left,assistantLeft:document.querySelector('.message.assistant .message-body').getBoundingClientRect().left,paragraphGap:parseFloat(getComputedStyle(p).marginBottom),listPitch:li[1].getBoundingClientRect().top-li[0].getBoundingClientRect().top,states:document.querySelectorAll('.message.system').length};
    });
    console.log(baseline?'기존 화면':'수정 화면',JSON.stringify(coords));
    if(baseline){assert.equal(coords.states,3);assert.equal(coords.userLeft,coords.assistantLeft);return;}
    assert(coords.userLeft>coords.assistantLeft+12);
    assert(coords.paragraphGap>=4 && coords.paragraphGap<=8);
    assert(coords.listPitch<=24);
    const popupButton=page.getByRole('button',{name:/작업 내역 보기/});
    assert.equal(await popupButton.count(),1);
    await popupButton.click();
    const popup=page.getByRole('list',{name:'작업 과정',exact:true});
    assert.equal(await popup.locator('details').count(),3);
    await popup.locator('summary').nth(1).click();
    const original=popup.locator('pre');
    assert.match(await original.innerText(),/둘째 기록/);
    assert((await original.textContent()).includes('아주긴로그토큰'.repeat(400)));
    assert(await original.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await popupButton.click();
    await popup.waitFor({state:'hidden'});
    const input=page.getByRole('textbox',{name:'Codex에 보낼 작업 요청'});
    if(process.argv.includes('--work-progress')) {
      await checkWorkProgress(page,input,popup,gate,title);
      return;
    }
    const draft='# 제목\n\n**강조** 그리고 `코드`\n\n- [x] 목록';
    await require('./inline-draft-checks.cjs').checkInlineDraft(page,input,draft);
    await require('./inline-draft-checks.cjs').checkLargeDraft(page,input,async()=>{
      // Only this test project's temporary directory is moved, briefly causing a real IPC failure.
      const moved=folder+'-moved';
      await fs.rename(folder,moved);
      try{
        await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
        await page.getByText(/파일이나 폴더를 찾을 수 없습니다/).first().waitFor();
      }finally{await fs.rename(moved,folder);}
    },page.getByRole('button',{name:'작업 보내기',exact:true}),folder,{verifyLargeFailure:true});
    await input.fill(draft);
    const image=await fs.readFile(path.join(root,'assets/flowrium.png'));
    // 무작위 픽셀을 담은 실제 PNG로 큰 원본의 운영체제 미리보기 경로도 검증합니다.
    const pixels=randomBytes(900*900*4);
    const large=Buffer.from(await app.evaluate(({nativeImage},base64)=>
      nativeImage.createFromBitmap(Buffer.from(base64,'base64'),{width:900,height:900}).toPNG().toString('base64'),pixels.toString('base64')),'base64');
    assert(large.length>2*1024*1024);
    await page.getByLabel('채팅에 첨부할 파일').setInputFiles(Array.from({length:8},(_,i)=>({name:'사진'+i+'.png',mimeType:'image/png',buffer:i===0?large:image})));
    const attachments=page.locator('.attachment-composer .chat-image-strip');
    await attachments.locator('img').nth(7).waitFor({state:'attached'});
    assert(!(await attachments.innerText()).includes('.png'));
    const thumb=attachments.getByRole('img',{name:'사진0.png',exact:true});
    await thumb.waitFor();
    assert(await thumb.evaluate(img=>img.complete && img.naturalWidth>0 && img.naturalWidth<=640));
    assert(await attachments.evaluate(e=>e.scrollWidth>e.clientWidth+30));
    await attachments.evaluate(e=>e.scrollLeft=e.scrollWidth);
    assert(await attachments.evaluate(e=>e.scrollLeft>40));
    await page.getByRole('button',{name:'사진7.png 첨부 제거'}).click();
    assert.equal(await attachments.locator('li').count(),7);
    await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    const sent=page.locator('.messages .message.user').last();
    await sent.locator('.chat-image-strip').waitFor();
    assert.equal(await sent.locator('.chat-image-strip li').count(),7);
    assert(!(await sent.locator('.chat-image-strip').innerText()).includes('.png'));
    await checkWorkProgress(page,input,popup,gate,title);
    await checkQueuedOriginal(app,page,input,session.id);
    console.log('입력 마크다운 / 발신·수신 말풍선 / 요청별 과거와 실시간 작업 기록 및 재실행 복원 / 사진 가로 목록과 전송 후 보존 통과');
  } finally {
    await app?.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
