const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const baseline = process.argv.includes('--before');
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-density-'));
  const profile = path.join(temp, 'profile');
  let app;
  try {
    const store = new Store(profile);
    await store.load();
    const folder = path.join(temp, '자료 검토');
    await fs.mkdir(folder);
    await store.addProject(folder);
    await store.saveSettings({codexPath: path.join(__dirname, 'backend-fake-codex.cjs')});
    const env = {...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({args:[root],env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.setViewportSize({width:1440,height:880});
    await page.locator('.workspace-side').hover();
    await page.locator('.side-project').first().click();
    await page.getByRole('button',{name:'프로젝트 메뉴',exact:true}).click();
    await page.getByRole('navigation',{name:'프로젝트 상세 탭'}).getByRole('button',{name:'프로젝트 설정',exact:true}).click();
    const edit = page.getByRole('button',{name:'킥오프 수정',exact:true});
    await edit.waitFor();
    await page.getByText('프로젝트 상세',{exact:true}).first().waitFor();
    const metrics = await edit.evaluate(button=>{
      const root=button.closest('.project-document-content');
      const heading=button.closest('.pf-section-header').querySelector('h2');
      const copy=[...root.querySelectorAll('p')].find(p=>p.textContent.includes('프로젝트의 범위'));
      const details=[...root.querySelectorAll('summary')].find(s=>s.textContent.includes('프로젝트 상세'));
      return {headingToCopy:copy.getBoundingClientRect().top-heading.getBoundingClientRect().bottom,copyToDetails:details.getBoundingClientRect().top-copy.getBoundingClientRect().bottom};
    });
    if(!baseline){
      assert(metrics.headingToCopy<=20&&metrics.copyToDetails<=30,JSON.stringify(metrics));
      const back=page.getByRole('button',{name:'프로젝트 홈으로 돌아가기',exact:true});
      await back.click();
      assert.equal(await back.count(),0);
      await page.getByRole('button',{name:'프로젝트 메뉴',exact:true}).click();
      const nav=page.getByRole('navigation',{name:'프로젝트 상세 탭'});
      await nav.getByRole('button',{name:'문서',exact:true}).click();
      const types=page.getByRole('navigation',{name:'자료 종류'});
      for(const label of ['규칙','디자인 시안','회의록','문서'])await types.getByRole('button',{name:label,exact:true}).click();
    }
    console.log(JSON.stringify(metrics));
  }finally{await app?.close();await fs.rm(temp,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
