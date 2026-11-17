const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, randomBytes} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {openConversation} = require('./shell-test-helpers.cjs');

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
    await store.createSession(project.id,{title,messages});
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
    assert.match(await popup.locator('pre').innerText(),/둘째 기록/);
    await popup.getByRole('button',{name:'원문 보기',exact:true}).click();
    const original=popup.getByRole('region',{name:'작업 원문',exact:true});
    assert((await original.textContent()).includes('아주긴로그토큰'.repeat(400)));
    assert(await original.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await popupButton.click();
    await popup.waitFor({state:'hidden'});
    const input=page.getByRole('textbox',{name:'Codex에 보낼 작업 요청'});
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
    },page.getByRole('button',{name:'작업 보내기',exact:true}),folder);
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
    await page.getByRole('button',{name:'작업 보내기',exact:true}).waitFor();
    await input.fill('작업 단계 스트림 시험');
    await input.press('Enter');
    const liveButton=page.locator('.turn-progress-trigger').last();
    await popup.getByText('명령 실행',{exact:true}).waitFor();
    await popup.getByText('작업 중',{exact:true}).waitFor();
    await liveButton.click();
    await popup.waitFor({state:'hidden'});
    await liveButton.click();
    await fs.writeFile(gate,'완료');
    await popup.getByText('완료',{exact:true}).waitFor();
    assert.equal(await popup.locator('li').count(),1);
    await liveButton.click();
    await page.reload();
    await openConversation(page,title);
    await liveButton.click();
    await popup.getByText('완료',{exact:true}).waitFor();
    console.log('입력 마크다운 / 발신·수신 말풍선 / 요청별 과거와 실시간 작업 기록 및 재실행 복원 / 사진 가로 목록과 전송 후 보존 통과');
  } finally {
    await app?.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
