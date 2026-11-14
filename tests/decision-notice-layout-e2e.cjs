const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{_electron}=require('playwright');
const {Store}=require('../electron/store.cjs'),{closeInstalledApp}=require('./update-installed-ui.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),qa=path.join(root,'.flowrium-tmp/qa-261115_03');await fs.mkdir(qa,{recursive:true});const temp=await fs.mkdtemp(path.join(qa,'decision-notice-'));let app;const measurements=[];
 try{
  const folder=path.join(temp,'합성 알림 프로젝트');await fs.mkdir(folder);const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();const project=await store.addProject(folder),session=await store.createSession(project.id);await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});const page=await app.firstWindow();page.setDefaultTimeout(16000);await page.setViewportSize({width:1440,height:1000});await page.locator('.side-usage[data-connected=true]').waitFor();
  for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:1000});const dock=page.locator('.conversation-dock');if(await dock.count()){await dock.getByRole('button',{name:'대화함 접기',exact:true}).click();await dock.waitFor({state:'detached'})}
   await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'승인검증',mode:'build'}),session.id);const notice=page.locator('.decision-arrival');await notice.waitFor();
   const geometry=await page.evaluate(()=>{const notice=document.querySelector('.decision-arrival'),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}},buttons=[...document.querySelectorAll('.topbar button')].filter(e=>e.getClientRects().length);return {viewport:innerWidth,notice:rect(notice),header:rect(document.querySelector('.topbar')),pointerEvents:getComputedStyle(notice).pointerEvents,responsePointerEvents:getComputedStyle(notice.querySelector('button')).pointerEvents,buttons:buttons.map(button=>{const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {label:button.getAttribute('aria-label'),reachable:hit===button||button.contains(hit)}})}});
   measurements.push(geometry);assert(geometry.notice.y>=geometry.header.bottom,'알림이 헤더 영역 밖에 배치됨');assert.equal(geometry.pointerEvents,'none');assert.equal(geometry.responsePointerEvents,'auto');assert(geometry.buttons.every(button=>button.reachable),'알림 표시 중 모든 헤더 버튼에 실제 포인터가 도달함');
   await page.locator('.dock-toggle').click({timeout:2000});await dock.waitFor();await dock.getByRole('button',{name:'대화함 접기',exact:true}).click({timeout:2000});await dock.waitFor({state:'detached'});
   if(width===390){await notice.waitFor({state:'detached',timeout:10000});assert((await page.evaluate(()=>window.flowrium.securityPending())).some(event=>event.type==='approval'),'자동 닫힘 후에도 승인 요청 보존');await page.locator('.header-decisions').click();}
   else await notice.getByRole('button',{name:'응답하기',exact:true}).click();
   const popup=page.getByRole('dialog',{name:'알림',exact:true}),card=popup.getByRole('region',{name:'실행 승인 요청'});await card.waitFor();await card.getByRole('button',{name:'이번 작업 승인',exact:true}).click();await card.waitFor({state:'detached'});await popup.getByRole('button',{name:'알림 닫기',exact:true}).click();
   for(let i=0;i<100;i++){if(!(await page.evaluate(()=>window.flowrium.securityPending())).some(event=>event.sessionId===session.id))break;await page.waitForTimeout(30)}
  }
  await fs.writeFile(path.join(qa,'decision-notice-layout-result.json'),JSON.stringify({passed:true,autoDismissMs:8000,headerReachableWhileVisible:true,pendingRequestPreserved:true,measurements},null,2)+'\n');console.log('결정 알림 실제 화면 / 1440·1024·390폭 헤더 밖 배치 / 표시 중 모든 헤더 포인터 도달 / 대화함 즉시 열기·닫기 / 응답 버튼 직접 승인 / 8초 자동 닫힘 후 요청 보존·알림에서 응답 통과');
 }finally{try{if(app)await closeInstalledApp(app,'결정 알림 배치 검사 앱 종료')}finally{await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150})}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
