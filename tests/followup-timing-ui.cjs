const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {openConversation, composer, settledLayout} = require('./shell-test-helpers.cjs');
const {closeInstalledApp} = require('./update-installed-ui.cjs');

async function verifyContinuationRows(page) {
  const section = page.locator('.composer .chat-continuation');
  for (const width of [320, 390, 960, 1440]) {
    await page.setViewportSize({width, height:900});
    await settledLayout(section);
    const rows = await section.evaluate(node => {
      const rect = element => {
        const {left,right,top,bottom} = element.getBoundingClientRect();
        return {left,right,top,bottom,center:(top+bottom)/2};
      };
      return {
        recommendation:rect(node.querySelector('.followup-accept')),
        proceed:rect(node.querySelector('.followup-proceed')),
        complete:rect(node.querySelector('.followup-complete')),
        section:rect(node),
      };
    });
    const {recommendation, proceed, complete} = rows;
    assert(Math.abs(proceed.center-complete.center)<1 && proceed.right<=complete.left && complete.right<=rows.section.right,
      JSON.stringify({width,rows}));
    assert(recommendation.bottom<=proceed.top+.5 && Math.abs(recommendation.right-complete.right)<1,
      JSON.stringify({width,rows}));
  }
}

async function verifyFollowupTiming() {
  const root = path.resolve(__dirname, '..');
  const dir = await fs.mkdtemp(path.join(root,'.flowrium-tmp','followup-timing-'));
  const trace = path.join(dir,'합성 전송 기록');
  const expected = '분류표의 누락 기기를 원본 목록과 대조해줘';
  const answer = '기기별 분류를 끝냈습니다.\n다음 단계: 분류표의 누락 기기를 원본 목록과 대조해 주세요.';
  let app;
  try {
    const projectDir = path.join(dir,'합성 프로젝트');
    await fs.mkdir(projectDir);
    const store = new Store(path.join(dir,'profile'));
    await store.load();
    const project = await addTrustedFixtureProject(store, projectDir, {account: backendFixtureAccount});
    const add = (title, user, text) => store.createSession(project.id, {title, messages:[
      {id:randomUUID(),role:'user',text:user,createdAt:new Date().toISOString()},
      {id:randomUUID(),role:'assistant',text,createdAt:new Date().toISOString()},
    ]});
    const long = await add('길게 받은 답변','분류를 살펴봐줘','자료의 값입니다. '.repeat(2000)+'\n'+answer);
    const declined = await add('추천 거부','다음 단계는 제안하지 마세요.',answer);
    const finished = await add('완료한 결과','표를 확인해줘','판매표를 확인했습니다.');
    const retained = await add('이전 중계가 남은 설치','기존 QR을 다시 안 찍어도 되도록 유지하고 이전 빌드 파일을 지워줘.',
      '새 설치 파일은 공개했습니다. 직전 버전 복구본과 현재 아이폰 중계가 사용 중인 이전 빌드의 실행 파일은 유지했습니다. 추가 조치가 필요한 사항은 없습니다.');
    const waiting = await add('후속 작업 대기','기기 분류표의 누락을 살펴봐 주세요.','기기 분류표를 확인했습니다. 계속 진행할까요?');
    const contextual=await store.createSession(project.id,{title:'추천의 전체 맥락 갱신',messages:[
      {id:randomUUID(),role:'user',text:'아이폰 연결 유지를 먼저 확인해 주세요.',createdAt:new Date().toISOString()},
      {id:randomUUID(),role:'user',text:'같은 조건으로 계속',createdAt:new Date().toISOString()},
      {id:randomUUID(),role:'assistant',text:'다음 단계\n- 윈도우 설치 복원을 검증해 주세요.\n- 아이폰 연결 유지를 확인해 주세요.',createdAt:new Date().toISOString()},
    ]});
    const fresh = await store.createSession(project.id,{title:'새 작업'});
    await store.saveSettings({codexPath:path.join(__dirname,'continuation-fake-codex.cjs'),model:'test-model'});
    await fs.writeFile(trace,'');
    const env = {...process.env, FLOWRIUM_TEST_FOLLOWUP_TRACE:trace, FLOWRIUM_TEST_FOLLOWUP_ANSWER:answer,
      FLOWRIUM_USER_DATA:path.join(dir,'profile'), CODEX_HOME:path.join(dir,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root],env,timeout:45000});
    const page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.side-usage[data-connected=true]').waitFor();
    const accept = page.locator('.followup-accept[data-source="conversation"]');
    const input = composer(page);
    await page.evaluate(()=>{
      window.recommendationProgress = [];
      const observer = new MutationObserver(()=>{
        const progress=document.querySelector('.followup-progress');
        const button=document.querySelector('.followup-proceed');
        if(!progress||!button)return;
        const a=progress.getBoundingClientRect(), b=button.getBoundingClientRect();
        const row={width:innerWidth,value:Number(progress.getAttribute('aria-valuenow')),text:progress.textContent,
          sameRow:Math.abs(a.top+a.height/2-b.top-b.height/2)<1 && a.right<b.left};
        const previous=window.recommendationProgress.at(-1);
        if(previous?.value!==row.value||previous?.width!==row.width)window.recommendationProgress.push(row);
      });
      observer.observe(document.querySelector('.app-shell'),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-valuenow']});
    });
    for(const width of [320,390,960,1440]){
      await page.setViewportSize({width,height:900});
      await openConversation(page,waiting.title);
      await accept.waitFor({timeout:10000});
      const rows=await page.evaluate(()=>window.recommendationProgress.filter(row=>row.width===innerWidth));
      assert.deepEqual(rows.map(row=>row.value),[0,25,50,75,100],JSON.stringify(rows));
      assert(rows.every(row=>row.sameRow&&row.text===`작업 추천 중 (${row.value.toFixed(1)}%)`),JSON.stringify(rows));
    }
    await openConversation(page,long.title);
    await accept.waitFor({timeout:10000});
    assert.equal(await accept.locator('small').innerText(),'다음 작업 추천');
    await verifyContinuationRows(page);
    await input.fill('직접 작성한 초안');
    await accept.click();
    assert.equal(await input.inputValue(),'직접 작성한 초안\n\n'+expected);
    await openConversation(page,finished.title);
    await accept.filter({hasText:/판매표.*확인한 범위/}).waitFor({timeout:10000});
    assert.equal(await input.inputValue(),'');
    await openConversation(page,contextual.title);
    await accept.filter({hasText:'아이폰 연결 유지를 확인해 주세요'}).waitFor({timeout:10000});
    const contextChangedAt=Date.now();
    await app.evaluate(({BrowserWindow},session)=>BrowserWindow.getAllWindows()[0].webContents.send(
      'flowrium:event',{type:'session',sessionId:session.id,session}
    ),{...contextual,messages:contextual.messages.map((row,index)=>index===0?{...row,text:'윈도우 설치 복원을 먼저 확인해줘.'}:row)});
    await accept.filter({hasText:'윈도우 설치 복원을 검증해줘'}).waitFor({timeout:10000});
    assert.equal(await accept.filter({hasText:'아이폰 연결 유지'}).count(),0);
    const contextMs=Date.now()-contextChangedAt;
    assert(contextMs<10000);
    const retainedPrompt='QR을 다시 찍지 않도록 기존 연결을 유지하면서 아이폰 중계를 최신 버전으로 옮기고, 교체가 확인되면 직전 복구본만 남기고 나머지 이전 빌드를 정리해줘';
    const retainedStarted=Date.now();
    await openConversation(page,retained.title);
    await accept.filter({hasText:retainedPrompt}).waitFor({timeout:10000});
    const retainedMs=Date.now()-retainedStarted;
    assert(retainedMs<10000);
    await accept.click();
    assert.equal(await input.inputValue(),retainedPrompt);
    console.log('이전 중계가 남은 실제 대화 추천 '+retainedMs+'ms / QR 보존과 교체 후 정리가 편집 가능한 초안에 반영');
    for(const session of [declined,fresh]){
      await openConversation(page,session.title);
      assert.equal(await accept.count(),0);
      assert.equal(await input.inputValue(),'');
      assert.equal(await page.getByRole('progressbar',{name:'작업 추천 중'}).count(),0);
    }
    assert.equal(await fs.readFile(trace,'utf8'),'','대화를 열고 초안을 선택해도 모델 호출 없음');
    await page.evaluate(() => {
      const watch = new MutationObserver(() => {
        if (window.followupArrival == null && document.querySelector('.message.assistant')?.textContent.includes('기기별 분류'))
          window.followupArrival = performance.now();
      });
      watch.observe(document.querySelector('.messages'),{characterData:true,subtree:true,childList:true});
    });
    // 입력칸을 한 번도 활성화하지 않고 공식 전송 경로로 새 답변을 받는다.
    await page.evaluate(sessionId=>window.flowrium.send({sessionId,text:'분류표를 확인해줘',mode:'plan'}),fresh.id);
    await accept.waitFor({timeout:10000});
    const metrics = await page.evaluate(()=>({
      delay:performance.now()-window.followupArrival, focused:document.activeElement===document.querySelector('.composer textarea'),
    }));
    assert(Number.isFinite(metrics.delay) && metrics.delay>=0 && metrics.delay<10000,JSON.stringify(metrics));
    assert.equal(metrics.focused,false);
    assert.equal(await input.inputValue(),'');
    assert.equal(await input.getAttribute('placeholder'),expected);
    await input.press('Tab');
    assert.equal(await input.inputValue(),expected);
    const state = await page.evaluate(sessionId=>window.flowrium.bootstrap().then(s=>s.sessions.find(v=>v.id===sessionId)),fresh.id);
    assert.deepEqual(state.messages.filter(m=>m.role==='user').map(m=>m.text),['분류표를 확인해줘']);
    assert.equal(await fs.readFile(trace,'utf8'),'전송\n','실제 사용자 턴 이외의 요청이 없어 추가 토큰을 사용하지 않음');
    console.log('무초점 답변 후 추천 '+Math.round(metrics.delay)+'ms / 추가 모델 호출 0 / 클릭과 Tab은 편집 가능한 초안만 생성 / 명시 후속 없는 답변·거부·빈 대화·긴 답변 통과');
    console.log('데스크톱: 같은 답변의 앞선 대화 수정 뒤 추천 갱신 '+contextMs+'ms');
    console.log('320·390·960·1440px / 소수 첫째 자리 진행률과 진행·완료가 같은 줄 / 결과 뒤에는 전체 너비 추천과 아래 줄의 진행·완료');
  } finally {
    try { if(app) await closeInstalledApp(app,'로컬 추천 화면 종료'); }
    finally { await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
  }
}
module.exports={verifyFollowupTiming};
if(require.main===module) verifyFollowupTiming().catch(error=>{console.error(error);process.exitCode=1;});
