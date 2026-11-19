const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {openConversation, composer} = require('./shell-test-helpers.cjs');
const {closeInstalledApp} = require('./update-installed-ui.cjs');

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
    const request = page.getByRole('button',{name:'다음 작업 추천받기',exact:true});
    const input = composer(page);
    await openConversation(page,long.title);
    await accept.waitFor({timeout:10000});
    assert.equal(await accept.locator('small').innerText(),'다음 작업 추천');
    await input.fill('직접 작성한 초안');
    await accept.click();
    assert.equal(await input.inputValue(),'직접 작성한 초안\n\n'+expected);
    for(const session of [declined,finished,fresh]){
      await openConversation(page,session.title);
      assert.equal(await accept.count(),0);
      assert.equal(await input.inputValue(),'');
      assert.equal(await request.count(),session.id===finished.id?1:0);
      if(session.id===finished.id){
        await request.click();
        await page.getByRole('status').getByText('현재 대화에서 이어갈 구체적인 작업을 찾지 못했습니다.').waitFor();
      }
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
    console.log('무초점 답변 후 추천 '+Math.round(metrics.delay)+'ms / 추가 모델 호출 0 / 클릭과 Tab은 편집 가능한 초안만 생성 / 거부·빈 대화·긴 답변 통과');
  } finally {
    try { if(app) await closeInstalledApp(app,'로컬 추천 화면 종료'); }
    finally { await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
  }
}
module.exports={verifyFollowupTiming};
if(require.main===module) verifyFollowupTiming().catch(error=>{console.error(error);process.exitCode=1;});
