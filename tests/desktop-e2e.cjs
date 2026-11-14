const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { _electron: electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
const root = path.resolve(__dirname, "..");
async function waitForSession(page, title, test) {
  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    const session = await page.evaluate(async name =>
      (await window.flowrium.bootstrap()).sessions.find(s => s.title === name), title);
    if (session && test(session)) return;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error(title + "의 저장 결과를 기다리다 시간이 초과됐습니다.");
}

async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-e2e-"));
  const profile = path.join(temp, "profile");
  const project = path.join(temp, "검증 & 프로젝트");
  const store = new Store(profile);
  await fs.mkdir(project);
  await store.load();
  await store.saveSettings({ codexPath: path.join(__dirname, "backend-fake-codex.cjs") });
  const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, "codex") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app;
  const launch = async () => {
    app = await electron.launch({args: [root], env, timeout: 45000});
    const page = await app.firstWindow();await page.setViewportSize({width:1440,height:1000});
    page.setDefaultTimeout(16000);
    return page;
  };
  try {
    let page = await launch();
    const btn = name => page.getByRole("button", { name, exact: true });
    const sidebar = () => page.locator(".workspace-side");
    const closeDockOverlay=async()=>{const scrim=page.locator('.dock-mobile-scrim');if(await scrim.isVisible()){const dock=page.locator('.conversation-dock');if(await dock.getAttribute('data-phase')!=='exit')await dock.getByRole('button',{name:'대화함 접기',exact:true}).click();await scrim.waitFor({state:'hidden'});}};
    const goDashboard = async () => { await closeDockOverlay(); await sidebar().hover(); await sidebar().getByRole("button",{name:"대시보드",exact:true}).click(); };
    const goHome = async () => { await goDashboard(); await btn("업무 보드").click(); };
    const projectTabs = () => page.getByRole("navigation",{name:"프로젝트 상세 탭"});
    const goProject = async () => { await closeDockOverlay(); await sidebar().hover(); await sidebar().locator(".side-project").first().click(); };
    await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='false');
    await sidebar().hover();
    await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');
    await page.mouse.move(600,100);
    await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='false');
    await sidebar().hover();
    await sidebar().getByRole('button',{name:'메뉴 고정',exact:true}).click();
    await page.mouse.move(600,100);
    assert.equal(await sidebar().getAttribute('data-pinned'),'true');
    assert.equal(await sidebar().getAttribute('data-expanded'),'true');
    await app.evaluate(({ dialog }, selection) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths:[selection]});
    }, project);
    await btn("프로젝트 폴더 선택").click();
    await page.locator("[data-work-kind=task]").waitFor();
    await page.locator(".settings-button").click();
    await page.locator(".settings-section").filter({has:page.getByRole("heading",{name:"Codex 연결",exact:true})}).getByRole("button",{name:"연결 확인",exact:true}).click();
    await page.getByRole("dialog",{name:"설정"}).getByText("ChatGPT / pro", { exact: true }).waitFor();
    await page.getByLabel("설정 닫기").click();
    for (const kind of ["research", "briefing", "weekly", "document", "pause", "task"]) {
      await page.locator(`[data-work-kind=${kind}]`).click();
      const form = page.locator(".wb-form form");
      await form.locator("input").first().fill("화면 검증 " + kind);
      await form.locator("textarea").fill("선택한 역할과 프로젝트 기록으로 확인해 주세요.");
      await btn("업무 시작").click();
      await waitForSession(page,"화면 검증 "+kind,s=>s.messages.some(m=>m.role==="assistant" && m.text.includes("확인한 결과")));
      await page.locator('.conversation-dock').getByRole("heading",{name:"화면 검증 "+kind,exact:true}).waitFor();
      assert.equal(await page.locator('.app-shell').getAttribute('data-chat-focus'),'false','대화는 우측에 고정되고 본 화면 유지');
      assert(await form.isVisible(),'대화를 열어도 가운데 업무 설정 화면 유지');
      assert.equal(await form.locator('input').first().inputValue(),'화면 검증 '+kind,'가운데 업무 설정 입력도 보존');
      if (kind === "research") {
        await btn("리서치 / 진행 중").click();
        await page.getByLabel("새 체크리스트 항목").fill("근거 확인");
        await btn("추가").click();
        await page.getByRole("checkbox",{name:"근거 확인"}).click();
        await page.locator(".wb-check input:checked").waitFor();
        await btn("답변을 산출물로 저장").click();
        await page.locator(".wb-notice").waitFor();
        await btn("검토로 이동").click();
        await btn("업무 완료").click();
        await btn("리서치 / 완료").waitFor();
        await btn("업무 재개").click();
        await btn("리서치 / 진행 중").waitFor();
      }
      await goHome();
    }
    const snapshot = () => page.evaluate(() => window.flowrium.bootstrap());
    const sessions = (await snapshot()).sessions;
    assert.equal(sessions.length, 6);
    assert.equal(new Set(sessions.map(s=>s.threadId)).size, 6);
    for (const session of sessions) {
      assert.equal(session.workflow.brief,"선택한 역할과 프로젝트 기록으로 확인해 주세요.", session.title+" 업무 지시 저장");
      assert(session.messages.some(m=>m.role==="assistant"),session.title+" 응답 저장");
    }
    await page.getByRole("navigation",{name:"작업실 화면"}).getByRole("button",{name:"산출물",exact:true}).click();
    await page.locator(".wb-file-row, .wb-line-item").filter({hasText:"화면 검증 research"}).first().click();
    await btn("원본 대화").click();
    await btn("대화 관리").click();
    await page.getByLabel("이 대화의 모델").selectOption("test-model");
    await page.getByLabel("이 대화의 추론 강도").selectOption("low");
    const chatAddress="https://chatgpt.com/c/11111111-2222-3333-4444-555555555555";
    await page.getByLabel("이어갈 ChatGPT 대화 주소").fill(chatAddress);
    await btn("대화 연결 설정 저장").click();
    await page.locator(".conversation-popover").waitFor({state:"hidden"});
    await app.evaluate(({shell})=>{shell.openExternal=async value=>{globalThis.flowriumTestExternal=value;};});
    await page.locator(".dock-chatgpt-button").click();
    assert.equal(await app.evaluate(()=>globalThis.flowriumTestExternal),chatAddress);
    await btn("대화 관리").click();
    await btn("여기까지 새 대화로 분기").click();
    await page.getByRole("heading",{name:"분기 / 화면 검증 research",exact:true}).waitFor();
    await btn("대화 관리").click();
    await page.getByLabel("대화 이름",{exact:true}).fill("되감기 시험");
    await btn("이름 저장").click();
    await page.getByRole("heading",{name:"되감기 시험",exact:true}).waitFor();
    await page.locator(".conversation-popover").waitFor({state:"hidden"});
    await btn("대화 관리").click();
    await page.getByLabel("기준 요청").selectOption({index:1});
    await btn("이 요청 전으로 되감기").click();
    await btn("되감기 확인").click();
    await waitForSession(page,"되감기 시험",s=>s.messages.length === 0);
    await app.close(); app = undefined;
    page = await launch();
    await page.getByRole("heading",{name:"프로젝트 대시보드"}).waitFor();
    await page.locator(".pf-row").filter({hasText:"화면 검증 task"}).click();
    const composer=page.getByLabel("Codex에 보낼 작업 요청");
    await composer.fill("승인검증");
    await composer.press("Enter");
    await page.locator(".approval-card").waitFor();
    await goDashboard();
    await page.getByRole("button",{name:/^승인함/}).click();
    await page.locator('.inbox-page').getByRole('button',{name:'이번 작업 승인',exact:true}).click();
    await waitForSession(page,"화면 검증 task",s=>s.messages.some(m=>m.role==="assistant"&&m.text.includes("accept")));
    const restored = (await snapshot()).sessions;
    assert.equal(restored.length, 7);
    const research = restored.find(s=>s.title==="화면 검증 research");
    assert.equal(research.workflow.checklist[0].done, true);
    assert(research.messages.some(m=>m.role==="assistant"));
    await goProject();await projectTabs().getByRole("button",{name:"프로젝트 설정",exact:true}).click();
    await page.locator(".project-details summary").click();
    await page.getByLabel("프로젝트 담당자").fill("검증 담당");
    await page.getByLabel("프로젝트 목표").fill("공개 앱 검증");
    await btn("상세 정보 저장").click();
    await page.getByLabel("새 프로젝트 체크리스트 항목").fill("설치 확인");
    await btn("항목 추가").click();
    await page.getByRole("checkbox",{name:"설치 확인"}).click();
    await page.locator(".project-details input:checked").waitFor();
    await btn("프로젝트 보관").click();
    await btn("프로젝트 재개").click();
    await btn("프로젝트 보관").waitFor();
    await goDashboard();await btn("작업 현황").click();
    await page.getByText("전체 CPU 사용률", {exact:true}).waitFor();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+1" : "Control+1");
    await page.locator("[data-work-kind=research]").waitFor();
    await goProject();await projectTabs().getByRole("button",{name:"팀",exact:true}).click();
    await btn("팀 만들기").click();
    await page.getByLabel("팀 이름").fill("시험 팀");
    await btn("팀 저장").click();
    await page.getByLabel("공동 요청").fill("시험 프로젝트의 요구와 검증 기준을 확인해 주세요.");
    await page.getByLabel("업무 배정 방식").selectOption("shared");
    await btn("팀 실행").click();
    await page.locator(".team-result small").filter({hasText:"완료"}).nth(1).waitFor();
    await btn("역할 대화 열기").first().click();
    await page.locator(".messages .assistant").first().waitFor();
    await require("./activity-ui.cjs").verifyActivityUI(page);
    await require("./update-ui.cjs").verifyUpdateUI(app,page);
    console.log("실제 앱 검증 통과 / 메뉴 펼침·접힘·고정 / 프로젝트 선택 / 로그인 연결 모의 응답 / 여섯 업무의 독립 요청과 답변 / 오른쪽 대화와 가운데 업무 보드 유지 / 체크리스트 / 검토·완료·재개 / 산출물 및 원본 / 분기·이름·되감기 / 앱 재실행 복원 / 프로젝트 보관·재개 / 팀 역할 병렬 실행 / 승인함 / 업데이트 버튼");
  } catch(error) {
    if(app) console.error("화면 검증 진단:",await (await app.firstWindow()).locator("body").innerText().then(t=>t.slice(-1800)).catch(()=>"화면 닫힘"));
    throw error;
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive:true, force:true, maxRetries:6, retryDelay:220 });
  }
}
run().catch(e=>{ console.error(e); process.exitCode=1; });
