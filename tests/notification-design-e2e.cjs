const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const currentVersion=require('../package.json').flowriumVersion,nextVersion=require('../electron/version.cjs').nextVersion(currentVersion);
const {addTrustedFixtureProject,backendFixtureAccount}=require('./project-trust-fixture.cjs');
const {closeInstalledApp}=require('./update-installed-ui.cjs');
async function run(){
 const root=path.resolve(__dirname,'..'),base=path.join(root,'.flowrium-tmp/qa-261115_03');
 await fs.mkdir(base,{recursive:true});const temporary=await fs.mkdtemp(path.join(base,'notification-design-'));
 const output=process.env.FLOWRIUM_NOTICE_SCREENS||path.join(temporary,'screens');await fs.mkdir(output,{recursive:true});
 let app;
 try{
  const profile=path.join(temporary,'profile'),folder=path.join(temporary,'온라인 스토어 매출 분석');await fs.mkdir(folder);
  const store=new Store(profile);await store.load();const project=await addTrustedFixtureProject(store,folder,{account:backendFixtureAccount});
  const session=await store.createSession(project.id,{title:'상반기 매출 분석'});
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temporary,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});const page=await app.firstWindow();page.setDefaultTimeout(16000);
  await page.setViewportSize({width:1440,height:900});await page.locator('.side-usage[data-connected=true]').waitFor();
  await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'입력질문검증',mode:'plan'}),session.id);
  const questionNotice=page.locator('.flow-question-notice[data-tone=question]');await questionNotice.waitFor();
  assert.equal(await questionNotice.getByRole('status').innerText(),'어시스턴트가 질문이 있으니 결정 부탁드립니다.');
  assert.equal(await questionNotice.count(),1);assert(!/비밀|검증 문구|명령/.test(await questionNotice.innerText()));
  const bell=page.getByRole('button',{name:/^알림 [1-9]\d*건$/}),count=bell.locator('.notification-count');
  await count.waitFor();
  const badgeCases=await count.evaluate(node=>{
   const original=node.textContent;
   return ['1','12','99+'].map((label,index,values)=>{
    node.textContent=label;
    const style=getComputedStyle(node),badge=node.getBoundingClientRect();
    const svg=node.parentElement.querySelector('svg').getBoundingClientRect();
    const result={height:badge.height,width:badge.width,radius:parseFloat(style.borderRadius),
     fontSize:parseFloat(style.fontSize),pointerEvents:style.pointerEvents,topOffset:svg.top-badge.top,
     clearBelowBadge:svg.bottom-badge.bottom};
    if(index===values.length-1)node.textContent=original;
    return result;
   });
  });
  assert(badgeCases.every(box=>Math.abs(box.height-14)<.1&&box.radius>=box.height/2&&box.fontSize<9&&
    box.pointerEvents==='none'&&box.topOffset>6&&box.clearBelowBadge>10),JSON.stringify(badgeCases));
  assert(Math.abs(badgeCases[0].width-badgeCases[0].height)<.1,'한 자리 알림 숫자는 원형');
  assert(badgeCases.slice(1).every(box=>box.width>=box.height&&box.width<27),'여러 자리 알림 숫자는 낮고 둥근 모양');
  const questionBox=await questionNotice.boundingBox();assert(Math.abs(questionBox.width-390)<1);assert(questionBox.height<115,JSON.stringify(questionBox));
  await page.screenshot({path:path.join(output,'안내-질문.png'),animations:'disabled'});
  const captureNotice=async(locator,name)=>{const box=await locator.boundingBox(),width=await page.evaluate(()=>innerWidth),scale=page.viewportSize().width/width;await page.screenshot({path:path.join(output,name),clip:{x:box.x*scale,y:box.y*scale,width:box.width*scale,height:box.height*scale},animations:'disabled'});};
  await captureNotice(questionNotice,'알림-질문-확대.png');
  await questionNotice.getByRole('button',{name:'대화에서 답하기',exact:true}).click();
  const form=page.locator('.conversation-question .input-request');await form.waitFor();
  assert.equal(await page.locator('.composer-area .input-request').count(),0);
  assert.equal(await form.locator('input:checked').count(),0);assert(await form.getByRole('button',{name:'답변 보내기',exact:true}).isDisabled());
  await questionNotice.waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'대화-질문카드.png'),animations:'disabled'});
  await form.getByRole('radio',{name:/요약/}).check();await form.getByRole('radio',{name:'직접 입력',exact:true}).check();
  await form.getByLabel('직접 답변').fill('매출 비교 자료');await form.getByLabel('비밀 답변').fill('임시 합성 확인값');
  await form.getByRole('button',{name:'답변 보내기',exact:true}).click();await form.waitFor({state:'detached'});
  await page.locator('.message.assistant').filter({hasText:'질문 응답 형식 확인 / 요약 / 매출 비교 자료'}).waitFor();
  const completed=page.locator('.flow-question-notice[data-tone=success]');await completed.waitFor();
  const conversationTitle=await page.evaluate(async id=>(await window.flowrium.bootstrap()).sessions.find(s=>s.id===id).title,session.id);
  assert.equal(await completed.getByRole('status').innerText(),`‘${conversationTitle}’ 대화의 답변이 완료됐습니다.`);
  assert.equal(await completed.locator('.flow-notice-summary p').count(),1);
  const completeText=await completed.innerText();assert.match(completeText,/답변을 마쳤습니다/);assert(!completeText.includes('임시 합성 확인값'));
  const completeBox=await completed.boundingBox();assert(Math.abs(completeBox.width-390)<1);assert(completeBox.height<115,JSON.stringify(completeBox));
  await page.screenshot({path:path.join(output,'안내-완료.png'),animations:'disabled'});
  await captureNotice(completed,'알림-완료-확대.png');
  const state=await page.evaluate(()=>window.flowrium.bootstrap());assert(!JSON.stringify(state).includes('임시 합성 확인값'));
  await page.setViewportSize({width:390,height:844});const small=await completed.boundingBox(),viewport=await page.evaluate(()=>innerWidth);assert(small.x>=-0.5&&small.x+small.width<=viewport+0.5,JSON.stringify({small,viewport}));
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'승인검증',mode:'build'}),session.id);
  const approvalNotice=page.locator('.flow-question-notice[data-tone=question]');await approvalNotice.getByText('승인 요청이 도착했어요',{exact:true}).waitFor();
  assert((await page.evaluate(()=>window.flowrium.securityPending())).some(event=>event.type==='approval'));
  await approvalNotice.getByRole('button',{name:'대화에서 확인하기',exact:true}).click();
  const approval=page.locator('.conversation-dock').getByRole('region',{name:'실행 승인 요청'});await approval.waitFor();
  await approval.getByRole('button',{name:'거절',exact:true}).click();await approval.waitFor({state:'detached'});
  await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'광고 문서 두 번째 확인',mode:'plan'}),session.id);
  await page.locator('.flow-question-notice[data-tone=success][data-phase=idle]').waitFor();
  await page.locator('.header-decisions').click();
  let popup=page.getByRole('dialog',{name:'알림',exact:true});
  await popup.locator('.attention-item p').first().waitFor();
  assert((await popup.locator('.attention-item p').allTextContents()).every(text=>Array.from(text).length<=70));
  const total=await popup.locator('.attention-item').count();
  assert(total>=3);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   const padding=await popup.evaluate(element=>{
    const surface=getComputedStyle(element),row=getComputedStyle(element.querySelector('.attention-item'));
    return [parseFloat(surface.paddingTop),parseFloat(surface.paddingBottom),parseFloat(row.paddingTop),parseFloat(row.paddingBottom)];
   });
   assert.equal(padding[0],padding[1]);
   assert.equal(padding[2],padding[3]);
   assert(padding[1]<=14&&padding[3]<=8);
  }
  await page.setViewportSize({width:1440,height:900});
  const rows=popup.locator('.attention-item'),ids=(await rows.evaluateAll(items=>items.map(item=>item.dataset.notificationId))).slice(0,3);
  const row=id=>popup.locator(`[data-notification-id="${id}"]`);
  await row(ids[0]).locator('.attention-remove').click();
  await row(ids[0]).waitFor({state:'detached'});
  await row(ids[1]).getByRole('checkbox').check();
  await row(ids[2]).getByRole('checkbox').check();
  await popup.getByRole('button',{name:'선택 삭제 (2)',exact:true}).click();
  for(const id of ids.slice(1))await row(id).waitFor({state:'detached'});
  assert((await page.evaluate(()=>window.flowrium.workflowState())).notifications.every(n=>!ids.includes(n.id)));
  await popup.getByRole('button',{name:'알림 닫기',exact:true}).click();
  await popup.waitFor({state:'hidden'});
  await app.evaluate(({BrowserWindow},{root,currentVersion,nextVersion})=>{
    const require=process.getBuiltinModule('node:module').createRequire(root+'/package.json');
    const state={status:'available',currentVersion,latestVersion:nextVersion,message:'시험 새 버전을 설치할 수 있습니다.'};
    require('./electron/updater.cjs').DesktopUpdater.prototype.getState=()=>state;
    BrowserWindow.getAllWindows()[0].webContents.send('flowrium:update',state);
  },{root,currentVersion,nextVersion});
  const update=page.locator('.flow-question-notice').filter({hasText:'Flowrium '+nextVersion+' 업데이트가 나왔습니다.'});
  await update.waitFor();
  assert.equal(await update.getByRole('button',{name:'알림 닫기',exact:true}).count(),0);
  await update.waitFor({state:'detached',timeout:7000});
  await page.locator('.header-decisions').click();
  popup=page.getByRole('dialog',{name:'알림',exact:true});
  const updateItem=popup.locator('.attention-item').filter({hasText:'Flowrium '+nextVersion+' 업데이트가 나왔습니다.'});
  await updateItem.getByRole('button',{name:'업데이트 열기',exact:true}).click();
  await page.getByRole('dialog',{name:'설정',exact:true}).getByRole('region',{name:'프로그램 업데이트',exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.flowrium.workflowState())).notifications.filter(n=>n.updateVersion===nextVersion).length,1);
  await fs.writeFile(path.join(output,'알림-질문-검증.json'),JSON.stringify({passed:true,badgeCases,questionBox,completeBox,small,questionInsideConversation:true,noAutoSelection:true,shortSummary:true,secretNotStored:true,approvalNoticeAndExplicitDecline:true},null,2)+'\n');
  console.log('알림 / 390px 공통 너비 / 간결한 안내 / 같은 대화 질문 이동 / 자동 선택 없음 / 명시 제출 / 70자 요약 / 비밀 답변 비보관 / 390px 화면 경계 검사 통과');
 }finally{try{if(app)await closeInstalledApp(app,'알림과 질문 전용 검사 앱 종료')}finally{await fs.rm(temporary,{recursive:true,force:true,maxRetries:6,retryDelay:150})}}
}
run().catch(error=>{console.error(error);process.exitCode=1});
