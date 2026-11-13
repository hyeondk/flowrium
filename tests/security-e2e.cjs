const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const {closeSettings}=require("./shell-test-helpers.cjs");
const { Store } = require("../electron/store.cjs");

async function run() {
  const tmp = await fs.mkdtemp(
    path.join(os.tmpdir(), "flowrium-security-screen-"),
  );
  const profile = path.join(tmp, "profile"),
    folder = path.join(tmp, "잠금 검증 프로젝트");
  await fs.mkdir(folder);
  const store = new Store(profile);
  await store.load();
  const project = await store.addProject(folder);
  const session = await store.createSession(project.id);
  await store.saveSettings({
    codexPath: path.join(__dirname, "backend-fake-codex.cjs"),
  });
  const env = {
    ...process.env,
    FLOWRIUM_USER_DATA: profile,
    CODEX_HOME: path.join(tmp, "codex"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app, page;
  const btn = (name) => page.getByRole("button", { name, exact: true });
  async function launch() {
    app = await _electron.launch({
      args: [path.resolve(__dirname, "..")],
      env,
      timeout: 45000,
    });
    page = await app.firstWindow();await page.setViewportSize({width:1440,height:1000});
    page.setDefaultTimeout(15000);
  }
  async function unlock() {
    await page.getByLabel("잠금 번호", { exact: true }).fill("7904");
    await btn("잠금 해제").click();
    await page
      .locator(".pf-card")
      .filter({ hasText: "잠금 검증 프로젝트" })
      .waitFor();
  }
  try {
    await launch();
    await btn("설정").click();
    await btn("사용량 조회").click();
    await page.getByText("5시간 한도 / 37% 사용").waitFor();
    await page.getByLabel("새 잠금 번호", { exact: true }).fill("7904");
    await page.getByLabel("새 번호 확인").fill("7904");
    await btn("잠금 번호 설정").click();
    await page.getByText("잠금 번호를 저장했습니다.").waitFor();
    await page.getByLabel("자리 비움 자동 잠금").selectOption("5");
    await page.waitForFunction(
      async () =>
        (await window.flowrium.securityState()).preferences?.idleMinutes === 5,
    );
    await closeSettings(page);
    const personal=await page.evaluate(()=>window.flowrium.createHubConversation({scope:'general',title:'잠금 중 내보내기 보호'}));
    const blockedExport=path.join(tmp,'잠금 중 생성되면 안 되는 대화.md');
    await app.evaluate(({dialog})=>{globalThis.flowriumSaveTest={original:dialog.showSaveDialog,release:null};dialog.showSaveDialog=()=>new Promise(resolve=>{globalThis.flowriumSaveTest.release=resolve;});});
    const pendingExport=page.evaluate(id=>window.flowrium.exportSession(id),personal.id).then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}));
    for(let attempt=0;attempt<150;attempt++){if(await app.evaluate(()=>typeof globalThis.flowriumSaveTest.release==='function'))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(await app.evaluate(()=>typeof globalThis.flowriumSaveTest.release),'function');
    await assert.rejects(page.evaluate(()=>window.flowrium.logoutSecurity()),/진행 중/);
    await page.evaluate(()=>window.flowrium.lockSecurity());
    await app.evaluate((_,file)=>{globalThis.flowriumSaveTest.release({canceled:false,filePath:file});},blockedExport);
    const exportResult=await pendingExport;assert.equal(exportResult.ok,false);assert.match(exportResult.error,/잠겼|계정|상태/);
    await assert.rejects(fs.access(blockedExport),{code:'ENOENT'});
    await app.evaluate(({dialog})=>{dialog.showSaveDialog=globalThis.flowriumSaveTest.original;delete globalThis.flowriumSaveTest;});
    await page.evaluate(()=>window.flowrium.unlockSecurity('7904'));
    await page.locator('.pf-card').filter({hasText:'잠금 검증 프로젝트'}).waitFor();
    await page.evaluate(async (id) => {
      await window.flowrium.send({
        sessionId: id,
        mode: "build",
        text: "승인검증",
      });
    }, session.id);
    await page.waitForFunction(async () =>
      (await window.flowrium.securityPending()).some(
        (e) => e.type === "approval",
      ),
    );
    await assert.rejects(
      page.evaluate(() => window.flowrium.logoutSecurity()),
      /진행 중/,
    );
    await btn("잠금").click();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    assert(
      !(await page.locator("body").innerText()).includes("잠금 검증 프로젝트"),
    );
    for (const key of [
      "bootstrap",
      "securityPending",
      "readAccountUsage",
      "readPortfolio",
      "logoutSecurity",
      "updateState",
    ]) {
      await assert.rejects(
        page.evaluate((key) => window.flowrium[key](), key),
        /잠겼습니다/,
      );
    }
    await page.getByLabel("잠금 번호", { exact: true }).fill("0000");
    await btn("잠금 해제").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "일치하지 않습니다" })
      .waitFor();
    await unlock();
    await page.getByRole("complementary",{name:"작업 공간 탐색"}).hover();
    await page.locator(".side-project[title*='결정']").waitFor();
    const approval = await page.evaluate(async () =>
      (await window.flowrium.securityPending()).find(
        (e) => e.type === "approval",
      ),
    );
    await page.evaluate(
      (q) =>
        window.flowrium.approval({
          requestId: q.requestId,
          decision: "decline",
        }),
      approval,
    );
    await page.waitForFunction(
      async (id) =>
        (await window.flowrium.bootstrap()).sessions
          .find((s) => s.id === id)
          ?.messages.some((m) => m.role === "assistant"),
      session.id,
    );
    await btn("로그아웃").click();
    await btn("취소").click();
    assert(
      (await page.evaluate(() => window.flowrium.connectionStatus()))
        .authenticated,
    );
    await btn("로그아웃").click();
    await btn("로그아웃 확인").click();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    await unlock();
    await page.waitForFunction(
      async () => !(await window.flowrium.connectionStatus()).authenticated,
    );
    assert(
      (await page.evaluate(() => window.flowrium.bootstrap())).sessions.find(
        (s) => s.id === session.id,
      ).messages.length > 1,
    );
    await app.close();
    app = null;
    await launch();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    await unlock();
    assert.equal(
      (await page.evaluate(() => window.flowrium.securityState())).preferences
        .idleMinutes,
      5,
    );
    console.log(
      "실제 앱 보안 화면 통과 / 사용량 / PIN 등록과 오입력 / 저장 창 대기 중 잠금 후 개인 대화 내보내기와 파일 생성 차단 / 잠금 중 IPC 차단 / 승인 복원 / 로그아웃 확인과 기록 보존 / 앱 재시작 잠금",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(tmp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    });
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
