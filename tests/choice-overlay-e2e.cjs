const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {updateDetails}=require('../electron/project-details.cjs');

async function run(){
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-choice-overlay-'));
 let app;
 try{
  const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
  for(let i=0;i<16;i++){const directory=path.join(temp,'매출 분석 '+String(i+1).padStart(2,'0'));await fs.mkdir(directory);const project=await store.addProject(directory);await updateDetails(store,project.id,null,{action:'category',category:i?'기관 업무':'대학교'});}
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(12000);
  await page.setViewportSize({width:1440,height:900});await page.locator('.workspace-side').getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.locator('[data-settings-target=categories]').click();
  const editor=dialog.getByRole('region',{name:'프로젝트 카테고리 관리'}),choice=editor.getByRole('combobox',{name:'프로젝트',exact:true}),list=editor.getByRole('listbox',{name:'프로젝트',exact:true});
  await choice.locator('.project-category-label').waitFor();
  const rows=[];
  const measure=async(label)=>{
   await page.waitForTimeout(230);
   const row=await choice.evaluate((node,label)=>{
    const trigger=node.getBoundingClientRect(),list=document.getElementById(node.getAttribute('aria-controls')),box=list.getBoundingClientRect(),modal=node.closest('[role=dialog]').getBoundingClientRect();
    const sampleX=Math.max(box.left+10,Math.min(box.right-10,box.left+box.width/2)),sampleY=box.top+Math.min(20,box.height/2);
    return {label,side:list.dataset.placement,trigger:{left:trigger.left,right:trigger.right,top:trigger.top,bottom:trigger.bottom,width:trigger.width},popup:{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},boundary:{left:Math.max(0,modal.left),right:Math.min(innerWidth,modal.right),top:Math.max(0,modal.top),bottom:Math.min(innerHeight,modal.bottom)},hit:list.contains(document.elementFromPoint(sampleX,sampleY)),scrollable:list.scrollHeight>list.clientHeight};
   },label);
   assert(row.popup.left>=row.boundary.left+7&&row.popup.right<=row.boundary.right-7&&row.popup.top>=row.boundary.top+7&&row.popup.bottom<=row.boundary.bottom-7,JSON.stringify(row));
   assert(Math.abs(row.popup.width-row.trigger.width)<1,JSON.stringify(row));
   assert(Math.abs((row.side==='up'?row.trigger.top-row.popup.bottom:row.popup.top-row.trigger.bottom)-6)<1.6,JSON.stringify(row));
   assert(row.hit,'다른 내용 위에서 목록 선택 가능 '+JSON.stringify(row));rows.push(row);return row;
  };
  for(const [width,height] of [[1440,900],[1440,420],[390,600]]){
   await page.setViewportSize({width,height});await choice.scrollIntoViewIfNeeded();
   const before=await editor.evaluate(node=>({height:node.closest('[role=dialog]').getBoundingClientRect().height,save:node.querySelector('.category-edit-form>button').getBoundingClientRect().top}));
   await choice.click();await list.waitFor();await measure(width+'×'+height);
   const after=await editor.evaluate(node=>({height:node.closest('[role=dialog]').getBoundingClientRect().height,save:node.querySelector('.category-edit-form>button').getBoundingClientRect().top}));
   assert(Math.abs(before.height-after.height)<1&&Math.abs(before.save-after.save)<1,JSON.stringify({before,after}));
   assert.equal(await list.locator('.project-category-label').count(),16);
   await choice.press('End');await choice.press('Enter');assert.equal(await choice.getAttribute('aria-expanded'),'false');assert(await choice.evaluate(node=>node===document.activeElement));
  }
  assert(rows.some(row=>row.side==='up')&&rows.some(row=>row.side==='down'),'남은 공간에 따라 위와 아래 선택 '+JSON.stringify(rows));
  await page.setViewportSize({width:1440,height:900});await choice.click();await list.waitFor();await measure('기본');
  await page.setViewportSize({width:980,height:620});await measure('열린 상태 창 크기 변경');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.15));await measure('열린 상태115%');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(.87));
  await choice.press('Escape');assert.equal(await list.count(),0);assert(await choice.evaluate(node=>node===document.activeElement));
  await page.setViewportSize({width:390,height:420});await choice.scrollIntoViewIfNeeded();await choice.click();await list.waitFor();await measure('스크롤 전');
  await dialog.locator('.settings-content').evaluate(node=>node.scrollBy({top:16,behavior:'instant'}));
  if(await list.count())await measure('본문 스크롤 추적');
  await choice.press('Tab');assert.equal(await list.count(),0);
  if(process.env.FLOWRIUM_CHOICE_SCREENSHOT){await page.setViewportSize({width:1440,height:900});await choice.click();await list.waitFor();await page.waitForTimeout(230);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));await fs.writeFile(process.env.FLOWRIUM_CHOICE_SCREENSHOT,Buffer.from(png,'base64'));}
  console.log(JSON.stringify({flowUnchanged:true,categoryLabels:16,rows}));
 }finally{await app?.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
