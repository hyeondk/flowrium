const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// 이 파일은 격리된 검사 앱의 메인 프로세스에서만 지연과 실패를 주입한다.
function installGates() {
  const {ipcMain} = require('electron');
  const gates = new Map();
  const register = ipcMain.handle.bind(ipcMain);
  global.flowriumProgressTest = {
    hold(name) {
      let release;
      const ready = new Promise(resolve => {release = resolve;});
      gates.set(name, {ready, release});
    },
    finish(name, fail = false) {
      const gate = gates.get(name);
      gates.delete(name);
      gate.release(fail);
    }
  };
  ipcMain.handle = (channel, handler) => register(channel, async (...args) => {
    const wait = gates.get(channel);
    if (wait && await wait.ready) throw new Error('기동 상태 검사 오류');
    return handler(...args);
  });
}

async function run() {
  const {_electron} = require('playwright');
  const {Store} = require('../electron/store.cjs');
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-boot-'));
  const profile = path.join(temp, 'profile');
  const store = new Store(profile);
  let app;
  try {
    await store.load();
    const folder = path.join(temp,'진행 표시 검사');
    await fs.mkdir(folder);
    await store.addProject(folder);
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:['-r',__filename,root],env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.locator('.app-shell').waitFor();
    const gate = name => app.evaluate((_,name)=>global.flowriumProgressTest.hold(name),name);
    const finish = (name,fail=false) => app.evaluate((_,args)=>global.flowriumProgressTest.finish(...args),[name,fail]);
    await gate('flowrium:securityState');
    await page.reload();
    const startup = page.getByRole('progressbar',{name:'작업 공간을 준비하고 있습니다.'});
    await startup.waitFor();
    assert.equal(await page.getByRole('progressbar').count(),1);
    const animation = () => startup.evaluate(e=>getComputedStyle(e,'::after').animationName);
    assert.equal(await animation(),'flow-loading-pass');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await animation(),'none');
    await finish('flowrium:securityState',true);
    await page.getByRole('alert').filter({hasText:'기동 상태 검사 오류'}).waitFor();
    assert.equal(await startup.count(),0);
    await gate('flowrium:bootstrap');
    await page.getByRole('button',{name:'연결 다시 확인'}).click();
    const workspace = page.getByRole('progressbar',{name:'작업 공간을 불러오고 있습니다.'});
    await workspace.waitFor();
    await finish('flowrium:bootstrap');
    await workspace.waitFor({state:'detached'});
    await page.locator('.workspace-side').hover();
    await gate('flowrium:readProjectDetails');
    await page.locator('.side-project').first().click();
    const project = page.getByRole('progressbar',{name:'프로젝트 정보를 불러오는 중입니다.'});
    await project.waitFor();
    await finish('flowrium:readProjectDetails');
    await project.waitFor({state:'detached'});
    await page.getByRole('button',{name:'프로젝트 설정',exact:true}).click();
    const section = page.locator('.kickoff-settings');
    const info = await section.evaluate(el=>{
      const h=el.querySelector('h2').getBoundingClientRect(),p=el.querySelector('p').getBoundingClientRect();
      return {gap:Math.round(p.top-h.bottom),width:el.clientWidth,scrollWidth:el.scrollWidth};
    });
    assert(info.gap>=0 && info.gap<30,'제목과 설명 간격 '+info.gap);
    assert(info.scrollWidth<=info.width+1);
    console.log('초기 진행 표시 / 동작 줄이기 / 실패 / 재시도 / 자료 로딩 / 프로젝트 설정 통과',info);
  } finally {
    if(app) await app.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true});
  }
}
if(require.main === module) run().catch(error=>{console.error(error);process.exitCode=1});
else installGates();
