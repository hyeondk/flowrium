const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {openConversation, composer} = require('./shell-test-helpers.cjs');
const {closeInstalledApp} = require('./update-installed-ui.cjs');

async function firstPaintAfterClick(page) {
  const request = page.getByRole('button', {name:'다음 작업 추천받기', exact:true});
  await request.evaluate(button => {
    button.addEventListener('click', () => {
      const start = performance.now();
      window.firstFollowupPaint = undefined;
      function onFrame() {
        const input = document.querySelector('.composer textarea');
        const accept = document.querySelector('.followup-accept');
        if (input?.dataset.inlineSuggestion === 'true' && accept?.getBoundingClientRect().height > 0) {
          window.firstFollowupPaint = {
            duration:performance.now() - start, prompt:input.placeholder, source:accept.dataset.source,
          };
        } else if (performance.now() - start < 12000) {
          requestAnimationFrame(onFrame);
        }
      }
      requestAnimationFrame(onFrame);
    }, {once:true});
  });
  await request.click();
  await page.waitForFunction(() => Boolean(window.firstFollowupPaint), undefined, {timeout:10000});
  return page.evaluate(() => window.firstFollowupPaint);
}

async function verifyFollowupTiming() {
  const root = path.resolve(__dirname, '..');
  const dir = await fs.mkdtemp(path.join(root, '.flowrium-tmp', 'followup-timing-'));
  const profile = path.join(dir, 'profile');
  const trace = path.join(dir, '모델 응답 기록');
  let app;
  try {
    const folder = path.join(dir, '합성 프로젝트');
    await fs.mkdir(folder);
    const store = new Store(profile);
    await store.load();
    const project = await store.addProject(folder);
    const add = (title, question, answer) => store.createSession(project.id, {title, messages:[
      {id:randomUUID(), role:'user', text:question, createdAt:new Date().toISOString()},
      {id:randomUUID(), role:'assistant', text:answer, createdAt:new Date().toISOString()},
    ]});
    const slow = await add('분류표 확인', '기기별 분류표 검증을 맡아 주세요.',
      '기기별 분류를 끝냈습니다.\n다음 단계: 분류표의 누락 기기를 원본 목록과 대조해 주세요.');
    const staged = await add('추천 순서 확인', '응답 순서 검증을 맡아 주세요.',
      '분석한 열 이름을 통일했습니다.\n다음 단계: 변경한 열 이름을 데이터 사전과 비교해 주세요.');
    const recoverable = await add('오류 뒤 초안', '응답 중단 검증과 응답 순서 검증을 맡아 주세요.',
      '자료의 형식을 맞췄습니다.\n다음 단계: 날짜별 중복 행을 대조해 주세요.');
    const failing = await add('응답 중단', '응답 중단 검증을 맡아 주세요.', '입력한 데이터 7건을 모두 저장했습니다.');
    const blank = await store.createSession(project.id, {title:'빈 대화'});
    await store.saveSettings({codexPath:path.join(__dirname, 'continuation-fake-codex.cjs'), model:'test-model', theme:'light'});
    await fs.writeFile(trace, '');
    const env = {...process.env, FLOWRIUM_TEST_FOLLOWUP_LATENCY:trace, FLOWRIUM_USER_DATA:profile, CODEX_HOME:path.join(dir,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root], env, timeout:45000});
    const page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    await page.setViewportSize({width:1440,height:900});
    await page.locator('.side-usage[data-connected=true]').waitFor();

    await openConversation(page, slow.title);
    const displayed = await firstPaintAfterClick(page);
    assert(displayed.duration < 10000, '클릭 후 10초 안에 입력 미리보기와 선택 버튼이 같이 표시');
    assert.equal(displayed.source, 'conversation');
    assert.match(displayed.prompt, /누락 기기.*원본 목록/u);
    assert(!(await fs.readFile(trace,'utf8')).includes('완료'), '모델이 응답하기 전에 첫 문구가 이미 보임');
    assert.equal(await composer(page).inputValue(), '', '추천 표시가 초안을 바꾸지 않음');
    await page.locator('.followup-accept').click();
    assert.equal(await composer(page).inputValue(), displayed.prompt);
    const stored = session => page.evaluate(id => window.flowrium.bootstrap().then(s => s.sessions.find(row => row.id === id)), session.id);
    assert.equal((await stored(slow)).messages.length, 2, '선택만으로 전송하지 않음');

    await openConversation(page, blank.title);
    await composer(page).fill('새 대화의 독립된 초안');
    const deadline = Date.now() + 16000;
    while (!(await fs.readFile(trace,'utf8')).includes('완료') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await fs.readFile(trace,'utf8'), '시작\n완료\n', '모의 모델이 12초 후에 정상 완료');
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '새 대화의 독립된 초안');
    assert.equal(await page.locator('.followup-accept, .followup-request').count(), 0);
    assert.equal((await stored(blank)).messages.length, 0, '늦은 응답을 새 대화에 추가하지 않음');
    await openConversation(page,slow.title);
    assert.equal(await composer(page).inputValue(), displayed.prompt, '늦은 응답이 사용한 초안을 덮어쓰지 않음');

    await openConversation(page,staged.title);
    const first = await firstPaintAfterClick(page);
    assert.equal(first.source, 'conversation');
    const alternate = page.getByRole('button',{name:'다른 추천 보기'});
    await alternate.waitFor();
    assert.equal(await composer(page).getAttribute('placeholder'), first.prompt, '모델 결과가 도착해도 읽는 항목이 이동하지 않음');
    await alternate.click();
    const model = page.locator('.followup-accept[data-source="model"]');
    await model.waitFor();
    assert.match(await composer(page).getAttribute('placeholder'), /한글 검색어/);
    await page.getByRole('button',{name:'추천 닫기'}).click();
    assert.equal(await page.locator('.followup-accept').count(), 0);
    assert.equal((await stored(staged)).messages.length, 2);

    await openConversation(page,recoverable.title);
    const fallback = await firstPaintAfterClick(page);
    assert.equal(fallback.source, 'conversation');
    await page.locator('.chat-continuation [role=alert]').waitFor();
    assert.equal(await composer(page).getAttribute('placeholder'), fallback.prompt, '모델이 끊겨도 읽고 있던 직전 답변 제안 보존');
    await page.locator('.followup-accept').click();
    assert.equal(await composer(page).inputValue(), fallback.prompt);

    await openConversation(page,failing.title);
    await page.getByRole('button', {name:'다음 작업 추천받기', exact:true}).click();
    await page.locator('.chat-continuation [role=alert]').waitFor();
    assert.equal(await page.locator('.followup-accept').count(), 0, '다음 단계가 없는 완료 답변에서 추천을 만들지 않음');
    assert.equal((await stored(failing)).messages.length, 2);
    console.log('모델 응답 12초 지연 / 클릭부터 첫 추천 표시 '+Math.round(displayed.duration)+'밀리초 / 답변에 명시된 근거 확인 / 전송 전 초안 보존 / 새 대화로 늦은 추천 유출 없음 / 모델 실패 시 근거 없는 추천 없음');
  } finally {
    try { if (app) await closeInstalledApp(app, '추천 시간 검사 앱 종료'); }
    finally { await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
  }
}

module.exports = {verifyFollowupTiming};
if (require.main === module) verifyFollowupTiming().catch(error => { console.error(error); process.exitCode=1; });
