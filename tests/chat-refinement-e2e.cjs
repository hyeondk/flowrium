const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {_electron}=require('playwright'),{Store}=require('../electron/store.cjs');
const {updateDetails}=require('../electron/project-details.cjs');
const {openConversation,settledLayout}=require('./shell-test-helpers.cjs');
async function capture(app,file,box){
 const encoded=await app.evaluate(async({BrowserWindow},box)=>{
  const window=BrowserWindow.getAllWindows()[0],zoom=window.webContents.getZoomFactor();
  const rect=box?{x:Math.max(0,Math.floor(box.x*zoom)),y:Math.max(0,Math.floor(box.y*zoom)),width:Math.ceil(box.width*zoom),height:Math.ceil(box.height*zoom)}:undefined;
  return (await window.webContents.capturePage(rect)).toPNG().toString('base64');
 },box);await fs.writeFile(file,Buffer.from(encoded,'base64'));
}
async function main(){
 const root=path.resolve(__dirname,'..'),scratch=process.env.FLOWRIUM_TEST_TEMP_ROOT||os.tmpdir();await fs.mkdir(scratch,{recursive:true});
 const temp=await fs.realpath(await fs.mkdtemp(path.join(scratch,'flowrium-chat-refinement-'))),profile=path.join(temp,'profile');let app,page;
 const proof={sizes:[],errors:[]},out=path.resolve(process.env.FLOWRIUM_CAPTURE_DIR||path.join(root,'artifacts/actual-design-20261118'));
 try{
  const folder=path.join(temp,'온라인 매출 분석');await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await store.addProject(folder);
  await require('./project-trust-fixture.cjs').trustFixtureProject(store,project);
  await updateDetails(store,project.id,null,{action:'category',category:'데이터 분석'});
  const at=new Date().toISOString(),hash='a'.repeat(64),thread=randomUUID();
  const session=await store.createSession(project.id,{title:'월별 매출 흐름 확인',context:{used:1280,total:1280,max:10000,percent:12.8},messages:[
   {id:randomUUID(),role:'user',text:'상반기 월별 매출을 비교하고 감소한 달의 원인을 정리해줘.',createdAt:at},
   {id:randomUUID(),role:'assistant',text:'상반기 매출을 월별로 비교했어요.\n\n**6월 매출은 3,600만 원**으로 1월보다 50% 늘었습니다. 3월에는 주문 수가 줄었고, 4월부터 다시 증가했습니다.\n\n1. 월별 매출 합계 6건을 대조했습니다.\n2. 감소 원인은 제품별 판매량과 반품률을 함께 확인하면 더 정확해집니다.',createdAt:at}
  ]});
  await store.createSession(project.id,{title:'제품별 판매량 비교'});
  store.session(session.id).codexLink={version:1,mode:'linked',sourceThreadId:thread,ownerHash:hash,deviceHash:hash,snapshotHash:hash,archivePath:'.flowrium/codex-source/'+hash+'/'+hash+'.json',activeAtImport:false,sourceMessageIds:[],importedAt:at,sourceUpdatedAt:at};
  await store.save();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light',model:'gpt-6.1-sol'});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_CHAT_MODELS:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>proof.errors.push(error.message));await page.locator('.app-shell').waitFor();await page.bringToFront();
  // Synthetic state only: never inspect real voice credentials or a Codex thread.
  await app.evaluate(({ipcMain})=>{
   ipcMain.removeHandler('flowrium:voiceStatus');ipcMain.handle('flowrium:voiceStatus',()=>({configured:false}));
   ipcMain.removeHandler('flowrium:codexTransferAction');ipcMain.handle('flowrium:codexTransferAction',()=>({sync:'current'}));
   ipcMain.removeHandler('flowrium:copyText');ipcMain.handle('flowrium:copyText',(_event,text)=>{globalThis.chatRefinementCopied=text;});
  });
  await page.setViewportSize({width:1440,height:900});await openConversation(page,session.title);await page.evaluate(()=>document.fonts.ready);
  const dock=page.locator('.conversation-dock'),assistant=page.locator('.message.assistant').first(),user=page.locator('.message.user').first();
  await page.locator('.session-heading .project-category-label').getByText('데이터 분석',{exact:true}).waitFor();
  await dock.getByRole('button',{name:'대화 패널 보기 방식',exact:true}).click();assert.equal(await page.getByRole('menuitem',{name:'대화 화면 설정 열기',exact:true}).count(),0);await page.keyboard.press('Escape');
  for(const width of [1440,900,390,320]){
   await page.setViewportSize({width,height:900});await settledLayout(dock);
   const metrics=await assistant.evaluate(row=>{
    const center=r=>(r.top+r.bottom)/2,box=e=>e.getBoundingClientRect();
    const avatar=box(row.querySelector('.message-avatar')),icon=box(row.querySelector('.chatgpt-avatar'));
    const author=row.querySelector('.message-meta strong'),label=box(author),font=getComputedStyle(author);
    const canvas=document.createElement('canvas').getContext('2d');
    canvas.font=font.font;
    const ink=canvas.measureText(author.textContent);
    const inkCenter=center(label)+(ink.fontBoundingBoxAscent-ink.fontBoundingBoxDescent-ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent)/2*label.height/parseFloat(font.lineHeight);
    const bubble=box(row.querySelector('.message-bubble'));
    const assistantTime=box(row.querySelector('.message-time')),assistantCopy=box(row.querySelector('.copy-message'));
    const user=document.querySelector('.message.user'),ownBubble=box(user.querySelector('.message-bubble')),copy=box(user.querySelector('.copy-message')),userTime=box(user.querySelector('.message-time'));
    const tokenSummary=document.querySelector('.chat-token-summary'),token=box(tokenSummary),settings=box(document.querySelector('.session-details>summary'));
    const track=box(tokenSummary.querySelector('.chat-token-track')),fill=box(tokenSummary.querySelector('.chat-token-fill'));
    const heading=box(document.querySelector('.session-heading h2')),scope=box(document.querySelector('.session-heading .eyebrow'));
    return {width:innerWidth,iconOffset:Math.abs(center(icon)-center(avatar)),authorOffset:Math.abs(inkCenter-center(icon)),userCopyOutside:copy.top>=ownBubble.bottom,userCopyRight:Math.abs(copy.right-ownBubble.right),
     userTimeOutside:userTime.right<=ownBubble.left-3&&Math.abs(userTime.bottom-ownBubble.bottom)<1,
     userHeaderCount:user.querySelectorAll('.message-meta').length,assistantTimeBelow:assistantTime.top>=bubble.bottom,assistantFooterOffset:Math.abs(center(assistantTime)-center(assistantCopy)),
     timestampsInsideBubbles:document.querySelectorAll('.message-bubble time').length,
     radius:parseFloat(getComputedStyle(row.querySelector('.message-bubble')).borderRadius),userRadius:parseFloat(getComputedStyle(user.querySelector('.message-bubble')).borderRadius),
     tokenBeforeSettings:token.right<=settings.left+1,tokenWidth:track.width,tokenRatio:fill.width/track.width,headingGap:heading.top-scope.bottom,overflow:document.documentElement.scrollWidth-innerWidth,messageOverflow:row.scrollWidth-row.clientWidth,
     bubbleWidth:bubble.width,scale:getComputedStyle(document.querySelector('.message-history-items')).zoom};
   });
   assert(metrics.iconOffset<.25&&metrics.authorOffset<1,'실제 아이콘과 Codex 글자의 세로 중심 '+JSON.stringify(metrics));
   assert(metrics.userTimeOutside&&metrics.userHeaderCount===0&&metrics.assistantTimeBelow&&metrics.assistantFooterOffset<1&&metrics.timestampsInsideBubbles===0,'시간은 말풍선 밖 / 내 시간은 왼쪽 하단 / 응답 시간은 하단 도구와 나란히');
   assert(metrics.userCopyOutside&&metrics.userCopyRight<2,'사용자 복사 도구는 말풍선 바깥 우측 하단');
   assert(metrics.radius>=18&&metrics.userRadius>=18&&metrics.tokenBeforeSettings,'둥근 양측 말풍선 / 토큰은 설정 왼쪽');
   assert(metrics.headingGap>=4.5,'대화 종류와 제목 사이 간격 '+JSON.stringify(metrics));
   assert(metrics.tokenWidth<=40&&Math.abs(metrics.tokenRatio-.128)<.02,'설정 왼쪽의 짧은 문맥 사용량 막대 '+JSON.stringify(metrics));
   assert(metrics.overflow<=1&&metrics.messageOverflow<=1&&Number(metrics.scale)===.9,JSON.stringify(metrics));proof.sizes.push(metrics);
  }
  await page.setViewportSize({width:1440,height:900});await settledLayout(dock);
  const meter=dock.getByRole('meter',{name:'컨텍스트 길이',exact:true});
  const usageTip=page.getByRole('tooltip').filter({hasText:'12.8% 사용'});
  await meter.hover();await usageTip.waitFor();assert.match(await usageTip.innerText(),/1,280 \/ 10,000 토큰/);
  await page.mouse.move(0,0);await usageTip.waitFor({state:'hidden'});
  await meter.focus();await usageTip.waitFor();assert.match(await meter.getAttribute('aria-valuetext'),/12\.8% 사용 \/ 1,280 \/ 10,000 토큰/);
  await page.locator('.session-details>summary').focus();await usageTip.waitFor({state:'hidden'});
  await page.locator('.session-details>summary').click();await page.getByRole('button',{name:'대화 새로고침',exact:true}).waitFor();
  proof.sync=await page.locator('.codex-link-bar').evaluate(bar=>{const a=bar.querySelector('summary').getBoundingClientRect(),b=bar.querySelector(':scope>.button').getBoundingClientRect();return {centerOffset:Math.abs((a.top+a.bottom-b.top-b.bottom)/2),buttons:bar.querySelectorAll(':scope>.button').length}});assert(proof.sync.centerOffset<1);await page.locator('.session-details>summary').click();
  const picker=page.getByRole('combobox',{name:'이 채팅의 모델',exact:true});
  proof.menuFrames=await picker.evaluate(button=>new Promise(resolve=>{
   const frames=[],start=performance.now();button.click();
   function sample(){const menu=document.querySelector('[role=listbox][aria-label="이 채팅의 모델"]');if(menu){const r=menu.getBoundingClientRect(),b=button.getBoundingClientRect(),css=getComputedStyle(menu);frames.push({opacity:Number(css.opacity),clip:css.clipPath,top:r.top,bottom:r.bottom,triggerTop:b.top,placement:menu.dataset.placement,animation:css.animationName,height:r.height,offset:menu.offsetHeight,scroll:menu.scrollHeight,zoom:css.zoom,styleHeight:css.height,border:[css.borderTopWidth,css.borderBottomWidth],clientH:menu.clientHeight,clientW:menu.clientWidth,scrollW:menu.scrollWidth,width:r.width});}if(performance.now()-start<280)requestAnimationFrame(sample);else resolve(frames)}requestAnimationFrame(sample);
  }));
  assert(proof.menuFrames.some(f=>f.opacity>0&&f.opacity<1),'모델 메뉴가 여러 프레임에 걸쳐 펼쳐집니다');
  const last=proof.menuFrames.at(-1);assert(last.placement==='up'&&last.bottom<=last.triggerTop-3&&last.top>=0&&last.animation==='choice-reveal-up','모델 메뉴는 화면 안에서 위로 펼쳐집니다 '+JSON.stringify(last));
  await picker.press('ArrowDown');await picker.press('Enter');await page.getByRole('listbox',{name:'이 채팅의 모델',exact:true}).waitFor({state:'detached'});
  const voice=page.getByRole('button',{name:'음성으로 입력',exact:true}),notice=page.locator('.voice-message');await voice.click();await notice.waitFor();const start=Date.now();await page.waitForTimeout(1000);assert(await notice.isVisible());await notice.waitFor({state:'detached',timeout:5200});proof.voiceExpiryMs=Date.now()-start;assert(proof.voiceExpiryMs>=4600&&proof.voiceExpiryMs<=6000);
  await user.getByRole('button',{name:'메시지 복사',exact:true}).click();assert.equal(await app.evaluate(()=>globalThis.chatRefinementCopied),session.messages[0].text,'복사 원문 보존');
  await assistant.getByRole('button',{name:'좋아요',exact:true}).click();await assistant.getByRole('button',{name:'좋아요 취소',exact:true}).waitFor();
  await page.evaluate(()=>document.activeElement?.blur());await fs.mkdir(out,{recursive:true});await capture(app,path.join(out,'대화-07-말풍선.png'),await dock.boundingBox());
  await picker.click();await page.getByRole('listbox',{name:'이 채팅의 모델',exact:true}).waitFor();await page.waitForTimeout(220);await capture(app,path.join(out,'대화-07-모델선택.png'));await picker.press('Escape');
  await dock.getByRole('button',{name:'대화 목록으로',exact:true}).click();
  const rows=dock.locator('.dock-session-list .dock-session');
  await rows.nth(1).waitFor();
  proof.conversationRowGap=await rows.evaluateAll(([first,second])=>second.getBoundingClientRect().top-first.getBoundingClientRect().bottom);
  assert(proof.conversationRowGap>=2.5,'대화 목록의 두 선택 영역 사이 간격');
  const projectPicker=page.getByRole('combobox',{name:'대화함 프로젝트 선택',exact:true});await projectPicker.click();const list=page.getByRole('listbox',{name:'대화함 프로젝트 선택',exact:true});await list.getByText('데이터 분석',{exact:true}).waitFor();assert.equal(await list.locator('.project-category-label .lucide-tag').count(),1);await page.waitForTimeout(220);await capture(app,path.join(out,'대화-07-프로젝트분류.png'),await dock.boundingBox());
  await projectPicker.press('Escape');
  await rows.filter({has:page.getByText('제품별 판매량 비교',{exact:true})}).click();
  const unavailable=dock.getByRole('img',{name:'컨텍스트 사용량을 아직 확인하지 못했습니다.',exact:true});
  await unavailable.waitFor();assert.equal(await unavailable.locator('.chat-token-fill').count(),0);
  await unavailable.focus();
  await page.locator('.messages').dispatchEvent('scroll');
  const unavailableTip=page.getByRole('tooltip').filter({hasText:'컨텍스트 사용량을 아직 확인하지 못했습니다.'});
  await unavailableTip.waitFor();
  await page.locator('.messages').dispatchEvent('scroll');
  assert(await unavailableTip.isVisible(),'대화가 스크롤되어도 초점을 둔 컨텍스트 도움말을 유지합니다');
  await unavailable.blur();
  await unavailableTip.waitFor({state:'detached'});
  assert.deepEqual(proof.errors,[]);proof.passed=true;await fs.writeFile(path.join(out,'대화-07-검증.json'),JSON.stringify(proof,null,2)+'\n');
  console.log('대화 개선 검사 통과 / 양측 말풍선·메타정보·복사 도구 / 문맥 사용량 막대와 마우스·키보드 도움말 / 분류·동기화 / 모델 위로 펼침 / 음성 안내 5초 / 4개 폭 / 원문 복사·좋아요 유지');
 }finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
