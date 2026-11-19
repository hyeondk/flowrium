const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const {dockHome,openProjectTab,settledLayout}=require('./shell-test-helpers.cjs');

const left='.side-project-list [data-project-sort-id]';
const right='.dock-browser [data-project-sort-id]';
const home='.pf-project-entries [data-project-sort-id]';
const row=(page,list,id)=>page.locator(list+'[data-project-sort-id="'+id+'"]');
const center=box=>({x:box.x+box.width/2,y:box.y+box.height/2});

async function openGrip(page,list,id,target) {
  const source=row(page,list,id),destination=row(page,list,target);
  await source.scrollIntoViewIfNeeded();
  await settledLayout(source);
  const startBox=await source.boundingBox(),endBox=await destination.boundingBox();
  assert.ok(startBox&&endBox);
  const start=center(startBox),end=center(endBox);
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.waitForFunction(({list,id})=>
    Boolean(document.querySelector(list+'[data-project-sort-id="'+id+'"][data-project-drag=moving]')),{list,id});
  return {start,end};
}

async function motionFrames(page,list,action) {
  await page.evaluate(list=>{
    const records=[];
    const started=performance.now();
    window.projectMotionFrames={records,complete:false};
    function sample(time) {
      records.push([...document.querySelectorAll(list)].map(node=>{
        const bounds=node.getBoundingClientRect();
        return {id:node.dataset.projectSortId,phase:node.dataset.projectDrag,top:bounds.top,width:bounds.width,
          animated:node.getAnimations().some(animation=>animation.playState==='running'&&Number(animation.effect?.getTiming().duration)>16)};
      }));
      if(time-started<430)requestAnimationFrame(sample);
      else window.projectMotionFrames.complete=true;
    }
    sample(started);
  },list);
  await action();
  await page.waitForFunction(()=>window.projectMotionFrames.complete);
  return page.evaluate(()=>window.projectMotionFrames.records);
}

function interpolated(first,last,values) {
  if(Math.abs(last-first)<=2)return false;
  const low=Math.min(first,last)+.6,high=Math.max(first,last)-.6;
  return new Set(values.filter(value=>value>low&&value<high).map(value=>Math.round(value*10))).size>=2;
}

async function test() {
  const root = path.resolve(__dirname,'..');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-project-order-'));
  let app;
  try {
    const profile = path.join(temporary,'profile'), store = new Store(profile);
    await store.load();
    const projects = [];
    for (const name of ['처음','가운데','마지막']) {
      const folder = path.join(temporary,name);
      await fs.mkdir(folder);
      projects.push(await store.addProject(folder));
    }
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temporary,'codex')};
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const launch=async()=>{
      app=await _electron.launch({args:[root],env,timeout:40000});
      const page=await app.firstWindow();
      await page.setViewportSize({width:1420,height:960});
      page.setDefaultTimeout(10000);
      return page;
    };
    let page=await launch();
    const expected=(ids,lists=[left,right,home])=>page.waitForFunction(({lists,ids})=>lists.every(sel=>
      [...document.querySelectorAll(sel)].map(e=>e.dataset.projectSortId).join()===ids.join()),{lists,ids});
    const [a,b,c]=projects.map(p=>p.id);
    await expected([a,b,c]);
    assert.equal(await page.locator(right).first().isVisible(),false);
    await dockHome(page);
    const {start,end}=await openGrip(page,right,c,a);
    const half={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
    await page.mouse.move(half.x,half.y,{steps:5});
    const movingMidpoint=await row(page,right,c).evaluate(node=>node.getBoundingClientRect().top);
    const beforeArrival=await row(page,right,a).evaluate(node=>node.getBoundingClientRect().top);
    const travel=await motionFrames(page,right,()=>page.mouse.move(end.x,end.y+9,{steps:8}));
    const tracks=id=>travel.map(frame=>frame.find(item=>item.id===id));
    const held=tracks(c).at(-1),shifted=tracks(a).at(-1);
    assert(held.top<movingMidpoint-8,'잡은 프로젝트가 끝점까지 포인터를 따라가야 합니다.');
    assert(shifted.top>beforeArrival+4,'이미 차 있는 자리는 잡은 프로젝트가 놓이기 전에 열려야 합니다.');
    assert(interpolated(beforeArrival,shifted.top,tracks(a).map(item=>item.top)),'옆 프로젝트가 적어도 두 위치를 거쳐 새 자리로 이동해야 합니다.');
    await expected([a,b,c],[left,home]);
    const drop=await motionFrames(page,right,()=>page.mouse.up());
    await expected([c,a,b]);
    await settledLayout(row(page,right,c));
    const resting=await row(page,right,c).evaluate(node=>node.getBoundingClientRect().top);
    const settling=drop.flatMap(frame=>frame.filter(item=>item.id===c&&item.phase==='settling'));
    assert(settling.length>=2&&interpolated(held.top,resting,settling.map(item=>item.top)),'놓은 프로젝트가 확정된 자리까지 보간되어야 합니다.');
    assert.match(await page.locator('.main-shell').getAttribute('data-view'),/dashboard/);

    await page.locator('.workspace-side').hover();
    if(await page.locator('.workspace-side').getAttribute('data-pinned')!=='true')await page.getByRole('button',{name:'메뉴 고정',exact:true}).click();
    const canceled=await openGrip(page,left,b,c);
    await page.mouse.move(canceled.end.x,canceled.end.y,{steps:5});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.locator(left+'[data-project-drag="moving"]').waitFor({state:'detached'});
    await expected([c,a,b]);
    assert.deepEqual((await page.evaluate(()=>window.flowrium.portfolioAction({action:'navigation'}))).order,[c,a,b]);
    assert.equal(await page.locator('.main-shell').getAttribute('data-view'),'dashboard');

    await page.emulateMedia({reducedMotion:'reduce'});
    const reduced=await openGrip(page,left,b,c);
    const instantaneous=await motionFrames(page,left,async()=>{
      await page.mouse.move(reduced.end.x,reduced.end.y,{steps:5});
      await page.mouse.up();
    });
    await expected([b,c,a]);
    assert(!instantaneous.flat().some(item=>item.animated),'동작 줄이기에서 정렬 애니메이션이 없어야 합니다.');
    await page.emulateMedia({reducedMotion:'no-preference'});

    const keyboardRow=row(page,left,c);
    assert.equal(await keyboardRow.getAttribute('aria-keyshortcuts'),'Alt+ArrowUp Alt+ArrowDown');
    await keyboardRow.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expected([b,a,c]);
    assert(await keyboardRow.evaluate(node=>node===document.activeElement),'키보드로 이동한 프로젝트에 초점이 남아야 합니다.');
    await app.close();app=null;page=await launch();
    await expected([b,a,c]);
    // A normal click still opens the project. Rename through the project settings form.
    await row(page,left,a).click();
    await expected([b,a,c],[left]);
    await page.getByRole('heading',{name:'처음',exact:true}).first().waitFor();
    await openProjectTab(page,'프로젝트 설정');
    await page.getByRole('button',{name:'킥오프 수정',exact:true}).click();
    await page.getByLabel('프로젝트 이름',{exact:true}).fill('개정한 표시 이름');
    await page.getByRole('button',{name:'킥오프 저장',exact:true}).click();
    await page.getByRole('heading',{name:'개정한 표시 이름',exact:true}).first().waitFor();
    await page.locator('.workspace-side button[aria-label="개정한 표시 이름"]').waitFor();
    await dockHome(page);
    await page.locator(right).filter({hasText:'개정한 표시 이름'}).waitFor();
    assert.ok((await fs.stat(projects[0].path)).isDirectory());
    await page.locator('.project-details summary').click();
    await page.getByRole('button',{name:'프로젝트 완료',exact:true}).click();
    await expected([b,c],[left,right]);
    await page.locator('.workspace-side').hover();
    await page.locator('.workspace-side').getByRole('button',{name:'완료한 업무',exact:true}).click();
    await page.getByRole('button',{name:'프로젝트 재개',exact:true}).click();
    await expected([b,a,c],[left,right]);

    console.log('홈·좌우 동일 순서 / 포인터 추종과 자리 열기 프레임 / 놓기 보간과 정착 / 탈출 취소 / 줄임 모션 / 키보드 이동·포커스 / 짧은 클릭 / 재실행 복원 통과',
      JSON.stringify({pointerTravelPixels:Math.round(movingMidpoint-held.top),openedSlotPixels:Math.round(shifted.top-beforeArrival),
        settlingTravelPixels:Math.round(Math.abs(held.top-resting)),settlingFrames:settling.length}));
  } finally {
    if (app) await app.close();
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
}
test().catch(e=>{console.error(e);process.exitCode=1;});
