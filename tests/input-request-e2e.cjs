const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
async function run() {
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "flowrium-input-screen-"),
    ),
    profile = path.join(temp, "기기"),
    folder = path.join(temp, "프로젝트");
  const env = {
    ...process.env,
    FLOWRIUM_USER_DATA: profile,
    CODEX_HOME: path.join(temp, "codex"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app;
  try {
    await fs.mkdir(folder);
    const store = new Store(profile);
    await store.load();
    const p = await store.addProject(folder);
    const s = await store.createSession(p.id);
    await store.saveSettings({
      codexPath: path.join(__dirname, "backend-fake-codex.cjs"),
    });
    app = await _electron.launch({
      args: [path.resolve(__dirname, "..")],
      env,
      timeout: 45000,
    });
    const page = await app.firstWindow();await page.setViewportSize({width:1440,height:1000});
    page.setDefaultTimeout(16000);
    const button = (name) => page.getByRole("button", { name, exact: true });
    let form = page.locator(".main-shell").getByRole("form", { name: "Codex 질문" });
    async function launchQuestion() {
      await page.evaluate(
        (id) =>
          window.flowrium.send({
            sessionId: id,
            text: "입력질문검증",
            mode: "plan",
          }),
        s.id,
      );
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (
          (await page.evaluate(() => window.flowrium.securityPending())).some(
            (e) => e.type === "input",
          )
        )
          return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw Error("질문 수신 시간 초과");
    }
    async function openInbox() {
      form=page.locator(".main-shell").getByRole("form", {name:"Codex 질문"});
      await page.getByRole("button", { name: /^승인함/ }).click();
      await form.waitFor();
    }
    async function answer(place, secret) {
      await form.getByRole("radio", { name: /요약/ }).check();
      await form.getByRole("radio", { name: "직접 입력" }).check();
      await form.getByLabel("직접 답변").fill(place);
      await form.getByLabel("비밀 답변").fill(secret);
      assert.equal(
        await form.getByLabel("비밀 답변").getAttribute("type"),
        "password",
      );
      await form.getByRole("button", { name: "답변 보내기" }).click();
      await form.waitFor({ state: "detached" });
    }
    await page.locator(".pf-card").waitFor();
    await page.evaluate(() => window.flowrium.setSecurityPin("", "7195"));
    await launchQuestion();
    await openInbox();
    assert(
      await form.getByRole("button", { name: "답변 보내기" }).isDisabled(),
    );
    await form.getByRole("radio", { name: /상세/ }).check();
    await form.getByLabel("비밀 답변").fill("폐기할 임시 입력");
    await button("잠금").click();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    await assert.rejects(
      page.evaluate(() => window.flowrium.securityPending()),
      /잠겼습니다/,
    );
    await page.getByLabel("잠금 번호", { exact: true }).fill("7195");
    await button("잠금 해제").click();
    await openInbox();
    assert.equal(await form.getByLabel("비밀 답변").inputValue(), "");
    await form.getByRole("button", { name: "대화 열기" }).click();
    form=page.locator(".conversation-dock").getByRole("form",{name:"Codex 질문"});
    await form.waitFor();
    await answer("첫 번째 참고 자료", "절대 저장하지 않을 테스트 값");
    await page
      .locator(".message.assistant")
      .filter({ hasText: "질문 응답 형식 확인 / 요약 / 첫 번째 참고 자료" })
      .waitFor();
    await button("대시보드").click();
    await launchQuestion();
    await openInbox();
    await answer("두 번째 참고 자료", "두 번째 보호 값");
    const end = Date.now() + 6000;
    let session;
    do {
      session = (
        await page.evaluate(() => window.flowrium.bootstrap())
      ).sessions.find((v) => v.id === s.id);
      if (session.messages.some((m) => m.text.includes("두 번째 참고 자료")))
        break;
      await new Promise((r) => setTimeout(r, 50));
    } while (Date.now() < end);
    assert(session.messages.some((m) => m.text.includes("두 번째 참고 자료")));
    assert(!JSON.stringify(session).includes("보호 값"));
    const revisions = path.join(folder, ".flowrium", "sessions");
    for (const name of await fs.readdir(revisions)) {
      const body = await fs.readFile(path.join(revisions, name), "utf8");
      assert(
        !body.includes("절대 저장하지 않을") &&
          !body.includes("두 번째 보호 값"),
      );
    }
    console.log(
      "실제 앱 질문 검증 통과 / 계획 모드 질문 / 선택·직접 입력·비밀 문구 / 잠금 후 미응답 복원 / 대화와 승인함 두 경로 / 회신 및 비밀 답변 비보관",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 200,
    });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
