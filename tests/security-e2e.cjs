const {addTrustedFixtureProject, backendFixtureAccount} = require('./project-trust-fixture.cjs');
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const {expect} = require("playwright/test");
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
  const project = await addTrustedFixtureProject(store, folder, {account: backendFixtureAccount});
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
    page = await app.firstWindow();await page.bringToFront();await page.waitForFunction(()=>document.visibilityState==='visible');await page.setViewportSize({width:1440,height:1000});
    await page.emulateMedia({ reducedMotion: "no-preference" });
    page.setDefaultTimeout(15000);
  }
  async function closeWithMotion(layer, button, name, duration) {
    const probe = await layer.evaluateHandle((element, name) => {
      const result = { started: null, ended: false };
      element.addEventListener('animationend', event => {if(event.target===element && event.animationName===name) result.ended=true;});
      element.addEventListener("animationstart", (event) => {
        if (event.target !== element || event.animationName !== name) return;
        const animation = element.getAnimations().find(item => item.animationName === name);
        result.started = {
          name: event.animationName,
          duration: animation?.effect.getTiming().duration,
          frames: animation?.effect.getKeyframes().map(frame => frame.transform),
        };
      });
      return result;
    }, name);
    try {
      await button.click();
      await layer.waitFor({ state: "detached" });
      const { started, ended } = await probe.jsonValue();
      if(name==='ui-unlock') assert.ok(ended,'잠금 화면을 해제 애니메이션 마지막 프레임까지 유지합니다.');
      assert.ok(started, name + " 시작 이벤트가 필요합니다.");
      assert.equal(started.name, name);
      assert.equal(started.duration, duration);
      return started.frames;
    } finally {
      await probe.dispose();
    }
  }
  async function unlock() {
    await page.getByLabel("잠금 번호", { exact: true }).fill("7904");
    const frames = await closeWithMotion(page.locator('.security-lock-layer'), btn("잠금 해제"), "ui-unlock", 360);
    assert.deepEqual(frames, ["translateY(0px)", "translateY(-100%)"]);
    await page
      .locator(".pf-card")
      .filter({ hasText: "잠금 검증 프로젝트" })
      .waitFor();
  }
  try {
    await launch();
    const side=page.locator('.workspace-side'), credits=side.locator('.side-credit-row');
    await page.mouse.move(900,80);
    await side.getByText('63%',{exact:true}).first().waitFor();
    assert.equal(await credits.count(),0);
    const collapsedSettings=await btn("설정").boundingBox();
    await side.hover();
    await credits.getByText('1,234.50').waitFor();
    const expandedSettings=await btn("설정").boundingBox();
    assert(Math.abs(expandedSettings.y-collapsedSettings.y)<=1,'메뉴를 펼쳐도 도구 버튼의 세로 위치는 같아야 합니다.');
    await btn('메뉴 고정').click();
    await page.mouse.move(900,80);
    assert(await credits.isVisible());
    await btn('메뉴 자동 접기').click();
    await page.mouse.move(900,80);
    await credits.waitFor({state:'detached'});
    await side.hover();
    await btn("설정").click();
    const accountCredits=page.getByLabel('계정 크레딧',{exact:true});
    await accountCredits.getByText('1,234.50').waitFor();
    await accountCredits.getByText('2회',{exact:true}).waitFor();
    await btn("사용량 조회").click();
    await page.getByText("5시간 한도 / 37% 사용").waitFor();
    await page.getByLabel("새 잠금 번호", { exact: true }).fill("7904");
    await page.getByLabel("새 번호 확인").fill("7904");
    await btn("잠금 번호 설정").click();
    await page.getByText("잠금 번호를 저장했습니다.").waitFor();
    await page.getByRole("combobox",{name:"자리 비움 자동 잠금"}).click();await page.getByRole("option",{name:"5분 후",exact:true}).click();
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
    await expect.poll(()=>page.evaluate(async id=>
      (await window.flowrium.securityPending()).some(e=>e.type==="approval"&&e.sessionId===id),
      session.id),{timeout:15000}).toBe(true);
    await assert.rejects(
      page.evaluate(() => window.flowrium.logoutSecurity()),
      /진행 중/,
    );
    await side.hover();await btn("잠금").click();
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
    assert.equal(await page.locator('.security-lock-layer[data-phase=exit]').count(),0,'잘못된 번호로 잠금 해제 애니메이션을 시작하지 않음');
    await page
      .getByRole("alert")
      .filter({ hasText: "일치하지 않습니다" })
      .waitFor();
    await unlock();
    const approval = await page.evaluate(async (id) =>
      (await window.flowrium.securityPending()).find(
        (e) => e.type === "approval" && e.sessionId === id,
      ),
      session.id,
    );
    assert.ok(approval?.requestId, "잠금을 해제하면 같은 대화의 승인 요청이 복원되어야 합니다.");
    const sidebar = page.getByRole("complementary", { name: "작업 공간 탐색" });
    await sidebar.getByRole("button", { name: "Flowrium 홈" }).hover();
    const projectButton = sidebar.getByRole("button", { name: project.name, exact: true });
    await projectButton.hover();
    const decisionBadge = projectButton.locator('.side-project-label small[data-state="decision"]');
    await decisionBadge.waitFor({ state: "visible" });
    assert.match(await decisionBadge.innerText(), /결정 1건/);
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
    await side.hover();await btn("로그아웃").click();
    const logoutFrames = await closeWithMotion(page.locator('.logout-overlay [role="dialog"]'), btn("취소"), "ui-popup-out", 240);
    assert.ok(logoutFrames.length >= 2);
    assert(
      (await page.evaluate(() => window.flowrium.connectionStatus()))
        .authenticated,
    );
    await side.hover();await btn("로그아웃").click();
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
    const timeline=await page.context().newCDPSession(page);
    await timeline.send('Animation.enable');
    await timeline.send('Animation.setPlaybackRate',{playbackRate:.35});
    await unlock();
    await timeline.send('Animation.setPlaybackRate',{playbackRate:1});await timeline.detach();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window.flowrium.lockSecurity());
    const reducedLayer=page.locator('.security-lock-layer');
    await reducedLayer.waitFor();
    const reducedProbe=await reducedLayer.evaluateHandle(el=>{
      const state={starts:0};
      el.addEventListener('animationstart',event=>{if(event.target===el&&event.animationName==='ui-unlock')state.starts++});
      return state;
    });
    await page.getByLabel('잠금 번호',{exact:true}).fill('7904');
    await btn('잠금 해제').click();
    await reducedLayer.waitFor({state:'detached'});
    assert.deepEqual(await reducedProbe.jsonValue(),{starts:0});
    await reducedProbe.dispose();

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
