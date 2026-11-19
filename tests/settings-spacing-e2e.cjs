const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {releaseVersion} = require('../electron/version.cjs');
const {releaseNotes} = require('../shared/release-notes.ts');

const baseline=process.argv.includes('--baseline');
const groups=['general','categories','security','remote','voice','account','appearance'];
async function run(){
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-settings-spacing-'));
 let app;
 try{
  const profile=path.join(temp,'profile'),store=new Store(profile);await store.load();
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
  const project=path.join(temp,'온라인 스토어 분석');await fs.mkdir(project);await store.addProject(project);
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(12000);
  await page.setViewportSize({width:1440,height:940});
  await page.locator('.workspace-side').getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true}),content=dialog.locator('.settings-content');
  await dialog.waitFor();
  const select=async id=>{const button=dialog.locator(`[data-settings-target=${id}]`);if(await button.getAttribute('aria-expanded')!=='true')await button.click();await page.waitForTimeout(220);await content.evaluate(node=>node.scrollTo({top:0,behavior:'instant'}));};
  const rows=[];
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===1440?940:844});
   for(const id of groups){
    await select(id);
    const group=dialog.locator(`[data-settings-group=${id}]`);
    const row=await group.evaluate((node,{id,width})=>{
     const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none'&&!['absolute','fixed'].includes(getComputedStyle(el).position);
     const children=[...node.children].filter(visible),rects=children.map(child=>child.getBoundingClientRect());
     const viewport=node.closest('.settings-content'),bounds=viewport.getBoundingClientRect();
     const boxes=children.filter(child=>child.matches('.settings-section,.migration-panel')).map(box=>{
      const rect=box.getBoundingClientRect(),inside=[...box.children].filter(visible).map(child=>child.getBoundingClientRect());
      return {className:box.className,top:inside.length?Math.min(...inside.map(r=>r.top))-rect.top:null,bottom:inside.length?rect.bottom-Math.max(...inside.map(r=>r.bottom)):null};
     });
     return {width,id,gaps:rects.slice(1).map((r,i)=>r.top-rects[i].bottom),top:rects[0].top-bounds.top,overflow:viewport.scrollWidth-viewport.clientWidth,boxes,dialogHeight:node.closest('[role=dialog]').getBoundingClientRect().height,layoutHeight:viewport.parentElement.getBoundingClientRect().height};
    },{id,width});
    await content.evaluate(node=>node.scrollTo({top:node.scrollHeight,behavior:'instant'}));
    row.bottom=await group.evaluate(node=>{const children=[...node.children].filter(child=>child.getClientRects().length);return node.closest('.settings-content').getBoundingClientRect().bottom-children.at(-1).getBoundingClientRect().bottom;});
    rows.push(row);
    if(!baseline){
     assert.equal(await dialog.locator('[data-settings-group]:not([hidden])').count(),1,'선택한 범주만 표시');
     assert(row.gaps.every(gap=>gap>=11.5),`범주 내 요소 간격 ${JSON.stringify(row)}`);
     // 브라우저 배율과 스크롤 끝의 부분 픽셀을 실제 표시 단위로 비교한다.
     assert(Math.round(row.top)>=15&&Math.round(row.bottom)>=15,`첫·마지막 여백 ${JSON.stringify(row)}`);
     assert(row.overflow<=1,`가로 넘침 ${JSON.stringify(row)}`);
     assert(row.boxes.every(box=>box.top===null||(box.top>=11.5&&box.bottom>=11.5)),`상자 안쪽 여백 ${JSON.stringify(row)}`);
    }
    if(id==='appearance'&&process.env.FLOWRIUM_SETTINGS_SCREENSHOTS){
     await fs.mkdir(process.env.FLOWRIUM_SETTINGS_SCREENSHOTS,{recursive:true});
     await content.evaluate(node=>node.scrollTo({top:0,behavior:'instant'}));await page.mouse.move(0,0);
     const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
     await fs.writeFile(path.join(process.env.FLOWRIUM_SETTINGS_SCREENSHOTS,`settings-appearance-${width}.png`),Buffer.from(png,'base64'));
    }
   }
  }
  if(baseline){console.log(JSON.stringify({mode:'재현',rows}));return;}
  for(const width of [1440,390]){const heights=rows.filter(row=>row.width===width).map(row=>row.dialogHeight);assert(Math.max(...heights)-Math.min(...heights)<1,`설정 탭마다 같은 창 높이 ${JSON.stringify({width,heights})}`);}
  await select('general');
  const version=releaseVersion(require('../package.json'));
  const history=dialog.getByRole('region',{name:'최신 변경점',exact:true});
  const expected=releaseNotes[version];
  assert(expected?.length,'현재 버전의 변경점이 필요합니다.');
  assert.equal(await history.getByRole('heading').locator('small').textContent(),version);
  assert.deepEqual(await history.locator('li').allTextContents(),expected,'현재 버전의 변경점을 순서대로 그대로 표시합니다.');
  await select('categories');const draft=dialog.getByRole('combobox',{name:'카테고리 이름',exact:true});await draft.fill('보존 확인');
  await select('appearance');await select('categories');assert.equal(await draft.inputValue(),'보존 확인');
  await dialog.locator('[data-settings-target=categories]').click();await page.waitForTimeout(220);assert.equal(await dialog.locator('[data-settings-group=categories]').isVisible(),false);
  await select('categories');assert.equal(await draft.inputValue(),'보존 확인');
  console.log(JSON.stringify({mode:baseline?'재현':'검증',rows,draftPreserved:true}));
 }finally{await app?.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
