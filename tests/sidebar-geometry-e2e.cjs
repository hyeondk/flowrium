const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID}=require('node:crypto');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const {trustFixtureProject,backendFixtureAccount}=require('./project-trust-fixture.cjs');

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
      const icon=row.querySelector('.side-project-icon>svg').getBoundingClientRect();
      const title=row.querySelector('strong').getBoundingClientRect();
      const count=row.querySelector('.side-project-count'),counterStyle=getComputedStyle(count);
      const markers=row.querySelector('.side-project-markers');
      return {icon:[icon.x,icon.y,icon.width,icon.height],title:[title.x,title.y],
        count:count.textContent,background:counterStyle.backgroundColor,description:row.getAttribute('aria-description'),
        markerLabel:markers?.getAttribute('aria-label'),
        markers:[...row.querySelectorAll('.side-project-markers i')].map(marker=>{const r=marker.getBoundingClientRect();return {state:marker.dataset.state,width:parseFloat(getComputedStyle(marker).width),height:parseFloat(getComputedStyle(marker).height),x:r.x,y:r.y,right:r.right}})};
    });
    const beforeMarkers=await markerGeometry();
    await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'대기검증',mode:'plan'}),runningSession.id);
    await page.evaluate(id=>window.flowrium.send({sessionId:id,text:'승인검증',mode:'build'}),decisionSession.id);
    await page.waitForFunction(()=>document.querySelectorAll('.side-project-markers i').length===3);
    const afterMarkers=await markerGeometry();
    assert.deepEqual(afterMarkers.markers.map(item=>item.state),['running','waiting','decision']);
    assert.equal(afterMarkers.count,'3','오른쪽 숫자는 작업 상태가 아닌 전체 대화 수입니다.');
    assert.equal(afterMarkers.background,'rgba(0, 0, 0, 0)','대화 수에 채움 배경을 넣지 않습니다.');
    for(const label of ['작업중 1건','대기 1건','결정 1건']){
      assert(afterMarkers.markerLabel.includes(label));
      assert(afterMarkers.description.includes(label));
    }
    assert(afterMarkers.markers.every(marker=>Math.abs(marker.width-5)<.1&&Math.abs(marker.height-5)<.1&&marker.y<afterMarkers.icon[1]&&marker.right<=afterMarkers.icon[0]+afterMarkers.icon[2]+1),'세 상태 상자는 폴더 왼쪽 위에 작게 놓입니다.');
    assert([...afterMarkers.icon,...afterMarkers.title].every((value,index)=>Math.abs(value-[...beforeMarkers.icon,...beforeMarkers.title][index])<1),'복수 상태가 나타나도 폴더와 제목 기준선은 움직이지 않습니다.');
    console.log(JSON.stringify({multipleStates:afterMarkers.markers.map(item=>item.state),conversationCount:afterMarkers.count,markerSize:5,markerGeometryStable:true}));
    const sample = () => side.evaluate(node => {
      const icons = node.querySelectorAll('.side-brand img, nav>.side-row>svg, .side-project-section-icon, .side-project-head button svg, .side-project-icon>svg, .side-group .side-row>svg, .side-usage-refresh>svg, .settings-button>svg');
      const nav=node.querySelector('nav'),navBox=nav.getBoundingClientRect();
      const projects=[...node.querySelectorAll('.side-project')].map(e=>{
        const r=e.getBoundingClientRect();return {height:parseFloat(getComputedStyle(e).height),top:r.top,bottom:r.bottom};
      });
      const projectCenters=[...node.querySelectorAll('.side-project')].map(e=>{
        const r=e.getBoundingClientRect();return r.top+r.height/2;
      });
      const scale=node.getBoundingClientRect().width/parseFloat(getComputedStyle(node).width);
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
      return {
        positions:[...icons].map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];}),
        percentages:node.querySelector('.side-usage').innerText.match(/\d+%/g)||[],
        credits:!!node.querySelector('.side-credit-row'), projects,
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
      };
    });
    for (const height of [900,800,680]) {
      await page.setViewportSize({width:1440,height});
      await side.locator('nav').evaluate(el=>{el.scrollTop=0});
      await page.mouse.move(900,80);
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
      await side.locator('.sidebar-surface').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
      const closed = await sample();
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
      assert(open.projects.every(p=>Math.abs(p.height-40)<0.1),'프로젝트는 제목 길이에 관계없이 실제 40px 한 줄 행이어야 합니다.');
      assert(Math.abs(open.projectListHeight-320)<0.1,'8개 프로젝트 외에 빈 예약 높이를 추가하지 않습니다.');
      assert(open.largestNavGap<=42.1,'프로젝트 행 중심 간격은 42px 이하여야 합니다.');
      assert(open.lastToolBottom>=open.navBottom-2,'도구 그룹은 기존처럼 탐색 영역 아래쪽에 있습니다.');
      assert(open.navBottom<=open.footerTop,'탐색 스크롤은 하단 사용량과 설정을 가리지 않습니다.');
      if(height>=800)assert(open.projects.every(p=>p.bottom<=open.navBottom+1),'높이 800px 이상에서 8개 프로젝트가 모두 보여야 합니다.');
      assert.deepEqual(open.percentages,['63%']);
      assert.deepEqual(closed.percentages,['63%']);
      assert(!closed.credits && open.credits);
    }
    await page.setViewportSize({width:1440,height:800});
    await side.locator('nav').evaluate(el=>{el.scrollTop=el.scrollHeight});
    const bottomReachable=await side.evaluate(node=>{
      const nav=node.querySelector('nav').getBoundingClientRect();
      const last=node.querySelector('.side-tools .side-row:last-child').getBoundingClientRect();
      return last.top>=nav.top&&last.bottom<=nav.bottom+1;
    });
    assert(bottomReachable,'짧은 화면에서도 스크롤하여 마지막 도구에 접근할 수 있어야 합니다.');
    await side.getByRole('button',{name:'메뉴 고정',exact:true}).click();
    await page.mouse.move(900,80);
    assert.equal(await side.getAttribute('data-expanded'),'true');
    assert.equal(await side.getAttribute('data-pinned'),'true');
    assert.equal(await page.evaluate(()=>localStorage.getItem('flowrium.navigation.pinned')),'true');
    await side.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();
    await page.mouse.move(900,80);
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
    await page.keyboard.press('Tab');
    await side.locator('.side-brand').focus();
    await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='true');
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
      const ratios={body:contrast(colors['--text'],colors['--panel']),muted:Math.min(...collapsed.stops.map(stop=>contrast(colors['--muted'],stop))),selected:contrast(colors['--accent-ink'],colors['--accent-soft']),primary:contrast(colors['--on-primary'],colors['--accent-fill'])};
      assert(Object.values(ratios).every(ratio=>ratio>=4.5),'본문 / 보조 문구 / 선택 상태 / 강조 버튼의 대비를 4.5 이상 유지합니다. '+JSON.stringify({theme,accentColor,ratios}));
      workspaceBackgrounds[theme].push(collapsed.workspaceImage);
      const shortcut=await page.locator('.main-shell>.topbar .header-search kbd').evaluate(el=>({text:el.textContent,size:parseFloat(getComputedStyle(el).fontSize),weight:Number(getComputedStyle(el).fontWeight),visible:getComputedStyle(el).display!=='none'}));
      assert(shortcut.visible&&shortcut.size>=12.9&&shortcut.weight>=700&&/^(⌘|Ctrl) K$/.test(shortcut.text),'상단 검색 단축키를 플랫폼에 맞게 13px 굵기로 보여줍니다. '+JSON.stringify(shortcut));
      console.log(JSON.stringify({theme,accentColor,sameBackground:true,colors:collapsed.stops,contrast:ratios,shortcut}));
      if(process.env.FLOWRIUM_SIDEBAR_CAPTURE)await side.locator('.sidebar-surface').screenshot({path:path.join(stage,`sidebar-${theme}-${accentColor}.png`)});
    }
    for(const theme of ['light','dark'])assert.equal(new Set(workspaceBackgrounds[theme]).size,3,'앱 바깥 배경도 파랑 / 초록 / 보라 선택에 함께 반응합니다.');
  } finally {
    if(page&&!page.isClosed())await page.evaluate(async ids=>{for(const sessionId of ids)try{await window.flowrium.interrupt(sessionId)}catch{}},fixtureRuns).catch(()=>{});
    if(app) await app.close().catch(()=>{});
    await fs.rm(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
