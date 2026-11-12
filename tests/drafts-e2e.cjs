const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
const { registerMemory } = require("../electron/memory.cjs");
async function run() {
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "flowrium-drafts-screen-"),
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
  await fs.mkdir(folder);
  const store = new Store(profile);
  await store.load();
  const p = await store.addProject(folder);
  await store.saveSettings({
    codexPath: path.join(__dirname, "backend-fake-codex.cjs"),
  });
  const api = {};
  registerMemory((k, v) => (api[k] = v), store);
  const session = await api.openAssistant(p.id),
    key = "session:" + session.id;
  let app, page;
  const launch = async () => {
    app = await _electron.launch({
      args: [path.resolve(__dirname, "..")],
      env,
      timeout: 45000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(16000);
  };
  const close = async () => {
    await app.close();
    app = null;
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const composer = () => page.getByLabel("Codex에 보낼 작업 요청");
  const until = async (fn) => {
    for (let i = 0; i < 160; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error("초안 상태 대기 시간 초과");
  };
  async function unlock() {
    await page.getByLabel("잠금 번호", { exact: true }).fill("6804");
    await button("잠금 해제").click();
    await button("개인 비서").waitFor();
  }
  try {
    await launch();
    await button("개인 비서").waitFor();
    await page.evaluate(
      (k) =>
        localStorage.setItem(
          "flowrium.drafts",
          JSON.stringify({
            [k]: { text: "이전 버전의 미전송 문장", mode: "review" },
          }),
        ),
      key,
    );
    await close();
    // 구버전 프로필을 재현한다. 방금 빈 임시 프로필로 만든 새 버전의 이관 표식만 제거한다.
    await fs.unlink(path.join(profile, "composer-drafts", "legacy.json"));
    await launch();
    await button("개인 비서").click();
    await until(
      async () => (await composer().inputValue()) === "이전 버전의 미전송 문장",
    );
    assert.equal(await page.getByLabel("작업 모드").inputValue(), "review");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("flowrium.drafts")),
      null,
    );
    await composer().fill("새로 편집한 미전송 초안");
    await until(
      async () =>
        (await page.evaluate(
          async (k) =>
            (
              await window.flowrium.readDrafts(
                (await window.flowrium.securityState()).accountRevision,
              )
            )[k]?.text,
          key,
        )) === "새로 편집한 미전송 초안",
    );
    await page.evaluate(() => window.flowrium.setSecurityPin("", "6804"));
    await button("잠금").click();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("flowrium.drafts")),
      null,
    );
    await assert.rejects(
      page.evaluate(() => window.flowrium.readDrafts(0)),
      /잠겼습니다/,
    );
    await close();
    await launch();
    await unlock();
    await button("개인 비서").click();
    await until(
      async () => (await composer().inputValue()) === "새로 편집한 미전송 초안",
    );
    assert.equal(
      (await page.evaluate(() => window.flowrium.bootstrap())).sessions[0]
        .messages.length,
      0,
    );
    await button("로그아웃").click();
    await button("로그아웃 확인").click();
    await page.getByRole("heading", { name: "화면 잠금" }).waitFor();
    await unlock();
    await button("개인 비서").click();
    await composer().waitFor();
    const revision = await page.evaluate(
      async () => (await window.flowrium.securityState()).accountRevision,
    );
    assert(revision > 0);
    assert.deepEqual(
      await page.evaluate((rev) => window.flowrium.readDrafts(rev), revision),
      {},
    );
    assert.equal(await composer().inputValue(), "");
    await assert.rejects(
      page.evaluate(() => window.flowrium.readDrafts(0)),
      /계정이 바뀌/,
    );
    console.log(
      "실제 앱 초안 검증 통과 / 구버전 원문 이전과 제거 / 미전송 입력·모드 유지 / PIN 보호 / 앱 재시작 / 로그아웃 계정 구분",
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
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
