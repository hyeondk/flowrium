const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
const { registerWorkbench } = require("../electron/workbench.cjs");
const { registerPortfolio } = require("../electron/portfolio.cjs");

async function capture() {
  const root = path.resolve(__dirname, ".."),
    temp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-doc-preview-"));
  const profile = path.join(temp, "프로필");
  let app;
  try {
    const store = new Store(profile);
    await store.load();
    await store.saveSettings({
      theme: "light",
      codexPath: path.join(root, "tests", "backend-fake-codex.cjs"),
    });
    const api = {},
      register = (name, fn) => {
        api[name] = fn;
      };
    registerPortfolio(register, store, {
      chooseFolder: async () => temp,
      reveal: () => {},
    });
    registerWorkbench(register, store, { reveal: () => {} });
    const examples = [
      {
        name: "도시 산책 안내서",
        owner: "콘텐츠 편집",
        phase: "진행",
        goal: "처음 방문하는 사람을 위한 동네별 산책 코스를 만듭니다.",
      },
      {
        name: "고객 인터뷰",
        owner: "사용자 조사",
        phase: "킥오프",
        goal: "첫 사용 경험을 듣고 다음 인터뷰 질문을 정리합니다.",
      },
      {
        name: "도움말 개편",
        owner: "운영",
        phase: "유지보수",
        goal: "자주 묻는 질문을 바탕으로 사용 설명서를 갱신합니다.",
      },
    ];
    const projects = [];
    for (const example of examples)
      projects.push(
        await api.kickoffProject({
          ...example,
          privacy: "일반",
          createFolder: true,
        }),
      );
    for (const [index, kind, title, status] of [
      [2, "document", "설치와 첫 실행 안내", "done"],
      [0, "briefing", "답사 기록을 바탕으로 코스 선정", "done"],
      [1, "research", "참여자 모집 조건 검토", "review"],
      [2, "task", "도움말 목차와 화면 연결", "active"],
      [0, "document", "골목 산책 코스 초안", "active"],
      [1, "briefing", "첫 인터뷰 질문 정리", "active"],
      [0, "research", "산책로 접근성과 소요 시간 조사", "active"],
    ]) {
      const s = await api.startWork({
        projectId: projects[index].id,
        kind,
        title,
      });
      if (status !== "active")
        await api.updateWork(s.id, { action: "status", status });
    }
    const env = {
      ...process.env,
      FLOWRIUM_USER_DATA: profile,
      CODEX_HOME: path.join(temp, "모의 계정"),
    };
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: [root], env });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1392, height: 930 });
    await page.locator(".pf-card").nth(2).waitFor();
    await page.locator(".side-account i[data-connected=true]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1380, 920);
    await page.screenshot({
      path: path.join(root, "docs", "workspace.png"),
      animations: "disabled",
      scale: "css",
    });
    const contrast = async (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          function light(color) {
            const channels = color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map((x) => Number(x) / 255)
              .map((x) =>
                x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
              );
            return (
              channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            );
          }
          let current = el,
            background;
          while (current) {
            const color = getComputedStyle(current).backgroundColor;
            if (!color.endsWith(", 0)") && color !== "transparent") {
              background = color;
              break;
            }
            current = current.parentElement;
          }
          const text = light(getComputedStyle(el).color),
            surface = light(background);
          return (
            (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05)
          );
        });
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.getByRole("button", { name: "설정", exact: true }).click();
        await page.getByRole("button", { name: "어둡게", exact: true }).click();
        await page.getByLabel("설정 닫기").click();
        await page.waitForFunction(
          () => document.documentElement.dataset.theme === "dark",
        );
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a instanceof CSSTransition)
              .map((a) => a.finished.catch(() => {})),
          ),
        );
      }
      for (const selector of [
        ".side-account",
        ".side-group h2",
        ".pf-card p",
        ".pf-card .pf-status",
        ".pf-dashboard-tools button",
        ".pf-heading .pf-primary",
      ]) {
        const ratio = await contrast(selector);
        assert.ok(
          ratio >= 4.5,
          theme + " " + selector + " 텍스트 대비 " + ratio.toFixed(2),
        );
      }
    }
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth + 1 &&
            document.querySelector(".pf-page").scrollWidth <=
              document.querySelector(".pf-page").clientWidth + 1,
        ),
        "대시보드 가로폭 " + width,
      );
      if (width < 761) {
        await page.getByLabel("메뉴 열기").click();
        await page
          .getByRole("button", { name: "대시보드", exact: true })
          .click();
      }
    }
    await page.locator(".pf-card").first().click();
    for (const tab of [
      "홈",
      "업무 현황",
      "팀",
      "GitHub",
      "규칙",
      "디자인 시안",
      "회의록",
      "문서",
      "프로젝트 설정",
    ]) {
      await page
        .getByRole("navigation", { name: "프로젝트 상세 탭" })
        .getByRole("button", { name: tab, exact: true })
        .click();
      assert.ok(
        await page
          .locator(".pf-page")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        tab + " 가로폭 320픽셀",
      );
    }
    console.log(
      "예시 데이터 실제 대시보드 촬영 / 밝은 테마와 어두운 테마 본문 대비 / 768·390·320픽셀 대시보드 / 320픽셀 상세 아홉 탭",
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
capture().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
