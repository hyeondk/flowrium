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
    require('../electron/project-details.cjs').registerProjectDetails(register,store);
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
    const day=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    const today=day(new Date());
    for(const [index,p] of projects.entries()){
      let details=await api.readProjectDetails(p.id);
      details=await api.updateProjectDetails(p.id,details.revision,{action:'goal-add',period:'week',key:today,text:['산책 코스 현장 자료 10건 확인','인터뷰 질문 최종 검토','설치 안내 초안 완성'][index],target:10,due:today});
      await api.updateProjectDetails(p.id,details.revision,{action:'goal-progress',id:details.periodGoals.at(-1).id,current:[7,4,8][index]});
    }
    let sequence=0;
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
      const record=store.session(s.id),date=new Date(Date.now()-(sequence++%5)*86400000).toISOString();
      record.createdAt=date;if(record.workflow?.completion)record.workflow.completion.at=date;await store.save();
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
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".pf-card").nth(2).waitFor();
    await page.locator(".side-usage[data-connected=true]").waitFor();
    await page.getByRole('heading',{name:'오늘의 할 일',exact:true}).waitFor();
    assert.equal(await page.title(),'Flowrium');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('NanumSquareRound')&&document.fonts.check('400 14px NanumSquareRound')&&document.fonts.check('700 14px NanumSquareRound')),'나눔스퀘어라운드 본문과 굵은 글꼴 로드');
    await page.locator('.conversation-dock').getByRole('button',{name:'새 통합 대화',exact:true}).waitFor();
    await page.locator('.conversation-dock').getByRole('button',{name:'새 일반 대화',exact:true}).waitFor();
    await page.locator('.workspace-side').hover();
    await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');
    await page.mouse.move(1420, 980);
    await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='false');
    await page.screenshot({
      path: path.join(root, "docs", "workspace.png"),
      animations: "disabled",
      scale: "css",
    });
    for (const theme of ["light", "dark"]) {
      await page.locator('.workspace-side').hover();
      await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');
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
      await page.locator('.workspace-side').hover();
      await page.waitForFunction(()=>document.querySelector('.workspace-side')?.dataset.expanded==='true');
      for(const heading of await page.locator('.workspace-side h2').evaluateAll(rows=>rows.map(el=>({text:el.textContent,lineHeight:parseFloat(getComputedStyle(el).lineHeight),height:el.getBoundingClientRect().height}))))assert.ok(heading.lineHeight<=heading.height+.5,theme+' 메뉴 제목 줄 높이 / '+heading.text+' / '+heading.lineHeight+' / '+heading.height);

    }
    await page.getByRole('button',{name:'대화함 접기',exact:true}).click();
    await page.locator('.conversation-dock').waitFor({state:'hidden'});
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
      "예시 데이터 실제 대시보드와 오른쪽 대화함 촬영 / 메뉴 펼침과 접힘 / 나눔스퀘어라운드 로드 / 밝은 테마와 어두운 테마 메뉴 제목 높이 / 768 / 390 / 320픽셀 대시보드 / 320픽셀 상세 아홉 탭",
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
