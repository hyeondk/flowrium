// Installed Flowrium only / synthetic data only / no changes to an existing app window.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {updateDetails}=require('../electron/project-details.cjs');
const {addTrustedFixtureProject,backendFixtureAccount}=require('../tests/project-trust-fixture.cjs');
const {openConversation,settledLayout,settledRail}=require('../tests/shell-test-helpers.cjs');
const {closeInstalledApp}=require('../tests/update-installed-ui.cjs');
const root=path.resolve(__dirname,'..');
const executable='/Applications/Flowrium.app/Contents/MacOS/Flowrium';
const imageURL='https://i.ytimg.com/flowrium-isolated-test/sales-installed.svg';
const chart='<svg xmlns="http://www.w3.org/2000/svg" width="620" height="250" viewBox="0 0 620 250"><rect width="620" height="250" rx="12" fill="#f4f8ff"/><g fill="#62758d" font-size="14" font-family="sans-serif"><text x="24" y="29">2026 / 1–6</text><text x="475" y="29">+50%</text></g><g fill="none" stroke="#dce6f3"><path d="M45 65H580M45 110H580M45 155H580M45 200H580"/></g><path d="M55 170L155 143L255 157L355 116L455 98L555 62L555 200L55 200Z" fill="#0b6de018"/><path d="M55 170L155 143L255 157L355 116L455 98L555 62" fill="none" stroke="#0b6de0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><g fill="#0b6de0"><circle cx="55" cy="170" r="4"/><circle cx="155" cy="143" r="4"/><circle cx="255" cy="157" r="4"/><circle cx="355" cy="116" r="4"/><circle cx="455" cy="98" r="4"/><circle cx="555" cy="62" r="4"/></g><g fill="#62758d" font-size="14" font-family="sans-serif" text-anchor="middle"><text x="55" y="225">1</text><text x="155" y="225">2</text><text x="255" y="225">3</text><text x="355" y="225">4</text><text x="455" y="225">5</text><text x="555" y="225">6</text></g></svg>';
async function capture(app,file,box){
 const encoded=await app.evaluate(async({BrowserWindow},box)=>{
  const window=BrowserWindow.getAllWindows().find(window=>!window.isDestroyed());
  const zoom=window.webContents.getZoomFactor();
  const rect=box?{x:Math.max(0,Math.floor(box.x*zoom)),y:Math.max(0,Math.floor(box.y*zoom)),width:Math.ceil(box.width*zoom),height:Math.ceil(box.height*zoom)}:undefined;
  return(await window.webContents.capturePage(rect)).toPNG().toString('base64');
 },box);
 const bytes=Buffer.from(encoded,'base64');await fs.writeFile(file,bytes);
 return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}
async function main(){
 assert(process.argv.includes('--installed-ready'),'설치 교체 완료 신호 후 --installed-ready를 지정하세요.');
 const expected=process.argv.find(arg=>arg.startsWith('--expected-version='))?.split('=')[1];
 assert(expected,'촬영할 설치 버전을 --expected-version=값 으로 지정하세요.');
 const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-installed-design-')));
 const profile=path.join(temporary,'profile');
 const output=path.resolve(process.env.FLOWRIUM_CAPTURE_DIR||path.join(root,'artifacts/actual-design-20261118'));
 let app;
 try{
  const store=new Store(profile);await store.load();const projects=[];
  for(const name of ['온라인 스토어 매출 분석','월간 운영 보고서','고객 의견 분석','주문 데이터 정리','마케팅 성과 분석','제품별 매출 비교','재고 현황 분석','분기 계획']){
   const folder=path.join(temporary,name);await fs.mkdir(folder);projects.push(await addTrustedFixtureProject(store,folder,{account:backendFixtureAccount}));
  }
  let revision=null;const change=async action=>{const value=await updateDetails(store,projects[0].id,revision,action);revision=value.revision;return value;};
  await change({action:'details',owner:'데이터 분석팀',goal:'월별 매출 흐름과 변동 원인을 확인합니다.',dueDate:''});
  for(const text of ['상반기 매출 자료 확인','3월 매출 감소 원인 비교','다음 분기 실행안 정리'])await change({action:'add',text});
  const classified=await change({action:'category',category:'데이터 분석'});
  await change({action:'check',id:classified.checklist[0].id,done:true});
  const date=new Date(),monday=new Date(date);monday.setDate(date.getDate()-(date.getDay()+6)%7);
  const key=[monday.getFullYear(),String(monday.getMonth()+1).padStart(2,'0'),String(monday.getDate()).padStart(2,'0')].join('-');
  const goal=await change({action:'goal-add',period:'week',key,text:'월별 자료 6건 검토',target:6});await change({action:'goal-progress',id:goal.periodGoals.at(-1).id,current:6});
  const stamp=date.toISOString(),message=(role,text)=>({id:randomUUID(),role,text,createdAt:stamp});
  const request=message('user','상반기 매출 흐름을 분석하고 3월의 감소 원인을 정리해줘.');
  Object.assign(request,{workStartedAt:new Date(date-206000).toISOString(),workCompletedAt:stamp,workSteps:[{id:randomUUID(),label:'월별 매출 자료 6건 확인',state:'completed',createdAt:new Date(date-190000).toISOString()},{id:randomUUID(),label:'월별 증감률 계산과 대조',state:'completed',createdAt:new Date(date-30000).toISOString()},{id:randomUUID(),label:'분석 결과와 후속 작업 정리',state:'completed',createdAt:stamp}]});
  const answer='6월 매출은 **3,600만 원**으로, 1월 2,400만 원보다 **50% 늘었어요.**\n\n![상반기 월별 매출 추이]('+imageURL+')\n\n1. 1~2월 매출은 12.5% 증가했습니다.\n2. 3월은 2월보다 약 5.6% 감소했습니다.\n3. 4~6월은 매달 증가해 상반기 최고 매출을 기록했습니다.\n\n**확인한 내용**\n월별 합계 6건과 증감률을 대조했습니다.\n\n**남은 사항**\n3월의 제품별 판매량과 반품 자료를 비교하면 감소 원인을 더 구체적으로 확인할 수 있습니다.\n\n제품별 판매량과 반품률을 비교해줘';
  const session=await store.createSession(projects[0].id,{title:'상반기 매출 흐름',messages:[request,message('assistant',answer)]});
  await store.createSession(projects[0].id,{title:'제품별 매출 비교',messages:[message('user','제품별 매출 구성을 비교해줘.')]});
  await store.createSession(projects[1].id,{title:'월간 보고서 검토',messages:[message('assistant','월간 보고서의 초안을 정리했어요. 다음 작업을 계속할까요?')]});
  await store.saveSettings({codexPath:path.join(root,'tests/backend-fake-codex.cjs'),theme:'light',accentColor:'blue'});
  const env={...process.env,CODEX_HOME:path.join(temporary,'codex'),FLOWRIUM_TEST_PLAN:'pro'};
  for(const key of ['FLOWRIUM_USER_DATA','ELECTRON_RENDERER_URL','ELECTRON_RUN_AS_NODE','OPENAI_API_KEY'])delete env[key];
  app=await _electron.launch({executablePath:executable,args:['--user-data-dir='+profile,'--use-mock-keychain'],env,timeout:45000});
  const identity=await app.evaluate(({app})=>({version:app.getVersion(),appPath:app.getAppPath(),executable:process.execPath,userData:app.getPath('userData'),packaged:app.isPackaged}));
  assert.equal(identity.version,expected);assert(identity.packaged);assert.equal(await fs.realpath(identity.userData),await fs.realpath(profile));
  assert(identity.appPath.startsWith('/Applications/Flowrium.app/Contents/Resources/'));assert.equal(await fs.realpath(identity.executable),await fs.realpath(executable));
  const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(imageURL,route=>route.fulfill({body:chart,contentType:'image/svg+xml'}));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await page.locator('.side-usage[data-connected=true]').waitFor();
  const side=page.locator('.workspace-side');await side.hover();if(await side.getAttribute('data-pinned')!=='true')await side.getByRole('button',{name:'메뉴 고정',exact:true}).click();
  await page.locator('.side-project').filter({hasText:projects[0].name}).click();await openConversation(page,session.title);
  await page.locator('.message-prose img').evaluate(image=>image.decode());await page.evaluate(()=>document.fonts.ready);
  await page.locator('.followup-accept kbd').filter({hasText:/^Tab$/}).waitFor();
  await side.getByRole('button',{name:projects[1].name,exact:true}).locator('.side-project-markers [data-state=waiting]').waitFor();
  await settledLayout(page.locator('.conversation-dock'));await settledRail(side,{expanded:true,pinned:true},'설치본 탐색 패널 안정');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'설치본-검증.json'),JSON.stringify({passed:false,phase:'capturing',version:identity.version},null,2)+'\n');
  const dimensions={expanded:await capture(app,path.join(output,'설치본-전체-펼침.png'))};
  await capture(app,path.join(output,'설치본-좌측.png'),await side.locator('.sidebar-surface').boundingBox());
  await capture(app,path.join(output,'설치본-대화.png'),await page.locator('.conversation-dock').boundingBox());
  const measure=()=>page.evaluate(()=>{
   const side=document.querySelector('.workspace-side'),rows=[...side.querySelectorAll('.side-project')];
   const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
   const usage=side.querySelector('.side-usage'),usageStyle=getComputedStyle(usage),surfaceStyle=getComputedStyle(side.querySelector('.sidebar-surface'));
   const heading=document.querySelector('.dock-heading').getBoundingClientRect(),scope=document.querySelector('.dock-scope-tabs').getBoundingClientRect();
   const add=side.querySelector('.side-project-head button'),projectHeading=add.closest('.side-project-head');
   const addBox=add.getBoundingClientRect(),title=projectHeading.querySelector('h2').getBoundingClientRect();
   const projectAdd={visible:getComputedStyle(add).visibility==='visible',focusable:add.tabIndex>=0,
    rightInset:projectHeading.getBoundingClientRect().right-addBox.right,titleGap:addBox.left-title.right,
    centerDifference:Math.abs((addBox.top+addBox.bottom-title.top-title.bottom)/2)};
   const controls=['.header-search','.assistant-entry','.header-music','.header-decisions'].map(selector=>{
    const nodes=[...document.querySelectorAll('.main-shell '+selector)],button=nodes[0],icon=button?.querySelector('svg');
    const rect=button&&box(button),iconBox=icon&&box(icon),center=iconBox?{x:iconBox.x+iconBox.width/2,y:iconBox.y+iconBox.height/2}:null;
    let painted=Boolean(iconBox&&iconBox.width>0&&iconBox.height>0);
    for(let node=icon;node&&node!==document.documentElement;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)painted=false;}
    const hit=center&&document.elementFromPoint(center.x,center.y);
    return{selector,count:nodes.length,label:button?.getAttribute('aria-label'),rect,center,painted,pointerReachable:Boolean(hit&&button.contains(hit))};
   });
   const sidebarRemovedControls=side.querySelectorAll('.command-trigger,.assistant-entry,.header-music,.header-decisions,.dock-toggle,[aria-label="음악"],[aria-label="뮤직 열기"],[aria-label="대화함 닫기"],[aria-label="대화함 열기"],[aria-label="대화함 접기"]').length;
   const dockCloseCount=document.querySelectorAll('.conversation-dock button[aria-label="대화함 접기"]').length;
   return{sidebar:box(side.querySelector('.sidebar-surface')),sidebarBackground:{image:surfaceStyle.backgroundImage,color:surfaceStyle.backgroundColor},projectAdd,projectRows:rows.map(node=>({height:parseFloat(getComputedStyle(node).height),center:node.getBoundingClientRect().top+node.getBoundingClientRect().height/2})),percentageCount:(usage.innerText.match(/\d+%/g)||[]).length,usageMargin:{top:parseFloat(usageStyle.marginTop),bottom:parseFloat(usageStyle.marginBottom)},headerControls:controls,sidebarRemovedControls,dockCloseCount,chat:box(document.querySelector('.conversation-dock')),scopeTabsGap:scope.top-heading.bottom,chatScale:getComputedStyle(document.querySelector('.message-history-items')).zoom,font:getComputedStyle(document.querySelector('.message-prose')).fontFamily,fontsReady:document.fonts.check('700 14px NanumSquareRound','한글 123'),viewport:{width:innerWidth,height:innerHeight}};
  });
  const checkLayout=value=>{
   assert(Math.abs(value.scopeTabsGap-9)<.1,'대화 헤더 아래에서 종류 선택창 위까지 실제 간격은 9 CSS px여야 합니다: '+value.scopeTabsGap);
   assert.equal(value.usageMargin.top,5,'사용량 위 여백은 5px');assert.equal(value.usageMargin.bottom,5,'사용량 아래 여백은 5px');
   assert(value.headerControls.every(button=>button.count===1&&button.painted&&button.pointerReachable),'중앙 헤더의 네 버튼이 한 번씩 표시되고 클릭 가능해야 합니다.');
   for(let index=1;index<value.headerControls.length;index++){
    const previous=value.headerControls[index-1],current=value.headerControls[index];
    assert(current.rect.x-previous.rect.x-previous.rect.width>=1.5,'검색 / 개인 비서 / 음악 / 알림 순서로 여백을 둡니다.');
    assert(Math.abs(previous.center.y-current.center.y)<1,'중앙 헤더 네 아이콘의 세로 중심이 같아야 합니다.');
   }
   assert.equal(value.sidebarRemovedControls,0,'좌측에 이동한 도구나 중복 대화 닫기가 남아 있으면 안 됩니다.');
   assert.equal(value.dockCloseCount,1,'우측 패널 내부 닫기 버튼은 한 개 유지해야 합니다.');
  };
  const expanded=await measure();assert(expanded.projectRows.every(row=>Math.abs(row.height-40)<1));assert.equal(expanded.percentageCount,1);assert.equal(Number(expanded.chatScale),.9);assert(expanded.fontsReady);
  const checkAdd=value=>assert(value.visible&&value.focusable&&value.rightInset>=4&&value.titleGap>=4&&value.centerDifference<1,JSON.stringify(value));
  checkAdd(expanded.projectAdd);
  checkLayout(expanded);
  await side.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();await page.mouse.move(650,80);
  await settledRail(side,{expanded:false,pinned:false},'설치본 접힌 탐색 패널 안정');
  dimensions.collapsed=await capture(app,path.join(output,'설치본-전체-접힘.png'));const collapsed=await measure();
  dimensions.collapsedSidebar=await capture(app,path.join(output,'설치본-좌측-접힘.png'),await side.locator('.sidebar-surface').boundingBox());
  assert.equal(collapsed.percentageCount,1);assert(Math.abs(collapsed.sidebar.width-56)<1);
  assert(!collapsed.projectAdd.visible&&!collapsed.projectAdd.focusable,'접힌 패널에서는 추가 버튼 감춤');
  checkLayout(collapsed);
  const centersDrift=Math.max(...expanded.projectRows.map((row,index)=>Math.abs(row.center-collapsed.projectRows[index].center)));assert(centersDrift<1);
  await side.hover();await settledRail(side,{expanded:true,pinned:false},'설치본 호버 펼침 패널 안정');
  const hovered=await measure();checkLayout(hovered);
  checkAdd(hovered.projectAdd);
  assert.notEqual(expanded.sidebarBackground.image,'none','세 상태 모두 패널 자체의 옅은 그라데이션을 사용해야 합니다.');
  assert.deepEqual(hovered.sidebarBackground,expanded.sidebarBackground,'호버 펼침과 고정 펼침의 배경이 같아야 합니다.');
  assert.deepEqual(collapsed.sidebarBackground,expanded.sidebarBackground,'접힘과 고정 펼침의 배경이 같아야 합니다.');
  dimensions.hovered=await capture(app,path.join(output,'설치본-전체-호버펼침.png'));
  dimensions.hoveredSidebar=await capture(app,path.join(output,'설치본-좌측-호버펼침.png'),await side.locator('.sidebar-surface').boundingBox());
  await side.getByRole('button',{name:'대시보드',exact:true}).click();
  await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();
  await side.hover();await settledRail(side,{expanded:true,pinned:false},'대시보드에서 호버 펼침 안정');
  await settledLayout(page.locator('.conversation-dock'));
  const dashboard=await measure();checkLayout(dashboard);
  dimensions.dashboardHovered=await capture(app,path.join(output,'설치본-대시보드-호버펼침.png'));
  const dock=page.locator('.conversation-dock');await dock.getByRole('button',{name:'대화함 접기',exact:true}).click();await dock.waitFor({state:'detached'});
  const reopen=page.getByRole('button',{name:'대화 패널 펼치기',exact:true});await reopen.waitFor();await reopen.click();
  await dock.waitFor();await settledLayout(dock);await page.locator('.message.assistant').filter({hasText:'6월 매출은'}).waitFor();
  const dockCloseAndReopenVerified=true;
  const body=await page.locator('body').innerText();for(const token of [temporary,os.homedir(),'backend-fake-codex'])assert(!body.includes(token),'촬영 화면에 개인 또는 시험 실행 경로가 없어야 합니다.');
  assert.equal(await page.locator('.command-trigger').count(),1,'상단 검색 진입점 한 개');
  await side.getByRole('button',{name:'설정',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'설정',exact:true});
  await settings.waitFor();
  await settings.locator('[data-settings-target=appearance]').click();
  const appearance=settings.locator('[data-settings-group=appearance]');
  await settledLayout(appearance);
  const settingsGaps=await appearance.evaluate(group=>{
   const children=[...group.children].map(child=>child.getBoundingClientRect());
   return children.slice(1).map((box,index)=>box.top-children[index].bottom);
  });
  assert(settingsGaps.every(gap=>gap>=11.5),'설정의 상자 / 안내 / 링크 사이 12px');
  dimensions.settings=await capture(app,path.join(output,'설치본-설정.png'),await settings.boundingBox());
  await settings.locator('[data-settings-target=security]').click();
  const security=settings.locator('[data-settings-group=security]');
  await settledLayout(security);
  const switches=await security.locator('.ui-switch-control input[type=checkbox]').evaluateAll(inputs=>inputs.map(input=>getComputedStyle(input).appearance));
  assert(switches.length&&switches.every(appearance=>appearance==='none'),'설치본 보안 스위치 공통 스타일');
  dimensions.security=await capture(app,path.join(output,'설치본-보안.png'),await settings.boundingBox());
  await settings.locator('[data-settings-target=account]').click();
  const account=settings.locator('[data-settings-group=account] .connection-state');
  await settledLayout(account);
  const accountLabel=(await account.innerText()).trim();
  assert.equal(accountLabel,'ChatGPT(Pro)');
  const accountBox=await account.boundingBox(),accountCard=await account.locator('..').boundingBox();
  dimensions.account=await capture(app,path.join(output,'설치본-요금제.png'),{...accountCard,height:accountBox.y+accountBox.height-accountCard.y+5});
  assert.equal(errors.length,0);
  await fs.writeFile(path.join(output,'설치본-검증.json'),JSON.stringify({passed:true,syntheticData:true,captureMethod:'webContents.capturePage',version:identity.version,installedAppPath:identity.appPath,installedExecutable:identity.executable,isolatedUserDataVerified:true,zoom:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),dimensions,expanded,collapsed,hovered,dashboard,centersDrift,dockCloseAndReopenVerified,settingsGaps,switches,accountLabel,errors},null,2)+'\n');
  console.log('설치본 직접 실행 / 별도 시험 프로필 확인 / 좌측 펼침과 접힘 / 우측 대화 / 90% 대화 배율 / 실제 글꼴 / capturePage 촬영 완료');
 }finally{try{if(app)await closeInstalledApp(app,'설치본 촬영 전용 창 종료')}finally{await fs.rm(temporary,{recursive:true,force:true,maxRetries:6,retryDelay:150})}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
