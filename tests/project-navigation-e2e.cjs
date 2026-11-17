const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const {dockHome}=require('./shell-test-helpers.cjs');

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
    const left='.side-project-list [data-project-sort-id]',right='.dock-browser [data-project-sort-id]';
    const expected=ids=>page.waitForFunction(({left,right,ids})=>[left,right].every(sel=>
      [...document.querySelectorAll(sel)].map(e=>e.dataset.projectSortId).join()===ids.join()),{left,right,ids});
    const [a,b,c]=projects.map(p=>p.id);
    await expected([a,b,c]);
    const hold=async(section,id,target)=>{
      const row=page.locator(section+'[data-project-sort-id="'+id+'"]'),dest=page.locator(section+'[data-project-sort-id="'+target+'"]');
      await row.scrollIntoViewIfNeeded();const x=await row.boundingBox(),y=await dest.boundingBox();assert.ok(x&&y);
      await page.mouse.move(x.x+x.width/2,x.y+x.height/2);await page.mouse.down();
      await page.waitForFunction(id=>document.querySelector('[data-project-sort-id="'+id+'"][data-project-drag=moving]'),id);
      await page.mouse.move(y.x+y.width/2,y.y+y.height/2,{steps:7});await page.mouse.up();
    };
    assert.equal(await page.locator(right).first().isVisible(),false);
    await dockHome(page);
    await hold(right,c,a);
    await expected([c,a,b]);
    assert.match(await page.locator('.main-shell').getAttribute('data-view'),/dashboard/);
    await page.locator('.workspace-side').hover();await page.getByRole('button',{name:'메뉴 고정'}).click();
    await hold(left,b,c);
    await expected([b,c,a]);
    await page.locator(left+'[data-project-sort-id="'+c+'"]').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expected([b,a,c]);
    await app.close();app=null;page=await launch();
    await expected([b,a,c]);
    // A normal click still opens the project. Rename through the project settings form.
    await page.locator(left+'[data-project-sort-id="'+a+'"]').click();
    await page.getByRole('button',{name:'프로젝트 설정',exact:true}).click();
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
    await expected([b,c]);
    await page.locator('.workspace-side').hover();
    await page.locator('.workspace-side').getByRole('button',{name:'완료',exact:true}).click();
    await page.getByRole('button',{name:'프로젝트 재개',exact:true}).click();
    await expected([b,a,c]);

    console.log('좌우 패널 길게 눌러 이동 / 반대 패널 동시 반영 / 키보드 이동 / 재실행 복원 / 설정에서 이름 변경과 좌우 반영 통과');
  } finally {
    if (app) await app.close();
    await fs.rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
}
test().catch(e=>{console.error(e);process.exitCode=1;});
