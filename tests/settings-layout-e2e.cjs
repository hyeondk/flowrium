const {settledLayout}=require('./shell-test-helpers.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
const {expect}=require('playwright/test');
const {Store}=require('../electron/store.cjs');

function colorAlpha(value){
 const color=value.trim().toLowerCase();if(color==='transparent')return 0;
 const rgba=/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(color);
 return rgba?Number(rgba[1]):1;
}
function checkTransparentColors(){
 for(const color of ['transparent','rgba(0, 0, 0, 0)','rgba(229, 239, 247, 0)','rgba(229,239,247,0.0)'])assert.equal(colorAlpha(color),0,'알파 0인 색은 RGB와 무관하게 완전 투명');
 for(const color of ['rgba(0, 0, 0, 1)','rgba(229, 239, 247, 0.001)','rgb(0, 0, 0)','#000000','white'])assert.notEqual(colorAlpha(color),0,'불투명하거나 일부 보이는 색은 투명으로 통과하지 않음');
}

async function openSettings(page,group) {
 await page.locator('.workspace-side').hover();
 await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');
 await page.getByRole('button',{name:'설정',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'설정',exact:true});
 await dialog.waitFor();
 if(group)await dialog.getByRole('button',{name:group,exact:true}).click();
 return dialog;
}

const generalSettings=page=>page.evaluate(async()=>(await window.flowrium.bootstrap()).settings);
const voiceSettings=page=>page.evaluate(()=>window.flowrium.voicePreferences());

async function verifyAutomaticSave(app,page,codexPath) {
 const closeName={name:'설정 닫기',exact:true};
 const ready=await openSettings(page,'화면');
 assert.equal(await ready.getByRole('button',{name:'완료',exact:true}).count(),0,'설정은 별도 완료 버튼 없이 닫기에서 마칩니다.');
 await app.evaluate(({ipcMain})=>{
  const channel='flowrium:saveSettings',save=ipcMain._invokeHandlers.get(channel);
  if(!save)throw Error('설정 저장 시험 경로를 찾을 수 없습니다.');
  const state={started:[],finished:[],failGreen:true};
  const hold=new Promise(resolve=>{state.release=resolve;});
  globalThis.settingsSaveTest=state;
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel,async(event,patch)=>{
   state.started.push(patch);
   try {
    if(patch.accentColor==='green'&&state.failGreen){
     state.failGreen=false;
     throw Error('시험용 설정 쓰기 실패');
    }
    const result=await save(event,patch);
    if(patch.theme==='dark')await hold;
    return result;
   }finally{state.finished.push(patch);}
  });
 });
 const appearance=ready.getByRole('group',{name:'강조색'});
 try {
  await ready.getByRole('button',{name:'어둡게',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>globalThis.settingsSaveTest.started.some(patch=>patch.theme==='dark'))).toBe(true);
  await appearance.getByRole('button',{name:'보라',exact:true}).click();
  await ready.getByRole('button',{name:'밝게',exact:true}).click();
  await ready.getByRole('button',closeName).click();
 }finally{await app.evaluate(()=>globalThis.settingsSaveTest.release());}
 await ready.waitFor({state:'detached'});
 await expect.poll(()=>generalSettings(page)).toMatchObject({theme:'light',accentColor:'purple'});
 await expect.poll(()=>app.evaluate(()=>{
  const {finished}=globalThis.settingsSaveTest;
  return ['dark','light'].every(theme=>finished.some(patch=>patch.theme===theme))&&finished.some(patch=>patch.accentColor==='purple');
 })).toBe(true);
 await expect.poll(()=>generalSettings(page)).toMatchObject({theme:'light',accentColor:'purple'});
 await expect.poll(()=>page.evaluate(()=>[document.documentElement.dataset.theme,document.documentElement.dataset.accent])).toEqual(['light','purple']);

 const retry=await openSettings(page,'화면');
 const green=retry.getByRole('group',{name:'강조색'}).getByRole('button',{name:'초록',exact:true});
 await green.click();
 await page.getByRole('alert').filter({hasText:'시험용 설정 쓰기 실패'}).waitFor();
 assert.equal((await generalSettings(page)).accentColor,'purple','저장이 실패한 값은 저장된 값에 섞이지 않아야 합니다.');
 await green.focus();
 await page.keyboard.press('Enter');
 await expect.poll(()=>generalSettings(page)).toMatchObject({theme:'light',accentColor:'green'});
 await page.keyboard.press('Escape');
 await retry.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'설정','Escape로 닫은 뒤 처음 연 버튼으로 초점 복귀');

 const voice=await openSettings(page,'음성');
 const nextVoice={provider:'local',continuous:true,silenceMs:1200,localWhisper:'http://127.0.0.1:9913'};
 await voice.getByLabel('음성 인식 방식',{exact:true}).selectOption(nextVoice.provider);
 await voice.getByLabel('연속 듣기 사용',{exact:true}).check();
 await voice.getByLabel('말끝 무음 시간',{exact:true}).selectOption(String(nextVoice.silenceMs));
 const address=voice.getByLabel('로컬 인식 서버 주소',{exact:true});
 await address.fill(nextVoice.localWhisper);
 await address.focus();
 assert.equal(await voice.getByRole('button',{name:'음성 설정 저장',exact:true}).count(),0);
 await page.keyboard.press('Escape');
 await voice.waitFor({state:'detached'});
 await expect.poll(()=>voiceSettings(page)).toMatchObject(nextVoice);

 const account=await openSettings(page,'계정과 모델');
 const pathInput=account.getByLabel(/Codex 실행 파일 경로/);
 await pathInput.fill(codexPath);
 await pathInput.focus();
 await page.keyboard.press('Escape');
 await account.waitFor({state:'detached'});
 await expect.poll(()=>generalSettings(page)).toMatchObject({codexPath});
 return {settings:{theme:'light',accentColor:'green',codexPath},voice:nextVoice};
}

async function run(){
 checkTransparentColors();
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-settings-layout-')));
 let app,page;const errors=[],measurements=[];
 try{
  const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  async function launch(){
   app=await _electron.launch({args:[root],env,timeout:45000});
   page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
   await page.setViewportSize({width:1440,height:1000});
  }
  await launch();
  const dialog=await openSettings(page);await settledLayout(dialog);
  for(const [width,height]of [[1440,1000],[800,1000],[390,844],[320,844]]){
   await page.setViewportSize({width,height});const securityTab=page.locator('.settings-nav-item[data-settings-target="security"]');if(await securityTab.getAttribute('aria-expanded')!=='true')await securityTab.click();
   await page.waitForFunction(()=>{const panel=document.querySelector('.security-panel'),content=document.querySelector('.settings-content');if(!panel||!content)return false;const p=panel.getBoundingClientRect(),c=content.getBoundingClientRect();return p.top>=c.top-1&&p.top<c.top+70;});await settledLayout(dialog);
   const m=await page.evaluate(()=>{
    const panel=document.querySelector('.security-panel'),dialog=document.querySelector('[aria-labelledby="settings-title"]'),content=document.querySelector('.settings-content'),box=panel.getBoundingClientRect(),style=getComputedStyle(panel),modal=dialog.getBoundingClientRect();
    const toBox=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const controls=[...panel.querySelectorAll('input:not([type=checkbox]),select,button')].map(toBox);
    const switches=[...panel.querySelectorAll('.ui-switch-control')].map(toBox);
    const words=[];for(const p of panel.querySelectorAll('header p')){const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){for(const match of node.textContent.matchAll(/[가-힣A-Za-z0-9]+/g)){if(match[0].length<2)continue;const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);words.push({word:match[0],tops:[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>r.top)});}}}
    const rows=[...panel.querySelectorAll('.security-row')].map(toBox),heading=panel.querySelector('header h3'),description=panel.querySelector('header p');
    const action=panel.querySelector('.security-pin-form>div');
    const ghost=[...document.querySelectorAll('.settings-nav-item')].find(e=>e.getAttribute('aria-current')!=='page'),gs=getComputedStyle(ghost);
    return{width:innerWidth,height:innerHeight,pointerFine:matchMedia('(pointer:fine)').matches,panel:toBox(panel),padding:[style.paddingLeft,style.paddingRight,style.paddingTop,style.paddingBottom].map(parseFloat),heading:toBox(heading),description:toBox(description),controls,switches,rows,action:toBox(action),modal:toBox(dialog),content:{scroll:content.scrollWidth,client:content.clientWidth},document:{scroll:document.documentElement.scrollWidth,client:innerWidth},ghost:{background:gs.backgroundColor,border:gs.borderColor},words};
   });
   measurements.push(m);assert(m.padding.slice(0,2).every(value=>value>=16)&&m.padding.slice(2).every(value=>value>=14),width+' 조밀한 설정 표면 가로16px·세로14px 여백');assert(m.heading.x>=m.panel.x+m.padding[0]-.5,width+' 제목이 테두리에 붙지 않음');assert(m.description.x>=m.panel.x+m.padding[0]-.5,width+' 설명이 표면 여백 안에 표시');
   assert(m.controls.every(c=>c.x>=m.panel.x+m.padding[0]-1&&c.right<=m.panel.right-m.padding[1]+1),width+' 입력과 버튼의 가로 경계');assert(m.controls.every(c=>c.height>=(m.pointerFine?32:36)),width+' 입력 방식에 맞는 컨트롤 최소 높이');assert(m.rows.every(r=>r.height>=48),width+' 설정 행 높이');
   assert(m.switches.every(c=>Math.abs(c.right-(m.panel.right-m.padding[1]-1))<2),width+' 스위치 오른쪽 정렬');assert(Math.abs(m.action.right-(m.panel.right-m.padding[1]-1))<2,width+' 폼 행동 그룹 오른쪽 정렬');assert(m.content.scroll<=m.content.client+1,width+' 설정 본문 가로 넘침 없음');assert(m.document.scroll<=m.document.client+1,width+' 문서 가로 넘침 없음');
   assert(Math.abs(m.modal.x+m.modal.width/2-m.width/2)<2,width+' 배율을 반영한 팝업 가로 중앙');assert(Math.abs(m.modal.y+m.modal.height/2-m.height/2)<2,width+' 배율을 반영한 팝업 세로 중앙');assert.equal(colorAlpha(m.ghost.background),0,width+' 비선택 메뉴 배경 알파 0 / '+m.ghost.background);assert.equal(colorAlpha(m.ghost.border),0,width+' 비선택 메뉴 테두리 알파 0 / '+m.ghost.border);assert(m.words.every(w=>new Set(w.tops.map(v=>Math.round(v))).size<=1),width+' 한글 어절 단위 줄바꿈');
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('.settings-nav-item[data-settings-target="general"]').click();await page.getByRole('region',{name:'프로그램 업데이트',exact:true}).waitFor();await settledLayout(dialog);
  const update=await page.getByRole('region',{name:'프로그램 업데이트',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),text=e.querySelector('strong').getBoundingClientRect();return{left:r.left,right:r.right,textLeft:text.left,padding:parseFloat(s.paddingLeft),height:r.height};});assert(update.textLeft>=update.left+update.padding-1,'업데이트 문구의 내부 여백');assert(update.padding>=16,'조밀한 업데이트 표면 여백');
  const controls=page.getByRole('region',{name:'보안과 계정',exact:true});await page.locator('.settings-nav-item[data-settings-target="security"]').click();const pin=controls.getByLabel('새 잠금 번호',{exact:true});await pin.fill('1234');await pin.focus();await pin.hover();await page.mouse.wheel(0,80);assert.equal(await pin.inputValue(),'1234','스크롤로 숫자 입력 변경 없음');assert.equal(await pin.evaluate(e=>e===document.activeElement),true,'스크롤 뒤 입력 초점 유지');
  await pin.fill('');await settledLayout(dialog);
  if(process.env.FLOWRIUM_SETTINGS_LAYOUT_DIR){const output=path.resolve(process.env.FLOWRIUM_SETTINGS_LAYOUT_DIR);await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'settings-layout.json'),JSON.stringify({result:'passed',measurements:measurements.map(m=>({width:m.width,height:m.height,padding:m.padding,controlHeights:[...new Set(m.controls.map(c=>c.height))],rowHeights:m.rows.map(r=>r.height),modal:m.modal,bodyOverflow:m.content.scroll-m.content.client,documentOverflow:m.document.scroll-m.document.client,ghost:m.ghost})),update},null,2));await page.screenshot({path:path.join(output,'settings-layout.png'),animations:'disabled'});}
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  console.log('설정 실제 앱 배치 / 가로16px·세로14px 표면 여백 / 목적별 탐색 / 1440·800·390·320폭 / 입력·행·행동 정렬 / 한글 어절 줄바꿈 / 가로 넘침 없음 / 배율을 반영한 중앙 팝업 / 투명한 보조 메뉴 / 숫자 스크롤·초점 보존 통과');
  const nextBackend=path.join(temp,'settings-test-codex.cjs');
  await fs.copyFile(path.join(__dirname,'backend-fake-codex.cjs'),nextBackend);
  const expected=await verifyAutomaticSave(app,page,nextBackend);
  await app.close();app=null;page=null;
  await launch();
  await expect.poll(()=>generalSettings(page)).toMatchObject(expected.settings);
  await expect.poll(()=>voiceSettings(page)).toMatchObject(expected.voice);
  const restored=await openSettings(page,'음성');
  assert.equal(await restored.getByLabel('로컬 인식 서버 주소',{exact:true}).inputValue(),expected.voice.localWhisper);
  assert.deepEqual(errors,[]);
  console.log('설정 자동 저장 / 응답 지연 뒤 여러 값과 같은 항목의 연속 변경 / 저장 오류와 키보드 재시도 / 닫기와 Escape / 음성 주소·시간·스위치와 Codex 경로 / 앱 재실행 복원 통과');
 }catch(error){if(page&&await page.locator('.settings-content').count())console.error('넘침 요소',JSON.stringify(await page.locator('.settings-content').evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>({tag:e.tagName,class:e.className,client:e.clientWidth,scroll:e.scrollWidth,text:e.textContent?.slice(0,100)})).slice(0,35))));if(measurements.length)console.error('설정 배치 측정',JSON.stringify(measurements));if(page)console.error('화면 상태',(await page.locator('body').innerText()).slice(0,1200));throw error;}
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
if(process.argv.includes('--check-colors')){checkTransparentColors();console.log('투명색 표기 4종 허용 / 불투명과 부분 투명 5종 거절 통과');}
else (process.argv.includes('--baseline')?baseline():run()).catch(error=>{console.error(error);process.exitCode=1});
