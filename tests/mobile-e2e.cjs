const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { _electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
const { registerRemote } = require("../electron/remote.cjs");
const { registerWorkbench } = require("../electron/workbench.cjs");
const {verifyDashboardLoading, verifyChatLoading, verifyRefreshingChat} = require('./mobile-loading-checks.cjs');
const {verifyStopSheet, observeToast, verifyToast} = require('./mobile-feedback-checks.cjs');

async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-mobile-e2e-"));
  let window, service, workflow;
  try {
    const folder = path.join(temp, "취재 자료집");
    await fs.mkdir(path.join(folder, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(folder, "docs", "안내.md"),
      "공개 전 확인할 항목",
    );
    const store = new Store(path.join(temp, "프로필"));
    await store.load();
    const p = await store.addProject(folder),
      controller = new EventEmitter();
    await require('./project-trust-fixture.cjs').trustFixtureProject(store,p);
    controller.runs = new Map();
    controller.status = { available: true, authenticated: true };
    controller.connectionStatus = async () => ({
      available: true,
      authenticated: true,
      accountLabel: "ChatGPT",
    });
    let locked = false,
      requests = [],
      decisions = [],
      answersReceived = [],
      rejectNext = false,
      interrupted;
    const handlers = new Map(),
      register = (name, fn) => handlers.set(name, fn);
    controller.store=store;controller.editingSessions=new Set();
    controller.options={canRun:()=>!locked};
    controller.emitEvent=event=>controller.emit('event',event);
    workflow=require('../electron/workflow.cjs').registerWorkflow(register,store,controller,{
      canRun:()=>!locked,pending:()=>requests,intervalMs:600000,
    });
    registerWorkbench(register, store, { reveal: () => {} });
    const todayKey=new Intl.DateTimeFormat('sv-SE').format(new Date());
    register('readPortfolio',async()=>[{project:p,details:{dueDate:todayKey,kickoff:{phase:'진행'},periodGoals:[{id:'fixture',text:'모바일 검토 마무리',due:todayKey}]}}]);
    register("readTeams", () => ({
      teams: [
        {
          id: randomUUID(),
          name: "편집 팀",
          roles: [{ name: "기획" }, { name: "교정" }],
        },
      ],
      runs: [],
    }));
    register("send", async (input) => {
      const session = store.session(input.sessionId);
      const at = new Date().toISOString();
      session.messages.push({
        id: randomUUID(),
        role: "user",
        text: input.text,
        createdAt: at,
      });
      session.updatedAt = at;
      controller.runs.set(session.id, {});
      requests = [
        {
          type: "approval",
          requestId: "확인-1",
          sessionId: session.id,
          details: "시험 파일 작성 요청",
        },
      ];
      return { accepted: true };
    });
    register("interrupt", async (id) => {
      interrupted = id;
      controller.runs.delete(id);
    });
    register("approval", (input) => {
      decisions.push(input.decision);
      requests = [];
    });
    register("answerInput", async (input) => {
      if (rejectNext) {
        rejectNext = false;
        throw Error("질문 응답 시험 실패");
      }
      answersReceived.push(input);
      requests = requests.filter((e) => e.requestId !== input.requestId);
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    register("securityPending", () => requests);
    const tunnel = new EventEmitter();
    tunnel.stdout = new EventEmitter();
    tunnel.stderr = new EventEmitter();
    tunnel.exitCode = null;
    tunnel.signalCode = null;
    tunnel.kill = () => {
      tunnel.exitCode = 0;
      tunnel.emit("exit", 0);
    };
    service = registerRemote(register, {
      store,
      controller,
      handlers,
      isLocked: () => locked,
      readDecisionLinks: () => workflow.pendingDecisionLinks(),
      version: "시험",
      tunnelFactory: () => {
        setTimeout(
          () =>
            tunnel.stderr.emit(
              "data",
              Buffer.from(
                "https://mobile-test.trycloudflare.com Registered tunnel connection",
              ),
            ),
          15,
        );
        return tunnel;
      },
    });
    const archived = await store.createSession(p.id, {
      title: "지난 현장 기록",
    });
    const archivedSession = store.session(archived.id);
    const note = (index) => ({
      id: randomUUID(),
      role: index % 2 ? "user" : "assistant",
      text: "답사 기록 " + String(index).padStart(3, "0"),
      createdAt: new Date().toISOString(),
    });
    archivedSession.messages = Array.from({ length: 121 }, (_, index) =>
      note(index + 1),
    );
    const remote = await handlers.get("startRemoteAccess")();
    const fixture = path.join(temp, "window.cjs");
    await fs.writeFile(
      fixture,
      `const {app,BrowserWindow}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadURL("about:blank");});`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    window = await _electron.launch({
      args: [fixture, "--user-data-dir=" + path.join(temp, "브라우저")],
      env,
    });
    const page = await window.firstWindow();
    page.setDefaultTimeout(9000);
    const btn = (name) => page.getByRole("button", { name, exact: true });
    const openProject = () =>
      page.getByRole("button", { name: /취재 자료집.*업무/ }).click();
    const pages = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/mobile/sessions/"))
        pages.push({ path: u.pathname, before: u.searchParams.get("before") });
    });
    const stateResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/mobile/state",
    );
    await verifyDashboardLoading(page, remote.localUrl);
    const firstState = await (await stateResponse).json();
    assert.equal(firstState.sessions[0].messages.length, 0);
    assert.equal(firstState.sessions[0].messageCount, 121);
    await page.getByRole('heading',{name:'대시보드',exact:true}).waitFor();
    await page.getByRole('heading',{name:'오늘 할 일',exact:true}).waitFor();
    await page.getByRole('heading',{name:'프로젝트 현황',exact:true}).waitFor();
    assert.equal(await page.locator('.activity-chart li').count(),7);
    await page.locator('.mobile-today').getByText('모바일 검토 마무리',{exact:true}).waitFor();
    const recentWork=page.getByRole('region',{name:'최근 업무'});
    const recentEntry=recentWork.getByRole('button',{name:/지난 현장 기록/});
    await recentEntry.waitFor();
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:844});
      const regions=await page.locator('#content[data-view=projects] > :is(.workspace-overview,.mobile-dashboard-panel)').evaluateAll(panels=>panels.map(panel=>{
        const rect=panel.getBoundingClientRect(),style=getComputedStyle(panel);
        return {left:rect.left,right:rect.right,padding:parseFloat(style.paddingLeft),overflow:panel.scrollWidth-panel.clientWidth};
      }));
      assert.equal(regions.length,5);
      assert(regions.every(r=>Math.abs(r.left-regions[0].left)<1&&Math.abs(r.right-regions[0].right)<1&&r.padding>=12&&r.overflow<=1),JSON.stringify({width,regions}));
    }
    await page.setViewportSize({width:390,height:844});
    const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/mobile/dashboard'&&response.ok());
    await btn('새로고침').click();
    await refreshed;
    await recentEntry.click();
    await page.getByRole('heading',{name:'지난 현장 기록',exact:true}).waitFor();
    await btn('대시보드로').click();
    await recentEntry.waitFor();
    await require('./mobile-shell-checks.cjs').checkMobileShell(page);
    await require('./mobile-shell-checks.cjs').checkWorkspaceSizes(page);
    const tail=archivedSession.messages.at(-1),savedTail={...tail};
    Object.assign(tail,{role:'assistant',text:'후속 업무도 진행할까요?'});
    await btn('대기 대화 1개').click();await page.getByRole('heading',{name:'대기 대화',exact:true}).waitFor();
    await page.getByRole('button',{name:/지난 현장 기록/}).waitFor();
    controller.runs.set(archived.id,{sessionId:archived.id});
    await page.getByText('대기 상태의 대화가 없습니다.',{exact:true}).waitFor();
    await btn('대시보드로').click();await btn('작업중 대화 1개').waitFor();
    const proposal=await workflow.action({action:'propose',kind:'next',sourceId:archived.id,title:'다음 단계 선택',text:'합성 제안'});
    await btn('결정 대화 1개').click();
    await page.getByRole('button',{name:/지난 현장 기록/}).click();
    await page.getByRole('heading',{name:'지난 현장 기록',exact:true}).waitFor();
    await page.locator('.chat-state[data-state="decision"]').waitFor();
    await btn('결정 대화 목록으로').click();await btn('대시보드로').click();
    await workflow.action({action:'reject',id:proposal.id,revision:proposal.revision});controller.runs.delete(archived.id);
    await btn('대기 대화 1개').click();
    await page.getByRole('button',{name:/지난 현장 기록/}).click();
    await page.getByLabel('요청',{exact:true}).fill('후속 완료 전에 적은 초안');
    await observeToast(page);
    await btn('완료').click();await btn('완료').waitFor({state:'detached'});
    assert.equal(await page.getByLabel('요청',{exact:true}).inputValue(),'후속 완료 전에 적은 초안');
    assert.equal(archivedSession.completedContinuationId,tail.id);assert.equal(archivedSession.messages.length,121);
    await verifyToast(page,'후속 대기를 완료했습니다.',()=>btn('대기 대화 목록으로').click());
    await page.getByText('대기 상태의 대화가 없습니다.',{exact:true}).waitFor();await btn('대시보드로').click();
    await btn('대기 대화 0개').waitFor();
    Object.assign(tail,savedTail);delete archivedSession.completedContinuationId;
    pages.length=0;
    await openProject();
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(pages.length, 0);
    await verifyChatLoading(page, () => page.getByRole("button", {name:/지난 현장 기록/}).click(), archived.id);
    await page.getByText("답사 기록 121", { exact: true }).waitFor();
    assert.equal(await page.locator(".message").count(), 50);
    assert.equal(
      await page.getByText("답사 기록 071", { exact: true }).count(),
      0,
    );
    await page.waitForFunction(()=>!document.querySelector('#content').getAnimations().some(animation=>animation.playState==='running'));
    assert(await page.evaluate(()=>document.scrollingElement.scrollHeight-innerHeight-scrollY<2),'처음 열면 최근 기록 위치');
    for (const [count,first] of [[100,'답사 기록 022'],[121,'답사 기록 001']]) {
      const before=await page.evaluate(()=>{
        const header=document.querySelector('.mobile-chat-heading').getBoundingClientRect().bottom;
        const timeline=document.querySelector('.mobile-timeline');
        window.scrollTo(0,scrollY+timeline.getBoundingClientRect().top-header+40);
        const visible=[...timeline.querySelectorAll('[data-message-id]')].find(element=>element.getBoundingClientRect().bottom>header);
        return {id:visible.dataset.messageId,y:visible.getBoundingClientRect().top};
      });
      await page.getByText(first,{exact:true}).waitFor();
      assert.equal(await page.locator('.message').count(),count);
      const restored=page.locator(`[data-message-id="${before.id}"]`);
      for(const delay of [0,80,280]){
        if(delay)await page.waitForTimeout(delay);
        const top=await restored.evaluate(el=>el.getBoundingClientRect().top);
        assert(Math.abs(top-before.y)<1.5,'이전 기록이 추가되는 동안 읽던 위치 유지 '+JSON.stringify({before,top,delay}));
      }
    }
    assert.equal(await btn("이전 메시지 더 보기").count(), 0);
    assert.equal(pages.filter((q) => q.before).length, 2);
    const anchor=page.getByText('답사 기록 060',{exact:true});
    await anchor.evaluate(el=>el.scrollIntoView({block:'center'}));
    const anchorTop=()=>anchor.evaluate(el=>el.getBoundingClientRect().top);
    const beforeTop=await anchorTop();
    await verifyRefreshingChat(page, archived.id, () => {
      archivedSession.messages.push(note(122));
      archivedSession.updatedAt = new Date().toISOString();
    }, anchor);
    await page.getByText("답사 기록 122", { exact: true }).waitFor();
    const afterTop=await anchorTop();
    await page.waitForTimeout(350);
    const settledTop=await anchorTop();
    assert.ok(Math.abs(afterTop-beforeTop)<=1 && Math.abs(settledTop-beforeTop)<=1,'새 메시지 뒤 읽던 위치 '+[beforeTop,afterTop,settledTop].join(' / '));
    console.log('휴대폰 상태 자동 갱신, 대기 / 작업중 / 결정 우선순위와 이동, 읽던 메시지의 화면 위치 '+[beforeTop,afterTop,settledTop].join(' / '));
    const streaming=archivedSession.messages.at(-1);
    controller.runs.set(archived.id,{sessionId:archived.id});
    controller.emit('event',{type:'status',sessionId:archived.id,status:'running',text:'파일 변경을 적용하고 있습니다.',details:'표시하지 않을 검사용 명령'});
    streaming.text='새 단계 확인 중';
    controller.emit('event',{type:'delta',sessionId:archived.id,text:'새 단계 확인 중'});
    await page.getByText(streaming.text,{exact:true}).waitFor();
    const progress=page.getByRole('button',{name:'작업 진행 중',exact:true});
    await page.getByRole('list',{name:'작업 과정'}).getByText('파일 변경을 적용하고 있습니다.',{exact:true}).waitFor();
    await progress.evaluate(button=>button.click());
    await page.getByRole('list',{name:'작업 과정'}).waitFor({state:'hidden'});
    await progress.evaluate(button=>button.click());
    assert.equal(await page.getByText('표시하지 않을 검사용 명령',{exact:true}).count(),0);
    streaming.text='다음 단계 확인';
    controller.emit('event',{type:'session',sessionId:archived.id});
    await page.getByText(streaming.text,{exact:true}).waitFor();
    assert.ok(Math.abs(await anchorTop()-beforeTop)<=1);
    controller.runs.delete(archived.id);
    await progress.waitFor({state:'detached'});
    await page.waitForTimeout(250);
    assert.equal(await page.locator(".message").count(), 122);
    const delivered = pages.length;
    await page.waitForTimeout(2250);
    assert.equal(
      pages.length,
      delivered,
      "바뀌지 않은 대화 본문은 상태 조회마다 전송하지 않습니다.",
    );
    locked = true;
    await page
      .getByRole("heading", { name: "작업 공간이 잠겼습니다" })
      .waitFor();
    assert.equal(await page.locator(".message").count(), 0);
    locked = false;
    await btn("다시 확인").click();
    await openProject();
    await btn("팀").click();
    await page.getByText("편집 팀 / 기획 / 교정", { exact: true }).waitFor();
    await btn("문서").click();
    await page.getByRole("button", { name: /안내.md/ }).click();
    await page.getByText("공개 전 확인할 항목", { exact: true }).waitFor();
    await btn("업무").click();
    await btn("새 업무 대화").click();
    await page.getByLabel("업무 유형").selectOption("research");
    await page.getByLabel("업무 이름").fill("현장 조사");
    await page.getByLabel("목표와 요청").fill("접근성을 살펴주세요.");
    await btn("대화 만들기").click();
    await page.getByRole("heading", { name: "현장 조사" }).waitFor();
    assert.equal(
      await page.getByLabel("요청", { exact: true }).inputValue(),
      "접근성을 살펴주세요.",
    );
    await btn("요청 보내기").click();
    await page.getByText("접근성을 살펴주세요.", { exact: true }).waitFor();
    await btn("승인함").click();
    await page.getByText("시험 파일 작성 요청").waitFor();
    await btn("이번 작업 승인").click();
    await page.getByText("대기 중인 승인 요청이 없습니다.").waitFor();
    assert.deepEqual(decisions, ["accept"]);
    const requestId = "업무 질문";
    const followup = {
      type: "input",
      requestId,
      sessionId: store.state.sessions[0].id,
      isBlocking: true,
      questions: [
        {
          id: "shape",
          header: "형식",
          question: "어떤 형식으로 작성할까요?",
          options: [
            { label: "표", description: "항목을 비교합니다." },
            { label: "요약", description: "짧은 글입니다." },
          ],
          isSecret: false,
          isOther: true,
        },
        {
          id: "memo",
          header: "범위",
          question: "추가할 내용을 적어 주세요.",
          options: [],
          isSecret: false,
          isOther: false,
        },
      ],
    };
    requests = [
      followup,
      {
        ...followup,
        requestId: "민감한 요청",
        questions: [
          {
            ...followup.questions[0],
            isSecret: true,
            question: "보이지 않을 비밀 제목",
          },
        ],
      },
    ];
    await page
      .getByText("이 질문은 데스크톱 Flowrium에서 확인하고 답해 주세요.")
      .waitFor();
    assert.equal(await page.getByText("보이지 않을 비밀 제목").count(), 0);
    assert.equal(await btn("이번 작업 승인").count(), 0);
    const pick = page.getByLabel("어떤 형식으로 작성할까요?", { exact: true }),
      free = page.getByLabel("추가할 내용을 적어 주세요.", { exact: true });
    await pick.selectOption("other");
    await page
      .getByLabel("어떤 형식으로 작성할까요? / 직접 입력", { exact: true })
      .fill("표와 그림");
    await free.fill("단계별 설명");
    store.state.sessions[0].updatedAt = new Date().toISOString();
    await page.waitForTimeout(2150);
    assert.equal(await free.inputValue(), "단계별 설명");
    assert.equal(
      await page
        .getByLabel("어떤 형식으로 작성할까요? / 직접 입력", { exact: true })
        .inputValue(),
      "표와 그림",
    );
    rejectNext = true;
    await btn("질문 답변 보내기").click();
    await page
      .locator("#notice")
      .filter({ hasText: "질문 응답 시험 실패" })
      .waitFor();
    assert.equal(await free.inputValue(), "");
    assert.equal(await pick.inputValue(), "");
    await pick.selectOption({ label: "표" });
    await page.getByText("항목을 비교합니다.", { exact: true }).waitFor();
    await free.fill("현장 기록 기준");
    await btn("질문 답변 보내기").click();
    await page
      .locator("#notice")
      .filter({ hasText: "질문에 답했습니다." })
      .waitFor();
    assert.deepEqual(answersReceived, [
      {
        requestId,
        answers: {
          shape: { answers: ["표"] },
          memo: { answers: ["현장 기록 기준"] },
        },
      },
    ]);
    requests = [{ ...followup, requestId: "잠금 시험" }];
    await free.fill("잠금 뒤 지워질 내용");
    locked = true;
    await page
      .getByRole("heading", { name: "작업 공간이 잠겼습니다" })
      .waitFor();
    assert.equal(await free.count(), 0);
    locked = false;
    await btn("다시 확인").click();
    await btn("승인함").click();
    await free.waitFor();
    assert.equal(await free.inputValue(), "");
    assert.equal(await pick.inputValue(), "");
    requests = [];
    await btn("실행 중").click();
    await page.getByRole("button", { name: /현장 조사/ }).click();
    await verifyStopSheet(page, () => Boolean(interrupted), () => {
      const session = store.state.sessions[0];
      session.updatedAt = new Date().toISOString();
      return {id:session.id, updatedAt:session.updatedAt};
    });
    await btn("요청 보내기").waitFor();
    assert.equal(interrupted, store.state.sessions[0].id);
    await page.getByLabel("요청", { exact: true }).fill("이어 쓸 내용");
    store.state.sessions[0].updatedAt = new Date().toISOString();
    await page.waitForTimeout(2150);
    assert.equal(
      await page.getByLabel("요청", { exact: true }).inputValue(),
      "이어 쓸 내용",
    );
    locked = true;
    await page
      .getByRole("heading", { name: "작업 공간이 잠겼습니다" })
      .waitFor();
    assert.equal(await page.getByText("현장 조사", { exact: true }).count(), 0);
    locked = false;
    await btn("다시 확인").click();
    await openProject();
    await page.reload();
    await openProject();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false);
    assert.equal(p.id, store.state.sessions[0].projectId);
    await require('./mobile-project-trust-checks.cjs').verifyMobileProjectTrust({page,store,temp,handlers,url:remote.localUrl});
    console.log(
      "모바일 실제 브라우저 검증 / 로컬 서버 인증과 키 제거 / 프로젝트·팀·문서 / 업무 대화 생성·요청·중단·승인 / 질문 선택·직접 입력·실패 복구·비밀 문항 차단 / 입력 보존 / 본문 없는 목록과 최근·이전 기록 / 잠금과 복원 / 가로폭",
    );
  } finally {
    if (window) await window.close();
    if (service) await service.shutdown();
    if (workflow) await workflow.shutdown();
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 200,
    });
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
