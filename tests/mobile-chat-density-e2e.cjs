const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events'),{_electron}=require('playwright');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs');
const {registerRemote}=require('../electron/remote.cjs');

async function main(){
 const root=path.resolve(__dirname,'..'),scratch=path.join(root,'.flowrium-tmp');await fs.mkdir(scratch,{recursive:true});
 const temp=await fs.mkdtemp(path.join(scratch,'mobile-density-'));
 const output=path.resolve(process.env.FLOWRIUM_CAPTURE_DIR||path.join(root,'artifacts/actual-design-20261118'));
 let app,controller,remote,workflow;
 try{
  const projectDir=path.join(temp,'온라인 스토어 분석');await fs.mkdir(path.join(projectDir,'docs'),{recursive:true});
  const store=new Store(path.join(temp,'profile'));await store.load();const project=await store.addProject(projectDir);
  await require('./project-trust-fixture.cjs').trustFixtureProject(store,project);
  await store.saveSettings({theme:'light',accentColor:'blue',model:'test-model'});
  const at=new Date().toISOString(),turnId=randomUUID();
  const row=(role,text)=>({id:randomUUID(),role,text,turnId,createdAt:at});
  const reply='<send_user_message_question_reply>'+JSON.stringify([{questionItemId:['request_user_input_async','sales-period'],question:'어느 기간의 매출을 비교할까요?',answer:'최근 3개월 / 월별 비교'}])+'</send_user_message_question_reply>';
  const chat=await store.createSession(project.id,{title:'월별 매출 분석',messages:[
   {...row('user','최근 3개월 매출과 주문 변화를 분석해줘.'),workStartedAt:new Date(Date.now()-206000).toISOString(),workCompletedAt:at},
   row('user',reply),
   {...row('system','주문 데이터를 정리하고 월별 매출을 비교했어요.'),progressCommentary:true},
   row('assistant','최근 3개월 매출 분석을 완료했습니다.\n\n**10월 매출 3,120만 원 / 전월 대비 14.3% 증가**\n주문 수가 늘며 매출도 함께 증가했어요. 월별 변화를 아래에 정리했습니다.\n\n:codex-file-citation{path="docs/월별 매출.png" purpose="output"}')
  ]});
  const handlers=new Map(),register=(name,fn)=>handlers.set(name,fn);let pending=[],locked=false;const delivered=[];
  controller=new Controller(store,{descriptor:{command:process.execPath,prefix:[path.join(__dirname,'backend-fake-codex.cjs')],label:'격리된 검증용 연결',node:false},canRun:()=>true,queueOwner:()=>0});await controller.connect();
  for(const [name,fn]of Object.entries({send:i=>controller.send(i),interrupt:id=>controller.interrupt(id),connect:()=>controller.connect(),saveSettings:v=>controller.saveSettings(v),listQueuedMessages:id=>controller.listQueuedMessages(id),securityPending:()=>[],readAccountUsage:()=>({checkedAt:Date.now(),allowed:true,credits:{hasCredits:false,unlimited:false},buckets:[]})}))register(name,fn);
  register('securityPending',()=>pending);
  register('answerInput',async input=>{delivered.push(input);pending=pending.filter(entry=>entry.requestId!==input.requestId);});
  register('readChatCitation',(...args)=>require('../electron/chat-citations.cjs').readChatCitation(store,...args));
  require('../electron/chat-attachments.cjs').registerChatAttachments(register,store);
  require('../electron/conversation-tools.cjs').registerConversationTools(register,controller);
  workflow=require('../electron/workflow.cjs').registerWorkflow(register,store,controller,{canRun:()=>true,accountRevision:()=>0,intervalMs:3600000});
  remote=registerRemote(register,{store,controller,handlers,isLocked:()=>locked,accountRevision:()=>0,version:'261118_02',tunnelFactory:()=>{
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=child.signalCode=null;
   child.kill=()=>{child.exitCode=0;child.emit('exit',0)};
   setTimeout(()=>child.stderr.emit('data',Buffer.from('https://density-fixture.trycloudflare.com Registered tunnel connection')),5);return child;
  }});
  const access=await handlers.get('startRemoteAccess')(),origin=new URL(access.localUrl).origin;
  const browser=path.join(temp,'browser.cjs');await fs.writeFile(browser,'const {app,BrowserWindow}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL("about:blank");});');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[browser,'--user-data-dir='+path.join(temp,'browser')],env});
  const page=await app.firstWindow();page.setDefaultTimeout(12000);await page.setViewportSize({width:390,height:844});
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  await page.goto(access.localUrl);await page.getByRole('button',{name:/온라인 스토어 분석.*업무/}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const chart=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=620;canvas.height=260;const c=canvas.getContext('2d');
   c.fillStyle='#ffffff';c.fillRect(0,0,620,260);c.font='700 22px NanumSquareRound';c.fillStyle='#263d54';c.fillText('월별 매출',28,36);
   c.font='16px NanumSquareRound';c.fillStyle='#5b6e81';c.fillText('단위 / 만 원',486,34);
   for(let i=0;i<3;i++){
    const x=95+i*195,heights=[94,112,142],h=heights[i];c.fillStyle=['#b5d6ff','#79b1f5','#2675da'][i];c.beginPath();c.roundRect(x,212-h,86,h,[9,9,0,0]);c.fill();
    c.font='700 19px NanumSquareRound';c.fillStyle='#304960';c.fillText(['2,480','2,730','3,120'][i],x+10,199-h);
    c.font='17px NanumSquareRound';c.fillStyle='#5b6e81';c.fillText(['8월','9월','10월'][i],x+25,241);
   }
   return canvas.toDataURL().split(',')[1];
  });
  await fs.writeFile(path.join(projectDir,'docs','월별 매출.png'),Buffer.from(chart,'base64'));
  await page.getByRole('button',{name:/온라인 스토어 분석.*업무/}).click();
  await page.getByRole('button',{name:/월별 매출 분석/}).click();
  await page.getByRole('region',{name:'보낸 질문 답변'}).waitFor();
  await page.locator('.citation-preview img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.citation-preview img')?.naturalWidth===620);
  assert.equal(await page.locator('article').getByText(/send_user_message_question_reply|questionItemId|codex-file-citation/).count(),0);
  assert.equal(await page.getByRole('region',{name:'보낸 질문 답변'}).getByRole('button').count(),0);
  const candidate=page.locator('.mobile-followup'),field=page.getByRole('textbox',{name:'요청',exact:true});await candidate.waitFor();
  assert.equal(await candidate.locator('span').innerText(),'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  const calls=[];page.on('request',req=>{if(req.url().endsWith('/api/mobile/call'))calls.push(req.postDataJSON()?.method)});
  await field.focus();await field.press('Tab');assert.equal(await field.inputValue(),'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  await field.fill('작성 중인 요청');assert.equal(await candidate.isVisible(),false);await field.fill('');
  await field.dispatchEvent('compositionstart');await field.press('Tab');assert.equal(await field.inputValue(),'');await field.dispatchEvent('compositionend');
  await field.blur();await candidate.waitFor();assert(!calls.includes('send')&&!calls.includes('workflowAction'));
  await fs.mkdir(output,{recursive:true});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
  await page.screenshot({path:path.join(output,'mobile-chat.png'),animations:'disabled'});
  const metrics=[];
  for(const [width,height]of [[320,705],[390,844],[430,900],[844,390]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
   const m=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,heading:document.querySelector('.mobile-chat-heading').getBoundingClientRect().height,composer:document.querySelector('.chat-compose').getBoundingClientRect().height,zoom:getComputedStyle(document.querySelector('.mobile-timeline')).zoom}));
   assert.equal(m.overflow,0,JSON.stringify(m));assert(m.heading<=48,JSON.stringify(m));assert(m.composer<=175,JSON.stringify(m));assert.equal(Number(m.zoom),.9);metrics.push(m);
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.evaluate(()=>document.fonts.ready);
  await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'mobile-chat.png'),animations:'disabled'});
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'설정',exact:true}).click();
  await page.getByRole('button',{name:'기본 설정 저장',exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(output,'mobile-settings.png'),animations:'disabled'});
  const picker=page.locator('select').first();await picker.scrollIntoViewIfNeeded();await picker.click();
  await page.waitForFunction(()=>document.querySelector('select')?.matches(':open'));
  await page.waitForTimeout(250);
  const selectBounds=await picker.boundingBox(),optionBounds=await picker.locator('option').first().boundingBox();
  assert(optionBounds&&selectBounds&&optionBounds.x>=selectBounds.x-1&&optionBounds.x+optionBounds.width<=selectBounds.x+selectBounds.width+1);
  assert(optionBounds.y>=0&&optionBounds.y+optionBounds.height<=844);
  await page.screenshot({path:path.join(output,'mobile-picker.png'),animations:'disabled'});await page.keyboard.press('Escape');
  const refresh=async()=>{
    const response=page.waitForResponse(r=>r.url().endsWith('/api/mobile/state')&&r.ok());
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;
    await page.evaluate(()=>new Promise(requestAnimationFrame));
  };
  const requestId=randomUUID(),question={type:'input',requestId,sessionId:chat.id,isBlocking:true,questions:[{id:'period',header:'비교 기간',question:'추가 분석에 포함할 기간을 선택해 주세요.',isSecret:false,isOther:true,options:[{label:'최근 3개월',description:'월별 변화를 확인합니다.'},{label:'최근 6개월',description:'반기 추이를 확인합니다.'}]}]};
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'홈',exact:true}).click();
  await page.getByRole('button',{name:/온라인 스토어 분석.*업무/}).click();await page.getByRole('button',{name:/월별 매출 분석/}).click();
  await field.fill('답변 중에도 보존할 요청');
  await field.dispatchEvent('compositionstart');pending=[question];await refresh();
  await page.waitForTimeout(850);assert.equal(await page.locator('.mobile-response-notice').count(),0,'한글 조합 중에는 질문 알림을 미룬다');
  await field.dispatchEvent('compositionend');await field.blur();
  const arrival=page.locator('.mobile-response-notice');await arrival.waitFor();
  assert.equal(await arrival.getByText('어시스턴트가 질문이 있으니 결정 부탁드립니다.',{exact:true}).count(),1);
  assert(!(await arrival.innerText()).includes('추가 분석에 포함할 기간'));
  const arrivalSize=await arrival.boundingBox();assert(arrivalSize.width<=360&&arrivalSize.height>=176);
  await page.screenshot({path:path.join(output,'mobile-question-arrival.png'),animations:'disabled'});
  await arrival.getByRole('button',{name:'대화에서 답하기',exact:true}).click();
  const form=page.locator('[data-input-request="'+requestId+'"]');await form.waitFor();
  assert.equal(await field.inputValue(),'답변 중에도 보존할 요청');
  await form.getByLabel('추가 분석에 포함할 기간을 선택해 주세요.').selectOption('0');
  await form.getByRole('button',{name:'질문 답변 보내기',exact:true}).click();await form.waitFor({state:'detached'});
  assert.equal(delivered.length,1);assert.equal(delivered[0].answers.period.answers[0],'최근 3개월');assert.equal(await arrival.count(),0);
  pending=[{...question,requestId:randomUUID(),questions:[{...question.questions[0],isSecret:true}]}];await refresh();await page.waitForTimeout(900);
  assert.equal(await arrival.count(),0,'비밀 질문은 모바일 도착 카드로 노출하지 않는다');
  pending=[];await refresh();
  const transient={...question,requestId:randomUUID()};pending=[transient];await refresh();
  assert.equal(await arrival.count(),0,'새 요청은 즉시 표시하지 않고 유예한다');pending=[];await refresh();await page.waitForTimeout(850);assert.equal(await arrival.count(),0,'유예 중 해결된 질문은 표시하지 않는다');
  await workflow.load();workflow.notification('done','월별 매출 분석','결과 / 최근 3개월 매출 분석 완료\n검증 / 주문 합계와 월별 집계 확인\n남은 사항 / 채널별 원인 분석',chat.id,chat.id);await workflow.save();
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'비서',exact:true}).click();
  const doneCard=page.locator('.mobile-notification-card[data-notification-kind=done]');await doneCard.waitFor();
  assert(await doneCard.getByText(`‘${chat.title}’ 대화의 답변이 완료됐습니다.`,{exact:true}).isVisible());
  assert((await doneCard.locator('.mobile-notification-summary').boundingBox()).height<=60);
  await doneCard.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'mobile-notifications.png'),animations:'disabled'});
  pending=[{...question,requestId:randomUUID()}];await refresh();await arrival.waitFor();locked=true;
  const lockResponse=page.waitForResponse(r=>r.url().endsWith('/api/mobile/state')&&r.status()===403);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await lockResponse;await arrival.waitFor({state:'detached'});
  assert.deepEqual(failures,[]);
  console.log('모바일 응답 요약 / 원시 태그 비노출 / 로컬 추천 / Tab 초안 / IME / 전송 없음 / 네 화면 크기 통과 '+JSON.stringify(metrics));
  console.log('최종 캡처 '+output);
 } finally {
  if(app)await app.close();if(remote)await remote.shutdown();if(workflow)await workflow.shutdown();if(controller)await controller.shutdown();
  await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
