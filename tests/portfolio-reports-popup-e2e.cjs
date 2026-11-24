const {dockDismissButton,settledLayout,waitForCodexConnection} = require('./shell-test-helpers.cjs');
const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

async function run() {
  const root = path.resolve(__dirname, '..'), temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-report-popup-')));
  let app, page; const errors = [];
  try {
    const profile = path.join(temp, '검증 프로필'), log = path.join(temp, '모델 요청.jsonl'), fake = path.join(temp, '검증 모델.cjs');
    const fixture = (await fs.readFile(path.join(__dirname, 'backend-fake-codex.cjs'), 'utf8'))
      .replace('const request = JSON.parse(line);', 'const request = JSON.parse(line); require("node:fs").appendFileSync(' + JSON.stringify(log) + ', JSON.stringify(request) + "\\n");')
      .replace('{ id: "test-model", model: "test-model", displayName: "검증 모델" }', '{id:"test-model",model:"test-model",displayName:"깊이 검증 모델",isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:[{reasoningEffort:"medium",description:"균형"},{reasoningEffort:"xhigh",description:"깊이"}]},{id:"fast-model",model:"fast-model",displayName:"빠른 검증 모델",supportedReasoningEfforts:[{reasoningEffort:"minimal"}]}')
      .replace('require("./teams-fake-response.cjs")', 'require(' + JSON.stringify(path.join(__dirname, 'teams-fake-response.cjs')) + ')');
    await fs.writeFile(fake, fixture);
    const store = new Store(profile); await store.load(); await store.saveSettings({ codexPath: fake, theme: 'light' });
    const projects = [];
    for (const name of ['첫 보고 프로젝트', '두 번째 보고 프로젝트']) { const folder = path.join(temp, name); await fs.mkdir(folder); const project = await addTrustedFixtureProject(store, folder, {account: backendFixtureAccount}); projects.push(project); await store.createSession(project.id, { title: name + ' 최근 작업' }); }
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, 'codex') }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    async function launch() {
      app = await _electron.launch({ args: [root], env, timeout: 45000 });
      page = await app.firstWindow();
      page.setDefaultTimeout(16000);
      page.on('pageerror', error => errors.push(error.message));
      // 자동화의 가상 포커스 대신 실제 맥·윈도우 창의 포커스를 사용합니다.
      const protocol=await page.context().newCDPSession(page);
      await protocol.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    async function focusApp() {
      await app.evaluate(({app,BrowserWindow})=>{
        const window=BrowserWindow.getAllWindows()[0];
        if(!window.isVisible())window.show();
        if (process.platform==='darwin') app.focus({steal:true});
        window.focus();
      });
    }
    async function waitDashboard() {
      await page.getByRole('heading', { name: '프로젝트 대시보드', exact: true }).waitFor();
      await waitForCodexConnection(page);
    }
    await launch();
    await focusApp();
    await waitDashboard();
    const originalView = await page.locator('.main-shell').getAttribute('data-view');
    const snapshot = () => page.evaluate(() => window.flowrium.bootstrap());
    async function open(title) { await page.locator('.workspace-side').hover(); await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name: title, exact: true }).click(); const dialog = page.getByRole('dialog', { name: title, exact: true }); await dialog.waitFor(); await dialog.getByLabel('보고서 AI 모델', { exact: true }).locator('option[value="test-model"]').waitFor({ state: 'attached' }); await settledLayout(dialog); return dialog; }
    async function assertCentered(dialog, width) {
      await page.setViewportSize({ width, height: 1000 });
      const box = await settledLayout(dialog);
      const viewport = await dialog.evaluate(element=>{
        const overlay=element.parentElement, parent=overlay.getBoundingClientRect();
        return {width:innerWidth,height:innerHeight,centerX:parent.left+overlay.clientLeft+overlay.clientWidth/2,centerY:parent.top+overlay.clientTop+overlay.clientHeight/2};
      });
      assert(Math.abs(box.x + box.width / 2 - viewport.centerX) < 2, '스크롤 영역을 제외한 팝업 수평 중앙 '+JSON.stringify({width,box,viewport}));
      assert(Math.abs(box.y + box.height / 2 - viewport.centerY) < 2, '팝업 수직 중앙 '+JSON.stringify({width,box,viewport}));
      assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, '팝업 화면 안에 유지');
      assert.equal(await page.locator('.main-shell').getAttribute('data-view'), originalView, '원래 화면 유지');
      const overflow = await dialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth })); assert(overflow.scroll <= overflow.client + 1, '팝업 가로 넘침 없음');
    }
    let dialog = await open('주간업무보고');
    for (const width of [1440, 800, 390]) await assertCentered(dialog, width);
    await page.setViewportSize({ width: 1440, height: 1000 }); await settledLayout(dialog);
    assert.equal(await dialog.evaluate(element => element.parentElement?.parentElement === document.body), true, '본문 포털에 팝업 배치');
    await dialog.getByRole('button', { name: '전체 선택', exact: true }).click();
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('test-model');
    assert.deepEqual(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['', 'medium', 'xhigh']);
    await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('xhigh');
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('fast-model');
    assert.equal(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).inputValue(), '');
    assert.deepEqual(await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['', 'minimal']);
    await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('test-model'); await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('xhigh');
    await dialog.getByRole('button', { name: '직접 정하기', exact: true }).click(); await dialog.getByLabel('조회 시작일', { exact: true }).fill('2026-11-01'); await dialog.getByLabel('조회 종료일', { exact: true }).fill('2026-11-06');
    await dialog.getByLabel('덧붙일 말 선택 사항', { exact: true }).fill('완료한 업무를 과제별로 정리');
    await dialog.getByText('제목과 보고 형식 설정', { exact: true }).click(); await dialog.getByLabel('보고서 제목', { exact: true }).fill('팝업 검증 주간보고');
    if (process.env.FLOWRIUM_REPORTS_SCREENSHOT) { await fs.mkdir(path.dirname(process.env.FLOWRIUM_REPORTS_SCREENSHOT), { recursive: true }); await page.screenshot({ path: process.env.FLOWRIUM_REPORTS_SCREENSHOT }); }
    await dialog.getByRole('button', { name: 'ChatGPT로 보고서 작성', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).sessions.some(session => session.title === '팝업 검증 주간보고' && session.messages.some(message => message.role === 'assistant')));
    let data = await snapshot(); const report = data.sessions.find(session => session.title === '팝업 검증 주간보고'); assert.equal(report.preferences.model, 'test-model'); assert.equal(report.preferences.effort, 'xhigh'); assert.deepEqual(report.workflow.reportProjects, projects.map(project => project.id)); assert.equal(report.workflow.from, '2026-11-01'); assert.equal(report.workflow.to, '2026-11-06');
    dialog = await open('주간업무보고'); await dialog.getByRole('button', { name: '작성된 보고', exact: true }).click(); await dialog.getByRole('button').filter({ hasText: '팝업 검증 주간보고' }).click(); await dialog.waitFor({ state: 'detached' });
    const memo='회의 후 검증 결과 이어서 확인', closeTitle='팝업 검증 업무마감', resumeTitle='업무를 다시 이어갈 시간이에요.';
    dialog = await open('업무 마감'); await dialog.getByRole('button', { name: '전체 선택', exact: true }).click(); await dialog.getByRole('button', { name: '회의', exact: true }).click();
    await dialog.getByLabel('복귀할 때 참고할 메모 선택 사항', { exact: true }).fill(memo); await dialog.getByLabel('보고서 AI 모델', { exact: true }).selectOption('fast-model'); await dialog.getByLabel('보고서 AI 추론 강도', { exact: true }).selectOption('minimal');
    await dialog.getByText('제목과 인계 대상 설정', { exact: true }).click(); await dialog.getByLabel('마감 기록 제목', { exact: true }).fill(closeTitle); await dialog.getByRole('button', { name: 'ChatGPT로 업무 마감 작성', exact: true }).click();
    await dialog.getByRole('heading', { name: 'AI 작업을 시작했습니다', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).sessions.filter(session => session.title === '팝업 검증 업무마감' && session.messages.some(message => message.role === 'assistant')).length === 2);
    data = await snapshot(); const endings = data.sessions.filter(session => session.title === '팝업 검증 업무마감'); assert.equal(endings.length, 2); assert.deepEqual(new Set(endings.map(session => session.projectId)), new Set(projects.map(project => project.id)));
    for (const session of endings) {
      assert.equal(session.preferences.model, 'fast-model'); assert.equal(session.preferences.effort, 'minimal');
      assert.equal(session.workflow.brief, '회의');
      assert(!JSON.stringify(session).includes(memo),'복귀 메모는 대화와 마감 보고에 전달하지 않습니다.');
    }
    await dialog.getByRole('button', { name: '닫기', exact: true }).click(); await dialog.waitFor({ state: 'detached' }); assert.equal(await page.locator('.main-shell').getAttribute('data-view'), originalView);
    const requests = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(request => request.method === 'turn/start');
    assert(requests.some(request => request.params.model === 'test-model' && request.params.effort === 'xhigh'), '주간보고 실제 모델과 강도 요청');
    assert.equal(requests.filter(request => request.params.model === 'fast-model' && request.params.effort === 'minimal').length, 2, '프로젝트별 마감 실제 모델과 강도 요청');
    assert(!JSON.stringify(requests).includes(memo),'모델 요청 원문에 복귀 메모를 포함하지 않습니다.');

    const workflow = () => page.evaluate(()=>window.flowrium.workflowState());
    const notice = () => page.locator('.flow-question-notice').filter({hasText:resumeTitle});
    const resume = () => page.getByRole('region',{name:'이어갈 대화',exact:true});
    const toolbar = () => page.getByRole('group',{name:'프로젝트 빠른 작업',exact:true});
    const closeChat=()=>dockDismissButton(page.locator('.conversation-dock'));
    if (await closeChat().isVisible()) await closeChat().click();
    await page.waitForFunction(async()=>{
      const work=(await window.flowrium.workflowState()).workClose;
      return work?.returnPending&&work.sessions.length===2&&work.sessions.every(session=>session.status==='completed');
    });
    const pending=await workflow();
    const batchId=pending.workClose.id;
    assert.equal(pending.workClose.reason,'회의');
    assert.deepEqual(new Set(pending.workClose.sessions.map(row=>row.sessionId)),new Set(endings.map(session=>session.id)));
    assert(!JSON.stringify(pending).includes(memo),'일반 상태에서도 복귀 메모를 읽지 않습니다.');
    assert.equal(await notice().count(),0,'같은 화면에 머무르는 동안 복귀 알림을 띄우지 않습니다.');

    await page.evaluate(title=>{
      const proof={focusAt:0,visibleAt:0,appeared:[]},seen=new WeakSet();
      window.flowriumReturnProof=proof;
      window.addEventListener('focus',()=>{proof.focusAt||=performance.now();});
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')proof.visibleAt||=performance.now();});
      new MutationObserver(()=>{
        for(const element of document.querySelectorAll('.flow-question-notice')){
          if(element.getAttribute('aria-label')!==title||seen.has(element))continue;
          seen.add(element);proof.appeared.push(performance.now());
        }
      }).observe(document.querySelector('.flow-notice-stack'),{childList:true,subtree:true});
    },resumeTitle);
    const away=await app.evaluate(async ({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows()[0];
      window.hide();
      return {hidden:!window.isVisible(),focused:window.isFocused(),
        renderer:await window.webContents.executeJavaScript('({visible:document.visibilityState,focused:document.hasFocus()})')};
    });
    assert(away.hidden,'시험 창이 실제로 다른 화면 뒤로 사라집니다. '+JSON.stringify(away));
    await focusApp();
    await page.waitForFunction(()=>document.visibilityState==='visible'&&document.hasFocus(),null,{polling:25,timeout:2000});
    const nativeReturn=await page.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const {focusAt,visibleAt}=window.flowriumReturnProof;
      if(focusAt||visibleAt)return true;
      window.dispatchEvent(new FocusEvent('focus'));
      return false;
    });
    await notice().waitFor({timeout:2000});
    const proof=await page.evaluate(()=>window.flowriumReturnProof);
    const latency=proof.appeared[0]-Math.min(proof.focusAt||Infinity,proof.visibleAt||Infinity);
    assert(proof.appeared.length===1&&latency>=0&&latency<1100,'창 복귀 뒤 1초 안팎에 알림이 한 번 표시됩니다. '+JSON.stringify(proof));
    assert((await notice().innerText()).includes('회의'));
    assert(!(await notice().innerText()).includes(memo));
    await notice().getByRole('button',{name:'업무 재개',exact:true}).click();
    await notice().waitFor({state:'detached'});
    await resume().waitFor();

    const pauseRows=()=>resume().locator('.dashboard-work-resume-row[data-status="pause"]');
    const closedHeights=[];
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await settledLayout(resume());
      assert.equal(await pauseRows().count(),2,'선택한 두 프로젝트의 원본 마감 기록을 표시합니다.');
      for(const project of projects){
        const row=pauseRows().filter({hasText:project.name});
        assert.equal(await row.count(),1);
        assert.match(await row.innerText(),/회의 \/ 작성 완료/);
        assert((await row.innerText()).includes(closeTitle));
      }
      const geometry=await pauseRows().evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,client:row.clientWidth,scroll:row.scrollWidth})));
      assert(Math.abs(geometry[0].height-geometry[1].height)<=1&&geometry.every(row=>row.scroll<=row.client+1),'마감 기록의 높이와 가로 경계를 맞춥니다. '+JSON.stringify({width,geometry}));
      closedHeights.push({width,height:geometry[0].height});
    }
    await page.setViewportSize({width:1440,height:1000});
    const revealMemo=()=>resume().getByRole('button',{name:'복귀 메모 보기',exact:true});
    assert.equal(await resume().getByText(memo,{exact:true}).count(),0,'복귀 메모는 처음에 숨겨져 있습니다.');
    await revealMemo().click();
    await resume().getByText(memo,{exact:true}).waitFor();
    if(process.env.FLOWRIUM_RESUME_SCREENSHOT){
      await fs.mkdir(path.dirname(process.env.FLOWRIUM_RESUME_SCREENSHOT),{recursive:true});
      await page.screenshot({path:process.env.FLOWRIUM_RESUME_SCREENSHOT});
    }
    await resume().getByRole('button',{name:'복귀 메모 닫기',exact:true}).click();
    assert.equal(await resume().getByText(memo,{exact:true}).count(),0);
    const header=page.locator('.conversation-dock .session-heading');
    for(const project of projects){
      await pauseRows().filter({hasText:project.name}).click();
      await header.getByRole('heading',{name:closeTitle,exact:true}).waitFor();
      await header.locator('.eyebrow').filter({hasText:project.name}).waitFor();
      const source=endings.find(session=>session.projectId===project.id).messages.find(message=>message.role==='user');
      await page.locator(`.conversation-dock [data-message-id="${source.id}"]`).waitFor();
    }

    await page.evaluate(()=>{
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const returned=await workflow();
    assert.equal(returned.workClose.returnPending,false);
    assert.equal(returned.notifications.filter(item=>item.kind==='work-resume').length,1);
    assert.equal((await page.evaluate(()=>window.flowriumReturnProof.appeared)).length,1);
    await page.locator('.header-decisions').click();
    const attention=page.getByRole('dialog',{name:'알림',exact:true});
    const noticeRows=attention.locator('.attention-item').filter({hasText:resumeTitle});
    await noticeRows.waitFor();
    assert.equal(await noticeRows.count(),1);
    assert(!(await attention.innerText()).includes(memo));
    await attention.getByRole('button',{name:'알림 닫기',exact:true}).click();
    await attention.waitFor({state:'detached'});

    const pin='4702';
    await page.evaluate(pin=>window.flowrium.setSecurityPin('',pin),pin);
    await app.close(); app=undefined;
    await launch();
    await focusApp();
    await page.getByRole('heading',{name:'화면 잠금',exact:true}).waitFor();
    await assert.rejects(page.evaluate(batchId=>window.flowrium.workflowAction({action:'readWorkClose',batchId}),batchId),/잠겼습니다/);
    assert.equal(await page.getByText(memo,{exact:true}).count(),0);
    await page.getByLabel('잠금 번호',{exact:true}).fill(pin);
    await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
    await page.locator('.security-lock-layer').waitFor({state:'detached'});
    await waitDashboard();
    await toolbar().getByRole('button',{name:'업무 재개',exact:true}).click();
    await pauseRows().first().waitFor();
    assert.equal(await pauseRows().count(),2);
    assert.equal(await resume().getByText(memo,{exact:true}).count(),0);
    await revealMemo().click();
    await resume().getByText(memo,{exact:true}).waitFor();
    assert.equal(await notice().count(),0,'재실행 후 이미 확인한 복귀 알림을 반복하지 않습니다.');
    assert.equal((await workflow()).notifications.filter(item=>item.kind==='work-resume').length,1);
    assert.deepEqual(errors, []);
    console.log('보고와 마감 실제 앱 팝업 / 중앙 위치와 본문 포털 / 원래 화면 유지 / 1440·800·390폭 / 계정 실제 모델·지원 추론 강도 / 모델 변경 초기화 / AI 보고 생성 / 기록 열기 / 프로젝트별 AI 마감 / 실제 요청 전달 검증 통과');
    console.log('마감 사유와 모델 요청 분리 / 창 복귀 알림 '+Math.round(latency)+'ms'+(nativeReturn?' (실제 포커스·가시성 이벤트)':' (자동화 포커스 이벤트 재현)')+' / 동일 높이 '+JSON.stringify(closedHeights)+' / 두 원본 마감 기록 / 메모 명시 조회·잠금 차단·재시작 보존 / 알림 한 건 확인');
  } catch (error) { if (page && !page.isClosed()) console.error('실패 시 실제 화면', await page.locator('body').innerText().catch(() => '')); throw error; }
  finally { if (app) await app.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
