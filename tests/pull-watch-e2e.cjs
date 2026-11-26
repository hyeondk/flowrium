const {waitForCodexConnection}=require('./shell-test-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {_electron} = require('playwright');
const {expect} = require('playwright/test');
const {Store} = require('../electron/store.cjs');
const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');

const exec = promisify(execFile);

async function main() {
  const root=path.resolve(__dirname,'..');
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-pull-watch-ui-')));
  const dir=path.join(temp,'가상 설치 페이지'),profile=path.join(temp,'profile');
  const summaryTitle='example/flow-demo에 새 변경 요청이 열렸습니다.';
  let app, page;
  try {
    await fs.mkdir(dir);
    await exec('git',['init'],{cwd:dir});
    await exec('git',['remote','add','origin','https://github.com/example/flow-demo.git'],{cwd:dir});
    const store=new Store(profile);
    await store.load();
    await addTrustedFixtureProject(store,dir,{account:backendFixtureAccount});
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({args:[root],env,timeout:45000});
    page=await app.firstWindow();
    page.setDefaultTimeout(14000);
    await page.setViewportSize({width:1440,height:970});
    await waitForCodexConnection(page);
    await app.evaluate(({shell},moduleFile)=>{
      const runtime=process.mainModule.require(moduleFile);
      const {execFile}=process.mainModule.require('node:child_process');
      const {promisify}=process.mainModule.require('node:util');
      const original=runtime.scanPullRequests;
      const git=promisify(execFile);
      runtime.scanPullRequests=(store,watch,at,options)=>original(store,watch,at,{
        ...options,
        execute:async (command,args,details)=>{
          if(command==='git')return git(command,args,details);
          if(command!=='gh'||!args.at(-1).startsWith('repos/example/flow-demo/pulls?'))throw Error('예상하지 못한 외부 조회');
          const created=new Date(Math.floor(at/1000)*1000).toISOString();
          return {stdout:JSON.stringify([{number:71,title:'다운로드 카드의 도움말 위치 정리',created_at:created}])};
        },
      });
      shell.openExternal=async url=>{globalThis.flowriumPullTestUrl=url;};
    },path.join(root,'electron','pull-watch.cjs'));
    await page.locator('.workspace-side').hover();
    await page.getByRole('button',{name:'업무 센터',exact:true}).click();
    const hub=page.getByRole('region',{name:'업무 센터',exact:true});
    await hub.getByRole('button',{name:'비서와 예약',exact:true}).click();
    const monitor=hub.getByRole('region',{name:'깃허브 변경 요청 감시',exact:true});
    const toggle=monitor.getByRole('switch',{name:'새 변경 요청 알림 받기',exact:true});
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(),false);
    await toggle.click();
    await monitor.getByRole('status').filter({hasText:'저장소 1개'}).waitFor();
    const state=await page.evaluate(()=>window.flowrium.workflowState());
    assert.equal(state.pullWatch.enabled,true);
    assert.equal(Date.parse(state.pullWatch.nextCheckAt)-Date.parse(state.pullWatch.lastCheckedAt),600000);
    assert.equal(state.preferences.enabled,false);
    const matching=state.notifications.filter(row=>row.kind==='github-pr');
    assert.equal(matching.length,1);
    assert.equal(matching[0].body,'#71 다운로드 카드의 도움말 위치 정리');
    const toast=page.getByRole('complementary',{name:summaryTitle,exact:true});
    await toast.waitFor();
    await page.locator('.header-decisions').click();
    const inbox=page.getByRole('dialog',{name:'알림',exact:true});
    const article=inbox.locator('.attention-item').filter({hasText:summaryTitle});
    await article.getByText('#71 다운로드 카드의 도움말 위치 정리',{exact:true}).waitFor();
    if(process.env.FLOWRIUM_PULL_WATCH_SCREENSHOT){
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:process.env.FLOWRIUM_PULL_WATCH_SCREENSHOT,animations:'disabled'});
    }
    await article.getByRole('button',{name:'깃허브에서 열기',exact:true}).click();
    assert.equal(await app.evaluate(()=>globalThis.flowriumPullTestUrl),'https://github.com/example/flow-demo/pull/71');
    await expect.poll(()=>page.evaluate(async noticeId=>Boolean((await window.flowrium.workflowState()).notifications.find(row=>row.id===noticeId)?.readAt),matching[0].id)).toBe(true);
    await inbox.getByRole('button',{name:'알림 닫기',exact:true}).click();
    await inbox.waitFor({state:'detached'});
    await toggle.click();
    await expect.poll(()=>page.evaluate(async()=>Boolean((await window.flowrium.workflowState()).pullWatch.enabled))).toBe(false);
    console.log('실제 앱 깃허브 감시 설정 / 모의 원격 PR 조회 / 10분 간격 / 토스트 및 알림 목록 한 건 / 깃허브 URL / 읽음 / 끄기 통과');
  } catch(error) {
    if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(0,3500));
    throw error;
  } finally {
    if(app)await app.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
