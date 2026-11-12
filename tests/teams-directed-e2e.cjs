const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
async function main() {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "flowrium-team-screen-"),
  );
  const profile = path.join(temp, "profile"),
    folder = path.join(temp, "프로젝트");
  await fs.mkdir(folder);
  const store = new Store(profile);
  await store.load();
  await store.addProject(folder);
  await store.saveSettings({
    codexPath: path.join(__dirname, "backend-fake-codex.cjs"),
  });
  const env = {
    ...process.env,
    FLOWRIUM_USER_DATA: profile,
    CODEX_HOME: path.join(temp, "codex"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app, page;
  async function launch() {
    app = await _electron.launch({
      args: [path.resolve(__dirname, "..")],
      env,
      timeout: 45000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(18000);
    await page.locator(".pf-card").filter({ hasText: "프로젝트" }).click();
    await page
      .getByRole("navigation", { name: "프로젝트 상세 탭" })
      .getByRole("button", { name: "팀", exact: true })
      .click();
  }
  const btn = (name) => page.getByRole("button", { name, exact: true });
  const sessionCount = () =>
    page.evaluate(
      async () => (await window.flowrium.bootstrap()).sessions.length,
    );
  try {
    await launch();
    await btn("팀 만들기").click();
    await page.getByLabel("팀 이름").fill("직접 지정한 팀");
    await btn("팀 저장").click();
    await page.getByLabel("공동 요청").fill("수동 배정 검증");
    await btn("배정안 만들기").click();
    await page.getByRole("heading", { name: "배정안 검토" }).waitFor();
    assert.equal(await sessionCount(), 0);
    await page.getByLabel("기획에게 배정").check();
    await page.getByLabel("담당 과업").fill("결정질문시험");
    await btn("선택한 담당자 실행").click();
    await page.getByRole("heading", { name: "결정 대기" }).waitFor();
    await btn("내부 자료").click();
    await page.getByRole("heading", { name: "결과 검토" }).waitFor();
    assert.equal(await sessionCount(), 1);
    await btn("종합 보고서 작성").click();
    await page.getByRole("heading", { name: "완료", exact: true }).waitFor();
    const manualPath = await page.locator(".team-report p").innerText();
    assert.match(
      await fs.readFile(path.join(folder, manualPath), "utf8"),
      /팀 결과 보고/,
    );
    await page.getByLabel("업무 배정 방식").selectOption("plan");
    await page.getByLabel("공동 요청").fill("선택형 팀장 계획 검증");
    await btn("팀장에게 배정안 요청").click();
    await page.getByRole("heading", { name: "배정안 검토" }).waitFor();
    assert.equal(await page.getByLabel("담당 과업").count(), 2);
    await page.getByLabel("검토에게 배정").uncheck();
    await page.getByLabel("담당 과업").fill("팀장 계획에서 직접 수정한 과업");
    await btn("선택한 담당자 실행").click();
    await page.getByRole("heading", { name: "결과 검토" }).waitFor();
    await btn("종합 보고서 작성").click();
    await page.getByRole("heading", { name: "완료", exact: true }).waitFor();
    await btn("팀장 대화 열기").click();
    await page.locator(".message.assistant").first().waitFor();
    await app.close();
    app = null;
    await launch();
    await page
      .locator(".team-entry")
      .filter({ hasText: "선택형 팀장 계획 검증" })
      .click();
    await page.getByRole("heading", { name: "완료", exact: true }).waitFor();
    assert.match(
      await page.locator(".team-directed").innerText(),
      /팀장 계획에서 직접 수정한 과업/,
    );
    console.log(
      "실제 팀 화면 통과 / 직접 고른 담당자 / 중간 질문·답변 / 선택형 팀장 배정안 / 실행 전 수정 및 선택 / 종합 보고서 실제 파일 / 팀장 대화 / 앱 재실행 복원",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 250,
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
