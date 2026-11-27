const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {EventEmitter}=require('node:events'),{_electron}=require('playwright');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs');
const {CodexClient}=require('../electron/codex.cjs');
const {registerRemote}=require('../electron/remote.cjs');
const {createFollowupGenerator}=require('../electron/followup-generator.cjs');
const {backendFixtureAccount}=require('./project-trust-fixture.cjs');

async function typography(page,selectors) {
 return page.evaluate(selectors=>selectors.map(selector=>{
   const element=document.querySelector(selector), style=getComputedStyle(element);
   return {font:Number.parseFloat(style.fontSize),height:element.getBoundingClientRect().height};
 }),selectors);
}

async function verifyDashboardTouch(page) {
 const refresh=page.getByRole('button',{name:'새로고침',exact:true});
 const rect=await refresh.boundingBox(),cdp=await page.context().newCDPSession(page);
 const appearance=()=>refresh.evaluate(el=>{
   const css=getComputedStyle(el);
   return [css.backgroundColor,css.borderColor,css.boxShadow,css.outlineStyle,css.webkitTapHighlightColor];
 });
 const idle=await appearance();
 assert.equal(idle.at(-1),'rgba(0, 0, 0, 0)');
 try {
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.documentElement.hasAttribute('data-touch-input'));
  assert.deepEqual(await appearance(),idle);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  const {root}=await cdp.send('DOM.getDocument');
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.workspace-overview .mobile-compact-refresh'});
  await cdp.send('CSS.enable');
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
  assert.deepEqual(await appearance(),idle,'터치 뒤 브라우저가 호버 상태를 유지해도 강조가 남지 않는다');
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});
 } finally {
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await cdp.detach();
 }
}

async function verifyChatSafeArea(page) {
 const cdp=await page.context().newCDPSession(page);
 const devices=[
  {width:390,height:844,top:47,bottom:34,left:0,right:0},
  {width:844,height:390,top:0,bottom:21,left:47,right:47},
  {width:412,height:915,top:28,bottom:24,left:0,right:0},
 ];
 try {
  for(const device of devices) {
   const {width,height,...insets}=device;
   const landscape=width>height;
   await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:2,mobile:true,
     screenOrientation:{type:landscape?'landscapePrimary':'portraitPrimary',angle:landscape?90:0}});
   await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets});
   await page.waitForFunction(w=>innerWidth===w,width);
   const geometry=await page.evaluate(()=>{
    window.scrollTo(0,0);
    const heading=document.querySelector('.mobile-chat-heading');
    const back=heading.querySelector('button').getBoundingClientRect(),title=heading.querySelector('h1').getBoundingClientRect();
    const header=heading.getBoundingClientRect(),nav=document.querySelector('#nav').getBoundingClientRect();
    return {top:header.top,buttonTop:back.top,titleTop:title.top,left:back.left,right:title.right,navBottom:innerHeight-nav.bottom,
      flow:document.documentElement.scrollWidth-innerWidth};
   });
   const overview=JSON.stringify({device,geometry});
   assert(Math.abs(geometry.top)<=1 && Math.min(geometry.titleTop,geometry.buttonTop)>=insets.top+5,overview);
   assert(geometry.left>=insets.left-1 && geometry.right<=width-insets.right+1 && geometry.flow<=1,overview);
   assert(geometry.navBottom>=insets.bottom,overview);
  }
 } finally {
   await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{}});
   await cdp.send('Emulation.clearDeviceMetricsOverride');
   await cdp.detach();
   await page.setViewportSize({width:390,height:844});
 }
 console.log('휴대폰 채팅 상단 안전 영역 / 아이폰 세로·가로, 안드로이드 세로 / 제목·뒤로 가기·하단 메뉴가 화면 안에 표시됨');
}

async function verifyRecommendationFreshness(page,chat,expected,whenChanged) {
 const button=page.locator('button.mobile-followup');
 const historyRoute='**/api/mobile/sessions/'+chat.id+'?**';
 const reached=Promise.withResolvers(),older=Promise.withResolvers(),updated=Promise.withResolvers();
 let holdLatest=false;
 const delay=async route=>{
   const params=new URL(route.request().url()).searchParams;
   if(params.has('before')) await older.promise;
   else if(holdLatest) {reached.resolve();await updated.promise;}
   await route.continue();
 };
 await page.route(historyRoute,delay);
 try {
   const latest=page.waitForResponse(response=>response.url().includes('/sessions/'+chat.id+'?') &&
     !new URL(response.url()).searchParams.has('before') && response.ok());
   const started=Date.now();
   await page.getByRole('button',{name:new RegExp(chat.title)}).click();
   const first=await (await latest).json();
   assert.equal(first.messages.some(row=>row.id===first.recommendation.answerId),false);
   assert.equal(first.recommendation.prompt,expected);
   await button.filter({hasText:expected}).waitFor({timeout:8000});
   const initialMs=Date.now()-started;
   older.resolve();
   await page.getByRole('heading',{name:chat.title}).waitFor();
   holdLatest=true;
   const changeStarted=Date.now();
   await whenChanged();
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await Promise.race([reached.promise,page.waitForTimeout(8000).then(()=>{throw Error('갱신된 대화 기록 필요');})]);
   await button.filter({hasText:expected}).waitFor({state:'hidden'});
   holdLatest=false;updated.resolve();
   await button.filter({hasText:'윈도우 설치 복원을 검증해줘'}).waitFor({timeout:8000});
   const updateMs=Date.now()-changeStarted;
   await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
   assert.equal(await button.count(),0);
   assert(initialMs<10000&&updateMs<10000,JSON.stringify({initialMs,updateMs}));
   console.log('휴대폰: 작업 로그 57개 뒤 숨겨진 최종 답변 기반 추천 '+initialMs+'ms, 같은 답변의 이전 맥락 갱신 '+updateMs+'ms');
 } finally {
   older.resolve();updated.resolve();
   await page.unroute(historyRoute,delay);
 }
}

async function verifyCommandDrafts(page,store,finished,model,modelCommand,trace,changeModelPreference) {
 const list=page.getByRole('button',{name:'프로젝트로',exact:true});
 const input=page.getByRole('textbox',{name:'요청',exact:true});
 const candidate=page.locator('.mobile-followup');
 const expected='작업 내역 위쪽을 읽는 중에 테스트용 작업 이벤트를 연속으로 넣고, 현재 작업 줄과 읽던 위치가 밀리지 않는지 확인하는 회귀 테스트를 추가해줘';
 const writes=[];
 const record=req=>{
  if(req.url().endsWith('/api/mobile/call')) {
   const method=req.postDataJSON()?.method;
   if(method==='send'||method==='workflowAction')writes.push(method);
  }
 };
 const setModelEnabled=async enabled=>{
  changeModelPreference(enabled);
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/api/mobile/state')&&response.ok());
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  assert.equal((await (await refreshed).json()).settings.aiFollowups,enabled);
 };
 page.on('request',record);
 try {
  await page.getByRole('button',{name:new RegExp(finished.title)}).click();
  await candidate.filter({hasText:expected}).waitFor({timeout:8000});
  assert.doesNotMatch(await candidate.innerText(),/필요한 순서|확인 방법/);
  assert.equal(await input.getAttribute('placeholder'),expected);
  assert.equal(await input.inputValue(),'','추천 미리보기는 전송할 초안에 미리 입력하지 않는다');
  await candidate.click();
  assert.equal(await input.inputValue(),expected);
  await input.fill('읽던 기록을 유지하는지 확인하는 테스트를 추가해줘');
  await input.press('Tab');
  assert.equal(await input.inputValue(),'읽던 기록을 유지하는지 확인하는 테스트를 추가해줘');
  assert.equal(store.session(finished.id).messages.length,2);
  assert.equal(await fs.readFile(trace,'utf8'),'','기기 내 추천이 모델을 호출하지 않는다');
  await list.click();
  await setModelEnabled(true);
  const answerId=model.messages.at(-1).id;
  const reply=page.waitForResponse(response=>response.url().endsWith('/api/mobile/call')&&
    response.request().postDataJSON()?.method==='readChatRecommendation'&&response.ok());
  const started=Date.now();
  await page.getByRole('button',{name:new RegExp(model.title)}).click();
  const response=await reply;
  assert.deepEqual(response.request().postDataJSON().args,[model.id,answerId]);
  assert.equal((await response.json()).result.prompt,modelCommand.prompt);
  await candidate.filter({hasText:modelCommand.prompt}).waitFor({timeout:8000});
  const elapsed=Date.now()-started;
  assert(elapsed<10000);
  await input.focus();await input.press('Tab');
  assert.equal(await input.inputValue(),modelCommand.prompt);
  await input.fill('정산표에서 결제 수수료 누락분만 별도 표로 저장해줘');
  assert.equal(store.session(model.id).messages.length,2);
  assert.deepEqual(writes,[]);
  assert.equal(await fs.readFile(trace,'utf8'),'분석\n','허용한 모델 추천만 독립 분석으로 한 건 요청한다');
  await list.click();
  await setModelEnabled(false);
  console.log('휴대폰 화면 / 안내 문구 대신 고정 작업 줄 검증 초안 / 합성 모델의 새 명령 '+elapsed+'ms / 클릭과 Tab 뒤 편집 / 자동 전송 없음');
 } finally {page.off('request',record);}
}

async function main(){
 const root=path.resolve(__dirname,'..'),scratch=path.join(root,'.flowrium-tmp');await fs.mkdir(scratch,{recursive:true});
 const temp=await fs.mkdtemp(path.join(scratch,'mobile-density-'));
 const output=process.env.FLOWRIUM_CAPTURE_DIR && path.resolve(process.env.FLOWRIUM_CAPTURE_DIR);
 let app,controller,remote,workflow,generator;
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
  const recommend=await store.createSession(project.id,{title:'오래된 답변 추천 검증',messages:[
   row('user','아이폰 연결 유지를 먼저 확인해 주세요.'),
   row('assistant','연결 상태와 작업 항목을 확인했습니다.'),
   row('user','같은 조건으로 계속'),
   row('assistant','다음 단계\n- 윈도우 설치 복원을 검증해 주세요.\n- 아이폰 연결 유지를 확인해 주세요.'),
   ...Array.from({length:57},(_,i)=>({...row('system','공개 작업 설명 '+i),turnId:randomUUID(),progressCommentary:true})),
  ]});
  const retained=await store.createSession(project.id,{title:'휴대폰 중계 교체 추천',messages:[
   row('user','아이폰에서 QR 다시 안 찍고 연결이 유지되는지 확인해줘.'),
   row('user','이전 빌드는 전부 정리해줘.'),
   row('assistant','이전 설치본을 삭제했습니다. 직전 버전 복구본과 현재 휴대폰 중계가 사용하는 이전 빌드 실행 파일은 유지했습니다. 남은 작업은 없습니다.'),
  ]});
  const finished=await store.createSession(project.id,{title:'고정 작업 줄의 배포 결과',messages:[
   row('user','작업 과정은 같은 한 줄에서 계속 수정해서 보여줘.'),
   row('assistant','입력창 위의 현재 작업은 같은 자리에서 갱신됩니다. 이전 과정은 작업 내역에서 펼쳐 볼 수 있고, 위쪽 기록을 읽는 중에 새 작업이 들어와도 스크롤 위치가 유지됩니다.\n맥 설치 파일을 새 버전으로 배포했습니다.'),
  ]});
  const model=await store.createSession(project.id,{title:'주문 정산에서 찾은 다음 작업',messages:[
   row('user','정산표 항목에 맞게 검토해줘'),
   row('assistant','반품과 쿠폰은 서로 다른 열로 들어 있습니다. 결제 수수료가 빠진 주문도 있었습니다.'),
  ]});
  const avatarChat=await store.createSession(project.id,{title:'두 서비스의 답변 아이콘',messages:[
   row('assistant','Codex의 답변'),{...row('assistant','Claude의 답변'),provider:'claude'},
  ]});
  const modelCommand={prompt:'반품과 쿠폰을 주문 단위로 다시 묶고, 결제 수수료가 비어 있는 주문 번호만 새 표로 저장해줘',evidence:'결제 수수료가 빠진 주문'};
  const trace=path.join(temp,'추천 합성 전송 기록');await fs.writeFile(trace,'');
  const accountOwner=createHash('sha256').update('flowrium-account:'+backendFixtureAccount.toLowerCase()).digest('hex');
  const client=new CodexClient({descriptor:{command:process.execPath,prefix:[path.join(__dirname,'continuation-fake-codex.cjs')],label:'격리된 검증용 연결',node:false},
   spawn:(command,args,options)=>spawn(command,args,{...options,env:{...options.env,CODEX_HOME:path.join(temp,'codex'),
    FLOWRIUM_TEST_FOLLOWUP_TRACE:trace,FLOWRIUM_TEST_FOLLOWUP_MODEL:JSON.stringify(modelCommand)}}),
  });
  const handlers=new Map(),register=(name,fn)=>handlers.set(name,fn);
  let pending=[],locked=false,modelEnabled=false;const delivered=[];
  controller=new Controller(store,{client,canRun:()=>true,queueOwner:()=>0,modelAccount:()=>accountOwner});await controller.connect();
  generator=createFollowupGenerator(controller,{canRun:()=>modelEnabled});
  register('readChatRecommendation',(sessionId,answerId)=>generator.recommend(sessionId,answerId));
  for(const [name,fn]of Object.entries({send:i=>controller.send(i),interrupt:id=>controller.interrupt(id),connect:()=>controller.connect(),saveSettings:(value,options)=>controller.saveSettings(value,options),listQueuedMessages:id=>controller.listQueuedMessages(id),securityPending:()=>[],readAccountUsage:()=>({checkedAt:Date.now(),allowed:true,credits:{hasCredits:false,unlimited:false},buckets:[]})}))register(name,fn);
  register('securityPending',()=>pending);
  register('answerInput',async input=>{delivered.push(input);pending=pending.filter(entry=>entry.requestId!==input.requestId);});
  register('readChatCitation',(...args)=>require('../electron/chat-citations.cjs').readChatCitation(store,...args));
  require('../electron/chat-attachments.cjs').registerChatAttachments(register,store);
  require('../electron/conversation-tools.cjs').registerConversationTools(register,controller);
  workflow=require('../electron/workflow.cjs').registerWorkflow(register,store,controller,{canRun:()=>true,accountRevision:()=>0,intervalMs:3600000});
  remote=registerRemote(register,{store,controller,handlers,isLocked:()=>locked,accountRevision:()=>0,canUseFollowupModel:()=>modelEnabled,
   version:require('../package.json').flowriumVersion,tunnelFactory:()=>{
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=child.signalCode=null;
   child.kill=()=>{child.exitCode=0;child.emit('exit',0)};
   setTimeout(()=>child.stderr.emit('data',Buffer.from('https://density-fixture.trycloudflare.com Registered tunnel connection')),5);return child;
  }});
  const access=await handlers.get('startRemoteAccess')(),origin=new URL(access.localUrl).origin;
  const browser=path.join(temp,'browser.cjs');await fs.writeFile(browser,'const {app,BrowserWindow}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL("about:blank");});');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[browser,'--user-data-dir='+path.join(temp,'browser')],env});
  const page=await app.firstWindow();page.setDefaultTimeout(12000);await page.setViewportSize({width:390,height:844});
  if(output) await fs.mkdir(output,{recursive:true});
  const capture=async name=>{if(output) await page.screenshot({path:path.join(output,name),animations:'disabled'});};
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  await page.goto(access.localUrl);await page.getByRole('button',{name:/온라인 스토어 분석.*업무/}).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const dashboard=['.workspace-overview h1','[aria-label="프로젝트 현황"] .row strong','#nav button'];
  for (const width of [320,390]) {
    await page.setViewportSize({width,height:844});
    const sizes=await typography(page,dashboard);
    assert(sizes[0].font>=19&&sizes[0].font<20&&sizes[1].font===12&&sizes[2].font===10.5,JSON.stringify(sizes));
    assert(sizes[2].height>=44,JSON.stringify(sizes));
    const controls=await typography(page,['.mobile-execution button','.mobile-project-search']);
    assert(controls[0].height>=32&&controls[0].height<=36&&controls[1].height>=34&&controls[1].height<=36,JSON.stringify(controls));
  }
  await verifyDashboardTouch(page);
  await page.setViewportSize({width:810,height:1080});
  await page.evaluate(()=>{
    Object.defineProperties(screen,{width:{configurable:true,value:810},height:{configurable:true,value:1080}});
    dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(()=>document.documentElement.dataset.workspaceLayout==='wide');
  assert.deepEqual((await typography(page,dashboard.slice(0,2))).map(size=>size.font),[24,14]);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{delete screen.width;delete screen.height;dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.documentElement.dataset.workspaceLayout==='compact');
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
  await verifyRecommendationFreshness(page,recommend,'아이폰 연결 유지를 확인해줘',async()=>{
   const record=store.session(recommend.id);
   record.messages[0].text='윈도우 설치 복원을 먼저 확인해줘.';
   record.updatedAt=new Date(Date.now()+1_000).toISOString();
   await store.save();
  });
  const retainedStarted=Date.now();
  await page.getByRole('button',{name:new RegExp(retained.title)}).click();
  const retainedPrompt='QR을 다시 찍지 않도록 기존 연결을 유지하면서 휴대폰 중계를 최신 버전으로 옮기고, 교체가 확인되면 직전 복구본만 남기고 나머지 이전 빌드를 정리해줘';
  const retainedButton=page.locator('.mobile-followup').filter({hasText:retainedPrompt});
  await retainedButton.waitFor({timeout:8000});
  const retainedMs=Date.now()-retainedStarted;
  assert(retainedMs<10000);
  const retainedInput=page.getByRole('textbox',{name:'요청',exact:true});
  assert.equal(await retainedInput.getAttribute('placeholder'),retainedPrompt);
  assert.equal(await retainedInput.inputValue(),'');
  assert(await retainedButton.getByText('Touch',{exact:true}).isVisible());
  assert.equal(await retainedButton.getByText('Tab',{exact:true}).isVisible(),false);
  await capture('mobile-chat-long-suggestion.png');
  await retainedButton.scrollIntoViewIfNeeded();
  const touch=await page.context().newCDPSession(page),rect=await retainedButton.boundingBox();
  try {
    await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+rect.height/2}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(value=>document.querySelector('.chat-compose textarea')?.value===value,retainedPrompt);
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await touch.detach();
  }
  assert.equal(await retainedInput.inputValue(),retainedPrompt);
  console.log('이전 중계가 남은 휴대폰 대화 추천 '+retainedMs+'ms / QR 보존과 교체 후 정리가 편집 가능한 초안에 반영');
  await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
  await verifyCommandDrafts(page,store,finished,model,modelCommand,trace,value=>{modelEnabled=value;});
  await page.getByRole('button',{name:/월별 매출 분석/}).click();
  await page.getByRole('region',{name:'보낸 질문 답변'}).waitFor();
  await page.locator('.citation-preview img').waitFor();
  await page.waitForFunction(()=>document.querySelector('.citation-preview img')?.naturalWidth===620);
  assert.equal(await page.locator('article').getByText(/send_user_message_question_reply|questionItemId|codex-file-citation/).count(),0);
  assert.equal(await page.getByRole('region',{name:'보낸 질문 답변'}).getByRole('button').count(),0);
  const candidate=page.locator('.mobile-followup'),field=page.getByRole('textbox',{name:'요청',exact:true});await candidate.waitFor();
  await page.locator('[data-chat-picker=effort] select').waitFor();
  assert.equal(await candidate.locator('span').innerText(),'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  const calls=[];page.on('request',req=>{if(req.url().endsWith('/api/mobile/call'))calls.push(req.postDataJSON()?.method)});
  await field.focus();await field.press('Tab');assert.equal(await field.inputValue(),'매출 변화에 가장 크게 영향을 준 요인을 분석해줘');
  await field.fill('작성 중인 요청');assert.equal(await candidate.isVisible(),false);await field.fill('');
  await field.dispatchEvent('compositionstart');await field.press('Tab');assert.equal(await field.inputValue(),'');await field.dispatchEvent('compositionend');
  await field.blur();await candidate.waitFor();assert(!calls.includes('send')&&!calls.includes('workflowAction'));
  const grip=page.getByRole('separator',{name:'입력창 높이 조절'});
  const height=async()=>(await field.boundingBox()).height;
  const autoHeight=await height();
  await grip.focus();await grip.press('ArrowUp');assert(await height()>=autoHeight+16);
  await grip.press('Enter');assert.equal(await height(),autoHeight);
  const handle=await grip.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y-17,{steps:4});await page.mouse.up();
  assert(await height()>=autoHeight+16);
  await grip.press('Enter');assert.equal(await height(),autoHeight);
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});
  await capture('mobile-chat.png');
  const metrics=[];
  for(const [width,height]of [[320,705],[390,844],[430,900],[844,390]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));
   const m=await page.evaluate(()=>{
    const bounds=selector=>document.querySelector(selector).getBoundingClientRect();
    const heading=bounds('.mobile-chat-heading'), back=bounds('.mobile-chat-back'),states=bounds('.mobile-chat-states'),title=bounds('.mobile-chat-title');
    const dock=bounds('.mobile-chat-dock'),form=bounds('.chat-compose'),nav=bounds('#nav');
    const model=document.querySelector('.chat-options select[aria-label="이 채팅의 모델"]');
    const modelText=bounds('[data-chat-picker=model] .mobile-chat-choice-text > span');
    const effort=document.querySelector('[data-chat-picker=effort] .mobile-chat-choice-text > span');
    const recommendation=document.querySelector('.mobile-followup'),work=getComputedStyle(document.querySelector('.mobile-work > button'));
    const input=getComputedStyle(document.querySelector('.chat-compose textarea'));
    const send=bounds('.mobile-chat-send'),attach=bounds('.mobile-attach-button');
    return {width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,heading:heading.height,navHeight:nav.height,
      aligned:Math.abs(back.top-states.top)<=1&&title.top>=back.bottom,composer:form.height,dockAboveNav:dock.bottom<=nav.top+1,
      model:model.getBoundingClientRect().height,modelFill:getComputedStyle(model).backgroundColor,send:send.height,attach:attach.height,
      caretGap:model.getBoundingClientRect().right-modelText.right,effort:effort.textContent,
      recommendationHeight:recommendation.getBoundingClientRect().height,recommendationFont:parseFloat(getComputedStyle(recommendation).fontSize),
      workFill:work.backgroundColor,workBorder:work.borderTopWidth,inputFill:input.backgroundColor,inputBorder:input.borderTopWidth,
      zoom:getComputedStyle(document.querySelector('.mobile-timeline')).zoom};
   });
   assert.equal(m.overflow,0,JSON.stringify(m));
   assert(m.aligned&&m.heading>=92&&m.heading<=101&&m.navHeight>=53&&m.navHeight<=56,JSON.stringify(m));
   const [minComposer,maxComposer]=width===844?[134,155]:[153,173];
   assert(m.composer>=minComposer&&m.composer<=maxComposer&&m.dockAboveNav,JSON.stringify(m));
   assert(m.model>=44&&m.send>=44&&m.attach>=44&&m.modelFill==='rgba(0, 0, 0, 0)',JSON.stringify(m));
   assert(m.caretGap>=9&&m.caretGap<=16&&m.effort==='Medium',JSON.stringify(m));
   assert(m.recommendationHeight>=33&&m.recommendationHeight<=38&&m.recommendationFont<=12,JSON.stringify(m));
   assert(m.workFill==='rgba(0, 0, 0, 0)'&&m.workBorder==='0px',JSON.stringify(m));
   assert(m.inputFill==='rgba(0, 0, 0, 0)'&&m.inputBorder==='0px',JSON.stringify(m));
   assert.equal(Number(m.zoom),.9);metrics.push(m);
   const chatType=await typography(page,['.mobile-markdown','.chat-compose textarea','.mobile-chat-heading h1']);
   assert(chatType[0].font>=13&&chatType[0].font<14&&chatType[1].font===16&&chatType[2].font>=14&&chatType[2].font<15,JSON.stringify(chatType));
   assert(chatType[1].height>=44&&chatType[1].height<=132,JSON.stringify(chatType));
  }
  await verifyChatSafeArea(page);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.evaluate(()=>document.fonts.ready);
  await capture('mobile-chat.png');
  await page.getByRole('button',{name:'프로젝트로',exact:true}).click();
  await page.getByRole('button',{name:/두 서비스의 답변 아이콘/}).click();
  const authorIcons=async()=>page.locator('article[data-role=assistant]').evaluateAll(articles=>articles.map(article=>({
   provider:article.dataset.provider,icon:getComputedStyle(article.querySelector('.mobile-message-author'),'::before').backgroundImage,
  })));
  await page.getByText('Claude의 답변',{exact:true}).waitFor();
  assert.deepEqual((await authorIcons()).map(({provider,icon})=>[provider,new URL(icon.match(/url\("(.+)"\)/)[1]).pathname]),
   [['codex','/chatgpt.svg'],['claude','/claude.svg']]);
  const liveResponse=store.session(avatarChat.id).messages.at(-1);
  controller.runs.set(avatarChat.id,{sessionId:avatarChat.id,provider:'claude'});
  liveResponse.text='Claude의 답변 작성 중';controller.emit('event',{type:'delta',sessionId:avatarChat.id,text:'Claude의 답변 작성 중'});
  try{
   await page.getByText(liveResponse.text,{exact:true}).waitFor();
   assert.match((await authorIcons()).at(-1).icon,/\/claude\.svg/);
  }finally{controller.runs.delete(avatarChat.id);}
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'설정',exact:true}).click();
  await page.getByLabel('답변 길이',{exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));
  const settingsType=await typography(page,['#content h1','.settings-guides h2','.settings-guides button']);
  assert(settingsType[0].font>=20&&settingsType[0].font<21&&settingsType[1].font>=14&&settingsType[1].font<15&&settingsType[2].font===12,JSON.stringify(settingsType));
  assert(settingsType[2].height>=32&&settingsType[2].height<=38,JSON.stringify(settingsType));
  const updateIcon=page.getByRole('button',{name:'업데이트 확인',exact:true}).locator('svg:first-child');
  assert.equal(await updateIcon.getAttribute('aria-hidden'),'true');
  assert(await updateIcon.isVisible());
  for(const width of [320,390,430]) {
   await page.setViewportSize({width,height:844});
   const accountType=await typography(page,['.settings-account-models h2','.settings-account-identities td','.settings-account-models form select']);
   assert.deepEqual(accountType.map(size=>size.font),[13,11,16]);
   assert(accountType[2].height<=30,JSON.stringify(accountType));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'도움말',exact:true}).click();
  const guide=page.getByRole('dialog',{name:'도움말'});
  await guide.waitFor();
  assert.deepEqual((await typography(page,['#install-guide h2','#install-guide h3','#install-guide [data-help] p'])).map(size=>size.font),[15,13,12]);
  await guide.getByRole('button',{name:'도움말 닫기'}).click();
  await guide.waitFor({state:'hidden'});
  await capture('mobile-settings.png');
  const picker=page.locator('select').first();await picker.scrollIntoViewIfNeeded();await picker.click();
  await page.waitForFunction(()=>document.querySelector('select')?.matches(':open'));
  await page.waitForTimeout(250);
  const selectBounds=await picker.boundingBox(),optionBounds=await picker.locator('option').first().boundingBox();
  assert(optionBounds&&selectBounds&&optionBounds.x>=selectBounds.x-1&&optionBounds.x+optionBounds.width<=selectBounds.x+selectBounds.width+1);
  assert(optionBounds.y>=0&&optionBounds.y+optionBounds.height<=844);
  await capture('mobile-picker.png');await page.keyboard.press('Escape');
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
  const arrivalSize=await arrival.boundingBox();assert(arrivalSize.width<=360&&arrivalSize.height>=100&&arrivalSize.height<=165,JSON.stringify(arrivalSize));
  await capture('mobile-question-arrival.png');
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
  await doneCard.scrollIntoViewIfNeeded();await capture('mobile-notifications.png');
  pending=[{...question,requestId:randomUUID()}];await refresh();await arrival.waitFor();locked=true;
  const lockResponse=page.waitForResponse(r=>r.url().endsWith('/api/mobile/state')&&r.status()===403);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await lockResponse;await arrival.waitFor({state:'detached'});
  assert.deepEqual(failures,[]);
  console.log('모바일 응답 요약 / 원시 태그 비노출 / 로컬 추천 / Tab 초안 / IME / 전송 없음 / 네 화면 크기 통과 '+JSON.stringify(metrics));
  if(output) console.log('최종 캡처 '+output);
 } finally {
  generator?.invalidate();
  if(app)await app.close();if(remote)await remote.shutdown();if(workflow)await workflow.shutdown();if(controller)await controller.shutdown();
  await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
