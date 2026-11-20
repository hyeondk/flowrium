const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{_electron}=require('playwright'),{Store}=require('../electron/store.cjs');
const {openConversation,settledLayout}=require('./shell-test-helpers.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-long-chat-'))),profile=path.join(temp,'profile'),baseline=process.argv.includes('--baseline');let app,page;const errors=[],metrics={mode:baseline?'before':'after',total:22000,anchors:[]};
 const report=process.env.FLOWRIUM_TEST_REPORT_DIR||path.join(root,'.flowrium-tmp/qa-261114_01');
 try{
  const folder=path.join(temp,'synthetic-project');await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await addTrustedFixtureProject(store, folder, {account: backendFixtureAccount}),messages=Array.from({length:22000},(_,index)=>({id:randomUUID(),role:index%2?'assistant':'user',text:`합성 기록 ${index+1}\n\n검증용 문장은 실제 개인 대화와 관계가 없습니다. ${index%7===0?'\n\n- 첫째 확인 사항\n- 둘째 확인 사항':''}`,createdAt:new Date(1700000000000+index*1000).toISOString()}));
  const session=await store.createSession(project.id,{title:'긴 대화 표시 검증',threadId:'synthetic-long-thread',messages});await store.createSession(project.id,{title:'짧은 대화 전환 검증',messages:messages.slice(0,2)});await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const started=Date.now();await openConversation(page,session.title);await page.locator('.messages .message').first().waitFor();await page.waitForTimeout(500);metrics.openMs=Date.now()-started;metrics.rendered=await page.locator('.messages .message').count();metrics.elements=await page.locator('.messages *').count();
  const body=page.locator('.messages');metrics.layout=await body.evaluate(e=>({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,heap:performance.memory?.usedJSHeapSize}));
  if(baseline){assert.equal(metrics.rendered,22000);console.log('합성 긴 대화 기존 전체 표시 재현',JSON.stringify(metrics));return;}
  assert.equal(metrics.rendered,100,'최근 100개만 먼저 렌더링');assert(metrics.layout.height-metrics.layout.client-metrics.layout.top<2,'처음 열면 최신 위치');assert.equal(await page.locator('[data-message-id="'+messages[0].id+'"]').count(),0,'과거 DOM은 지연 생성');assert.equal(await page.locator('[data-message-id="'+messages.at(-1).id+'"]').count(),1,'마지막 메시지 표시');
  let saved=await page.evaluate(id=>window.flowrium.bootstrap().then(s=>s.sessions.find(x=>x.id===id)),session.id);assert.equal(saved.messages.length,22000,'원래 Session 전체 보존');assert.equal(saved.threadId,'synthetic-long-thread','모델의 원래 대화 연결 보존');
  const latest=page.getByRole('button',{name:'최근 메시지로',exact:true});
  assert.equal(await page.getByRole('button',{name:/이전 메시지.*더 보기/}).count(),0);
  async function measure(scrollTo){return body.evaluate((e,next)=>{if(next!==undefined)e.scrollTop=next;const top=e.getBoundingClientRect().top,node=[...e.querySelectorAll('[data-message-id]')].find(n=>n.getBoundingClientRect().bottom>top+60);return{top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,id:node?.dataset.messageId,y:node?.getBoundingClientRect().top};},scrollTo);}
  for(let i=0;i<3;i++){
   const before=await measure(60);
   await page.waitForFunction(count=>document.querySelectorAll('.messages [data-message-id]').length===count,200+i*100);
   const immediate=await measure();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const frames=await measure();await page.waitForTimeout(450);const settled=await measure();
   for(const [phase,value]of [['immediate',immediate],['frames',frames],['settled',settled]]){assert.equal(value.id,before.id,phase+' 기존 첫 보이는 메시지 유지');assert(Math.abs(value.y-before.y)<1.5,phase+' 메시지 화면 좌표 유지');assert(Math.abs((value.top-before.top)-(value.height-before.height))<2,phase+' 추가 높이만큼 스크롤 보정');}
   metrics.anchors.push({before,immediate,frames,settled});assert.equal(await page.locator('.messages [data-message-id]').count(),200+i*100);
  }
  await latest.click();await page.waitForTimeout(100);assert.equal(await page.locator('.messages [data-message-id]').count(),100,'최근으로 이동 시 최근 100개로 축소');assert(await body.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<2),'최근으로 이동 시 하단');
  // 실제 실행 완료 이벤트와 멈춘 프레임을 확인한 뒤 사용자가 읽는 위치를 바꿉니다.
  async function watchTurns() {
   await page.evaluate(id=>{
    window.longChatFinished=[];
    const stop=window.flowrium.onEvent(event=>{
     if(event.sessionId!==id||event.type!=='done')return;
     window.longChatFinished.push(event.status);
     if(window.longChatFinished.length===2)stop();
    });
   },session.id);
  }
  await watchTurns();
  const input=page.getByLabel('Codex에 보낼 작업 요청');
  await input.fill('긴 대화 새 응답 확인');
  await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
  await page.waitForFunction(()=>window.longChatFinished.length===1,undefined,{timeout:20000});
  await settledLayout(body);
  assert(await body.evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop<2),'새 응답은 기존 하단 따라가기 유지');
  const bodyBox=await body.boundingBox();
  assert(bodyBox);
  await page.mouse.move(bodyBox.x+bodyBox.width/2,bodyBox.y+bodyBox.height/2);
  await page.mouse.wheel(0,-(await body.evaluate(e=>e.scrollHeight)));
  await page.waitForFunction(()=>document.querySelectorAll('.messages article[data-message-id]').length>=200,undefined,{timeout:10000});
  await body.evaluate(e=>{e.scrollTop=240;});
  await settledLayout(body);
  const reading=await measure();
  assert(reading.id);
  await body.evaluate((el,id)=>{
   const observation={sampling:true,frames:[]};
   window.longChatReading=observation;
   const start=performance.now();
   function sample() {
    const anchor=el.querySelector('[data-message-id="'+id+'"]'), y=anchor?.getBoundingClientRect().top;
    const frame={time:Math.round(performance.now()-start),id:anchor?.dataset.messageId,y,
     top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,viewportY:el.getBoundingClientRect().top,
     composer:el.closest('.workspace-main').querySelector('.composer-area').clientHeight};
    const {time,...geometry}=frame;
    const previous=observation.frames.at(-1);
    if(!previous||Object.keys(geometry).some(key=>previous[key]!==geometry[key]))observation.frames.push(frame);
    if(observation.sampling)requestAnimationFrame(sample);
   }
   sample();
  },reading.id);
  await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'읽는 중 새 응답 확인',mode:'plan'}),session.id);
  await page.waitForFunction(()=>window.longChatFinished.length===2,undefined,{timeout:20000});
  await settledLayout(body);
  const whileReading=await measure();
  const frames=await page.evaluate(()=>{
   const observation=window.longChatReading;
   observation.sampling=false;
   return observation.frames;
  });
  metrics.whileReading={before:reading,frames,settled:whileReading};
  assert.deepEqual(await page.evaluate(()=>window.longChatFinished),['completed','completed']);
  for(const sample of [...frames,whileReading]){
   assert.equal(sample.id,reading.id,'위쪽을 읽을 때 새 응답으로 화면 이동 없음 '+JSON.stringify(sample));
   assert(Math.abs(sample.y-reading.y)<1.5,'위쪽을 읽을 때 화면 좌표 유지 '+JSON.stringify(metrics.whileReading));
  }
  saved=await page.evaluate(id=>window.flowrium.bootstrap().then(s=>s.sessions.find(x=>x.id===id)),session.id);assert.equal(saved.messages.length,22004);assert.equal(saved.messages[0].text,messages[0].text);assert.equal(saved.threadId,'synthetic-long-thread');
  const destination=path.join(temp,'all-messages.md');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},destination);await page.getByRole('button',{name:'대화 관리',exact:true}).click();await page.getByRole('button',{name:'대화 내보내기',exact:true}).click();await page.waitForTimeout(200);const exported=await fs.readFile(destination,'utf8');assert(exported.includes('합성 기록 1\n'));assert(exported.includes('합성 기록 22000\n'));assert(exported.includes('읽는 중 새 응답 확인'),'전체 데이터 내보내기');
  await openConversation(page,'짧은 대화 전환 검증');assert.equal(await page.locator('.messages [data-message-id]').count(),2);await openConversation(page,session.title);assert.equal(await page.locator('.messages article[data-message-id]').count(),100,'대화 전환 시 최근 메시지 100개 표시');assert.equal(await page.locator('.messages .turn-progress').count(),2,'두 요청의 작업 내역은 별도 요약 행으로 표시');await page.waitForTimeout(280);metrics.finalLayout=await body.evaluate(e=>({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight}));assert(metrics.finalLayout.height-metrics.finalLayout.client-metrics.finalLayout.top<2,'대화 전환 시 최신 위치');
  assert.deepEqual(errors,[]);metrics.result='passed';metrics.savedMessages=saved.messages.length;console.log('합성 긴 대화 / 최근 100개 / 이전 100개 / 즉시와 안정 프레임 위치 보존 / 최신 이동 / 새 응답 / 전환 초기화 / 전체 내보내기 통과',JSON.stringify(metrics));
 }finally{await fs.mkdir(report,{recursive:true});await fs.writeFile(path.join(report,'long-conversation-'+(baseline?'before':'after')+'.json'),JSON.stringify(metrics,null,2));if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
