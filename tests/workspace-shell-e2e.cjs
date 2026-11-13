const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {randomUUID}=require('node:crypto');

async function run(){
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-shell-ui-'));
 let app,page;const errors=[],failures=[],measurements=[];
 try{
 const profile=path.join(temp,'검증 프로필'),folder=path.join(temp,'화면 검증 프로젝트');
 await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await store.addProject(folder);
 const waiting=await store.createSession(project.id,{title:'계속할지 기다리는 대화',messages:[{id:randomUUID(),role:'assistant',text:'현재 업무를 정리했습니다.\n\n다음 작업을 계속할까요?',createdAt:new Date().toISOString()}]});
 const running=await store.createSession(project.id,{title:'실행 검증 대화'}),decision=await store.createSession(project.id,{title:'결정 검증 대화'});
 await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
 const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const check=(value,label,detail)=>{if(!value)failures.push({label,detail});};
 const sameBox=(a,b)=>['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<1);
 const button=name=>page.getByRole('button',{name,exact:true});
 async function dashboard(){assert.equal(await page.locator('.main-shell').getAttribute('data-view'),'dashboard');assert.equal(await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).isVisible(),true);}
 async function dockHome(){
  const back=button('대화 목록으로');if(await back.isVisible()){await back.click();await page.locator('.dock-chat').waitFor({state:'detached'});}
  const home=button('대화 홈으로');if(await home.isVisible())await home.click();
  await page.locator('.dock-scope-card[data-scope=general]').waitFor();
 }
 async function projectList(){await dockHome();await page.locator('.dock-project-row').filter({hasText:project.name}).click();await page.locator('.dock-session-list').waitFor();}
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.bringToFront();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());await page.setViewportSize({width:1440,height:1000});await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.side-account i')?.dataset.connected==='true');
  await page.evaluate(async()=>{await document.fonts.load('400 14px NanumSquareRound','프로젝트');await document.fonts.ready;});
  const rail=page.locator('.workspace-side'),surface=page.locator('.sidebar-surface'),main=page.locator('.main-shell');
  await page.mouse.move(650,110);await page.waitForTimeout(300);const base=await main.boundingBox();
  check(await rail.getAttribute('data-expanded')==='false','기본 레일 접힘');
  const collapsed=await surface.boundingBox();check(collapsed.width<90,'접힌 레일 폭',collapsed);
  await page.mouse.move(35,140);await page.waitForTimeout(300);const expanded=await surface.boundingBox();
  check(await rail.getAttribute('data-expanded')==='true'&&expanded.width>180,'포인터를 올리면 메뉴 확장',expanded);const groupHeadings=await rail.locator('h2').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight)})));check(groupHeadings.every(e=>e.line<=e.height),'메뉴 작은 제목의 줄 상자가 정해진 높이에 맞음',groupHeadings);check(sameBox(base,await main.boundingBox()),'메뉴 확장 중 본문 위치와 크기 유지',{before:base,after:await main.boundingBox()});
  await page.mouse.move(650,110);await page.waitForTimeout(300);check(await rail.getAttribute('data-expanded')==='false','포인터를 벗어나면 자동 접힘');check(sameBox(base,await main.boundingBox()),'메뉴를 접은 뒤 본문 위치와 크기 유지');
  await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());await page.keyboard.press('Tab');await page.waitForTimeout(280);
  check(await rail.getAttribute('data-expanded')==='true','키보드 탭으로 메뉴 진입 시 확장');check(await rail.evaluate(e=>e.contains(document.activeElement)),'키보드 초점이 메뉴 안에 있음');
  await page.locator('.dock-toggle').focus();await page.waitForTimeout(280);check(await rail.getAttribute('data-expanded')==='false','메뉴 밖으로 초점 이동 시 접힘');
  await page.mouse.move(35,140);await button('메뉴 고정').click();await page.mouse.move(650,110);await page.waitForTimeout(280);
  check(await rail.getAttribute('data-pinned')==='true'&&await rail.getAttribute('data-expanded')==='true','고정 후 포인터를 벗어나도 유지');check(await page.evaluate(()=>localStorage.getItem('flowrium.navigation.pinned'))==='true','고정 선택 저장');
  await page.reload();await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();check(await rail.getAttribute('data-pinned')==='true','새로 열어도 메뉴 고정 유지');
  await button('메뉴 자동 접기').click();await page.mouse.move(650,110);await page.waitForTimeout(300);check(await rail.getAttribute('data-expanded')==='false','고정 해제 후 자동 접기 복구');
  if(!await page.locator('.conversation-dock').isVisible())await page.locator('.dock-toggle').click();await page.locator('.conversation-dock').waitFor();
  const before=(await page.evaluate(()=>window.flowrium.bootstrap())).sessions.length;
  await button('새 통합 대화').click();await page.locator('.dock-chat .session-heading h2').filter({hasText:'새 통합 채팅'}).waitFor();await dashboard();
  let snapshot=await page.evaluate(()=>window.flowrium.bootstrap());check(snapshot.sessions.some(s=>s.scope==='integrated'),'통합 채팅 생성과 저장');
  await dockHome();await button('새 일반 대화').click();await page.locator('.dock-chat .session-heading h2').filter({hasText:'새 일반 대화'}).waitFor();await dashboard();
  snapshot=await page.evaluate(()=>window.flowrium.bootstrap());check(snapshot.sessions.some(s=>s.scope==='general'),'일반 대화 생성과 저장');
  await projectList();await page.locator('.dock-new-conversation').click();await page.locator('.dock-chat .session-heading h2').filter({hasText:'새로운 작업'}).waitFor();await dashboard();
  snapshot=await page.evaluate(()=>window.flowrium.bootstrap());check(snapshot.sessions.length===before+3&&snapshot.sessions.filter(s=>!s.scope).length===4,'세 범위 대화의 독립 생성',snapshot.sessions.map(s=>({scope:s.scope||'project',title:s.title})));check(snapshot.projects.length===1,'개인 대화가 프로젝트 목록을 늘리지 않음');
  await projectList();await page.locator('.dock-session').filter({has:page.locator('strong',{hasText:running.title})}).click();await page.getByLabel('Codex에 보낼 작업 요청').fill('대기검증');await button('작업 보내기').click();await page.locator('.execution-summary [data-state=running] strong').filter({hasText:'1'}).waitFor();await dashboard();
  await projectList();await page.locator('.dock-session').filter({has:page.locator('strong',{hasText:decision.title})}).click();await page.getByLabel('작업 모드',{exact:true}).selectOption('build');await page.getByLabel('Codex에 보낼 작업 요청').fill('승인검증');await button('작업 보내기').click();await page.locator('.execution-summary [data-state=decision] strong').filter({hasText:'1'}).waitFor();await dashboard();
  const counts=await page.locator('.execution-summary>button').evaluateAll(nodes=>nodes.map(e=>({state:e.dataset.state,text:e.innerText.replace(/\s+/g,' ').trim(),count:Number(e.querySelector('strong').textContent)})));
  check(counts.length===3&&counts.every(e=>e.count===1),'작업중 / 대기 / 결정 집계',counts);
  for(const [state,title]of [['running','대기검증'],['waiting',waiting.title],['decision','승인검증']]){
   await page.locator('.dock-status-tabs [data-state='+state+']').click();await page.locator('.dock-session-list').waitFor();
   const titles=await page.locator('.dock-session strong').allTextContents();check(titles.length===1&&titles[0]===title,'진행 상태 필터 '+state,titles);
   check(await page.locator('.dock-session .execution-badge').getAttribute('data-state')===state,'대화 카드 상태 표시 '+state);await dashboard();
  }
  await page.mouse.move(35,140);await page.waitForTimeout(280);check((await page.locator('.side-state[data-state=decision]').innerText()).includes('결정 1'),'프로젝트 메뉴의 결정 강조');await page.mouse.move(650,110);await page.waitForTimeout(280);
  // 세로 높이를 고정하고 각 폭에서 주요 영역과 내부 스크롤 폭을 함께 검사합니다.
  for(const width of [1440,1280,1024,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(330);
   const dock=page.locator('.conversation-dock');if(await dock.count()){await dock.getByRole('button',{name:'대화함 접기',exact:true}).click();await dock.waitFor({state:'detached'});}
   const layout=await page.evaluate(()=>{
    const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,right:b.right,width:b.width,client:e.clientWidth,scroll:e.scrollWidth}};
    return{width:innerWidth,document:document.documentElement.scrollWidth,main:rect(document.querySelector('.main-shell')),topbar:rect(document.querySelector('.topbar')),page:rect(document.querySelector('.pf-page')),content:rect(document.querySelector('.pf-content')),family:getComputedStyle(document.body).fontFamily,wordBreak:getComputedStyle(document.querySelector('.pf-heading h1')).wordBreak,headerButtons:[...document.querySelectorAll('.topbar button')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.innerText,height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})),actions:[...document.querySelectorAll('.pf-heading .pf-actions button')].map(e=>e.getBoundingClientRect().height)};
   });
   check(layout.document<=width+1,'문서 가로 넘침 없음 '+width,layout);for(const key of ['main','topbar','page','content'])check(layout[key].scroll<=layout[key].client+1,'영역 내부 가로 넘침 없음 '+width+' '+key,layout[key]);
   check(layout.headerButtons.every(b=>b.right<=width+1&&b.height>=28),'헤더 버튼 잘림과 최소 높이 '+width,layout.headerButtons);check(new Set(layout.actions).size<=1&&layout.actions.every(h=>h>=40),'대시보드 같은 그룹 버튼 높이 일치 '+width,layout.actions);check(/NanumSquareRound/.test(layout.family)&&layout.wordBreak==='keep-all','글꼴과 어절 줄바꿈 '+width,{family:layout.family,wordBreak:layout.wordBreak});
   await page.locator('.dock-toggle').click();await dock.waitFor();await page.waitForTimeout(320);
   const panel=await dock.evaluate(e=>{const b=e.getBoundingClientRect();const browser=e.querySelector('.dock-browser');return{left:b.left,right:b.right,width:b.width,scroll:e.scrollWidth,client:e.clientWidth,body:browser?{scroll:browser.scrollWidth,client:browser.clientWidth}:null,animation:getComputedStyle(e).animationName}});
   check(panel.left>=-1&&panel.right<=width+1&&panel.scroll<=panel.client+1&&(!panel.body||panel.body.scroll<=panel.body.client+1),'대화함 가로 넘침 없음 '+width,panel);if(width===390)check(panel.animation==='ui-sheet-in','모바일 대화함 하단 시트',panel);
   measurements.push({width,layout,panel});await dashboard();
  }
  await page.setViewportSize({width:1440,height:1000});
  if(await page.locator('.conversation-dock').count()){await button('대화함 접기').click();await page.locator('.conversation-dock').waitFor({state:'detached'});}
  await button('설정').click();const settings=page.locator('.settings-modal[aria-labelledby="settings-title"]');await settings.waitFor();await page.waitForTimeout(30);
  check(await settings.evaluate(e=>e.contains(document.activeElement)),'설정 팝업 최초 초점 이동',await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')})));
  const focusables='button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
  await settings.evaluate((e,selector)=>[...e.querySelectorAll(selector)].filter(n=>n.getClientRects().length).at(-1)?.focus(),focusables);await page.keyboard.press('Tab');
  check(await settings.evaluate((e,selector)=>[...e.querySelectorAll(selector)].filter(n=>n.getClientRects().length)[0]===document.activeElement,focusables),'설정 팝업 마지막에서 첫 초점으로 순환');
  await page.keyboard.press('Shift+Tab');check(await settings.evaluate((e,selector)=>[...e.querySelectorAll(selector)].filter(n=>n.getClientRects().length).at(-1)===document.activeElement,focusables),'설정 팝업 첫 초점에서 마지막으로 역순환');
  await page.keyboard.press('Escape');check(await settings.getAttribute('data-phase')==='exit','설정 팝업 종료 애니메이션 유지');await settings.waitFor({state:'detached'});check(await button('설정').evaluate(e=>e===document.activeElement),'설정 팝업 종료 후 원래 버튼으로 초점 복구');
  await page.evaluate(async ids=>{for(const id of ids)await window.flowrium.interrupt(id)},[running.id,decision.id]);
  check(errors.length===0,'렌더러 오류 없음',errors);
  console.log(JSON.stringify({검증:'실제 앱 탐색과 대화함',실패:failures,측정:measurements.map(({width,layout,panel})=>({폭:width,문서폭:layout.document,본문폭:layout.main.width,헤더스크롤:[layout.topbar.client,layout.topbar.scroll],본문스크롤:[layout.content.client,layout.content.scroll],버튼높이:layout.actions,대화함:panel}))},null,2));assert.equal(failures.length,0,'화면 검증 실패 '+failures.length+'개');
 }catch(error){if(page&&!page.isClosed())console.error('실패 시 실제 화면',await page.locator('body').innerText().catch(()=>''));if(failures.length)console.error('확인한 문제',JSON.stringify(failures));throw error;}
 finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
