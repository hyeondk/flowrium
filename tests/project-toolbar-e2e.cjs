const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {openProjectTab,settledLayout}=require('./shell-test-helpers.cjs');
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-project-toolbar-')),profile=path.join(temp,'profile'),folder=path.join(temp,'도구막대 검증 프로젝트');
 let app,page;const samples=[];
 try{
  await fs.mkdir(folder);const store=new Store(profile);await store.load();await store.addProject(folder);await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[path.resolve(__dirname,'..'),'--force-device-scale-factor=1'],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(8000);
  await page.setViewportSize({width:1440,height:1000});await page.locator('.pf-project-entry').click();
  const close=page.getByRole('button',{name:'대화함 접기',exact:true});if(await close.isVisible())await close.click();
  const back=page.getByRole('button',{name:'프로젝트 홈으로 돌아가기',exact:true});
  await page.locator('.project-toolbar-leading').getByText('프로젝트',{exact:true}).waitFor();
  assert.equal(await back.count(),0,'프로젝트 홈에서는 제목만 표시');
  for(const zoom of [.87,1,1.15]){
   await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value),zoom);
   for(const width of [1440,800,390,320]){
    await page.setViewportSize({width,height:1000});await settledLayout(page.locator('.project-document-toolbar'));
    for(const tab of ['프로젝트 설정','홈','팀','홈']){
     if(tab==='홈'){
      await back.click();
      await page.locator('.project-document-content[data-project-tab=home]').waitFor();
      assert.equal(await back.count(),0,'복귀 뒤 프로젝트 제목만 표시');
     }else{
      await openProjectTab(page,tab);
      assert.equal(await back.textContent(),'프로젝트');
     }
     await settledLayout(page.locator('.project-document-toolbar'));
     const sample=await page.locator('.project-document-toolbar').evaluate((node,label)=>{
      const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
      const buttons=[...node.querySelectorAll('button')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(element=>{
       const box=rect(element),target=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
       return{label:element.getAttribute('aria-label')||element.innerText,...box,receives:!!target&&element.contains(target),hit:target?.closest('button')?.getAttribute('aria-label')};
      });
      const overlap=[];for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i],b=buttons[j];if(Math.min(a.right,b.right)-Math.max(a.x,b.x)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.5)overlap.push([a.label,b.label]);}
      const back=node.querySelector('.project-back-button');
      const centerY=element=>{const box=rect(element);return box.y+box.height/2;};
      const backOffset=back?Math.abs(centerY(back.querySelector('svg'))-centerY(back.querySelector('span'))):null;
      return{...label,density:devicePixelRatio,viewport:innerWidth,toolbar:rect(node),buttons,overlap,backOffset,document:document.documentElement.scrollWidth};
     },{zoom,width,tab});samples.push(sample);
     assert.deepEqual(sample.overlap,[],'도구 버튼 영역 겹침 '+JSON.stringify(sample));
     assert(sample.buttons.every(b=>b.receives),'모든 버튼 중심이 실제 포인터 입력을 받음 '+JSON.stringify(sample));
     assert(sample.document<=sample.viewport+1,'도구막대 가로 넘침 없음');
     assert(sample.buttons.every(b=>b.x>=sample.toolbar.x-.5&&b.right<=sample.toolbar.right+.5),'도구 버튼이 도구막대 안에 유지');
     if(tab!=='홈')assert(sample.backOffset!==null&&sample.backOffset<.5,'뒤로 가기 아이콘과 글자의 세로 중심 일치');
     await page.getByRole('button',{name:'프로젝트 메뉴',exact:true}).click();
     const menu=page.getByRole('navigation',{name:'프로젝트 상세 탭',exact:true}),menuBox=await settledLayout(menu);
     sample.menu=menuBox;
     assert(menuBox.x>=sample.toolbar.x-.5&&menuBox.x+menuBox.width<=sample.toolbar.right+.5,'메뉴 목록이 화면 안에 유지 '+JSON.stringify(sample));
     await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
    }
   }
  }
  if(process.env.FLOWRIUM_PROJECT_TOOLBAR_PROOF)await fs.writeFile(process.env.FLOWRIUM_PROJECT_TOOLBAR_PROOF,JSON.stringify({passed:true,samples},null,2));
  console.log('프로젝트 도구막대 / 87·100·115% 배율 / 1440·800·390·320폭 / 설정·팀에서 업무 복귀 실제 클릭 / 겹침·가로 넘침 없음 / '+samples.length+'회');
 }catch(error){if(process.env.FLOWRIUM_PROJECT_TOOLBAR_PROOF)await fs.writeFile(process.env.FLOWRIUM_PROJECT_TOOLBAR_PROOF,JSON.stringify({passed:false,samples},null,2));throw error;}
 finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
