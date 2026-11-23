const {settledRail,openProjectTab}=require('./shell-test-helpers.cjs');
const {trustRegisteredFixtureFolder} = require('./project-trust-fixture.cjs');
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
  const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME:path.join(temporary,'codex') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  let app, page;
  try {
    app = await electron.launch({ args: [root], env, timeout: 40000 });
    page = await app.firstWindow();await page.setViewportSize({width:1440,height:1000});
    page.setDefaultTimeout(10000);
    await page.evaluate(() => {
      window.flowriumTestClicks = [];
      document.addEventListener('click', event => {
        const button = event.target.closest?.('button');
        if (!button) return;
        const row = { label: button.getAttribute('aria-label') || button.textContent.trim().slice(0, 80), before: document.querySelector('.main-shell')?.dataset.view };
        window.flowriumTestClicks.push(row);
        setTimeout(() => { row.after = document.querySelector('.main-shell')?.dataset.view; row.chatFocus = document.querySelector('.app-shell')?.dataset.chatFocus; }, 0);
      }, true);
    });
    const button = (name) => page.getByRole("button", { name, exact: true });
    const tab = name => openProjectTab(page,name);
    await page
      .getByRole("heading", { name: "프로젝트 대시보드", exact: true })
      .waitFor();
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    const toolGroups = page.locator(".pf-dashboard-tools [role=group]");
    assert.deepEqual(await toolGroups.evaluateAll(groups => groups.map(group => group.getAttribute("aria-label"))), ["작성과 분석", "업무 관리", "프로젝트 관리"]);
    assert.ok(await toolGroups.locator("button").evaluateAll(buttons => buttons.every(button => button.querySelector("svg") && button.textContent.trim())));
    assert.deepEqual(
      await nav
        .getByRole("button")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
      [
        "대시보드",
        "프로젝트 추가",
        "산출물",
        "완료한 업무",
        "휴지통",
        "업무 연결 / 비서",
        "주간업무보고",
        "업무 마감",
        "터미널",
      ],
    );
    await page.locator('.side-usage[data-connected=true]').waitFor();
    const rail=page.locator('.workspace-side');
    if(await rail.getAttribute('data-pinned')==='true')await button('메뉴 자동 접기').click();
    await page.mouse.move(400,100);await settledRail(rail,{expanded:false,pinned:false},'기본 메뉴 접힘');
    assert.equal(await rail.getAttribute('data-expanded'),'false');
    const before=await page.locator('.main-shell').boundingBox();
    await rail.hover();await settledRail(rail,{expanded:true,pinned:false,width:236},'포인터로 메뉴 펼치기');
    assert.equal(await rail.getAttribute('data-expanded'),'true');
    assert.ok(Math.abs((await page.locator('.sidebar-surface').boundingBox()).width-236)<.1);
    assert.deepEqual(await page.locator('.main-shell').boundingBox(),before,'메뉴를 올려도 본문 배치 유지');
    await button('메뉴 고정').click();await page.mouse.move(400,100);
    await settledRail(rail,{expanded:true,pinned:true,width:236},'메뉴 고정 유지');assert.equal(await rail.getAttribute('data-expanded'),'true');
    await button('메뉴 자동 접기').click();await page.mouse.move(500,100);await settledRail(rail,{expanded:false,pinned:false,width:56},'고정 해제 후 메뉴 접힘');
    assert.equal(await rail.getAttribute('data-expanded'),'false');
    await rail.hover();
    await settledRail(rail,{expanded:true,pinned:false,width:236},'프로젝트 추가 전 메뉴 펼치기');
    await nav.getByRole("button",{name:"프로젝트 추가",exact:true}).click();
    await page.getByLabel("프로젝트 이름", { exact: true }).fill(name);
    await page.getByLabel("프로젝트 구분", { exact: true }).fill("개인");
    const startDate=page.getByLabel("시작일",{exact:true}), dueDate=page.getByLabel("목표일",{exact:true});
    await startDate.fill("2026-11-16");
    await dueDate.fill("2026-11-18");
    await dueDate.click();
    const calendar=page.getByRole("dialog",{name:"날짜 선택"});
    await calendar.waitFor();
    assert.equal(await calendar.getByRole("button",{name:"2026-11-15",exact:true}).isDisabled(),true);
    await calendar.getByRole("button",{name:"2026-11-19",exact:true}).click();
    assert.equal(await dueDate.inputValue(),"2026-11-19");
    await dueDate.press("Alt+ArrowDown");
    await calendar.waitFor();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await calendar.waitFor({state:"hidden"});
    assert.equal(await dueDate.inputValue(),"2026-11-19");
    assert.ok(await dueDate.evaluate(field => field === document.activeElement));
    await dueDate.press("Alt+ArrowDown");
    await calendar.waitFor();
    // Exercise a native close event that arrives while the next field receives
    // input. Windows can post the event on a later rendering frame.
    await calendar.evaluate(dialog => {
      const goal = document.querySelector(".pf-form textarea[required]");
      function holdClose(event) {
        if (event.target !== dialog) return;
        document.removeEventListener("close", holdClose, true);
        event.stopImmediatePropagation();
        window.flowriumDateCloseHeld = true;
        goal.addEventListener("focus", () => queueMicrotask(() => {
          dialog.dispatchEvent(new Event("close"));
          window.flowriumDateCloseReplayed = true;
        }), {once:true});
      }
      document.addEventListener("close", holdClose, true);
    });
    await page.keyboard.press("ArrowRight");await page.keyboard.press("Enter");
    assert.equal(await dueDate.inputValue(),"2026-11-20");
    await page.waitForFunction(() => window.flowriumDateCloseHeld);
    const goalField = page.locator(".pf-form textarea[required]");
    const goalText = "동네 안내 자료를 발간합니다.";
    await page.getByLabel("프로젝트 목표", {exact:true}).fill(goalText);
    await page.waitForFunction(() => window.flowriumDateCloseReplayed);
    assert.ok(await goalField.evaluate(field => field === document.activeElement));
    assert.equal(await goalField.inputValue(), goalText);
    await page.getByLabel("담당자 또는 내 역할").fill("지역 편집팀");
    await page
      .getByLabel("킥오프 메모")
      .fill("현장 답사 전 검토사항을 기록합니다.");
    await page.getByLabel("규칙과 디자인, 회의록 폴더 만들기").check();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, parent);
    await button("폴더 선택 후 킥오프").click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    const savedGoal = await page.evaluate(async title => {
      const cards = await window.flowrium.readPortfolio();
      return cards.find(card => card.project.name === title)?.details?.goal;
    }, name);
    assert.equal(savedGoal, goalText);
    await page.locator(".overview-tools>summary").click();
    const panels = page.locator(".pf-project-summary .pf-overview-group");
    await panels.last().waitFor();
    const bounds = await panels.evaluateAll(groups => groups.map(group => {
      const title = group.querySelector(".pf-section-header").getBoundingClientRect();
      const body = group.querySelector(".pf-overview-body").getBoundingClientRect();
      return { titleBottom: title.bottom, top: body.top, bottom: body.bottom };
    }));
    assert.equal(bounds.length, 2);
    assert.ok(bounds.every(panel => panel.titleBottom <= panel.top + 1));
    if (Math.abs(bounds[0].top - bounds[1].top) < 1) assert.ok(Math.abs(bounds[0].bottom - bounds[1].bottom) < 1);
    await button('프로젝트 메뉴').click();
    assert.deepEqual(
      await page
        .getByRole("navigation", { name: "프로젝트 상세 탭" })
        .getByRole("button")
        .allTextContents(),
      ['업무 현황','팀','GitHub','문서','프로젝트 설정'],
    );
    await button('프로젝트 메뉴').click();
    assert.ok(await page.getByRole('group',{name:'프로젝트 보기'}).getByRole('button',{name:'업무',exact:true}).isVisible());
    assert.equal(
      (await fs.stat(path.join(parent, name, "docs", "회의록"))).isDirectory(),
      true,
    );
    await page
      .getByLabel("기간 목표", { exact: true })
      .fill("이번 주 인터뷰 자료 정리");
    await page.getByRole('region',{name:'기간 목표와 반복 일정',exact:true}).getByRole('button',{name:'목표 추가',exact:true}).click();
    await page
      .getByRole("checkbox", { name: /이번 주 인터뷰 자료 정리/ })
      .click();
    await page.locator(".advanced-goals input:checked").waitFor();
    await page.getByRole('group',{name:'목표 기간'}).getByRole('button',{name:'월간'}).click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: /이번 주 인터뷰 자료 정리/ })
        .count(),
      0,
    );
    await page.getByRole('group',{name:'목표 기간'}).getByRole('button',{name:'주간'}).click();
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
      await tab(label);
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

    await tab("팀");
    await page
      .getByRole("heading", { name: "프로젝트 팀", exact: true })
      .waitFor();
    await tab("GitHub");
    await page
      .getByRole("heading", { name: "형상관리", exact: true })
      .waitFor();
    await tab("문서");
    await page.getByLabel("산출물 검색").fill("착수 회의");
    await page
      .locator(".wb-line-item")
      .filter({ hasText: "착수 회의" })
      .click();
    await page.locator("pre").filter({ hasText: "합의한 내용" }).waitFor();

    await tab("업무 현황");
    await page.locator("[data-work-kind=research]").click();
    const form = page.locator(".wb-form form");
    await form.locator("input").first().fill("주민 동선 조사");
    await form
      .locator("textarea")
      .fill("관찰한 동선을 다음 주 면담 질문으로 정리해 주세요.");
    await trustRegisteredFixtureFolder(profile, path.join(parent,name));
    await button("업무 시작").click();
    await page.locator(".message.assistant").first().waitFor();
    await page.getByLabel('대화 연결 및 작업 도구',{exact:true}).click();
    await button("리서치 / 진행 중").click();
    await button("업무 완료").click();
    await button("리서치 / 완료").waitFor();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: '완료한 업무', exact:true })
      .first()
      .click();
    await page.getByLabel("완료 기록 검색").fill("주민 동선 조사");
    await page.locator(".main-shell").getByRole("button",{name:"업무 재개",exact:true}).click();
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
    assert.equal(await page.locator(".pf-project-entry").filter({ hasText: name }).locator(".pf-category").innerText(), "개인");
    await page.locator(".pf-project-entry").filter({ hasText: name }).click();
    await tab("프로젝트 설정");
    await page.getByText("프로젝트 상세", { exact: true }).click();
    await button("프로젝트 완료").click();
    await button("프로젝트 재개").waitFor();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: '완료한 업무', exact:true })
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
    await page.getByText("제목과 보고 형식 설정",{exact:true}).click();
    await page.getByLabel("보고서 제목").fill("편집 주간보고");
    await button("ChatGPT로 보고서 작성").click();
    await page
      .getByRole("heading", { name: "편집 주간보고", exact: true })
      .waitFor();
    await nav.getByRole("button", { name: "업무 마감", exact: true }).click();
    await button("최근 12시간 작업 선택").click();
    await page.getByText("제목과 인계 대상 설정",{exact:true}).click();
    await page.getByLabel("마감 기록 제목").fill("편집 업무 인계");
    await button("ChatGPT로 업무 마감 작성").click();
    await page
      .locator("button.report-history-row")
      .filter({ hasText: "편집 업무 인계" })
      .click();
    await page.getByRole("heading", { name: "편집 업무 인계" }).waitFor();
    await nav
      .getByRole("button", { name: "주간업무보고", exact: true })
      .click();
    await button("작성된 보고").click();
    await page
      .locator("button.report-history-row")
      .filter({ hasText: "편집 주간보고" })
      .waitFor();
    console.log(
      "포트폴리오 실제 앱 검증 / 빈 대시보드 / 네이티브 폴더 킥오프 / 아홉 탭 / 기간 목표 / 세 문서 유형 / 업무와 프로젝트 재개 / 날짜와 본문 검색 / 전체 산출물",
    );
  } catch (error) {
    if (page && !page.isClosed()) console.error('포트폴리오 화면 클릭과 상태', await page.evaluate(() => ({
      clicks: window.flowriumTestClicks?.slice(-15),
      view: document.querySelector('.main-shell')?.dataset.view,
      alerts: [...document.querySelectorAll('[role=alert]')].map(el => el.textContent.trim()),
      invalidFields: [...document.querySelectorAll('.pf-form input:invalid,.pf-form textarea:invalid')].map(el => el.labels?.[0]?.firstChild?.textContent.trim()),
      focusedField: document.activeElement?.labels?.[0]?.firstChild?.textContent.trim()
    })));
    throw error;
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
