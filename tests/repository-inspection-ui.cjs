const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const {Store}=require('../electron/store.cjs');
const exec=require('node:util').promisify(require('node:child_process').execFile);
async function main(){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-repo-screen-'));
  const profile=path.join(temporary,'profile'),project=path.join(temporary,'테스트');
  let app;
  try{
    await fs.mkdir(project);
    const git=async(...args)=>(await exec('git',['-C',project,...args],{windowsHide:true})).stdout;
    await git('init','-b','main');await git('-c','user.name=화면','-c','user.email=repo@example.invalid','commit','--allow-empty','-m','화면의 기준');
    const store=new Store(profile);await store.load();await store.addProject(project);
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temporary,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({args:[path.resolve(__dirname,'..')],env,timeout:45000});
    const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(15000);
    const click=name=>page.getByRole('button',{name,exact:true}).click();
    await page.locator('.side-project').getByText('테스트',{exact:true}).click();
    await page.getByRole('navigation',{name:'프로젝트 상세 탭'}).getByRole('button',{name:'GitHub',exact:true}).click();await page.getByText('최근 커밋 1개',{exact:true}).click();
    assert.match(await page.getByRole('region',{name:'저장소 현황'}).innerText(),/화면의 기준/);
    await click('GitHub 저장소 연결');await page.getByLabel('GitHub 소유자/저장소').fill('sample/fixture');
    await click('연결 검토');assert.equal((await git('remote')).trim(),'');
    await click('확인하고 연결');await page.getByRole('button',{name:'sample/fixture 열기'}).waitFor();
    assert.equal((await git('remote','get-url','origin')).trim(),'https://github.com/sample/fixture.git');
    await click('원격 연결 편집');await page.getByLabel('GitHub 소유자/저장소').fill('sample/second');await click('연결 검토');await click('취소');
    assert.equal((await git('remote','get-url','origin')).trim(),'https://github.com/sample/fixture.git');
    console.log('실제 형상관리 화면 / 최근 커밋 / 원격 연결 확인·취소 / 로컬 원격 주소 검증 통과');
  }finally{
    try{if(app)await app.close();}finally{await fs.rm(temporary,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
