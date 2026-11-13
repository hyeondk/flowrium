const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const { Store } = require("../electron/store.cjs");

async function main() {
  const root = path.resolve(__dirname, ".."),
    temporary = await fs.mkdtemp(
      path.join(os.tmpdir(), "flowrium-portfolio-ui-"),
    );
  const profile = path.join(temporary, "프로필"),
    parent = path.join(temporary, "선택한 상위 폴더"),
    name = "도시 자료집";
  await fs.mkdir(parent);
  const store = new Store(profile);
  await store.load();
  await store.saveSettings({
    codexPath: path.join(__dirname, "backend-fake-codex.cjs"),
    theme: "light",
  });
  const env = { ...process.env, FLOWRIUM_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app;
  try {
    app = await electron.launch({ args: [root], env, timeout: 40000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const button = (name) => page.getByRole("button", { name, exact: true });
    const tab = (name) =>
      page
        .getByRole("navigation", { name: "프로젝트 상세 탭" })
        .getByRole("button", { name, exact: true });
    await page
      .getByRole("heading", { name: "프로젝트 대시보드", exact: true })
      .waitFor();
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    assert.deepEqual(
      await nav
        .getByRole("button")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
      [
        "대시보드",
        "프로젝트 추가",
        "산출물",
        "완료",
        "업무 연결 / 비서",
        "주간업무보고",
        "업무 마감",
        "터미널",
        "뮤직",
        "설정",
        "잠금",
        "로그아웃",
      ],
    );
    await button("사이드바 접기").click();
    assert.ok(
      await page
        .locator(".workspace-side")
        .evaluate((n) => n.getBoundingClientRect().width < 90),
    );
    await button("사이드바 펼치기").click();
    assert.ok(
      await page
        .locator(".workspace-side")
        .evaluate((n) => n.getBoundingClientRect().width > 180),
    );
    await page
      .locator(".pf-heading")
      .getByRole("button", { name: "프로젝트 추가" })
      .click();
    await page.getByLabel("프로젝트 이름", { exact: true }).fill(name);
    await page
      .getByLabel("프로젝트 목표", { exact: true })
      .fill("동네 안내 자료를 발간합니다.");
    await page.getByLabel("담당자 또는 내 역할").fill("지역 편집팀");
    await page
      .getByLabel("킥오프 메모")
      .fill("현장 답사 전 검토사항을 기록합니다.");
    await page.getByLabel("규칙 / 디자인 / 회의록 폴더 만들기").check();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, parent);
    await button("폴더 선택 후 킥오프").click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("navigation", { name: "프로젝트 상세 탭" })
        .getByRole("button")
        .count(),
      9,
    );
    assert.equal(
      (await fs.stat(path.join(parent, name, "docs", "회의록"))).isDirectory(),
      true,
    );
    await page
      .getByLabel("기간 목표", { exact: true })
      .fill("이번 주 인터뷰 자료 정리");
    await button("목표 추가").click();
    await page
      .getByRole("checkbox", { name: /이번 주 인터뷰 자료 정리/ })
      .click();
    await page.locator(".advanced-goals input:checked").waitFor();
    await page.getByLabel("목표 기간").selectOption("month");
    assert.equal(
      await page
        .getByRole("checkbox", { name: /이번 주 인터뷰 자료 정리/ })
        .count(),
      0,
    );
    await page.getByLabel("목표 기간").selectOption("week");
    assert.ok(
      await page
        .getByRole("checkbox", { name: /이번 주 인터뷰 자료 정리/ })
        .isChecked(),
    );

    for (const [label, create, title] of [
      ["규칙", "규칙 작성", "인터뷰 자료 규칙"],
      ["디자인 시안", "시안 설명 작성", "작업 홈 시안"],
      ["회의록", "회의록 작성", "착수 회의"],
    ]) {
      await tab(label).click();
      await button(create).click();
      await page.getByLabel("문서 이름", { exact: true }).fill(title);
      await page
        .getByLabel("본문", { exact: true })
        .fill("이 문서에서 합의한 내용을 보존합니다.");
      await button("문서 저장").click();
      await page
        .locator(".pf-preview")
        .filter({ hasText: "합의한 내용" })
        .waitFor();
      await button("목록으로").click();
      await page.getByLabel(label + " 검색").fill(title);
      await page.locator("button.pf-row").filter({ hasText: title }).click();
      await page
        .locator(".pf-preview")
        .filter({ hasText: "합의한 내용" })
        .waitFor();
    }

    await tab("팀").click();
    await page
      .getByRole("heading", { name: "프로젝트 팀", exact: true })
      .waitFor();
    await tab("GitHub").click();
    await page
      .getByRole("heading", { name: "형상관리", exact: true })
      .waitFor();
    await tab("문서").click();
    await page.getByLabel("산출물 검색").fill("착수 회의");
    await page
      .locator(".wb-line-item")
      .filter({ hasText: "착수 회의" })
      .click();
    await page.locator("pre").filter({ hasText: "합의한 내용" }).waitFor();

    await tab("업무 현황").click();
    await page.locator("[data-work-kind=research]").click();
    const form = page.locator(".wb-form form");
    await form.locator("input").first().fill("주민 동선 조사");
    await form
      .locator("textarea")
      .fill("관찰한 동선을 다음 주 면담 질문으로 정리해 주세요.");
    await button("업무 시작").click();
    await page.locator(".message.assistant").first().waitFor();
    await button("리서치 / 진행 중").click();
    await button("업무 완료").click();
    await button("리서치 / 완료").waitFor();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /^완료(?:\s|$)/ })
      .first()
      .click();
    await page.getByLabel("완료 기록 검색").fill("주민 동선 조사");
    await button("업무 재개").click();
    await page.waitForFunction(
      async () =>
        (await window.flowrium.bootstrap()).sessions.find(
          (s) => s.title === "주민 동선 조사",
        )?.workflow?.status === "active",
    );
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /대시보드/ })
      .first()
      .click();
    await page.getByLabel("프로젝트 검색").fill("지역 편집팀");
    await page.locator(".pf-card").filter({ hasText: name }).click();
    await tab("프로젝트 설정").click();
    await page.getByText("프로젝트 상세", { exact: true }).click();
    await button("프로젝트 보관").click();
    await button("프로젝트 재개").waitFor();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /^완료(?:\s|$)/ })
      .first()
      .click();
    await page.getByLabel("완료 기록 검색").fill(name);
    await button("프로젝트 재개").click();
    await page.waitForFunction(
      async () =>
        !(await window.flowrium.readPortfolio())[0].details.archivedAt,
    );
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /대시보드/ })
      .first()
      .click();
    await button("날짜별 기록").click();
    await page.getByLabel("작업 기록 내용 검색").fill("동선을 다음 주");
    assert.ok((await page.locator("button.pf-row").count()) > 0);
    const snapshot = await page.evaluate(() => window.flowrium.bootstrap());
    await page.getByLabel("기록 날짜").fill("2001-01-01");
    await page
      .getByText("조건에 맞는 기록이 없습니다.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "모든 날짜", exact: true }).click();
    await page.locator("button.pf-row").first().click();
    await page
      .getByRole("heading", { name: "주민 동선 조사", exact: true })
      .waitFor();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: /^(전체 )?산출물/ })
      .first()
      .click();
    await page.getByLabel("전체 산출물 검색").fill("착수 회의");
    await page.locator("button.pf-row").first().click();
    await page
      .locator(".pf-preview")
      .filter({ hasText: "합의한 내용" })
      .waitFor();
    assert.equal(snapshot.projects.length, 1);
    await nav
      .getByRole("button", { name: "주간업무보고", exact: true })
      .click();
    await page.getByRole("checkbox", { name, exact: true }).check();
    await page.getByLabel("보고서 제목").fill("편집 주간보고");
    await button("ChatGPT로 보고서 작성").click();
    await page
      .getByRole("heading", { name: "편집 주간보고", exact: true })
      .waitFor();
    await nav.getByRole("button", { name: "업무 마감", exact: true }).click();
    await button("최근 12시간 작업 선택").click();
    await page.getByLabel("마감 기록 제목").fill("편집 업무 인계");
    await button("ChatGPT로 업무 마감 작성").click();
    await page
      .locator("button.pf-row")
      .filter({ hasText: "편집 업무 인계" })
      .click();
    await page.getByRole("heading", { name: "편집 업무 인계" }).waitFor();
    await nav
      .getByRole("button", { name: "주간업무보고", exact: true })
      .click();
    await button("작성된 보고").click();
    await page
      .locator("button.pf-row")
      .filter({ hasText: "편집 주간보고" })
      .waitFor();
    console.log(
      "포트폴리오 실제 앱 검증 / 빈 대시보드 / 네이티브 폴더 킥오프 / 아홉 탭 / 기간 목표 / 세 문서 유형 / 업무와 프로젝트 재개 / 날짜와 본문 검색 / 전체 산출물",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 240,
    });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
