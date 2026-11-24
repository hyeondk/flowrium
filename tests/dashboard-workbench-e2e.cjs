const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const { updateDetails } = require('../electron/project-details.cjs');
const { saveArtifact } = require('../electron/workbench.cjs');
const { addTrustedFixtureProject, backendFixtureAccount } = require('./project-trust-fixture.cjs');
const { composer } = require('./shell-test-helpers.cjs');

async function main() {
  const root = path.join(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-dashboard-workbench-'));
  const output = process.env.FLOWRIUM_DASHBOARD_PREVIEW_DIR;
  let app;
  try {
    const profile = path.join(temp, 'profile');
    const store = new Store(profile);
    await store.load();
    const names = ['도시 산책 안내서','고객 인터뷰','스토어 매출 분석'];
    const projects = [];
    for (const name of names) {
      const folder = path.join(temp,name);
      await fs.mkdir(folder);
      projects.push(await addTrustedFixtureProject(store,folder,{account:backendFixtureAccount}));
    }
    const details = await updateDetails(store,projects[0].id,null,{
      action:'details',owner:'박지우',goal:'현장 확인 내역을 다음 안내서에 반영하기',dueDate:'2026-11-30',
    });
    await updateDetails(store,projects[0].id,details.revision,{action:'add',text:'횡단보도 안내 표지 다시 확인'});
    const message = (role,text) => ({id:randomUUID(),role,text,createdAt:new Date().toISOString()});
    const walkingAnswer = message('assistant','현장 점검을 마쳤습니다.\n\n다음 작업\n- 중앙역에서 공원까지 저녁 시간대 보행 시간을 실제로 측정해줘.');
    const walking = await store.createSession(projects[0].id,{title:'산책 지도 확인',messages:[
      message('user','산책 지도와 이동 시간을 확인해줘.'),walkingAnswer,
    ]});
    const interview = await store.createSession(projects[1].id,{title:'인터뷰 질문 정리',messages:[
      message('user','고객 인터뷰 질문을 정리해줘.'),
      message('assistant','인터뷰 질문 다섯 가지를 정리했습니다.\n\n다음 작업\n- 최근 인터뷰 답변에서 반복된 의견을 비교해줘.'),
    ]});
    await store.createSession(projects[2].id,{title:'10월 주문과 매출',messages:[
      message('user','가상 스토어의 월별 매출 흐름을 분석해줘.'),
      message('assistant','월별 매출 분석을 마쳤습니다. 10월 매출은 전월 대비 14.3% 올랐고 주문 수와 평균 주문 금액이 함께 늘었습니다.'),
    ]});
    await saveArtifact(store,walking.id,walkingAnswer.id);
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
    const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({args:[root],env,timeout:45000});
    const page=await app.firstWindow();
    page.setDefaultTimeout(15000);
    if (output) await page.emulateMedia({reducedMotion:'reduce'});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();
    const tools=page.getByRole('region',{name:'대시보드 작업 도구',exact:true});
    const tool=name=>tools.getByRole('button',{name,exact:true});
    const storedMessages=id=>page.evaluate(async sessionId=>(await window.flowrium.bootstrap()).sessions.find(row=>row.id===sessionId).messages, id);
    const snapshot=async (file,target=tools)=>{
      if (!output) return;
      await fs.mkdir(output,{recursive:true});
      await page.evaluate(()=>document.fonts.ready);
      await target.scrollIntoViewIfNeeded();
      await page.mouse.move(0,0);
      const bounds=await target.evaluate(node=>{
        if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
        const rect=node.getBoundingClientRect();
        return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight};
      });
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const png=await app.evaluate(async ({BrowserWindow},box)=>{
        const image=await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        const size=image.getSize(),scaleX=size.width/box.width,scaleY=size.height/box.height;
        const x=Math.max(0,Math.floor(box.left*scaleX)),y=Math.max(0,Math.floor(box.top*scaleY));
        const right=Math.min(size.width,Math.ceil(box.right*scaleX)),bottom=Math.min(size.height,Math.ceil(box.bottom*scaleY));
        return image.crop({x,y,width:right-x,height:bottom-y}).toPNG().toString('base64');
      },bounds);
      await fs.writeFile(path.join(output,file),Buffer.from(png,'base64'));
    };

    await tool('답변에서 할 일').click();
    const followup=tools.getByRole('region',{name:'답변에서 할 일 만들기',exact:true});
    const draft=followup.getByRole('textbox',{name:'프로젝트 할 일 초안'});
    await draft.waitFor();
    assert.match(await draft.inputValue(),/보행 시간을 실제로 측정해줘/);
    await snapshot('0-대시보드-전체.png',page.locator('.app-shell'));
    await snapshot('1-답변에서-할-일.png');
    const task='저녁 시간대 보행 시간 교차 확인';
    await draft.fill(task);
    const save=followup.getByRole('button',{name:'할 일로 저장',exact:true});
    await save.click();
    await followup.getByText('프로젝트 할 일에 저장했습니다.').waitFor();
    await save.click();
    await followup.getByText('같은 할 일이 이미 저장돼 있습니다.').waitFor();
    assert.equal((await page.evaluate(id=>window.flowrium.readProjectDetails(id),projects[0].id)).checklist.filter(item=>item.text===task).length,1);
    await followup.getByRole('button',{name:'대화 초안 열기',exact:true}).click();
    await composer(page).waitFor();
    assert.equal(await composer(page).inputValue(),task);
    assert.equal((await storedMessages(walking.id)).length,2);
    await page.waitForFunction(async id=>{
      const state=await window.flowrium.securityState();
      return (await window.flowrium.readDrafts(state.accountRevision))['session:'+id]?.text;
    },walking.id);

    await tool('업무 재개').click();
    const resume=tools.getByRole('region',{name:'이어갈 대화',exact:true});
    await resume.getByRole('button',{name:/산책 지도 확인.*미전송 초안/}).waitFor();
    await snapshot('3-업무-재개.png');
    await resume.getByRole('button',{name:/산책 지도 확인.*미전송 초안/}).click();
    assert.equal(await composer(page).inputValue(),task);
    assert.equal((await storedMessages(walking.id)).length,2);

    await tool('작업 묶음').click();
    const batch=tools.getByRole('region',{name:'프로젝트 일괄 지시',exact:true});
    await batch.getByRole('textbox',{name:'공통 지시',exact:true}).fill('이번 주 기록을 대조하고 빠진 확인 항목을 찾아줘.');
    for(const [project,session] of [[names[0],walking],[names[1],interview]]){
      await batch.getByRole('checkbox',{name:project,exact:true}).check();
      await batch.getByRole('combobox',{name:project+' 대화 선택',exact:true}).click();
      await page.getByRole('option',{name:session.title,exact:true}).click();
    }
    await batch.getByRole('button',{name:'초안 검토',exact:true}).click();
    await batch.getByRole('textbox',{name:names[1]+'에 보낼 내용',exact:true}).fill('고객 인터뷰 두 건에서 반복된 의견이 있는지 비교해줘.');
    assert.equal((await storedMessages(interview.id)).length,2);
    await batch.getByRole('checkbox',{name:names[0]+' 초안 선택',exact:true}).check();
    await batch.getByRole('checkbox',{name:names[1]+' 초안 선택',exact:true}).check();
    await snapshot('2-프로젝트-작업-묶음.png');
    await tool('완료 전 점검').click();
    const review=tools.getByRole('region',{name:'프로젝트 검토',exact:true});
    await review.getByText('현장 확인 내역을 다음 안내서에 반영하기').waitFor();
    await review.getByText(task,{exact:true}).waitFor();
    await review.locator('.dashboard-work-card').filter({hasText:'저장된 산출물'}).getByText(walking.title,{exact:true}).waitFor();
    await snapshot('4-완료-전-점검.png');
    await tool('작업 묶음').click();
    await batch.getByRole('checkbox',{name:names[0]+' 초안 선택',exact:true}).uncheck();
    await batch.getByRole('button',{name:'선택한 1개 초안 전송',exact:true}).click();
    await page.waitForFunction(async ({id,text})=>(await window.flowrium.bootstrap()).sessions.find(row=>row.id===id).messages.some(row=>row.role==='user'&&row.text===text),
      {id:interview.id,text:'고객 인터뷰 두 건에서 반복된 의견이 있는지 비교해줘.'});
    assert.equal((await storedMessages(walking.id)).length,2);
    assert.equal(await composer(page).inputValue(),task);

    await tool('완료 전 점검').click();
    await review.getByRole('button',{name:'검토 초안 작성',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Codex에 보낼 작업 요청"]')?.value.includes('아래 기록을 바탕으로 프로젝트를 검토해줘'));
    assert.equal((await storedMessages(walking.id)).length,2);

    for(const width of [320,390,800,1024,1440]){
      await page.setViewportSize({width,height:900});
      const frame=await tools.evaluate(node=>{
        const toolbar=node.firstElementChild;
        const style=getComputedStyle(toolbar), body=node.querySelector('.dashboard-work-body:not([hidden])');
        return {fit:toolbar.scrollWidth<=toolbar.clientWidth+1&&(!body||body.scrollWidth<=body.clientWidth+1),gap:parseFloat(style.columnGap),padding:parseFloat(style.paddingInlineStart)};
      });
      assert(frame.fit&&frame.gap>=6&&frame.padding>=6,JSON.stringify({width,frame}));
    }
    console.log('대시보드 작업 도구 / 원본 답변에서 체크리스트 저장 및 중복 방지 / 기존 대화 초안과 재개 / 선택한 프로젝트 1곳만 실제 시험 전송 / 산출물과 미완료 작업을 근거로 검토 초안 / 5개 창 폭 간격·가로 넘침 통과');
  } finally {
    await app?.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:3});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
