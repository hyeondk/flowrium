const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {addTrustedFixtureProject,backendFixtureAccount}=require('./project-trust-fixture.cjs');
const {openConversation,waitForCodexConnection}=require('./shell-test-helpers.cjs');

(async()=>{
  const root=path.resolve(__dirname,'..'), temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-codex-plugins-'));
  const profile=path.join(temp,'profile'), projectFolder=path.join(temp,'project'), marker=path.join(temp,'fixture');
  let app;
  try{
    await fs.mkdir(projectFolder);
    const store=new Store(profile);await store.load();
    const project=await addTrustedFixtureProject(store,projectFolder,{account:backendFixtureAccount});
    const session=await store.createSession(project.id,{title:'연결 플러그인 시험'});
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_PLUGINS:marker};
    delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
    async function launch(){
      app=await _electron.launch({args:[root],env,timeout:45000});
      const page=await app.firstWindow();
      await page.setViewportSize({width:1440,height:1000});
      page.setDefaultTimeout(20000);
      await waitForCodexConnection(page);
      return page;
    }
    let page=await launch();
    await openConversation(page,session.title);
    let composer=page.getByRole('textbox',{name:'Codex에 보낼 작업 요청',exact:true});
    await composer.fill('연결 도구가 들어간 시험 요청 @시험');
    const picker=page.getByRole('region',{name:'연결 도구 선택',exact:true});
    await picker.getByRole('option',{name:/시험 연결 앱/}).waitFor();
    assert.equal(await picker.getByText('숨길 비활성 앱').count(),0);
    await composer.press('Enter');
    assert(!await composer.inputValue().then(text=>text.includes('@')));
    await page.getByRole('button',{name:'시험 연결 앱 연결 도구 제거'}).waitFor();
    await composer.fill('연결 도구가 들어간 시험 요청 @doc');
    await picker.getByRole('option',{name:/Documents/}).click();
    await page.getByRole('button',{name:'Documents 연결 도구 제거'}).waitFor();
    await app.close();app=undefined;

    page=await launch();
    await openConversation(page,session.title);
    composer=page.getByRole('textbox',{name:'Codex에 보낼 작업 요청',exact:true});
    assert.equal((await composer.inputValue()).trim(),'연결 도구가 들어간 시험 요청');
    await page.getByRole('button',{name:'시험 연결 앱 연결 도구 제거'}).waitFor();
    await page.getByRole('button',{name:'Documents 연결 도구 제거'}).waitFor();
    await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    const user=page.getByRole('article',{name:'내 메시지',exact:true}).filter({hasText:'연결 도구가 들어간 시험 요청'});
    await user.getByText('Documents',{exact:true}).waitFor();
    await page.getByText('확인한 결과입니다.').first().waitFor();
    const [input]=String(await fs.readFile(marker+'.turns')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(input.filter(row=>row.type==='mention'),[
      {type:'mention',name:'시험 연결 앱',path:'app://synthetic_work'},
      {type:'mention',name:'Documents',path:'plugin://documents@openai-curated-remote'},
    ]);
    const recorded=await page.evaluate(id=>window.flowrium.bootstrap().then(state=>state.sessions.find(s=>s.id===id)?.messages.find(m=>m.role==='user')),session.id);
    assert.equal(recorded.codexReferences.length,2);

    await page.locator('.workspace-side').hover();await page.getByRole('button',{name:'설정',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'설정',exact:true});
    await dialog.getByRole('button',{name:'계정과 모델',exact:true}).click();
    const settings=dialog.getByRole('region',{name:'플러그인과 연결 앱',exact:true});
    await settings.getByText('Documents',{exact:true}).waitFor();
    await settings.getByRole('button',{name:'새 도구 찾기',exact:true}).click();
    await settings.getByRole('searchbox',{name:'이름으로 찾기'}).fill('Work Calendar');
    const listing=settings.getByRole('listitem').filter({hasText:'Work Calendar'}).filter({has:page.getByRole('button',{name:'설치',exact:true})});
    await listing.getByRole('button',{name:'설치',exact:true}).click();
    assert.equal(await fs.stat(marker+'.installed').then(()=>true,()=>false),false);
    await settings.getByRole('button',{name:'확인하고 설치',exact:true}).click();
    await settings.getByText('플러그인을 설치했습니다. 연결 상태에서 서비스 권한을 확인해 주세요.').waitFor();
    const installed=settings.getByRole('listitem').filter({hasText:'Work Calendar'});
    await installed.getByRole('button',{name:'연결 상태',exact:true}).click();
    await settings.getByRole('button',{name:'계정 연결',exact:true}).waitFor();
    console.log('@ 검색과 키보드 선택 / 비활성 앱 제외 / 초안 재시작 복원 / 실제 구조화 Codex 입력과 기록 / 앱 내 설치 확인 / 서비스 권한 안내 통과');
  }finally{
    if(app)await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
