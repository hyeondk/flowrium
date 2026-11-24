const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID}=require('node:crypto');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const {trustFixtureProject,backendFixtureAccount,setFixtureAccountLinked}=require('./project-trust-fixture.cjs');
const {settledRail}=require('./shell-test-helpers.cjs');

async function run() {
  const root = path.resolve(__dirname, '..');
  const stage=process.env.FLOWRIUM_TEST_STAGE||path.join(root,'.flowrium-tmp','sidebar-validation');
  await fs.mkdir(stage,{recursive:true});
  const temp = await fs.mkdtemp(path.join(stage, 'sidebar-'));
  const profile = path.join(temp, 'profile');
  const store = new Store(profile);
  let app,page;
  let fixtureRuns=[];
  try {
    await store.load();
    let markerProject;
    for (let i = 0; i < 8; i++) {
      const folder = path.join(temp, '프로젝트 ' + i);
      await fs.mkdir(folder);
      const project=await store.addProject(folder);
      if(i===0)markerProject=project;
    }
    await store.createSession(markerProject.id,{title:'추가 입력 대기',messages:[{id:randomUUID(),role:'assistant',text:'계속 진행할까요?',createdAt:new Date().toISOString()}]});
    const runningSession=await store.createSession(markerProject.id,{title:'진행 상태 검증'});
    const decisionSession=await store.createSession(markerProject.id,{title:'결정 상태 검증'});
    fixtureRuns=[runningSession.id,decisionSession.id];
    await store.saveSettings({codexPath:path.join(__dirname, 'backend-fake-codex.cjs')});
    await trustFixtureProject(store,markerProject,{account:backendFixtureAccount});
    await setFixtureAccountLinked(profile);
    const env = {...process.env, FLOWRIUM_USER_DATA:profile, CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    if(process.env.FLOWRIUM_TEST_RENDERER_URL)env.ELECTRON_RENDERER_URL=process.env.FLOWRIUM_TEST_RENDERER_URL;
    else delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root], env});
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.setViewportSize({width:1440,height:900});
    const side = page.locator('.workspace-side');
    await side.waitFor();
    await page.evaluate(() => window.flowrium.connect());
    await page.locator('.side-usage-refresh strong').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await side.hover();
    if (await side.getAttribute('data-pinned') === 'true') await side.getByRole('button',{name:'메뉴 자동 접기'}).click();
    const markerRow=side.getByRole('button',{name:markerProject.name,exact:true});
    await markerRow.locator('[data-state=waiting]').waitFor();
    const markerGeometry=()=>markerRow.evaluate(row=>{
      const icon=row.querySelector('.side-project-icon>svg').getBoundingClientRect(),title=row.querySelector('strong').getBoundingClientRect();
      const count=row.querySelector('.side-project-count'),markers=row.querySelector('.side-project-markers');
      const scale=row.getBoundingClientRect().width/parseFloat(getComputedStyle(row).width);
      return {icon:[icon.x,icon.y,icon.width,icon.height],title:[title.x,title.y,title.height],height:parseFloat(getComputedStyle(row).height),
        count:count.textContent,background:getComputedStyle(count).backgroundColor,description:row.getAttribute('aria-description'),markerLabel:markers?.getAttribute('aria-label'),
        markers:[...row.querySelectorAll('.side-project-marker')].map(marker=>{const dot=marker.querySelector('i'),r=dot.getBoundingClientRect(),box=marker.getBoundingClientRect(),label=marker.querySelector('span').getBoundingClientRect();return {state:marker.dataset.state,label:marker.textContent,visible:getComputedStyle(marker).display!=='none',width:parseFloat(getComputedStyle(dot).width),height:parseFloat(getComputedStyle(dot).height),boxWidth:box.width/scale,contentLeft:(r.left-box.left)/scale,contentRight:(box.right-label.right)/scale,gap:(label.left-r.right)/scale,x:r.x,y:r.y,right:r.right}})};
    });
    const beforeMarkers=await markerGeometry();
    assert.deepEqual(beforeMarkers.markers.map(item=>[item.state,item.label]),[['waiting','대기']],'실제 발생한 상태만 폴더 위에 표시합니다.');
    assert(Math.abs(beforeMarkers.height-38)<.1,'상태 유무와 관계없이 프로젝트는 38px로 표시합니다.');
    await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'대기검증',mode:'plan'}),runningSession.id);
    await markerRow.locator('.side-project-marker[data-state=running]').waitFor();
    const runningMarkers=await markerGeometry();
    await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'승인검증',mode:'build'}),decisionSession.id);
    await page.waitForFunction(()=>document.querySelector('.side-project-markers')?.getAttribute('aria-label')==='작업중 1건 / 대기 1건 / 결정 1건');
    const afterMarkers=await markerGeometry();
    const bannerWidths=[beforeMarkers,runningMarkers,afterMarkers].map(measurement=>measurement.markers[0]);
    assert.deepEqual(bannerWidths.map(marker=>marker.state),['waiting','running','decision']);
    assert(bannerWidths.every(marker=>Math.abs(marker.boxWidth-38)<.1&&Math.abs(marker.gap-5)<.1),'세 상태 배너의 너비와 점 간격을 38px, 5px로 맞춥니다.');
    assert(Math.max(...bannerWidths.map(marker=>marker.boxWidth))-Math.min(...bannerWidths.map(marker=>marker.boxWidth))<.1,'상태 이름 길이가 달라도 배너 너비는 같습니다.');
    assert(bannerWidths.every(marker=>marker.contentLeft>=.9&&marker.contentRight>=.9&&Math.abs(marker.contentLeft-marker.contentRight)<.1),'점과 글자를 포함한 전체 콘텐츠의 좌우 안쪽 여백을 대칭으로 유지합니다. '+JSON.stringify(bannerWidths));
    console.log(JSON.stringify({bannerWidths:bannerWidths.map(({state,boxWidth,contentLeft,contentRight})=>({state,boxWidth,contentLeft,contentRight}))}));
    assert.deepEqual(afterMarkers.markers.map(item=>item.state),['decision'],'대표 배너만 렌더링하고 상세 상태는 접근성 설명에 보존합니다.');
    assert.equal(afterMarkers.count,'3','오른쪽 숫자는 작업 상태가 아닌 전체 대화 수입니다.');
    assert.equal(afterMarkers.background,'rgba(0, 0, 0, 0)','대화 수에 채움 배경을 넣지 않습니다.');
    for(const label of ['작업중 1건','대기 1건','결정 1건']){
      assert(afterMarkers.markerLabel.includes(label));
      assert(afterMarkers.description.includes(label));
    }
    assert.deepEqual(afterMarkers.markers.filter(marker=>marker.visible).map(marker=>marker.state),['decision'],'복합 상태에서는 결정 / 작업중 / 대기 우선순위의 대표 배너 하나만 보입니다.');
    assert([...afterMarkers.icon,...afterMarkers.title].every((value,index)=>Math.abs(value-[...beforeMarkers.icon,...beforeMarkers.title][index])<.1),'상태가 늘어나도 폴더와 제목의 가로·세로 좌표가 바뀌지 않습니다.');
    assert(Math.abs(afterMarkers.height-38)<.1,'복합 상태도 38px 행과 기존 아이콘 좌표를 유지합니다.');
    assert(Math.abs(afterMarkers.icon[1]+afterMarkers.icon[3]/2-afterMarkers.title[1]-afterMarkers.title[2]/2)<1,'폴더와 프로젝트 이름의 중심을 맞춥니다.');
    console.log(JSON.stringify({multipleStates:afterMarkers.markers.map(item=>[item.state,item.label]),conversationCount:afterMarkers.count,markerSize:4,singleHeight:beforeMarkers.height,multipleHeight:afterMarkers.height}));
    const sample = () => side.evaluate(node => {
      const icons = node.querySelectorAll('.side-brand img, nav>.side-row>svg, .side-project-section-icon, .side-project-head button svg, .side-project-icon>svg, .side-group .side-row>svg, .side-usage-refresh>svg, .settings-button>svg');
      const nav=node.querySelector('nav'),navBox=nav.getBoundingClientRect();
      const projects=[...node.querySelectorAll('.side-project')].map(e=>{
        const r=e.getBoundingClientRect();return {height:parseFloat(getComputedStyle(e).height),states:Number(e.dataset.statusCount),top:r.top,bottom:r.bottom};
      });
      const projectCenters=[...node.querySelectorAll('.side-project')].map(e=>{
        const r=e.getBoundingClientRect();return r.top+r.height/2;
      });
      const scale=node.getBoundingClientRect().width/parseFloat(getComputedStyle(node).width);
      const primaryRows=[...node.querySelectorAll('.side-dashboard,.side-project-head,.side-project')].map(row=>{
        const box=row.getBoundingClientRect(),label=row.querySelector('h2,.side-project-label strong,.side-dashboard>span').getBoundingClientRect();
        const icon=row.querySelector('svg').getBoundingClientRect();
        const mid=rect=>rect.top+rect.height/2;
        return {height:box.height/scale,top:box.top/scale,bottom:box.bottom/scale,
          textX:label.left/scale,iconX:icon.left/scale,textOffset:(mid(label)-mid(box))/scale,iconOffset:(mid(icon)-mid(box))/scale};
      });
      const usageBox=node.querySelector('.side-usage').getBoundingClientRect();
      const footerBox=node.querySelector('.side-foot').getBoundingClientRect();
      const accountBox=node.querySelector('.side-account-actions').getBoundingClientRect();
      const reset=node.querySelector('.side-usage-reset'),credit=node.querySelector('.side-credit-row');
      const contentClearances=[...node.querySelectorAll('.side-project-label strong,.side-project-count,.side-group .side-row>span')].filter(el=>getComputedStyle(el).visibility==='visible').map(el=>{
        const text=el.getBoundingClientRect(),box=el.closest('button').getBoundingClientRect();
        return [text.top-box.top,box.bottom-text.bottom].map(value=>value/scale);
      }).flat();
      const storage=node.querySelector('.side-storage').getBoundingClientRect(),tools=node.querySelector('.side-tools').getBoundingClientRect();
      const projectHead=node.querySelector('.side-project-head').getBoundingClientRect(),add=node.querySelector('.side-project-add'),addBox=add.getBoundingClientRect();
      const firstFolder=node.querySelector('.side-project-icon>svg').getBoundingClientRect();
      const sectionIcon=node.querySelector('.side-project-section-icon').getBoundingClientRect();
      const footerButtons=[...node.querySelectorAll('.side-account-actions>.side-row')].map(button=>{
        const rect=button.getBoundingClientRect(),label=button.querySelector('span'),labelRect=label.getBoundingClientRect(),icon=button.querySelector('svg').getBoundingClientRect();
        return {name:button.getAttribute('aria-label'),width:rect.width/scale,labelLeft:labelRect.left/scale,labelVisible:getComputedStyle(label).visibility==='visible',iconX:(icon.x+icon.width/2)/scale,labelGap:(labelRect.left-icon.right)/scale};
      });
      const surface=node.querySelector('.sidebar-surface').getBoundingClientRect();
      const statusProjects=[...node.querySelectorAll('.side-project:has(.side-project-markers)')].map(row=>{
        const box=row.getBoundingClientRect(),svg=row.querySelector('.side-project-icon>svg'),icon=svg.getBoundingClientRect(),outline=svg.querySelector('path'),markers=row.querySelector('.side-project-markers').getBoundingClientRect(),outlineTop=outline.getBoundingClientRect().top-parseFloat(getComputedStyle(outline).strokeWidth)*icon.width/24/2;
        return {states:[...row.querySelectorAll('.side-project-marker')].filter(marker=>getComputedStyle(marker).display!=='none').map(marker=>{const dot=marker.querySelector('i').getBoundingClientRect(),label=marker.querySelector('span').getBoundingClientRect(),rect=marker.getBoundingClientRect();return {state:marker.dataset.state,label:marker.textContent,color:getComputedStyle(marker.querySelector('i')).backgroundColor,fontSize:parseFloat(getComputedStyle(marker).fontSize),radius:parseFloat(getComputedStyle(marker).borderRadius),innerTop:(label.top-rect.top)/scale,innerBottom:(rect.bottom-label.bottom)/scale,left:rect.left/scale,right:rect.right/scale,top:rect.top/scale,bottom:rect.bottom/scale,dotGap:(label.left-dot.right)/scale,visible:getComputedStyle(marker).visibility==='visible'&&label.left>=surface.left&&label.right<=surface.right};}),topGap:(markers.top-box.top)/scale,iconOverlap:(markers.bottom-outlineTop)/scale,titleGap:(row.querySelector('.side-project-label').getBoundingClientRect().left-markers.right)/scale};
      });
      return {
        positions:[...icons].map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];}),
        percentages:node.querySelector('.side-usage').innerText.match(/\d+%/g)||[],
        credits:!!node.querySelector('.side-credit-row'), projects, primaryRows,
        projectListHeight:parseFloat(getComputedStyle(node.querySelector('.side-project-list')).height),
        largestNavGap:Math.max(...projectCenters.slice(1).map((y,i)=>(y-projectCenters[i])/scale)),
        lastToolBottom:node.querySelector('.side-tools .side-row:last-child').getBoundingClientRect().bottom,
        navBottom:navBox.bottom, footerTop:footerBox.top,
        width:parseFloat(getComputedStyle(node).width),surfaceWidth:parseFloat(getComputedStyle(node.querySelector('.sidebar-surface')).width),
        misplacedUtilities:node.querySelectorAll('.side-search,.command-trigger,.side-utility-actions,.assistant-entry,.header-music,.header-decisions,.dock-toggle,[aria-label="음악"],[aria-label="개인 비서"]').length,
        folderIconsVisible:[...node.querySelectorAll('.side-project-icon>svg')].every(icon=>getComputedStyle(icon).visibility==='visible'),
        markersVisible:[...node.querySelectorAll('.side-project-markers i')].every(marker=>getComputedStyle(marker).visibility==='visible'),
        usageGaps:[(usageBox.top-footerBox.top)/scale,(accountBox.top-usageBox.bottom)/scale],
        textClearance:contentClearances.length?Math.min(...contentClearances):null,
        lowerGroupGap:(tools.top-storage.bottom)/scale,
        usageTextGaps:reset&&credit?[reset.getBoundingClientRect().top-node.querySelector('.side-usage-refresh').getBoundingClientRect().bottom,credit.getBoundingClientRect().top-reset.getBoundingClientRect().bottom,usageBox.bottom-credit.getBoundingClientRect().bottom].map(value=>value/scale):null,
        addProject:{visible:getComputedStyle(add).visibility==='visible',tabIndex:add.tabIndex,ariaHidden:add.getAttribute('aria-hidden'),rightGap:(projectHead.right-addBox.right)/scale,titleLeft:node.querySelector('.side-project-head h2').getBoundingClientRect().left,top:projectHead.top,height:projectHead.height},
        brandGap:(navBox.top-node.querySelector('.side-brand-row').getBoundingClientRect().bottom)/scale,
        groupIconAligned:Math.abs((sectionIcon.x+sectionIcon.width/2)-(firstFolder.x+firstFolder.width/2))/scale,
        groupTitleAligned:Math.abs(node.querySelector('.side-project-head h2').getBoundingClientRect().left-node.querySelector('.side-project-label strong').getBoundingClientRect().left)/scale,
        footerButtons,footerIconAligned:Math.abs(footerButtons[0].iconX-(firstFolder.x+firstFolder.width/2)/scale),
        statusProjects,bottomSummaryCount:node.querySelectorAll('.side-execution,.execution-summary').length,
        functionWeights:[...node.querySelectorAll('.side-row:not(.side-project)>span,.side-project-head h2')].map(el=>Number(getComputedStyle(el).fontWeight)),
        titleSizes:[node.querySelector('.side-dashboard>span'),node.querySelector('.side-project-head h2')].map(el=>parseFloat(getComputedStyle(el).fontSize)),
      };
    });
    for (const height of [900,800,680]) {
      await page.setViewportSize({width:1440,height});
      await side.locator('nav').evaluate(el=>{el.scrollTop=0});
      await page.mouse.move(900,80);
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
      await side.locator('.sidebar-surface').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
      const closed = await sample();
      if(height===800&&process.env.FLOWRIUM_SIDEBAR_CAPTURE)await side.locator('.sidebar-surface').screenshot({path:path.join(stage,'sidebar-collapsed.png')});
      await side.hover();
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='true');
      await side.locator('.sidebar-surface').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
      const open = await sample();
      assert.equal(open.positions.length,closed.positions.length);
      assert(open.positions.length>=13);
      const drift = Math.max(...open.positions.flatMap((p,i)=>p.map((n,j)=>Math.abs(n-closed.positions[i][j]))));
      console.log(JSON.stringify({height,icons:open.positions.length,drift,closed:closed.percentages,open:open.percentages,projects:open.projects.length,projectHeight:open.projects[0].height,largestNavGap:open.largestNavGap,misplacedUtilities:[closed.misplacedUtilities,open.misplacedUtilities],usageGaps:open.usageGaps}));
      assert(drift<=1,'접고 펼쳐도 아이콘 중심 이동이 1px 이하여야 합니다.');
      assert.equal(closed.misplacedUtilities,0,'개인 비서 / 음악 / 알림 / 대화함 보조 버튼을 좌측에 중복 표시하지 않습니다.');
      assert.equal(open.misplacedUtilities,0,'좌측 패널을 펼쳐도 이동한 보조 버튼이 나타나지 않습니다.');
      assert(!closed.addProject.visible&&closed.addProject.tabIndex===-1&&closed.addProject.ariaHidden==='true','접힌 레일의 프로젝트 추가 버튼은 보이지 않고 초점을 받지 않습니다.');
      assert(open.addProject.visible&&open.addProject.tabIndex===0&&open.addProject.ariaHidden==='false','펼친 패널에서 프로젝트 추가 버튼에 접근할 수 있습니다.');
      assert(open.addProject.rightGap>=4&&open.addProject.rightGap<=6,'프로젝트 추가 버튼은 제목 행의 오른쪽 끝에 놓입니다.');
      assert(open.brandGap>=11&&open.brandGap<=13,'브랜드 아래에 약12px 간격을 둡니다.');
      assert(open.groupIconAligned<1&&open.groupTitleAligned<1,'프로젝트 묶음 아이콘과 제목은 실제 프로젝트의 아이콘·제목 열에 정렬합니다.');
      assert(Math.abs(open.titleSizes[0]-open.titleSizes[1])<.1&&open.functionWeights.every(weight=>weight>=700),'프로젝트 제목 크기를 대시보드와 맞추고 기능 이름을 굵게 표시합니다.');
      for(const state of [closed,open]){
        assert.equal(state.bottomSummaryCount,0,'좌측 하단에 전체 상태 세 행을 반복 표시하지 않습니다.');
        assert.equal(state.statusProjects.length,1,'상태가 없는 프로젝트에는 빈 상태 공간을 만들지 않습니다.');
        for(const project of state.statusProjects){
          assert.deepEqual(project.states.map(row=>[row.state,row.label]),[['decision','결정']]);
          assert(project.topGap>=1.8&&project.iconOverlap>=2.9&&project.iconOverlap<=5.1&&project.titleGap>=.9,'배너는 행 안에서 실제 폴더 윗 테두리에 3~5px 겹치며 제목과 양수 간격을 둡니다. '+JSON.stringify(project));
          assert(project.states.every(row=>row.visible&&row.fontSize===8.5&&row.dotGap>=1.9&&row.radius===3&&row.innerTop>=.9&&row.innerBottom>=.9),'접혀 있어도 색상 점과 8.5px 상태 이름을 읽을 수 있습니다.');
          assert.equal(new Set(project.states.map(row=>row.color)).size,1,'대표 상태의 기존 색을 유지합니다.');
          assert.equal(project.states.length,1,'접힘과 펼침 모두 대표 배너 하나만 표시합니다.');
        }
      }
      console.log(JSON.stringify({height,projectStatuses:closed.statusProjects,titleSizes:open.titleSizes,functionWeights:open.functionWeights}));
      assert.deepEqual(open.footerButtons.map(button=>button.name),['설정','잠금','로그아웃']);
      assert(open.footerButtons.every(button=>button.labelVisible)&&closed.footerButtons.every(button=>!button.labelVisible),'펼침에서 하단 라벨을 보이고 접힘에서는 글자를 강제 표시하지 않습니다.');
      assert(Math.max(...open.footerButtons.map(button=>button.width))-Math.min(...open.footerButtons.map(button=>button.width))<.1,'하단 세 버튼의 열 너비를 같게 맞춥니다.');
      const footerLabelSteps=open.footerButtons.slice(1).map((button,index)=>button.labelLeft-open.footerButtons[index].labelLeft);
      assert(Math.abs(footerLabelSteps[0]-footerLabelSteps[1])<.1,'하단 라벨 시작점은 같은 간격으로 정렬합니다.');
      assert(open.footerButtons.every(button=>button.labelGap>=2.5&&button.labelGap<=3.5)&&open.footerIconAligned<1,'하단 아이콘·라벨 간격을 맞추고 설정 아이콘 열을 유지합니다.');
      for(const key of ['titleLeft','top','height'])assert(Math.abs(open.addProject[key]-closed.addProject[key])<1,'추가 버튼 노출 전후 제목과 프로젝트 목록의 기준 좌표를 유지합니다.');
      assert(closed.folderIconsVisible&&open.folderIconsVisible&&closed.markersVisible&&open.markersVisible,'접힘과 펼침 모두 폴더와 실제 작업 상태를 표시합니다.');
      for(const gap of [...closed.usageGaps,...open.usageGaps])assert(gap>=4&&gap<=6,'사용량 위아래에 각각 약5px 간격을 둡니다.');
      assert(open.textClearance>=2,'프로젝트와 도구 문구가 행의 위아래 경계에 붙지 않습니다.');
      assert(open.lowerGroupGap>=3,'보관과 도구 그룹 사이에 여백을 유지합니다.');
      assert(open.usageTextGaps?.every(gap=>gap>=3),'사용량 / 초기화 날짜 / 크레딧 / 하단 경계에 0px 맞닿음이나 겹침이 없습니다.');
      console.log(JSON.stringify({height,textClearance:open.textClearance,lowerGroupGap:open.lowerGroupGap,usageTextGaps:open.usageTextGaps}));
      assert(Math.abs(closed.width-56)<0.1);
      assert(Math.abs(open.surfaceWidth-236)<0.1);
      assert.equal(open.projects.length,8);
      assert(open.projects.every(p=>Math.abs(p.height-38)<0.1),'상태 유무와 개수에 관계없이 프로젝트 행을 38px로 유지합니다.');
      assert(open.projects.slice(1).every((project,index)=>project.top-open.projects[index].bottom>=1.9),'인접한 프로젝트 선택 면 사이에 실제 2px 간격을 유지합니다.');
      assert(Math.abs(open.projectListHeight-(open.projects.reduce((sum,p)=>sum+p.height,0)+2*open.projects.length))<.2,'실제 행과 2px 간격 이외의 예약 공간은 없습니다.');
      for(const {primaryRows} of [closed,open]){
        assert(primaryRows.every(row=>Math.abs(row.height-38)<.1),'대시보드, 프로젝트 제목, 프로젝트 행 높이 38px');
        assert(primaryRows.slice(1).every((row,i)=>Math.abs(row.top-primaryRows[i].bottom-2)<.1),'대시보드에서 마지막 프로젝트까지 행 사이 간격 2px');
        assert(primaryRows.every(row=>Math.abs(row.textOffset)<.1&&Math.abs(row.iconOffset)<.1),'글자와 아이콘을 각 행의 높이 중앙에 맞춥니다.');
        assert(primaryRows.every(row=>Math.abs(row.textX-primaryRows[0].textX)<.1&&Math.abs(row.iconX-primaryRows[0].iconX)<.1),
          '대시보드, 프로젝트 제목과 행의 왼쪽 기준선을 맞춥니다. '+JSON.stringify(primaryRows.slice(0,3)));
      }
      assert(Math.abs(open.largestNavGap-40)<.1,'모든 프로젝트 아이콘의 중심 간격을 40px로 유지합니다.');
      assert(open.lastToolBottom>=open.navBottom-2,'도구 그룹은 기존처럼 탐색 영역 아래쪽에 있습니다.');
      assert(open.navBottom<=open.footerTop,'탐색 스크롤은 하단 사용량과 설정을 가리지 않습니다.');
      if(height>=800){
        assert(open.projects.every(p=>p.bottom<=open.navBottom+1),'높이 800px 이상에서 8개 프로젝트가 모두 보여야 합니다.');
        assert(open.lastToolBottom<=open.navBottom+1,'높이 800px 이상에서 마지막 도구까지 초기 화면에 보여야 합니다. '+JSON.stringify({lastToolBottom:open.lastToolBottom,navBottom:open.navBottom}));
      }
      assert.deepEqual(open.percentages,['63%']);
      assert.deepEqual(closed.percentages,['63%']);
      assert(!closed.credits && open.credits);
    }
    await page.locator('.flow-question-notice[data-tone=question]').waitFor({state:'hidden',timeout:12000});
    for(const [state,title] of [['running','진행 상태 검증'],['waiting','추가 입력 대기'],['decision','결정 상태 검증']]){
      await page.locator('.statusbar .execution-summary [data-state='+state+']').click();
      await page.waitForFunction(value=>document.querySelector('.dock-status-tabs [data-state='+value+']')?.getAttribute('aria-pressed')==='true',state);
      await page.locator('.dock-session-list').waitFor();
      const names=await page.locator('.dock-session strong').allTextContents();
      const expectedTitle=state==='waiting'?title:await page.evaluate(async id=>(await window.flowrium.bootstrap()).sessions.find(session=>session.id===id)?.title,state==='running'?runningSession.id:decisionSession.id);
      assert.deepEqual(names,[expectedTitle],'기존 전체 상태 필터에서 해당 대화만 보입니다.');
    }
    console.log(JSON.stringify({projectStatusLabelsVisible:true,bottomSidebarSummary:false,existingFilters:true,statusLabels:['작업중','대기','결정']}));
    await page.setViewportSize({width:1440,height:800});
    await side.locator('nav').evaluate(el=>{el.scrollTop=el.scrollHeight});
    const bottomReachable=await side.evaluate(node=>{
      const nav=node.querySelector('nav').getBoundingClientRect();
      const last=node.querySelector('.side-tools .side-row:last-child').getBoundingClientRect();
      return last.top>=nav.top&&last.bottom<=nav.bottom+1;
    });
    assert(bottomReachable,'짧은 화면에서도 스크롤하여 마지막 도구에 접근할 수 있어야 합니다.');
    await side.hover();
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='true');
    await side.getByRole('button',{name:'메뉴 고정',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.pinned==='true');
    await page.mouse.move(900,80);
    await settledRail(side,{expanded:true,pinned:true},'포인터를 옮겨도 메뉴 고정 유지');
    assert.equal(await page.evaluate(()=>localStorage.getItem('flowrium.navigation.pinned')),'true');
    await side.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();
    await page.mouse.move(900,80);
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
    await page.keyboard.press('Tab');
    await side.locator('.side-brand').focus();
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='true');
    await side.locator('.side-account-actions').getByRole('button',{name:'로그아웃',exact:true}).waitFor();
    const credits=side.locator('.side-credit-row');
    await credits.waitFor();
    assert.equal(await credits.getAttribute('data-active'),'false');
    const setUsage=async usedPercent=>{
      await app.evaluate(({ipcMain},usedPercent)=>{
        ipcMain.removeHandler('flowrium:readAccountUsage');
        ipcMain.handle('flowrium:readAccountUsage',()=>({allowed:null,checkedAt:Date.now(),credits:{hasCredits:true,unlimited:false,balance:'1234.50'},buckets:[{name:'Codex',plan:'pro',windows:[{key:'primary',usedPercent,minutes:null,resetsAt:1900000000000}]}]}));
      },usedPercent);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await credits.and(side.locator('[data-active="'+(usedPercent>=100)+'"]')).waitFor();
      return Number(await credits.locator('.side-credit-balance').evaluate(element=>getComputedStyle(element).fontWeight));
    };
    assert.equal(await setUsage(100),700);
    assert.equal(await setUsage(37),400);
    const addProjectButton=side.getByRole('button',{name:'프로젝트 추가',exact:true});
    await addProjectButton.focus();
    assert(await addProjectButton.evaluate(el=>el.matches(':focus-visible')),'프로젝트 추가 버튼에 키보드 초점을 표시합니다.');
    await page.keyboard.press('Enter');
    await page.locator('.main-shell[data-view=kickoff]').waitFor();
    await side.getByRole('button',{name:'대시보드',exact:true}).click();
    await page.locator('.main-shell[data-view=dashboard]').waitFor();
    const dashboard=side.getByRole('button',{name:'대시보드',exact:true});
    const dashboardFill=()=>dashboard.evaluate(el=>({background:getComputedStyle(el).backgroundColor,before:getComputedStyle(el,'::before').display,current:el.getAttribute('aria-current')}));
    await dashboard.hover();
    const hoverDashboard=await dashboardFill();
    await page.mouse.down();
    const pressedDashboard=await dashboardFill();
    await page.mouse.up();
    for(const state of [hoverDashboard,pressedDashboard]){
      assert.equal(state.background,'rgba(0, 0, 0, 0)','대시보드는 선택·호버·누름 상태에서도 채운 배경을 만들지 않습니다.');
      assert.equal(state.before,'none');assert.equal(state.current,'page');
    }
    await page.keyboard.press('Tab');await dashboard.focus();
    assert(await dashboard.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle!=='none'),'대시보드의 키보드 초점 표시를 유지합니다.');
    await side.hover();
    await addProjectButton.click();
    await page.locator('.main-shell[data-view=kickoff]').waitFor();
    await side.getByRole('button',{name:'대시보드',exact:true}).click();
    await page.locator('.main-shell[data-view=dashboard]').waitFor();
    await side.locator('.side-usage-refresh').hover();
    await page.waitForFunction(()=>document.querySelector('#flowrium-icon-tip')?.textContent.startsWith('63% 남음\n('));
    const usageTooltip=await page.locator('#flowrium-icon-tip').evaluate(el=>{
      const r=el.getBoundingClientRect();return {text:el.textContent,whiteSpace:getComputedStyle(el).whiteSpace,inViewport:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};
    });
    assert.match(usageTooltip.text,/^63% 남음\n\(.+ 초기화\)$/);
    assert.equal(usageTooltip.whiteSpace,'pre-line');
    assert(usageTooltip.inViewport,'날짜가 두 번째 줄인 사용량 도움말이 화면 밖으로 나가지 않습니다.');
    console.log(JSON.stringify({pin:true,keyboard:true,lastToolReachable:bottomReachable,addProjectRight:true,addProjectKeyboard:true,addProjectPointer:true,usageTooltip}));
    const readBackground=()=>side.locator('.sidebar-surface').evaluate(el=>{
      const style=getComputedStyle(el),rootStyle=getComputedStyle(document.documentElement);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const context=canvas.getContext('2d');
      const rgba=color=>{
        context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);
        return [...context.getImageData(0,0,1,1).data];
      };
      const stops=[...style.backgroundImage.matchAll(/(?:rgba?|color)\([^)]*\)/g)].map(match=>rgba(match[0]));
      return {image:style.backgroundImage,color:style.backgroundColor,stops,
        darkStops:['--sidebar','--bg'].map(token=>rgba(rootStyle.getPropertyValue(token).trim())),
        workspaceImage:getComputedStyle(document.querySelector('.app-shell')).backgroundImage,
        markerColors:[...el.querySelectorAll('.side-project-marker')].map(marker=>{const computed=getComputedStyle(marker);return {text:rgba(computed.color),background:rgba(computed.backgroundColor)}}),
        colors:Object.fromEntries(['--panel','--panel-alt','--text','--muted','--accent-ink','--accent-soft','--accent-fill','--on-primary'].map(token=>[token,rgba(rootStyle.getPropertyValue(token).trim())]))};
    });
    const settledBackground=async()=>{
      await side.locator('.sidebar-surface').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
      return readBackground();
    };
    const contrast=(a,b)=>{
      const luminance=rgb=>rgb.slice(0,3).map(channel=>channel/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
      const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);
    };
    const lightStops={blue:[[222,235,250,255],[237,244,252,255]],green:[[223,238,229,255],[237,246,240,255]],purple:[[233,225,245,255],[243,238,249,255]]};
    const workspaceBackgrounds={light:[],dark:[]};
    for(const theme of ['light','dark'])for(const accentColor of ['blue','green','purple']){
      await page.evaluate(settings=>window.flowrium.saveSettings(settings),{theme,accentColor});
      await page.reload();
      await side.waitFor();
      await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
      await page.waitForFunction(accent=>document.documentElement.dataset.accent===accent,accentColor);
      await page.evaluate(()=>document.fonts.ready);
      if(await side.getAttribute('data-pinned')==='true'){
        await side.hover();
        await side.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();
      }
      await page.mouse.move(900,80);
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
      const collapsed=await settledBackground();
      await side.hover();
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='true');
      const hovered=await settledBackground();
      await side.getByRole('button',{name:'메뉴 고정',exact:true}).click();
      await page.mouse.move(900,80);
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.pinned==='true');
      const pinned=await settledBackground();
      assert.notEqual(collapsed.image,'none','좌측 패널은 접힘 상태에도 정해진 그라데이션을 사용합니다.');
      for(const state of [hovered,pinned]){
        assert.equal(state.image,collapsed.image,'호버나 고정으로 바뀌어도 배경 그라데이션을 유지합니다.');
        assert.equal(state.color,collapsed.color,'호버나 고정으로 바뀌어도 배경색을 유지합니다.');
      }
      const expected=theme==='light'?lightStops[accentColor]:collapsed.darkStops;
      for(const state of [collapsed,hovered,pinned])assert.deepEqual(state.stops,expected,'각 강조색의 그라데이션을 접힘·호버·고정에서 동일하게 유지합니다.');
      if(theme==='dark')assert(collapsed.stops.every(([r,g,b,a])=>Math.max(r,g,b)<160&&a===255),'어두운 모드의 좌측 패널이 흰색이나 투명한 배경으로 바뀌지 않습니다.');
      const colors=collapsed.colors;
      const markerRatios=collapsed.markerColors.map(colors=>contrast(colors.text,colors.background));
      assert(markerRatios.length>0&&markerRatios.every(ratio=>ratio>=4.5),'모든 테마에서 작은 상태 박스의 글자 대비를 4.5 이상 유지합니다. '+JSON.stringify(markerRatios));
      const ratios={body:contrast(colors['--text'],colors['--panel']),muted:Math.min(...collapsed.stops.map(stop=>contrast(colors['--muted'],stop))),selected:contrast(colors['--accent-ink'],colors['--accent-soft']),primary:contrast(colors['--on-primary'],colors['--accent-fill'])};
      assert(Object.values(ratios).every(ratio=>ratio>=4.5),'본문 / 보조 문구 / 선택 상태 / 강조 버튼의 대비를 4.5 이상 유지합니다. '+JSON.stringify({theme,accentColor,ratios}));
      workspaceBackgrounds[theme].push(collapsed.workspaceImage);
      const shortcut=await page.locator('.main-shell>.topbar .header-search kbd').evaluate(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize),weight:Number(getComputedStyle(el).fontWeight),visible:getComputedStyle(el).display!=='none'}));
      assert(shortcut.visible&&shortcut.size>=12.9&&shortcut.weight>=700&&/^(⌘|Ctrl) K$/.test(shortcut.text),'상단 검색 단축키를 플랫폼에 맞게 13px 굵기로 보여줍니다. '+JSON.stringify(shortcut));
      console.log(JSON.stringify({theme,accentColor,sameBackground:true,colors:collapsed.stops,contrast:ratios,markerContrast:markerRatios,shortcut}));
      if(process.env.FLOWRIUM_SIDEBAR_CAPTURE)await side.locator('.sidebar-surface').screenshot({path:path.join(stage,`sidebar-${theme}-${accentColor}.png`)});
    }
    assert.equal(new Set(workspaceBackgrounds.light).size,3,'밝은 모드의 앱 바깥 배경은 선택한 강조색에 따라 달라집니다.');
    assert.equal(new Set(workspaceBackgrounds.dark).size,1,'어두운 모드의 앱 바깥 배경은 모든 강조색에서 같은 중립색을 유지합니다.');
  } finally {
    if(page&&!page.isClosed())await page.evaluate(async ids=>{for(const sessionId of ids)try{await window.flowrium.interrupt(sessionId)}catch{}},fixtureRuns).catch(()=>{});
    if(app) await app.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
