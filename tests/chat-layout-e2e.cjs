const {settledLayout,waitForCodexConnection}=require('./shell-test-helpers.cjs');
const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {openConversation}=require('./shell-test-helpers.cjs');

async function verifyComposerResize(page, historyTitle, recommendationTitle) {
  const input=page.getByRole('textbox',{name:'Codex에 보낼 작업 요청'});
  const handle=page.getByRole('separator',{name:'입력창 높이 조절'});
  const history=page.locator('.messages');
  const height=async el=>Math.round((await el.boundingBox()).height);
  await waitForCodexConnection(page);
  await openConversation(page,recommendationTitle);
  await page.setViewportSize({width:390,height:680});
  await input.focus();
  await page.waitForFunction(()=>document.querySelector('.composer textarea')?.dataset.inlineSuggestion==='true');
  const preview=await input.getAttribute('placeholder');
  assert(preview.length>65 && preview.length<=190,'여러 줄에 걸친 직전 답변의 후속 제안');
  const lineHeight=await input.evaluate(el=>parseFloat(getComputedStyle(el).lineHeight));
  assert((await height(input))>=lineHeight*2,'좁은 창의 긴 추천이 여러 줄로 자연스럽게 표시');
  assert(await input.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'긴 추천 전문이 자동 입력 높이에 들어옴');
  const waitingActions=page.locator('.chat-continuation-actions');
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:680});
    const rowFits=await waitingActions.evaluate(row=>{
      const onscreen=[...row.querySelectorAll('button')].map(button=>button.getBoundingClientRect());
      return row.scrollWidth<=row.clientWidth+1 && onscreen.every((box,i)=>box.width>0 && (!i || box.left>=onscreen[i-1].right-1));
    });
    assert(rowFits,'추천과 대기 버튼 겹침 없음 '+width);
  }
  await page.setViewportSize({width:390,height:680});
  const previewHeight=await height(input);
  const before=await height(history);
  assert(before>=260,'추천 표시 중에도 본문 공간 보존');
  await page.locator('.followup-accept[data-source="conversation"]').click();
  assert.equal(await input.inputValue(),preview);
  await input.fill('높이 조절 후 남아 있어야 하는 초안');
  await page.setViewportSize({width:1440,height:900});
  const start=await height(input), grip=await handle.boundingBox();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
  await page.mouse.down();
  await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2-112,{steps:8});
  await page.mouse.up();
  assert.equal(await height(input),start+112);
  assert.equal(await page.locator('html').getAttribute('data-composer-resizing'),null);
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  const saved=await height(input);
  assert.equal(saved,start+96);
  await page.waitForFunction(async()=>Object.values(await window.flowrium.readDrafts((await window.flowrium.securityState()).accountRevision)).some(d=>d.text==='높이 조절 후 남아 있어야 하는 초안'));
  await page.reload(); await openConversation(page,recommendationTitle);
  assert.equal(await height(input),saved);
  assert.equal(await input.inputValue(),'높이 조절 후 남아 있어야 하는 초안');
  await openConversation(page,historyTitle);
  const position=()=>history.evaluate(el=>({top:el.scrollTop,gap:el.scrollHeight-el.scrollTop-el.clientHeight,height:el.clientHeight}));
  await handle.focus(); await page.keyboard.press('End');
  await page.waitForTimeout(140);
  assert((await position()).gap<3,'최신 메시지 유지');
  await history.evaluate(el=>{el.scrollTop=200});
  await page.waitForTimeout(100);
  const prior=await position();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(360);
  assert.equal((await position()).top,prior.top,'읽던 과거 위치가 프레임 안정화 후 유지');
  await page.setViewportSize({width:320,height:568});
  await settledLayout(page.locator('.conversation-dock'));
  assert((await position()).height>150,'높이를 최대로 저장해도 작은 창의 본문 보존');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await handle.focus(); await page.keyboard.press('Home');
  assert.equal(await height(input),42);
  await handle.dblclick();
  assert.equal(await input.getAttribute('data-height-mode'),'auto');
  await page.setViewportSize({width:1440,height:900});
  await history.getByRole('button',{name:'최근 메시지로',exact:true}).evaluate(el=>el.click());
  await settledLayout(page.locator('.conversation-dock'));
  return {previewLength:preview.length,previewHeight,visibleHistoryDuringPreview:before,dragHeight:start+112,restoredHeight:saved};
}

async function run(){
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-chat-layout-'))),baseline=process.argv.includes('--baseline');let app,page;
 const report=process.env.FLOWRIUM_TEST_REPORT_DIR||path.join(root,'.flowrium-tmp/qa-261115_03');
 const measurements=[],errors=[];let resizeMetrics;
 try{
  const profile=path.join(temp,'profile'),folder=path.join(temp,'synthetic-project');await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await addTrustedFixtureProject(store, folder, {account: backendFixtureAccount});
  const latestAnswer='넓은 대화 화면에서 확인할 마지막 답변입니다.\n\n한국어 문장은 단어 중간에서 끊지 않고 자연스럽게 이어서 읽습니다.\n\n입력창 위의 현재 작업은 같은 자리에서 갱신됩니다. 작업 내역에서 위쪽 기록을 읽는 중에 새 작업이 들어와도 스크롤 위치가 유지됩니다.\n\n```js\nconst longLine = "'+('검증'.repeat(100))+'";\n```';
  const groundedPrompt='작업 내역 위쪽을 읽는 중에 테스트용 작업 이벤트를 연속으로 넣고, 현재 작업 줄과 읽던 위치가 밀리지 않는지 확인하는 회귀 테스트를 추가해줘';
  const messages=Array.from({length:302},(_,i)=>({id:randomUUID(),role:i%2?'assistant':'user',text:i===301?latestAnswer:`합성 대화 ${i+1}\n\n화면 공간과 스크롤을 확인하기 위한 검증 기록입니다.`,createdAt:new Date(1700000000000+i*1000).toISOString()}));
  const session=await store.createSession(project.id,{title:'넓은 채팅 배치 검증',threadId:'synthetic-layout-thread',messages,codexLink:{version:1,mode:'linked',sourceThreadId:'synthetic-layout-thread',ownerHash:'synthetic',deviceHash:'synthetic',importedAt:new Date().toISOString(),sourceUpdatedAt:new Date().toISOString(),snapshotHash:'synthetic',archivePath:'synthetic',activeAtImport:true,sourceMessageIds:[]}});
  store.session(session.id).codexLink={version:1,mode:'linked',sourceThreadId:'synthetic-layout-thread',ownerHash:'a'.repeat(64),deviceHash:'b'.repeat(64),importedAt:new Date().toISOString(),sourceUpdatedAt:new Date().toISOString(),snapshotHash:'c'.repeat(64),archivePath:'.flowrium/codex-source/'+('a'.repeat(64))+'/'+('b'.repeat(64))+'.json',activeAtImport:true,sourceMessageIds:[]};await store.save();
  const recommendation=await store.createSession(project.id,{title:'긴 추천 확인',messages:[
   {id:randomUUID(),role:'user',text:'입력창 높이 검증',createdAt:new Date().toISOString()},
   {id:randomUUID(),role:'assistant',text:'변경한 화면을 확인했습니다.\n다음 단계: 각 창의 폭에 맞춰 프로젝트 제목의 줄바꿈, 이전 메시지의 위치와 입력 영역의 높이를 다시 확인하고 최근 업데이트 전후의 화면 배치를 비교 검증해 주세요.',createdAt:new Date().toISOString()}]});
  const noRecommendation=await store.createSession(project.id,{title:'후속 근거 없는 완료 보고',messages:[
   {id:randomUUID(),role:'user',text:'검토 결과를 알려줘',createdAt:new Date().toISOString()},
   {id:randomUUID(),role:'assistant',text:'검토를 마쳤습니다.',createdAt:new Date().toISOString()}]});
  const typing=await store.createSession(project.id,{title:'입력과 전송 확인'});
  await store.saveSettings({codexPath:path.join(__dirname,'continuation-fake-codex.cjs')});const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:900});await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const followup=page.locator('.followup-accept');
  await openConversation(page,noRecommendation.title,{expanded:false});
  await page.locator('.messages').getByText('검토를 마쳤습니다.',{exact:true}).waitFor();
  await page.getByRole('progressbar',{name:'작업 추천 중'}).waitFor({state:'hidden'});
  assert.equal(await followup.count(),0,'실행 근거 없는 완료 보고에는 추천이 없음');
  await openConversation(page,session.title,{expanded:false});
  await followup.filter({hasText:groundedPrompt}).waitFor();
  await settledLayout(page.locator('.conversation-dock'));
  async function measure(){return page.evaluate(()=>{const rect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,client:e.clientWidth,scroll:e.scrollWidth,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight}:null;};return{viewport:{width:innerWidth,height:innerHeight},dock:rect('.conversation-dock'),heading:rect('.dock-heading'),session:rect('.session-heading'),link:rect('.codex-link-bar'),messages:rect('.messages'),composer:rect('.composer-area'),composerBox:rect('.composer'),toolbar:rect('.composer-toolbar'),continuation:rect('.chat-continuation'),continuationActions:rect('.chat-continuation-actions'),footnote:rect('.composer-footnote'),history:rect('.message-history-controls'),documentOverflow:document.documentElement.scrollWidth-innerWidth,focus:document.querySelector('.app-shell').dataset.chatFocus,textarea:rect('.composer textarea')};});}
  for(const [width,height]of [[1440,900],[1280,800],[1024,768],[800,700],[390,844],[320,568]]){
   await page.setViewportSize({width,height});await settledLayout(page.locator('.conversation-dock'));const m=await measure();measurements.push(m);
   assert.equal(m.focus,'false','대화가 본 화면을 숨기지 않음');
   if(width>=900){
    assert(m.dock.width>=350&&m.dock.width<=m.viewport.width*.46,'우측 대화 비율 '+width);
    assert(await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).isVisible(),'왼쪽 대시보드 유지 '+width);
   }else if(width<=760)assert(m.dock.width>=m.viewport.width-2,'작은 화면의 대화 폭 '+width);
   assert(m.messages.height>=m.viewport.height*.38,'본문 공간 '+width);
   // Chromium 배율에 따라 화면 높이와 문서의 CSS 높이는 다를 수 있습니다.
   const composerScreenHeight=m.composer.height*height/m.viewport.height;
   assert(composerScreenHeight<=Math.max(185,height*.28),'입력 영역의 기본 높이 '+width);
   assert(m.messages.scroll<=m.messages.client+1,'본문 가로 넘침 없음 '+width);
   assert(m.dock.scroll<=m.dock.client+1&&m.documentOverflow<=1,'대화와 문서 가로 넘침 없음 '+width);
   assert(m.textarea.height>=25&&m.textarea.height<=105,'자동 입력 높이 26~104px '+width);
   assert.equal(await page.locator('.messages [data-message-id]').count(),100);assert(await page.locator('.messages').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<3),'넓이 변경 후 최신 위치 유지');
   assert.equal(await followup.count(),1,'작업 줄과 스크롤에 대한 회귀 검증 추천 한 건 표시');
   assert.match(await followup.innerText(),/테스트용 작업 이벤트.*회귀 테스트를 추가해줘/s);
  }
  await page.setViewportSize({width:1440,height:900});
  await settledLayout(page.locator('.conversation-dock'));
  const compact=await measure();
  assert(compact.dock.width<=compact.viewport.width*.31,'같은 CSS 좌표에서 우측 패널 기본 너비는 화면의 31% 이하');
  resizeMetrics=await verifyComposerResize(page,session.title,recommendation.title);
  const originalWidth=(await measure()).dock.width;await page.getByRole('button',{name:'대화 패널 넓히기',exact:true}).click();await settledLayout(page.locator('.conversation-dock'));let m=await measure();assert.equal(m.focus,'false');assert(m.dock.width>originalWidth,'명시적인 우측 패널 폭 확대');assert(await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).isVisible());await page.getByRole('button',{name:'대화 패널 좁히기',exact:true}).click();await settledLayout(page.locator('.conversation-dock'));m=await measure();assert(Math.abs(m.dock.width-originalWidth)<1);
  // 고정 안내가 본문을 덮지 않고 과거 기록을 추가한 후에도 가시 위치가 유지되는지 확인합니다.
  const body=page.locator('.messages');
  const anchor=scrollTo=>body.evaluate((e,next)=>{if(next!==undefined)e.scrollTop=next;const b=e.getBoundingClientRect(),n=[...e.querySelectorAll('[data-message-id]')].find(n=>n.getBoundingClientRect().bottom>b.top+60);return{id:n?.dataset.messageId,y:n?.getBoundingClientRect().top,top:e.scrollTop,height:e.scrollHeight};},scrollTo);
  const before=await anchor(60);await page.waitForFunction(()=>document.querySelectorAll('.messages [data-message-id]').length===200);
  const immediate=await anchor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const frames=await anchor();await page.waitForTimeout(450);const settled=await anchor();for(const value of [immediate,frames,settled]){assert.equal(value.id,before.id);assert(Math.abs(value.y-before.y)<1.5);}
  await page.getByRole('button',{name:'최근 메시지로',exact:true}).click();await fs.mkdir(report,{recursive:true});await page.screenshot({path:path.join(report,'chat-after.png')});
  await openConversation(page,typing.title,{expanded:false});const input=page.getByLabel('Codex에 보낼 작업 요청');await input.fill('넓은 화면에서 Enter 전송 확인');await input.press('Enter');await page.locator('.message.assistant').first().waitFor();assert.equal((await page.evaluate(id=>window.flowrium.bootstrap().then(d=>d.sessions.find(s=>s.id===id)),typing.id)).messages.filter(m=>m.role==='user').length,1);
  await page.getByRole('button',{name:'대화 목록으로',exact:true}).click();await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();assert.equal(await page.locator('.app-shell').getAttribute('data-chat-focus'),'false');assert.deepEqual(errors,[]);console.log('우측 고정 대화 / 6개 화면 크기 / 본 화면 유지와 패널 폭 조정 / 입력 높이 드래그·키보드·복원 / 좁은 창의 긴 추천 전문과 대기 버튼 / 과거 기록 위치 / 전체 대화 보존 / Enter 전송 통과');
 }catch(error){console.error('대화 배치 실측',JSON.stringify(measurements));throw error;
 }finally{await fs.mkdir(report,{recursive:true});await fs.writeFile(path.join(report,'chat-layout-'+(baseline?'before':'after')+'.json'),JSON.stringify({baseline,measurements,resizeMetrics,errors},null,2));if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
run().catch(e=>{console.error(e);process.exitCode=1});
