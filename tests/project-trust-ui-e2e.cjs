const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { composer, dockHome, openConversation, newProjectConversation,waitForCodexConnection} = require('./shell-test-helpers.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-project-trust-ui-')));
  const profile = path.join(temp, 'profile');
  const env = {...process.env, FLOWRIUM_USER_DATA:profile, CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const projectFolder = path.join(temp, '이전 프로젝트');
  const secondFolder = path.join(temp, '새 프로젝트');
  let app, page;
  async function launch() {
    app = await _electron.launch({args:[root],env,timeout:45000});
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.setViewportSize({width:1440,height:940});
    await waitForCodexConnection(page);
    await app.evaluate(({dialog, BrowserWindow}, folders) => {
      const original = dialog.showMessageBox.bind(dialog);
      globalThis.trustUiTest = {calls:[], decider:null};
      dialog.showMessageBox = (owner, options) => {
        if (options?.title !== '프로젝트 폴더 신뢰') return original(owner, options);
        const actual = options.detail.split('\n').at(-1);
        if (!folders.includes(actual)) throw Error('예상하지 않은 경로의 시험용 창');
        const state = globalThis.trustUiTest;
        state.calls.push({actual,buttons:options.buttons,cancelId:options.cancelId,defaultId:options.defaultId,
          message:options.message,owned:BrowserWindow.getAllWindows().includes(owner)});
        return new Promise(resolve => {
          if (state.decider) throw Error('동시에 열린 신뢰 확인 창');
          state.decider = label => {state.decider = null; resolve({response:options.buttons.indexOf(label)});};
        });
      };
    }, [projectFolder, secondFolder]);
  }
  const snapshot = () => page.evaluate(() => window.flowrium.bootstrap());
  const calls = () => app.evaluate(() => globalThis.trustUiTest.calls);
  const sendButton = () => page.getByRole('button',{name:'작업 보내기',exact:true});
  async function answer(index, folder, label) {
    const deadline = Date.now() + 10000;
    while ((await calls()).length < index && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    const recorded = await calls();
    assert.equal(recorded.length,index);
    const event = recorded[index-1];
    assert.equal(event.actual,folder);
    assert(event.owned && event.message.includes(path.basename(folder)));
    assert.deepEqual(event.buttons, ['취소','신뢰하고 편집 허용']);
    assert.equal(event.cancelId,event.buttons.indexOf('취소'));
    assert.equal(event.defaultId,event.cancelId);
    await app.evaluate(({}, choice) => globalThis.trustUiTest.decider(choice), label);
  }
  async function sentOnce(projectId, text) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const sessions = (await snapshot()).sessions.filter(session=>session.projectId===projectId);
      const own = sessions.find(session=>session.messages.some(m=>m.role==='user'&&m.text===text));
      if (own?.messages.at(-1)?.role === 'assistant') {
        assert.equal(sessions.flatMap(s=>s.messages).filter(m=>m.role==='user'&&m.text===text).length,1);
        return own;
      }
      await new Promise(resolve=>setTimeout(resolve,60));
    }
    throw Error('프로젝트에서 시험 요청의 답변을 찾지 못했습니다. '+await page.locator('body').innerText().then(text=>text.slice(-1000)));
  }
  try {
    const store = new Store(profile);
    await store.load();
    await Promise.all([fs.mkdir(projectFolder),fs.mkdir(secondFolder)]);
    const project = await store.addProject(projectFolder), second = await store.addProject(secondFolder);
    const prior = await store.createSession(project.id,{title:'이전 권한 대화',preferences:{sandbox:'read-only'}});
    const guardFile = path.join(projectFolder,'보존.txt');
    await fs.writeFile(guardFile,'기존 내용');
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    await launch();
    await openConversation(page,prior.title);
    assert.equal((await calls()).length,0);
    assert.equal(await page.getByRole('button',{name:/이 대화에서 프로젝트 편집 허용/}).count(),0);
    const draft = '취소 후 이 문장과 첨부를 한 번만 보내 주세요.';
    await composer(page).fill(draft);
    await page.getByLabel('채팅에 첨부할 파일').setInputFiles({name:'확인.txt',mimeType:'text/plain',buffer:Buffer.from('이전 문서')});
    const attachment = page.locator('.attachment-composer .chat-attachment-list').getByText('확인.txt',{exact:true});
    await attachment.waitFor();
    await sendButton().click();
    await answer(1,projectFolder,'취소');
    await page.waitForFunction(() => !document.querySelector('button[aria-label="작업 보내기"]').disabled);
    assert.equal(await composer(page).inputValue(),draft);
    await attachment.waitFor();
    const afterCancel = await snapshot();
    assert.equal(afterCancel.sessions.length,1);
    assert.equal(afterCancel.sessions[0].messages.length,0);
    assert.equal(await fs.readFile(guardFile,'utf8'),'기존 내용');
    assert.equal(afterCancel.projects.find(p=>p.id===project.id).trustedForFileAccess,false);
    await sendButton().click();
    await answer(2,projectFolder,'신뢰하고 편집 허용');
    const original = await sentOnce(project.id,draft);
    assert.equal(original.id,prior.id);
    const sent = original.messages.find(m=>m.role==='user');
    assert.equal(sent.attachments.length,1);
    assert.equal(sent.attachments[0].name,'확인.txt');
    await newProjectConversation(page, project.id);
    await composer(page).fill('같은 폴더에서 새 대화'); await sendButton().click();
    await sentOnce(project.id,'같은 폴더에서 새 대화');
    assert.equal((await calls()).length,2);
    await app.close(); app=undefined;
    await launch();
    const priorTitle = (await snapshot()).sessions.find(s=>s.id===prior.id).title;
    await openConversation(page,priorTitle);
    await composer(page).fill('다시 실행한 대화'); await sendButton().click();
    await sentOnce(project.id,'다시 실행한 대화');
    assert.equal((await calls()).length,0);
    for (const [scope,label] of [['general','새 일반 대화'],['integrated','새 통합 대화']]) {
      const dock=await dockHome(page);
      await dock.getByRole('button',{name:label,exact:true}).click();
      await composer(page).waitFor();
      const globalSession=(await snapshot()).sessions.find(s=>s.scope===scope);
      const prompt=scope+' 질문';
      await composer(page).fill(prompt); await sendButton().click();
      await sentOnce(globalSession.projectId,prompt);
      assert.equal((await calls()).length,0);
    }
    const beforeReport=(await snapshot()).sessions.length;
    await page.locator('.workspace-side').hover();
    await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'주간업무보고',exact:true}).click();
    const report=page.getByRole('dialog',{name:'주간업무보고'});
    await report.getByRole('button',{name:'전체 선택',exact:true}).click();
    await report.getByLabel('보고서를 저장할 프로젝트').selectOption(project.id);
    const instructions=report.getByLabel('덧붙일 말 선택 사항');
    await instructions.fill('두 폴더의 주간 보고');
    await report.getByRole('button',{name:'ChatGPT로 보고서 작성',exact:true}).click();
    await answer(1,secondFolder,'취소');
    await report.getByRole('button',{name:'ChatGPT로 보고서 작성',exact:true}).waitFor();
    assert.equal(await instructions.inputValue(),'두 폴더의 주간 보고');
    assert.equal(await report.locator('.report-targets input:checked').count(),2);
    assert.equal((await snapshot()).sessions.length,beforeReport);
    await report.getByRole('button',{name:'취소',exact:true}).click();
    await report.waitFor({state:'hidden'});
    await newProjectConversation(page,second.id);
    assert.equal((await calls()).length,1);
    await composer(page).fill('다른 프로젝트 요청'); await sendButton().click();
    await answer(2,secondFolder,'신뢰하고 편집 허용');
    await sentOnce(second.id,'다른 프로젝트 요청');
    assert.equal((await calls()).length,2);
    console.log('프로젝트 첫 전송의 운영체제 승인 창 / 기존 읽기 전용 대화 / 취소 시 원문·첨부·기존 파일 보존 및 전송 0건 / 승인 후 한 번 전송 / 같은 폴더 새 대화와 재시작 / 일반 및 통합 대화 / 다른 폴더 독립 승인 통과');
  } finally {
    if(app) await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
