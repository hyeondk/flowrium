const {settledLayout}=require('./shell-test-helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{_electron}=require('playwright');
const {Store}=require('../electron/store.cjs'),{openConversation}=require('./shell-test-helpers.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),qa=path.join(root,'.flowrium-tmp/qa-261115_02');await fs.mkdir(qa,{recursive:true});const temp=await fs.realpath(await fs.mkdtemp(path.join(qa,'dock-modes-'))),profile=path.join(temp,'profile');let app,page;
 try{
  const folder=path.join(temp,'project');await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await store.addProject(folder),message={id:randomUUID(),role:'assistant',text:'숨기거나 지우지 않을 정상 대화 본문',createdAt:new Date().toISOString()},session=await store.createSession(project.id,{title:'보기 방식 검증',messages:[message]});await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(18000);await page.setViewportSize({width:1440,height:960});await page.locator('.app-shell').waitFor();await page.evaluate(()=>window.flowrium.connect());
  assert(Math.abs(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())-.87)<.001,'데스크톱 기본 배율 87%');
  const resetZoom=await app.evaluate(({Menu,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],item=Menu.getApplicationMenu()?.getMenuItemById('flowrium-reset-zoom');if(!item||typeof item.click!=='function')return {available:false};win.webContents.setZoomFactor(1.1);item.click(item,win);return {available:true,zoom:win.webContents.getZoomFactor()};});
  assert(resetZoom.available&&Math.abs(resetZoom.zoom-.87)<.001,'기본 크기 메뉴가 87%로 복원');
  const dock=page.locator('.conversation-dock'),main=page.locator('.main-shell'),input=page.getByLabel('Codex에 보낼 작업 요청',{exact:true}),menuButton=()=>page.getByRole('button',{name:'대화 패널 보기 방식',exact:true});
  async function choose(name){await menuButton().click();await page.getByRole('menu',{name:'대화 패널 보기',exact:true}).getByRole('menuitemradio',{name,exact:true}).click();await settledLayout(dock)}
  await dock.locator('.dock-scope-tabs').getByRole('button',{name:'프로젝트',exact:true}).click();
  assert.equal(await dock.locator('.dock-heading').getByRole('button',{name:'대화 화면 메뉴 열기'}).count(),0);
  const dimensions=await dock.evaluate(el=>{
    const bounds=selector=>el.querySelector(selector).getBoundingClientRect();
    return {select:bounds('.dock-project-select [role=combobox]').height,search:bounds('.dock-search').height,
      gap:bounds('.dock-project-select').top-bounds('.dock-navigation-row').bottom,
      back:bounds('.dock-back').top,tabs:bounds('.dock-scope-tabs').bottom,
      inputBorder:parseFloat(getComputedStyle(el.querySelector('.dock-search input')).borderTopWidth)};
  });
  assert(Math.abs(dimensions.search-dimensions.select)<1 && dimensions.search<=33,'검색과 프로젝트 선택 상자 높이 일치');
  assert(dimensions.gap>0 && dimensions.gap<=7 && dimensions.back>=dimensions.tabs && dimensions.inputBorder===0,'탭 아래 뒤로 가기 / 간격 / 단일 테두리');
  const captures=process.env.FLOWRIUM_DOCK_SCREENS;
  async function capture(name) {
    if(!captures)return;
    await fs.mkdir(captures,{recursive:true});
    const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(captures,name),Buffer.from(png));
  }
  await capture('대화-탐색.png');
  console.log('대화 목록 실측',JSON.stringify(dimensions));
  await dock.getByRole('button',{name:'대화 홈으로',exact:true}).click();
  await dock.getByRole('button',{name:'대화함 접기',exact:true}).click();
  const reopen=page.getByRole('button',{name:'대화 패널 펼치기',exact:true});
  await reopen.waitFor();await dock.waitFor({state:'detached'});
  await capture('대화-접힘.png');
  await page.setViewportSize({width:390,height:844});
  const handle=await reopen.evaluate(el=>{
    const {x,y,width,right,bottom}=el.getBoundingClientRect();
    return {x,y,width,right,bottom,viewportWidth:innerWidth,viewportHeight:innerHeight};
  });
  assert(handle.width>=28 && handle.x>=0 && handle.y>=0 && handle.right<=handle.viewportWidth+1 && handle.bottom<=handle.viewportHeight,'작은 창에서도 펼치기 가능 '+JSON.stringify(handle));
  await reopen.focus();await page.keyboard.press('Enter');await dock.waitFor();
  await page.setViewportSize({width:1440,height:960});
  await menuButton().click();assert.equal(await page.getByRole('menuitem',{name:'대화 화면 설정 열기',exact:true}).count(),0,'중복 설정 링크 제거');await page.keyboard.press('Escape');
  assert.equal(await dock.getAttribute('data-layout-mode'),'docked');assert.equal(await dock.getAttribute('data-minimized'),'false');assert.equal(await page.locator('.app-shell').getAttribute('data-chat-focus'),'false');
  await menuButton().click();assert.equal(await page.getByRole('menuitemradio',{name:'입력창만 보기',exact:true}).isDisabled(),true);await page.getByText('Flowrium 대화를 연 뒤 사용할 수 있습니다.',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await menuButton().getAttribute('aria-expanded'),'false');
  await openConversation(page,session.title);await page.locator('.messages').getByText(message.text,{exact:true}).waitFor();const initial={dock:await dock.boundingBox(),main:await main.boundingBox()};assert(initial.main.width>200);assert(initial.main.x+initial.main.width<=initial.dock.x+2);
  await input.fill('보관할 미전송 초안');const element=await input.elementHandle();
  await menuButton().click();const first=page.getByRole('menuitemradio',{name:'대시보드 옆에 고정',exact:true});await first.focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'겹쳐 보기');await page.keyboard.press('Enter');await settledLayout(dock);
  assert.equal(await dock.getAttribute('data-layout-mode'),'overlay');assert.equal(await dock.evaluate(e=>getComputedStyle(e).position),'fixed');assert((await main.boundingBox()).width>initial.main.width+200);assert.equal(await main.isVisible(),true);assert.equal(await input.inputValue(),'보관할 미전송 초안');assert.equal(await element.evaluate(e=>e===document.querySelector('textarea[aria-label="Codex에 보낼 작업 요청"]')),true);
  await choose('입력창만 보기');assert.equal(await dock.getAttribute('data-minimized'),'true');assert.equal(await input.isEditable(),true);assert.equal(await input.inputValue(),'보관할 미전송 초안');assert.equal(await page.locator('.messages').isVisible(),false);assert.equal(await element.evaluate(e=>e===document.querySelector('textarea[aria-label="Codex에 보낼 작업 요청"]')),true);assert((await dock.boundingBox()).height<initial.dock.height/2);assert.equal(await main.isVisible(),true);
  await menuButton().click();
  const compactMenu=page.getByRole('menu',{name:'대화 패널 보기',exact:true});
  await settledLayout(compactMenu);
  assert(await compactMenu.evaluate(menu=>{
    const trigger=menu.parentElement.querySelector('button');
    return menu.getBoundingClientRect().bottom<=trigger.getBoundingClientRect().top &&
      getComputedStyle(menu).getPropertyValue('--context-menu-travel').trim()==='6px';
  }),'입력창만 보일 때 보기 방식 메뉴가 화면 위쪽으로 열립니다.');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'대화 패널 다시 펼치기',exact:true}).click();assert.equal(await dock.getAttribute('data-minimized'),'false');assert.equal(await dock.getAttribute('data-layout-mode'),'overlay');assert.equal(await page.locator('.messages').isVisible(),true);assert.equal(await input.inputValue(),'보관할 미전송 초안');
  await choose('대시보드 옆에 고정');assert.equal(await dock.getAttribute('data-layout-mode'),'docked');assert.equal(await dock.evaluate(e=>getComputedStyle(e).position),'relative');const narrow=await dock.boundingBox();await page.getByRole('button',{name:'대화 패널 넓히기',exact:true}).click();await settledLayout(dock);assert((await dock.boundingBox()).width>narrow.width+60);assert.equal(await main.isVisible(),true);assert((await main.boundingBox()).width>200);
  await choose('겹쳐 보기');await choose('입력창만 보기');const savedPreference=await page.evaluate(()=>JSON.parse(localStorage.getItem('flowrium.dock.presentation.v1')));assert.deepEqual(savedPreference,{layout:'overlay',minimized:true});assert(!JSON.stringify(savedPreference).includes(session.id));assert(!JSON.stringify(savedPreference).includes('미전송'));
  await page.waitForFunction(async id=>{const api=window.flowrium,security=await api.securityState();return (await api.readDrafts(security.accountRevision))['session:'+id]?.text==='보관할 미전송 초안'},session.id);await page.reload();await page.locator('.app-shell').waitFor();await openConversation(page,session.title);assert.equal(await dock.getAttribute('data-layout-mode'),'overlay');assert.equal(await dock.getAttribute('data-minimized'),'true');assert.equal(await input.inputValue(),'보관할 미전송 초안');await page.getByRole('button',{name:'대화 패널 다시 펼치기',exact:true}).click();
  const current=await page.evaluate(id=>window.flowrium.bootstrap().then(s=>s.sessions.find(x=>x.id===id)),session.id);assert.deepEqual(current.messages,[message]);assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.length,1,'보기 방식은 대화를 새로 만들지 않습니다.');
  // Dots의 최소화 선택은 문맥을 바꾸지 않고 비활성화한다. 공개 사이트는 열지 않는다.
  await app.evaluate(({session},html)=>{const original=session.fromPartition.bind(session),seen=new Set();session.fromPartition=(partition,...args)=>{const value=original(partition,...args);if(partition.startsWith('persist:flowrium-dots-')&&!seen.has(partition)){seen.add(partition);value.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html'}}));}return value;};},'<!doctype html><html lang="ko"><h1>읽기 전용 Dots 모의 화면</h1></html>');
  await page.locator('.dock-scope-tabs').getByRole('button',{name:'개인 비서 보기',exact:true}).click();await page.getByRole('region',{name:'Dots 공식 화면'}).waitFor();await menuButton().click();assert.equal(await page.getByRole('menuitemradio',{name:'입력창만 보기',exact:true}).isDisabled(),true);await page.getByText('Flowrium 대화를 연 뒤 사용할 수 있습니다.',{exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await dock.getAttribute('data-minimized'),'false');assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.length,1);await choose('대시보드 옆에 고정');
  await page.setViewportSize({width:900,height:760});await settledLayout(dock);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('대화 패널 모드 실제 화면 / 기본 고정 / 키보드 메뉴·겹쳐 보기 / 기존 입력창 DOM·초안 유지 / 입력창 최소화·다시 펼침 / 너비 조절 / UI 선호 복원 / 본문 원본·주 화면 보존 / 홈·Dots 최소화 금지·묵시 대화 생성 없음');
 }finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
