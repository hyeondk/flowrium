const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
async function run() {
  const tmp = await fs.mkdtemp(
    path.join(os.tmpdir(), "flowrium-memory-screen-"),
  );
  const profile = path.join(tmp, "profile"),
    folder = path.join(tmp, "개인 메모 프로젝트");
  await fs.mkdir(folder);
  const store = new Store(profile);
  await store.load();
  const project = await store.addProject(folder);
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
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
  }
  try {
    await launch();
    await page.locator(".pf-card").filter({ hasText: project.name }).click();
    await page
      .getByRole("navigation", { name: "프로젝트 상세 탭" })
      .getByRole("button", { name: "규칙", exact: true })
      .click();
    await btn("메모 추가").click();
    await page.getByLabel("메모 제목").fill("업무 응답 방식");
    await page.getByLabel("지시와 메모").fill("수량마다 단위를 표시해 주세요.");
    await page.getByLabel("Codex 요청에 연결").check();
    await btn("메모 저장").click();
    const row = page
      .locator(".memory-list button")
      .filter({ hasText: "업무 응답 방식" });
    await row.click();
    await page.getByLabel("지시와 메모").fill("변경된 문장");
    await btn("메모 저장").click();
    await row.click();
    await btn("이전 버전").click();
    await btn("이 버전 복원").click();
    await row.click();
    assert.equal(
      await page.getByLabel("지시와 메모").inputValue(),
      "수량마다 단위를 표시해 주세요.",
    );
    assert.equal(
      (await page.evaluate(() => window.flowrium.bootstrap())).sessions.length,
      0,
    );
    await btn("개인 비서").click();
    await page.getByLabel("비서 대화 보관 프로젝트").selectOption(project.id);
    await btn("비서 대화 열기").click();
    await page.getByRole('dialog',{name:'개인 비서 연결',exact:true}).waitFor({state:'hidden'});
    await page
      .getByLabel("Codex에 보낼 작업 요청")
      .fill("현재 규칙을 확인해 주세요.");
    await page.getByLabel("Codex에 보낼 작업 요청").press("Enter");
    await page
      .locator(".message.assistant")
      .filter({ hasText: "확인한 결과입니다." })
      .first()
      .waitFor();
    for (let attempt = 0; attempt < 150; attempt++) {
      const events = await page.evaluate(() =>
        window.flowrium.securityPending(),
      );
      if (!events.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const home = await page.evaluate(() => window.flowrium.assistantHome());
    assert(home.sessionId);
    let registered = await page.evaluate(() => window.flowrium.bootstrap());
    assert.equal(registered.sessions.length, 1);
    assert.equal(registered.sessions[0].id, home.sessionId);
    assert.equal(registered.sessions[0].personalAssistant, true);
    assert(
      registered.sessions[0].messages.some(
        (m) => m.role === "assistant" && m.text.includes("확인한 결과입니다."),
      ),
    );
    assert.equal(
      registered.sessions[0].messages[0].text,
      "현재 규칙을 확인해 주세요.",
    );
    await app.close();
    app = null;
    await launch();
    await btn("개인 비서").click();
    await page
      .locator(".message.assistant")
      .filter({ hasText: "확인한 결과입니다." })
      .first()
      .waitFor();
    registered = await page.evaluate(() => window.flowrium.bootstrap());
    assert.equal(registered.sessions.length, 1);
    assert.equal(registered.sessions[0].id, home.sessionId);
    console.log(
      "실제 앱 메모와 비서 화면 통과 / 연결 메모 추가·수정·복원 / 명시 첫 요청 / 재시작 후 같은 비서 대화",
    );
  } catch (error) {
    if (page && !page.isClosed())
      console.error(
        "검증 화면 진단",
        await page
          .evaluate(async () => ({
            title: document.querySelector("h1")?.textContent,
            messages: document.querySelectorAll(".message").length,
            dialog: document.querySelector("dialog[open]")?.innerText,
            errors: [...document.querySelectorAll("[role=alert],.toast")].map(
              (el) => el.textContent,
            ),
            home: await window.flowrium.assistantHome(),
            sessions: (await window.flowrium.bootstrap()).sessions.map((s) => ({
              id: s.id,
              title: s.title,
              messages: s.messages
                .map((m) => m.role + " / " + m.text)
                .join(" / "),
            })),
          }))
          .catch(() => null),
      );
    throw error;
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
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
