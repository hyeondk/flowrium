const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');

async function run(){
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-settings-layout-')));
 let app,page;const errors=[],measurements=[];
 try{
  const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1000});await page.locator('.workspace-side').hover();await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');await page.getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();await page.waitForTimeout(300);
  for(const [width,height]of [[1440,1000],[800,1000],[390,844],[320,844]]){
   await page.setViewportSize({width,height});await page.locator('.settings-nav-item[data-settings-target="security"]').click();
   await page.waitForFunction(()=>{const panel=document.querySelector('.security-panel'),content=document.querySelector('.settings-content');if(!panel||!content)return false;const p=panel.getBoundingClientRect(),c=content.getBoundingClientRect();return p.top>=c.top-1&&p.top<c.top+70;});await page.waitForTimeout(300);
   const m=await page.evaluate(()=>{
    const panel=document.querySelector('.security-panel'),dialog=document.querySelector('[aria-labelledby="settings-title"]'),content=document.querySelector('.settings-content'),box=panel.getBoundingClientRect(),style=getComputedStyle(panel),modal=dialog.getBoundingClientRect();
    const toBox=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const controls=[...panel.querySelectorAll('input:not([type=checkbox]),select,button')].map(toBox);
    const switches=[...panel.querySelectorAll('.ui-switch-control')].map(toBox);
    const words=[];for(const p of panel.querySelectorAll('header p')){const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){for(const match of node.textContent.matchAll(/[가-힣A-Za-z0-9]+/g)){if(match[0].length<2)continue;const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);words.push({word:match[0],tops:[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>r.top)});}}}
    const rows=[...panel.querySelectorAll('.security-row')].map(toBox),heading=panel.querySelector('header h3'),description=panel.querySelector('header p');
    const action=panel.querySelector('.security-pin-form>div');
    const ghost=[...document.querySelectorAll('.settings-nav-item')].find(e=>e.getAttribute('aria-current')!=='page'),gs=getComputedStyle(ghost);
    return{width:innerWidth,height:innerHeight,panel:toBox(panel),padding:[style.paddingLeft,style.paddingRight,style.paddingTop,style.paddingBottom].map(parseFloat),heading:toBox(heading),description:toBox(description),controls,switches,rows,action:toBox(action),modal:toBox(dialog),content:{scroll:content.scrollWidth,client:content.clientWidth},document:{scroll:document.documentElement.scrollWidth,client:innerWidth},ghost:{background:gs.backgroundColor,border:gs.borderColor},words};
   });
   measurements.push(m);assert(m.padding.every(value=>value>=16),width+' 설정 표면 내부 여백');assert(m.heading.x>=m.panel.x+m.padding[0]-.5,width+' 제목이 테두리에 붙지 않음');assert(m.description.x>=m.panel.x+m.padding[0]-.5,width+' 설명이 표면 여백 안에 표시');
   assert(m.controls.every(c=>c.x>=m.panel.x+m.padding[0]-1&&c.right<=m.panel.right-m.padding[1]+1),width+' 입력과 버튼의 가로 경계');assert(m.controls.every(c=>c.height>=36),width+' 컨트롤 최소 높이');assert(m.rows.every(r=>r.height>=48),width+' 설정 행 높이');
   assert(m.switches.every(c=>Math.abs(c.right-(m.panel.right-m.padding[1]-1))<2),width+' 스위치 오른쪽 정렬');assert(Math.abs(m.action.right-(m.panel.right-m.padding[1]-1))<2,width+' 폼 행동 그룹 오른쪽 정렬');assert(m.content.scroll<=m.content.client+1,width+' 설정 본문 가로 넘침 없음');assert(m.document.scroll<=m.document.client+1,width+' 문서 가로 넘침 없음');
   assert(Math.abs(m.modal.x+m.modal.width/2-width/2)<2,width+' 팝업 가로 중앙');assert(Math.abs(m.modal.y+m.modal.height/2-height/2)<2,width+' 팝업 세로 중앙');assert.match(m.ghost.background,/rgba\(0, 0, 0, 0\)|transparent/,width+' 비선택 메뉴는 투명한 버튼');assert.match(m.ghost.border,/rgba\(0, 0, 0, 0\)|transparent/,width+' 비선택 메뉴는 개별 테두리 없음');assert(m.words.every(w=>new Set(w.tops.map(v=>Math.round(v))).size<=1),width+' 한글 어절 단위 줄바꿈');
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('.settings-nav-item[data-settings-target="general"]').click();await page.getByRole('region',{name:'프로그램 업데이트',exact:true}).waitFor();await page.waitForTimeout(300);
  const update=await page.getByRole('region',{name:'프로그램 업데이트',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),text=e.querySelector('strong').getBoundingClientRect();return{left:r.left,right:r.right,textLeft:text.left,padding:parseFloat(s.paddingLeft),height:r.height};});assert(update.textLeft>=update.left+update.padding-1,'업데이트 문구의 내부 여백');assert(update.padding>=20,'업데이트 표면 여백');
  const controls=page.getByRole('region',{name:'보안과 계정',exact:true});await page.locator('.settings-nav-item[data-settings-target="security"]').click();const pin=controls.getByLabel('새 잠금 번호',{exact:true});await pin.fill('1234');await pin.focus();await pin.hover();await page.mouse.wheel(0,80);assert.equal(await pin.inputValue(),'1234','스크롤로 숫자 입력 변경 없음');assert.equal(await pin.evaluate(e=>e===document.activeElement),true,'스크롤 뒤 입력 초점 유지');
  await pin.fill('');await page.locator('.settings-nav-item[data-settings-target="security"]').click();await page.waitForTimeout(400);await fs.mkdir(path.join(root,'.flowrium-tmp'),{recursive:true});await fs.writeFile(path.join(root,'.flowrium-tmp/settings-layout-061.json'),JSON.stringify({result:'passed',measurements:measurements.map(m=>({width:m.width,height:m.height,padding:m.padding,controlHeights:[...new Set(m.controls.map(c=>c.height))],rowHeights:m.rows.map(r=>r.height),modal:m.modal,bodyOverflow:m.content.scroll-m.content.client,documentOverflow:m.document.scroll-m.document.client,ghost:m.ghost})),update},null,2));await page.screenshot({path:path.join(root,'.flowrium-tmp/settings-layout-061.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.deepEqual(errors,[]);console.log('설정 실제 앱 배치 / 20px 표면 여백 / 목적별 탐색 / 1440·800·390·320폭 / 입력·행·행동 정렬 / 한글 어절 줄바꿈 / 가로 넘침 없음 / 중앙 팝업 / 투명한 보조 메뉴 / 숫자 스크롤·초점 보존 통과');
 }catch(error){if(page)console.error('넘침 요소',JSON.stringify(await page.locator('.settings-content').evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>({tag:e.tagName,class:e.className,client:e.clientWidth,scroll:e.scrollWidth,text:e.textContent?.slice(0,100)})).slice(0,35))));if(measurements.length)console.error('설정 배치 측정',JSON.stringify(measurements));if(page)console.error('화면 상태',(await page.locator('body').innerText()).slice(0,1200));throw error;}
 finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
}
async function baseline(){
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-settings-before-')));let app;
 try{
  const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});const env={...process.env,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.FLOWRIUM_USER_DATA;
  app=await _electron.launch({executablePath:'/Applications/Flowrium.app/Contents/MacOS/Flowrium',args:['--user-data-dir='+profile],env,timeout:45000});assert.equal(path.relative(await app.evaluate(({app})=>app.getPath('userData')),profile),'','개인 프로필과 격리');const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(20000);await page.locator('.workspace-side').hover();await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('region',{name:'프로그램 업데이트',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
  const rows=await page.evaluate(()=>[document.querySelector('[aria-label="프로그램 업데이트"]'),document.querySelector('.security-panel')].map(panel=>{const r=panel.getBoundingClientRect(),s=getComputedStyle(panel),text=panel.querySelector('strong,h3').getBoundingClientRect();return{label:panel.getAttribute('aria-label'),paddingLeft:parseFloat(s.paddingLeft),paddingTop:parseFloat(s.paddingTop),textInsetX:text.left-r.left,textInsetY:text.top-r.top};}));
  assert(rows.every(r=>r.paddingLeft===0&&r.textInsetX<2),'기존 업데이트·보안 표면의 여백 없음 재현');await fs.mkdir(path.join(root,'.flowrium-tmp'),{recursive:true});await fs.writeFile(path.join(root,'.flowrium-tmp/settings-baseline-061.json'),JSON.stringify({version:await app.evaluate(({app})=>app.getVersion()),rows},null,2));await page.screenshot({path:path.join(root,'.flowrium-tmp/settings-baseline-061.png'),animations:'disabled'});console.log('기존 설치 앱에서 업데이트 / 보안 표면 가로·위쪽 패딩 0 재현',JSON.stringify(rows));
 }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
}
(process.argv.includes('--baseline')?baseline():run()).catch(error=>{console.error(error);process.exitCode=1});
