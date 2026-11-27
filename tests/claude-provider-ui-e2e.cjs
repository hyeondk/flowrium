const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { closeSettings, dockHome, openConversation } = require('./shell-test-helpers.cjs');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-claude-ui-'));
  const profile = path.join(temp, 'profile');
  const codexHome = path.join(temp, 'codex');
  const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: codexHome };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  let app;
  try {
    await fs.mkdir(codexHome);
    const store = new Store(profile);
    await store.load();
    const directory = path.join(temp, '시험 프로젝트');
    await fs.mkdir(directory);
    const project = await store.addProject(directory);
    const now = new Date().toISOString();
    const codexReplyId = randomUUID(), claudeReplyId = randomUUID();
    const session = await store.createSession(project.id, { title: 'AI 서비스 변경 확인', messages: [
      { id: randomUUID(), role: 'user', text: '이미 있는 업무 요청', createdAt: now },
      { id: codexReplyId, role: 'assistant', text: 'Codex 시험 답변', createdAt: now },
      { id: claudeReplyId, role: 'assistant', provider: 'claude', text: 'Claude 시험 답변', createdAt: now },
    ] });
    const fixture = path.join(temp, 'codex-without-account.cjs');
    const fakeCodex = path.resolve(__dirname, 'backend-fake-codex.cjs');
    await fs.writeFile(fixture, `process.argv.push('--no-account');require(${JSON.stringify(fakeCodex)});\n`, { mode: 0o755 });
    await store.saveSettings({ codexPath: fixture, providerSetupPending: true });

    app = await _electron.launch({ args: [path.resolve(__dirname, '..')], env });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    page.setDefaultTimeout(12000);
    await app.evaluate(({ ipcMain }) => {
      const state = { configured: false, connected: false, models: [] };
      globalThis.claudeUiTest = { sent: [], trusted: [], codexChecks: 0, allowCodex: false, credentialActions: [] };
      function mock(name, handler) {
        const channel = 'flowrium:' + name;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
      mock('readClaudeConnection', () => state);
      mock('checkClaudeConnection', () => state);
      mock('configureClaude', (_event, input) => {
        globalThis.claudeUiTest.credentialActions.push(input.remove ? 'removed' : 'configured');
        state.configured = state.connected = input.apiKey === '가상 키 값';
        state.models = state.connected ? [
          { id: 'claude-sonnet-fixture', displayName: 'Claude Sonnet 시험 모델', isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
          { id: 'claude-low-fixture', displayName: 'Claude Low 전용 모델',
            supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
        ] : [];
        return state;
      });
      mock('readChatConnection', () => {
        globalThis.claudeUiTest.codexChecks++;
        if (globalThis.claudeUiTest.allowCodex) return { ready: true };
        return { ready: false, reason: 'login', message: '시험에서는 Codex 로그인을 하지 않았습니다.', desktopInstalled: false };
      });
      mock('requestProjectTrust', (_event, id, provider) => {
        globalThis.claudeUiTest.trusted.push({ id, provider });
        return true;
      });
      mock('send', (_event, input) => {
        globalThis.claudeUiTest.sent.push(input);
        return { accepted: true };
      });
    });

    async function settings() {
      await page.locator('.settings-button').click();
      const dialog = page.getByRole('dialog', { name: '설정', exact: true });
      await dialog.getByRole('button', { name: '계정과 모델', exact: true }).click();
      return dialog;
    }
    const service = page.getByRole('combobox', { name: '이 채팅의 AI 서비스', exact: true });
    const chooseService = async (name) => {
      await service.click();
      await page.getByRole('listbox', { name: '이 채팅의 AI 서비스', exact: true })
        .getByRole('option', { name, exact: true }).click();
    };
    const setup = page.getByRole('region', {name:'AI 대화 구성 선택', exact:true});
    await setup.getByRole('button', {name:/별도 구성/}).click();
    await setup.waitFor({state:'hidden'});
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).settings.providerMode === 'mixed');
    await openConversation(page, session.title);
    assert.equal(await service.count(), 0, '기본값은 Claude 꺼짐');
    const codexReply = page.locator(`[data-message-id="${codexReplyId}"][data-provider="codex"]`);
    const claudeReply = page.locator(`[data-message-id="${claudeReplyId}"][data-provider="claude"]`);
    await codexReply.getByText('Codex', { exact: true }).waitFor();
    await claudeReply.getByText('Claude', { exact: true }).waitFor();
    for (const [reply, selector] of [[codexReply, '.codex-avatar'], [claudeReply, '.claude-avatar']]) {
      const icon=reply.locator(selector);
      await icon.waitFor();
      assert(await icon.evaluate(image=>image.decode().then(()=>image.naturalWidth>0)));
    }

    let dialog = await settings();
    const switchLabel = { name: 'Claude 사용', exact: true };
    assert.equal(await dialog.getByRole('switch', switchLabel).isChecked(), false);
    await dialog.getByRole('switch', switchLabel).check();
    await dialog.getByLabel('Anthropic API 키', { exact: true }).fill('가상 키 값');
    await dialog.getByRole('button', { name: 'API 키 연결', exact: true }).click();
    await dialog.getByText('Claude에 연결됨', { exact: true }).waitFor();
    await dialog.getByLabel('기본값을 편집할 AI 서비스', { exact: true }).selectOption('claude');
    const defaultModel=dialog.getByLabel('기본 모델', { exact: true });
    const defaultEffort=dialog.getByLabel('추론 수준', { exact: true });
    const waitDefault=async (model,effort)=>page.waitForFunction(async ({model,effort})=>{
      const settings=(await window.flowrium.bootstrap()).settings;
      return (settings.claudeModel??'')===model&&(settings.claudeEffort??'')===effort;
    },{model,effort});
    await defaultEffort.selectOption('high');
    await waitDefault('','high');
    await defaultModel.selectOption('claude-low-fixture');
    await waitDefault('claude-low-fixture','');
    await page.waitForFunction(() => document.querySelector('select[aria-label="추론 수준"]')?.value === '');
    await defaultEffort.selectOption('low');
    await waitDefault('claude-low-fixture','low');
    await defaultEffort.selectOption('');
    await waitDefault('claude-low-fixture','');
    await defaultModel.selectOption('');
    await waitDefault('','');
    await defaultEffort.selectOption('high');
    await waitDefault('','high');
    await closeSettings(page);

    await chooseService('Claude');
    const draft = page.getByLabel('Claude에 보낼 작업 요청', { exact: true });
    await draft.waitFor();
    await page.getByText('Claude로 보내면 최근 대화 내용이 Anthropic으로 전송됩니다.', { exact: false }).waitFor();
    const model = page.getByRole('combobox', { name: '이 채팅의 모델', exact: true });
    const chooseModel=async (name)=>{
      await model.click();
      await page.getByRole('listbox',{name:'이 채팅의 모델',exact:true}).getByRole('option',{name,exact:true}).click();
    };
    await chooseModel('Claude Low 전용 모델');
    const reasoning=page.getByRole('button',{name:'Reasoning effort',exact:true});
    assert.equal(await reasoning.innerText(),'Default');
    await reasoning.click();
    const performance = page.getByRole('group', { name: 'Model controls', exact: true });
    assert.equal(await performance.getByRole('button', { name: 'Speed', exact: true }).count(), 0);
    const slider = performance.getByRole('slider', { name: 'Reasoning effort', exact: true });
    assert.equal(await slider.getAttribute('aria-valuetext'),'Default');
    assert.equal(await slider.getAttribute('max'),'1');
    const waitEffort=async effort=>page.waitForFunction(async ({id,effort})=>
      (await window.flowrium.bootstrap()).sessions.find(row=>row.id===id)?.preferences?.effort===effort,{id:session.id,effort});
    await slider.press('ArrowRight');
    await waitEffort('low');
    assert.equal(await reasoning.innerText(),'Low');
    await performance.getByRole('button',{name:'기본값으로 복구',exact:true}).click();
    await waitEffort(undefined);
    assert.equal(await reasoning.innerText(),'Default');
    await slider.press('Escape');
    await draft.fill('이 대화의 Claude 모델 기본 추론 수준으로 요청해 줘.');
    await page.getByRole('button', { name: '작업 보내기', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Claude에 보낼 작업 요청"]').value);
    await chooseModel('Claude Sonnet 시험 모델');
    await reasoning.click();
    assert.equal(await slider.getAttribute('aria-valuetext'),'Default (High)');
    await slider.press('End');
    await waitEffort('high');
    await slider.press('Escape');

    await draft.fill('같은 대화에서 이 내용을 Claude로 이어서 보내 줘.');
    await page.getByRole('button', { name: '작업 보내기', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Claude에 보낼 작업 요청"]').value);
    const calls = await app.evaluate(() => globalThis.claudeUiTest);
    assert.equal(calls.codexChecks, 0);
    assert.deepEqual(calls.trusted, Array.from({length:2},()=>({id:project.id,provider:'claude'})));
    assert.equal(calls.sent.length, 2);
    for (const [key,value] of Object.entries({sessionId:session.id,provider:'claude',model:'claude-low-fixture',effort:undefined})) {
      assert.equal(calls.sent[0][key],value,key);
    }
    for (const [key, value] of Object.entries({ sessionId: session.id, provider: 'claude', model: 'claude-sonnet-fixture', effort: 'high' })) {
      assert.equal(calls.sent[1][key], value, key);
    }
    assert.deepEqual(calls.credentialActions, ['configured']);
    assert.deepEqual((await page.evaluate(() => window.flowrium.bootstrap())).sessions.map(session => session.id), [session.id]);

    const emit = details => app.evaluate(({BrowserWindow}, input) => BrowserWindow.getAllWindows()[0].webContents.send('flowrium:event',input), {sessionId:session.id,...details});
    const sendClaudeStreaming = {id:randomUUID(),createdAt:now,provider:'claude'};
    await emit({type:'status',status:'running',provider:'claude',runningProviders:['claude']});
    await emit({type:'delta',provider:'claude',text:'Claude 동시 답변',streamingMessage:sendClaudeStreaming,runningProviders:['claude']});
    const active = page.getByRole('status', {name:'AI 서비스 작업 상태',exact:true});
    await active.getByText('Claude 작업 중', {exact:true}).waitFor();
    await page.getByRole('button',{name:'작업 중지',exact:true}).waitFor();
    await app.evaluate(()=>{globalThis.claudeUiTest.allowCodex=true;});
    await chooseService('Codex');
    const codexDraft = page.getByLabel('Codex에 보낼 작업 요청', { exact: true });
    await codexDraft.waitFor();
    await codexDraft.fill('Claude가 답하는 동안 Codex에도 보내 줘.');
    await page.getByRole('button',{name:'작업 보내기',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="Codex에 보낼 작업 요청"]').value);
    const parallelCalls = await app.evaluate(()=>globalThis.claudeUiTest);
    assert.deepEqual(parallelCalls.sent.map(row=>[row.sessionId,row.provider,row.delivery]), [[session.id,'claude',undefined],[session.id,'claude',undefined],[session.id,'codex',undefined]]);
    const sendCodexStreaming={id:randomUUID(),createdAt:now};
    await emit({type:'status',status:'running',provider:'codex',runningProviders:['claude','codex']});
    await emit({type:'delta',provider:'codex',text:'Codex 동시 답변',streamingMessage:sendCodexStreaming,runningProviders:['claude','codex']});
    await active.getByText('Claude 작업 중', {exact:true}).waitFor();
    await active.getByText('Codex 작업 중', {exact:true}).waitFor();
    await page.locator(`[data-message-id="${sendClaudeStreaming.id}"][data-provider="claude"]`).waitFor();
    await page.locator(`[data-message-id="${sendCodexStreaming.id}"][data-provider="codex"]`).waitFor();
    await emit({type:'done',provider:'claude',runningProviders:['codex']});
    await active.getByText('Claude 작업 중',{exact:true}).waitFor({state:'hidden'});
    await active.getByText('Codex 작업 중',{exact:true}).waitFor();
    await emit({type:'done',provider:'codex',runningProviders:[]});
    await active.waitFor({state:'hidden'});
    await page.getByText('Codex로 보내면 최근 Claude 대화가 요청의 참고 내용으로 전달됩니다.', { exact: true }).waitFor();
    await codexReply.getByText('Codex', { exact: true }).waitFor();
    await claudeReply.getByText('Claude', { exact: true }).waitFor();
    dialog = await settings();
    await dialog.getByRole('combobox', { name: 'AI 대화 구성', exact: true }).selectOption('sync');
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).settings.providerMode === 'sync');
    await closeSettings(page);
    const dock = await dockHome(page);
    const tabs = dock.getByRole('group', { name: '대화 AI 서비스', exact: true });
    assert.equal(await tabs.getByRole('button', { name: 'Codex', exact: true }).getAttribute('aria-pressed'), 'true');
    await dock.locator('.dock-project-row').filter({ hasText: project.name }).click();
    await dock.locator('.dock-session').getByText(session.title, { exact: true }).waitFor();
    await tabs.getByRole('button', { name: 'Claude', exact: true }).click();
    await dock.locator('.dock-session').getByText(session.title, { exact: true }).waitFor({state:'hidden'});
    await dock.getByRole('button', { name: '새 대화', exact: true }).click();
    await draft.waitFor();
    const claudeDraft = (await page.evaluate(() => window.flowrium.bootstrap())).sessions.find(row => row.id!==session.id);
    assert.equal(claudeDraft?.preferences?.provider ?? claudeDraft?.provider, 'claude');
    assert.equal(await service.count(),0,'동기화 구성은 대화함 상단에서 서비스를 선택');
    await tabs.getByRole('button', { name: 'Codex', exact: true }).click();
    await dock.locator('.dock-session').getByText(session.title, { exact: true }).click();
    await page.getByLabel('Codex에 보낼 작업 요청', { exact: true }).waitFor();
    dialog = await settings();
    await dialog.getByRole('switch', switchLabel).uncheck();
    await page.waitForFunction(async () => (await window.flowrium.bootstrap()).settings.claudeEnabled === false);
    await closeSettings(page);
    assert.equal(await service.count(), 0);
    await tabs.getByRole('button', { name: 'Claude', exact: true }).waitFor();
    await claudeReply.getByText('Claude', { exact: true }).waitFor();
    console.log('Claude 기본 꺼짐, 계정 연결, 동일 대화의 서비스/모델/추론 전송, 기록별 표시, 꺼짐 복원 검증 완료');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
