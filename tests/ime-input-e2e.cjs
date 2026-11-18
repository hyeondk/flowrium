const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{EventEmitter}=require('node:events'),{_electron}=require('playwright');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs');
const {registerRemote}=require('../electron/remote.cjs');
const {openConversation}=require('./shell-test-helpers.cjs');
const {editorDigest}=require('./inline-draft-checks.cjs');

async function compose(page,input,{during,guardKeys=false}={}){
 await input.focus();const element=await input.elementHandle(),cdp=await page.context().newCDPSession(page);
 await element.evaluate(el=>{
  const descriptor=Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');
  el.__imeWrites={value:0,selection:0,active:false};
  Object.defineProperty(el,'value',{configurable:true,get(){return descriptor.get.call(this)},set(v){if(this.__imeWrites.active)this.__imeWrites.value++;descriptor.set.call(this,v)}});
  const original=el.setSelectionRange;el.__originalSelection=original;
  el.setSelectionRange=function(...args){if(this.__imeWrites.active)this.__imeWrites.selection++;return original.apply(this,args)};
  el.addEventListener('compositionstart',()=>el.__imeWrites.active=true,{once:true});
  el.addEventListener('compositionend',()=>el.__imeWrites.active=false,{once:true});
 });
 try{
  for(const text of ['ㅎ','하','한']){
   await cdp.send('Input.imeSetComposition',{text,selectionStart:1,selectionEnd:1});
   assert(await element.evaluate(el=>el.isConnected&&document.activeElement===el),'한글 조합 중 입력 요소와 초점을 보존합니다');
   if(text==='하'&&during)await during(element);
  }
  if(guardKeys)for(const init of [{key:'Enter',isComposing:true},{key:'Escape',isComposing:true},{key:'Enter',keyCode:229},{key:'Escape',keyCode:229}]){
   await element.evaluate((el,init)=>el.dispatchEvent(new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true})),init);
   assert(await element.evaluate(el=>el.isConnected&&document.activeElement===el),'조합 중 확인/취소 키로 입력창을 닫거나 전송하지 않습니다');
  }
  const writes=await element.evaluate(el=>el.__imeWrites);assert.equal(writes.value,0,'조합 중 스크립트에서 value를 다시 쓰지 않습니다');assert.equal(writes.selection,0,'조합 중 스크립트에서 커서를 다시 지정하지 않습니다');
  await cdp.send('Input.insertText',{text:'한'});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  return writes;
 }finally{
  await element.evaluate(el=>{delete el.value;el.setSelectionRange=el.__originalSelection;delete el.__originalSelection;delete el.__imeWrites;}).catch(()=>{});
  await cdp.detach();
 }
}

async function main(){
 const root=path.resolve(__dirname,'..'),scratch=path.join(root,'.flowrium-tmp');await fs.mkdir(scratch,{recursive:true});
 const temp=await fs.realpath(await fs.mkdtemp(path.join(scratch,'ime-input-'))),proof={desktop:{},mobile:{},errors:[]};
 let desktop,mobile,remote,controller,workflow;
 try{
  const projectDir=path.join(temp,'한글 입력 검증');await fs.mkdir(projectDir);const profile=path.join(temp,'desktop-profile'),store=new Store(profile);await store.load();
  const project=await store.addProject(projectDir);await require('./project-trust-fixture.cjs').trustFixtureProject(store,project);
  const session=await store.createSession(project.id,{title:'한글 조합 확인',messages:[{id:randomUUID(),role:'assistant',text:'분석할 자료를 입력해 주세요.',createdAt:new Date().toISOString()}]});
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_PLAN:'pro'};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  let page;
  if(!process.argv.includes('--mobile-only')){
  desktop=await _electron.launch({args:[root],env,timeout:45000});page=await desktop.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>proof.errors.push(error.message));await page.locator('.app-shell').waitFor();await page.bringToFront();
  await page.locator('.header-search').click();const search=page.getByLabel('전체 검색어',{exact:true});await search.waitFor();
  proof.desktop.search=await compose(page,search,{guardKeys:true,during:async el=>{
   await page.evaluate(()=>window.dispatchEvent(new Event('resize')));assert(await el.evaluate(el=>el.isConnected),'검색 결과/앱 갱신에도 검색 입력이 유지됩니다');
  }});assert.equal(await search.inputValue(),'한');await search.press('Escape');await search.waitFor({state:'hidden'});
  await openConversation(page,session.title);const input=page.getByLabel('Codex에 보낼 작업 요청');await input.fill('분석 ');
  proof.desktop.chat=await compose(page,input,{guardKeys:true});assert.equal(await input.inputValue(),'분석 한');assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.find(s=>s.id===session.id).messages.length,1,'조합키는 전송하지 않습니다');
  const source=('자료 확인\n').repeat(45_000),expected='한'+source;
  await input.evaluate((el,text)=>{const transfer=new DataTransfer();transfer.setData('text/plain',text);el.focus();el.select();el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));el.setSelectionRange(0,0)},source);
  assert.equal(await input.getAttribute('data-draft-windowed'),'true');await page.getByRole('navigation',{name:'긴 입력 편집 범위'}).getByRole('button',{name:'처음',exact:true}).click();proof.desktop.longDraft=await compose(page,input,{guardKeys:true});
  const digest=await editorDigest(input);assert.deepEqual(digest,{length:expected.length,hash:createHash('sha256').update(expected).digest('hex')},'긴 초안 전체와 한글 조합 결과를 보존합니다');proof.desktop.longDraft.digest=digest;
  await desktop.close();desktop=undefined;
  }

  const mobileStore=new Store(path.join(temp,'mobile-profile'));await mobileStore.load();const mobileProject=await mobileStore.addProject(projectDir);await require('./project-trust-fixture.cjs').trustFixtureProject(mobileStore,mobileProject);
  const chat=await mobileStore.createSession(mobileProject.id,{title:'모바일 한글 확인'});
  controller=new Controller(mobileStore,{descriptor:{command:process.execPath,prefix:[path.join(__dirname,'backend-fake-codex.cjs')],label:'격리된 합성 계정',node:false},canRun:()=>true,queueOwner:()=>0});await controller.connect();
  const handlers=new Map(),register=(name,fn)=>handlers.set(name,fn);let pending=[],locked=false,answers=0;
  for(const [name,fn]of Object.entries({send:i=>controller.send(i),interrupt:id=>controller.interrupt(id),connect:()=>controller.connect(),saveSettings:v=>controller.saveSettings(v),listQueuedMessages:id=>controller.listQueuedMessages(id),securityPending:()=>pending,answerInput:async()=>{answers++;pending=[]},readAccountUsage:()=>({checkedAt:Date.now(),allowed:true,credits:{hasCredits:false,unlimited:false},buckets:[]})}))register(name,fn);
  workflow=require('../electron/workflow.cjs').registerWorkflow(register,mobileStore,controller,{canRun:()=>true,accountRevision:()=>0,intervalMs:3600000});
  remote=registerRemote(register,{store:mobileStore,controller,handlers,isLocked:()=>locked,accountRevision:()=>0,version:'261118_05',tunnelFactory:()=>{
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.exitCode=child.signalCode=null;child.kill=()=>{child.exitCode=0;child.emit('exit',0)};
   setTimeout(()=>child.stderr.emit('data',Buffer.from('https://ime-fixture.trycloudflare.com Registered tunnel connection')),5);return child;
  }});
  const access=await handlers.get('startRemoteAccess')(),browser=path.join(temp,'browser.cjs');
  await fs.writeFile(browser,'const {app,BrowserWindow}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL("about:blank");});');
  mobile=await _electron.launch({args:[browser,'--user-data-dir='+path.join(temp,'browser-profile')],env});page=await mobile.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>proof.errors.push(error.message));await page.bringToFront();await page.goto(access.localUrl);
  const projectButton=()=>page.getByRole('button',{name:new RegExp(mobileProject.name+'.*업무')});await projectButton().waitFor();
  const refresh=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/mobile/state'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;await page.waitForTimeout(120);};
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'설정',exact:true}).click();const device=page.getByLabel('알림 기기 이름',{exact:true});await device.waitFor();await device.fill('휴대폰 ');
  proof.mobile.settings=await compose(page,device,{during:async el=>{
   await page.evaluate(()=>document.dispatchEvent(new Event('flowrium-install-state')));await refresh();assert(await el.evaluate(el=>el.isConnected),'설정 갱신 중 입력 요소를 유지합니다');
  }});assert.equal(await device.inputValue(),'휴대폰 한');
  await page.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'홈',exact:true}).click();await projectButton().click();await page.getByRole('button',{name:/모바일 한글 확인/}).click();const request=page.getByLabel('요청',{exact:true});await request.waitFor();await request.fill('요청 ');
  proof.mobile.chat=await compose(page,request,{during:refresh});assert.equal(await request.inputValue(),'요청 한');
  const requestId=randomUUID();pending=[{type:'input',requestId,sessionId:chat.id,isBlocking:true,questions:[{id:'analysis',header:'분석 대상',question:'분석 대상을 적어 주세요.',isOther:true,isSecret:false,options:[]}]}];await refresh();const form=page.locator('[data-input-request="'+requestId+'"]');const answer=form.getByRole('textbox');await answer.waitFor();await answer.fill('대상 ');
  proof.mobile.question=await compose(page,answer,{during:async el=>{
   await refresh();await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(answers,0,'한글 조합 중 폼을 제출하지 않습니다');assert(await el.evaluate(el=>el.isConnected));
  }});assert.equal(await answer.inputValue(),'대상 한');assert.equal(answers,0);
  await answer.focus();const cdp=await page.context().newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'ㄱ',selectionStart:1,selectionEnd:1});locked=true;await refresh();await page.getByRole('heading',{name:'작업 공간이 잠겼습니다',exact:true}).waitFor();await cdp.detach();proof.mobile.lockOverridesComposition=true;
  assert.deepEqual(proof.errors,[]);proof.passed=true;
  const out=path.join(root,'artifacts/actual-design-20261118');await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'한글-입력-검증.json'),JSON.stringify(proof,null,2)+'\n');
  console.log('한글 입력 검증 통과 / '+(process.argv.includes('--mobile-only')?'모바일 설정·채팅·질문':'검색·채팅·긴 원문·모바일 설정·질문')+' / 조합 중 커서 재지정 0회 / 잠금 우선');
 }finally{
  if(desktop)await desktop.close().catch(()=>{});if(mobile)await mobile.close().catch(()=>{});if(remote)await remote.shutdown();if(workflow)await workflow.shutdown();if(controller)await controller.shutdown();await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
