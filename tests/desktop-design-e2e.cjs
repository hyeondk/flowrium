const {settledLayout,settledRail}=require('./shell-test-helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {expect} = require('playwright/test');
const {Store} = require('../electron/store.cjs');
const {setFixtureAccountLinked} = require('./project-trust-fixture.cjs');
const {updateDetails} = require('../electron/project-details.cjs');
const {openConversation} = require('./shell-test-helpers.cjs');
const root = path.resolve(__dirname,'..');
const screenshots = process.env.FLOWRIUM_DESIGN_SCREENS;
const fixture = path.join(__dirname,'backend-fake-codex.cjs');
const title='중앙역에서 도시숲까지 걷는 길';
const now = new Date();
function day(date){return [date.getFullYear(),date.getMonth()+1,date.getDate()].map((part,i)=>i?String(part).padStart(2,'0'):part).join('-')}
function message(role,text){return {id:randomUUID(),role,text,createdAt:now.toISOString()}}
async function setup(store,temp){
  await store.load();
  let project;
  for(const name of ['도시 산책 안내서','여름 독서 모임','새 계절의 기록']){
    const directory=path.join(temp,name);await fs.mkdir(directory);
    const value=await store.addProject(directory);project??=value;
  }
  const monday=new Date(now);monday.setDate(now.getDate()-(now.getDay()+6)%7);
  let revision=null;
  async function change(action){const result=await updateDetails(store,project.id,revision,action);revision=result.revision;return result}
  await change({action:'details',owner:'산책 편집팀',goal:'처음 방문하는 사람도 반나절 동안 걸을 수 있는 동네 산책길을 기록합니다.',dueDate:''});
  for(const text of ['골목 서점의 운영 시간을 확인하기','도시숲 남쪽 입구의 안내 문구 다듬기','중앙역 출구에서 횡단보도까지의 거리 기록'])await change({action:'add',text});
  const goals=await change({action:'goal-add',period:'week',key:day(monday),text:'산책 코스 현장 자료 10건 확인',target:10});
  await change({action:'goal-progress',id:goals.periodGoals[0].id,current:7});
  const details=await require('../electron/project-details.cjs').readDetails(store,project.id);
  await change({action:'check',id:details.checklist.at(-1).id,done:true});
  const response='중앙역 2번 출구에서 골목 서점을 거쳐 도시숲까지 이어지는 길을 정리했어요.\n\n'+
   '1. **중앙역에서 출발** / 2번 출구 앞 횡단보도를 건너세요.\n2. **골목 서점** / 책방을 지나면 오른쪽 작은 정원이 보여요.\n3. **도시숲 남문** / 천천히 걸으면 서점에서 약 12분이에요.\n\n'+
   '벤치는 남문을 지나 왼쪽 산책로에 있어요.\n\n![산책 경로도](https://i.ytimg.com/flowrium-isolated-test/walk.svg)';
  const messages=[{
    ...message('user','중앙역에서 도시숲까지 걷는 길을 정리해줘. 시간은 10~12분으로 표시해줘.'),
    workStartedAt:new Date(now.getTime()-206000).toISOString(),workCompletedAt:now.toISOString(),
    workSteps:[{id:randomUUID(),label:'현장 메모 3건 확인',state:'completed',createdAt:new Date(now.getTime()-186000).toISOString()},
      {id:randomUUID(),label:'안내도와 예상 시간 대조',state:'completed',createdAt:new Date(now.getTime()-14000).toISOString()}]
  },message('assistant',response+'\n\n갈림길과 쉬어 갈 곳을 표로 정리할 수 있어요.')];
  await store.createSession(project.id,{title,messages});
  await store.createSession(project.id,{title:'쉬어 갈 수 있는 장소',messages:[message('user','벤치와 쉼터 위치를 기록해줘.')]});
  const text=Array.from({length:40},(_,i)=>(i+1)+'번째 구간에서는 골목과 계단을 차례로 지나 산책로를 따라 공원으로 이어집니다.').join('\n\n');
  await store.createSession(project.id,{title:'긴 안내문',messages:[message('assistant',text)]});
  await store.saveSettings({codexPath:fixture,theme:'light',accentColor:'blue'});
}
const map='<svg xmlns="http://www.w3.org/2000/svg" width="360" height="137" viewBox="0 0 420 160"><rect width="420" height="160" fill="#eef3e9"/><path fill="#d4e7ea" d="m200 0 25 0-88 160h-25z"/><g fill="none" stroke="#fff" stroke-width="12"><path d="M0 70h420M40 20l335 120M45 155l33-155M300 165l62-165"/></g><path d="M48 112L82 70h98l65 25 78-54" fill="none" stroke="#2669aa" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><g fill="white" stroke="#2669aa" stroke-width="3"><circle cx="48" cy="112" r="6"/><circle cx="180" cy="70" r="6"/><circle cx="323" cy="41" r="6"/></g><g fill="#314b55" font-size="14" font-family="sans-serif"><text x="23" y="138">중앙역</text><text x="152" y="51">골목 서점</text><text x="314" y="21">도시숲</text></g></svg>';
async function sampleMotion(page,selector,button){
  return page.evaluate(({selector,button})=>new Promise(resolve=>{
    const frame=[];
    const read=t=>{
      const node=document.querySelector(selector);
      const r=node?.getBoundingClientRect(),css=node&&getComputedStyle(node);
      frame.push({t,opacity:r?.width?+css.opacity:0,main:document.querySelector('.main-shell').getBoundingClientRect().width,width:r?.width||0,x:r?r.x+r.width/2:0,y:r?r.y+r.height/2:0});
    };
    const begin=performance.now();read(0);document.querySelector(button).click();
    function step(time){read(time-begin);if(time-begin<440)requestAnimationFrame(step);else resolve(frame)}
    requestAnimationFrame(step);
  }),{selector,button});
}
function verifyMotion(rows,enter,popup){
  const moving=rows.filter(p=>p.width&&p.opacity>.01&&p.opacity<.99);
  // Hosted runners can drop display frames. Still require a real intermediate state.
  assert(moving.length>=1,'전환 과정에 실제 중간 프레임이 있어야 합니다: '+JSON.stringify(rows));
  assert(enter?rows.at(-1).opacity>.99:rows.at(-1).opacity===0);
  assert(Math.abs(rows[0].opacity-(enter?0:1))<.025);
  for(let i=1;i<moving.length;i++){
    assert(enter?moving[i].opacity>=moving[i-1].opacity-.001:moving[i].opacity<=moving[i-1].opacity+.001,'투명도 방향 유지');
    if(popup){assert(Math.abs(moving[i].x-moving[0].x)<1&&Math.abs(moving[i].y-moving[0].y)<1,'중앙 축 유지');}
    else assert(enter?moving[i].main<=moving[i-1].main+1:moving[i].main>=moving[i-1].main-1,'중앙 문서 너비를 연속적으로 변경');
  }
  return {frames:rows.length,changingFrames:moving.length,start:rows[0].opacity,end:rows.at(-1).opacity,maxFrameGap:Math.max(0,...moving.slice(1).map((p,i)=>p.t-moving[i].t))};
}
async function captureDesktop(app,file){
  const encoded=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const png=Buffer.from(encoded,'base64');if(file)await fs.writeFile(file,png);
  return {png,geometry:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}};
}
async function sampleTextContrast(app,page) {
  const png=(await captureDesktop(app)).png.toString('base64');
  return page.evaluate(async png=>{
    const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(png),s=>s.charCodeAt(0))],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
    const selectors={korean:'.message.assistant .message-meta strong',number:'.message.assistant .message-time'};
    const values={};
    const luminance=rgb=>rgb.slice(0,3).reduce((value,ch,i)=>{const v=ch/255;return value+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)},0);
    for(const [key,selector] of Object.entries(selectors)){
      const node=document.querySelector(selector),box=node.getBoundingClientRect();
      const bg=Array.from(ctx.getImageData(Math.floor((box.left+1)*canvas.width/innerWidth),Math.floor((box.top+1)*canvas.height/innerHeight),1,1).data);
      ctx.fillStyle=getComputedStyle(node).color;ctx.fillRect(0,0,1,1);
      const fg=Array.from(ctx.getImageData(0,0,1,1).data),a=luminance(fg),b=luminance(bg);
      values[key]={characters:node.textContent,color:fg.slice(0,3),background:bg.slice(0,3),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    }
    return values;
  },png);
}
async function measureAppScale(app,page,scale){
  await app.evaluate(({BrowserWindow},scale)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(scale),scale);
  await settledLayout(page.locator('.conversation-dock'));
  const result=await page.evaluate(()=>{
    const selectors={menu:'.workspace-side nav>.side-row',toolbar:'.project-document-toolbar',heading:'.dock-heading',input:'[aria-label="Codex에 보낼 작업 요청"]',body:'.message.assistant .message-prose',side:'.workspace-side'};
    const values={};
    for(const [key,selector] of Object.entries(selectors)){
      const node=document.querySelector(selector),r=node.getBoundingClientRect(),css=getComputedStyle(node);
      values[key]={x:r.x,y:r.y,width:r.width,height:r.height,fontSize:parseFloat(css.fontSize),lineHeight:parseFloat(css.lineHeight)||null,font:css.fontFamily};
    }
    const sidebar={};for(const selector of ['.sidebar-surface','.workspace-side nav','.side-projects','.side-project-list','.side-storage','.side-tools','.side-foot']){const node=document.querySelector(selector),rect=node.getBoundingClientRect();sidebar[selector]={height:rect.height,y:rect.y,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};}
    const list=document.querySelector('.side-project-list').getBoundingClientRect(),nav=document.querySelector('.workspace-side nav').getBoundingClientRect();
    const projectVisibility=[...document.querySelectorAll('.side-project-list .side-project')].map(node=>{const box=node.getBoundingClientRect();return {name:node.textContent,fullyVisible:box.top>=Math.max(list.top,nav.top)-1&&box.bottom<=Math.min(list.bottom,nav.bottom)+1}});
    const root=document.querySelector('.app-shell').getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},root:{width:root.width,height:root.height,x:root.x,y:root.y},sidebar,projectVisibility,values,messageScale:getComputedStyle(document.querySelector('.message-history-items')).zoom,fonts:document.fonts.check('700 14px NanumSquareRound','한글 123')};
  });
  const windowState=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];return {zoom:win.webContents.getZoomFactor(),contentSize:win.getContentSize()}});
  for(const value of Object.values(result.values)){value.renderedHeight=value.height*windowState.zoom;value.renderedFontSize=value.fontSize*windowState.zoom;}
  return {...result,...windowState};
}
async function visibleCharacters(page){
  return page.evaluate(()=>{
    const viewport=document.querySelector('.messages'),bounds=viewport.getBoundingClientRect();let count=0;
    const walker=document.createTreeWalker(viewport.querySelector('.message-prose'),NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const text=walker.currentNode;for(let i=0;i<text.length;i++){const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const r=range.getBoundingClientRect();if(r.top>=bounds.top&&r.bottom<=bounds.bottom&&r.width>0)count++;}}
    return count;
  });
}
async function designStructure(page){
  return page.evaluate(()=>{
    const visible=node=>Boolean(node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
    const assistant=document.querySelector('.message.assistant>.message-body');
    const css=getComputedStyle(assistant);
    const borders=['Top','Right','Bottom','Left'].map(side=>({width:parseFloat(css['border'+side+'Width']),style:css['border'+side+'Style'],color:css['border'+side+'Color']}));
    return {
      visibleToolbars:[...document.querySelectorAll('.main-shell>.topbar,.project-document-toolbar')].filter(visible).length,
      overviewToolbar:visible(document.querySelector('.project-document-toolbar')),
      visibleLegacyTabs:[...document.querySelectorAll('.pf-tabs button')].filter(visible).length,
      assistantBorders:borders,assistantShadow:css.boxShadow,
      settingsAvailable:visible(document.querySelector('.workspace-side .settings-button')),
      mainBackground:getComputedStyle(document.querySelector('.main-shell')).backgroundColor,
      chatBackground:getComputedStyle(document.querySelector('.messages')).backgroundColor,
    };
  });
}
async function verifyProjectNavigation(page){
  await page.locator('.project-document-toolbar .header-search').click();
  const search=page.getByRole('dialog',{name:'프로젝트와 화면 찾기',exact:true});
  await search.waitFor();
  await search.getByRole('textbox',{name:'전체 검색어',exact:true}).fill('도시 산책 안내서');
  assert.equal(await search.getByRole('option').filter({hasText:'도시 산책 안내서'}).count(),1,'중앙 검색에서 실제 프로젝트 검색');
  await search.getByRole('button',{name:'닫기',exact:true}).click();
  await search.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'프로젝트 메뉴',exact:true}).click();
  const navigation=page.getByRole('navigation',{name:'프로젝트 상세 탭',exact:true});
  await navigation.waitFor();
  const labels=await navigation.getByRole('button').allTextContents();
  assert.equal(labels.length,5,'프로젝트 메뉴의 중복 진입점을 정리');
  for(const label of ['업무 현황','팀','GitHub','문서','프로젝트 설정']){
    assert.equal(await navigation.getByRole('button',{name:label,exact:true}).count(),1,label+' 진입 보존');
  }
  await navigation.getByRole('button',{name:'프로젝트 설정',exact:true}).click();
  const back=page.getByRole('button',{name:'대시보드로 돌아가기',exact:true});
  await back.waitFor();
  await back.click();
  await page.locator('.main-shell[data-view=dashboard]').waitFor();
  await page.locator('.pf-project-entry').filter({hasText:'도시 산책 안내서'}).click();
  await page.locator('.overview-goal progress').waitFor();
  return {searchOpenedAndClosed:true,detailEntries:labels.length,projectSettingsOpened:true,projectHomeRestored:true};
}
async function verifyWidths(page){
  const rows=[];
  for(const [width,height] of [[320,740],[390,844],[768,820],[1024,768],[1440,940],[1920,1080],[1440,600]]){
    await page.setViewportSize({width,height});
    await settledLayout(page.locator('.conversation-dock'));
    const row=await page.evaluate(()=>{
      const visible=node=>Boolean(node&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
      const rect=selector=>{const node=document.querySelector(selector);if(!visible(node))return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      return {width:innerWidth,height:innerHeight,overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,
        dock:rect('.conversation-dock'),composer:rect('.composer'),toolbar:rect('.project-document-toolbar'),main:rect('.main-shell'),side:rect('.workspace-side'),
        messageOverflow:(node=>node.scrollWidth-node.clientWidth)(document.querySelector('.messages'))};
    });
    assert(row.overflow<=1,'화면 가로 넘침 '+JSON.stringify(row));
    assert(row.messageOverflow<=1,'대화 가로 넘침 '+JSON.stringify(row));
    for(const key of ['dock','composer']){const r=row[key];assert(r&&r.width>0&&r.x>=-1&&r.right<=row.width+1,key+'의 화면 경계 '+JSON.stringify(row));}
    assert(row.composer.bottom<=row.height+1,'입력창이 화면 아래로 벗어나지 않아야 합니다 '+JSON.stringify(row));
    if(row.width>=1440){assert(row.side.right<=row.main.x+1&&row.main.right<=row.dock.x+1,'세 영역이 겹치지 않아야 합니다 '+JSON.stringify(row));}
    rows.push({...row,requestedViewport:{width,height}});
  }
  await page.setViewportSize({width:1440,height:940});
  await settledLayout(page.locator('.conversation-dock'));
  return rows;
}
const baseline=process.argv.includes('--baseline');
const installed=process.argv.includes('--installed');
async function run(){
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-desktop-design-')));
  const profile=path.join(temp,'profile'), store=new Store(profile);
  let app,page;const results={themes:[],lock:[],reading:{},errors:[]};
  try{
    await setup(store,temp);
    await setFixtureAccountLinked(profile);
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_PLAN:'plus'};
    delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
    if(baseline||installed){
      if(baseline){const registry=JSON.parse(await fs.readFile(store.file,'utf8'));
        delete registry.settings.accentColor;await fs.writeFile(store.file,JSON.stringify(registry));}
      delete env.FLOWRIUM_USER_DATA;
      app=await _electron.launch({executablePath:'/Applications/Flowrium.app/Contents/MacOS/Flowrium',args:['--user-data-dir='+profile],env,timeout:45000});
      assert.equal(await fs.realpath(await app.evaluate(({app})=>app.getPath('userData'))),await fs.realpath(profile));
    }else app=await _electron.launch({args:[root],env,timeout:45000});
    results.installation={installed,version:await app.evaluate(({app})=>app.getVersion())};
    page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>results.errors.push(error.message));
    await page.route('https://i.ytimg.com/flowrium-isolated-test/walk.svg',route=>route.fulfill({body:map,contentType:'image/svg+xml'}));
    if(baseline)await page.setViewportSize({width:1440,height:940});
    else{
      results.initialZoom=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1440,940);return win.webContents.getZoomFactor()});
      assert(Math.abs(results.initialZoom-.87)<.001,'처음 실행한 데스크톱 앱 전체 배율은 87%');
    }
    await page.locator('.side-usage[data-connected=true]').waitFor();
    await page.locator('.workspace-side').hover();
    if(await page.locator('.workspace-side').getAttribute('data-pinned')!=='true')await page.getByRole('button',{name:'메뉴 고정',exact:true}).click();
    if(!baseline){
      const header=page.locator('.main-shell>.topbar');
      await settledLayout(header);
      await page.evaluate(()=>document.fonts.ready);
      results.headerTools=await header.evaluate(node=>{
        const header=node.getBoundingClientRect();
        const buttons=[...node.querySelectorAll('.workspace-utilities>button')].map(button=>button.getBoundingClientRect());
        const textCenter=element=>{
          const box=element.getBoundingClientRect(),font=getComputedStyle(element);
          const canvas=document.createElement('canvas').getContext('2d');
          canvas.font=font.font;
          const ink=canvas.measureText(element.textContent);
          const offset=(ink.fontBoundingBoxAscent-ink.fontBoundingBoxDescent-ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent)/2;
          return box.top+box.height/2+offset*box.height/parseFloat(font.lineHeight);
        };
        const search=node.querySelector('.header-search');
        return {count:buttons.length,gaps:buttons.slice(1).map((button,index)=>button.left-buttons[index].right),
          right:header.right-buttons.at(-1).right,vertical:buttons.map(button=>Math.abs((button.top+button.bottom-header.top-header.bottom)/2)),
          searchOffset:Math.abs(textCenter(search.querySelector('span'))-textCenter(search.querySelector('kbd')))};
      });
      assert.equal(results.headerTools.count,4);
      assert(results.headerTools.gaps.every(gap=>gap>=3)&&results.headerTools.right>=12&&results.headerTools.vertical.every(shift=>shift<1),JSON.stringify(results.headerTools));
      assert(results.headerTools.searchOffset<.5,'검색 문구와 단축키의 글자 중심 정렬 '+JSON.stringify(results.headerTools));
      await expect(page.locator('.workspace-side .command-trigger,.workspace-side .workspace-utilities')).toHaveCount(0);
      await expect(page.locator('.side-usage-refresh strong')).toHaveText('63%');
      results.sidebarUsage=await page.locator('.side-usage').evaluate(async node=>{
        const usage=await window.flowrium.readAccountUsage(),primary=usage.buckets.flatMap(bucket=>bucket.windows)[0];
        return {text:node.textContent,attributes:[...node.querySelectorAll('[title],[aria-label]')].flatMap(el=>[el.getAttribute('title'),el.getAttribute('aria-label')]).filter(Boolean),remaining:100-primary.usedPercent,shown:node.querySelector('.side-usage-refresh strong')?.textContent,progress:node.querySelector('progress')?.value};
      });
      assert(![results.sidebarUsage.text,...results.sidebarUsage.attributes].some(value=>value.includes('5시간')),'사용량 본문·도움말·접근성 이름에 5시간 표기를 남기지 않습니다');
      assert((results.sidebarUsage.text.match(/63%/g)||[]).length===1&&results.sidebarUsage.remaining===63&&results.sidebarUsage.shown==='63%'&&results.sidebarUsage.progress===63,'계정 응답의 남은 사용량 63%와 문구·막대 일치');
    }
    await page.locator('.side-project').filter({hasText:'도시 산책 안내서'}).click();
    if(!baseline){
      await page.locator('.overview-goal progress').waitFor();
      results.checkboxes=await page.locator('.overview-task input[type=checkbox]').evaluateAll(inputs=>inputs.map(input=>({
        checked:input.checked, appearance:getComputedStyle(input).appearance,
        animatedMark:!!input.parentElement.querySelector('svg rect+path'),
      })));
      assert.equal(results.checkboxes.length,3);
      assert(results.checkboxes.every(box=>box.appearance==='none'&&box.animatedMark));
      assert.equal(results.checkboxes.filter(box=>box.checked).length,1);
    }
    await openConversation(page,title);
    await page.locator('.message-prose img').evaluate(img=>img.decode());
    await page.evaluate(()=>document.fonts.ready);
    await settledLayout(page.locator('.conversation-dock'));
    if(baseline){
      for(const scale of [1,.9]){
        await page.evaluate(scale=>document.documentElement.style.setProperty('--chat-reading-scale',scale),scale);
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        results.reading[scale]=await page.evaluate(()=>{
          const rect=sel=>{const {x,y,width,height}=document.querySelector(sel).getBoundingClientRect();return{x,y,width,height}};
          return {image:rect('.message-prose img'),dock:rect('.conversation-dock'),heading:rect('.dock-heading'),toolbar:rect('.topbar'),composer:rect('.composer'),main:rect('.main-shell'),side:rect('.workspace-side'),font:getComputedStyle(document.querySelector('.message-prose')).fontFamily,fonts:document.fonts.check('700 14px NanumSquareRound','한글 123')};
        });
      }
      if(screenshots){await fs.mkdir(screenshots,{recursive:true});await captureDesktop(app,path.join(screenshots,'수정전.png'));}
      results.textContrast=await sampleTextContrast(app,page);
      await openConversation(page,'긴 안내문');
      for(const scale of [1,.9]){
        await page.evaluate(value=>{document.documentElement.style.setProperty('--chat-reading-scale',value);document.querySelector('.messages').scrollTop=0},scale);
        await settledLayout(page.locator('.messages'));
        results.reading[scale].visibleCharacters=await visibleCharacters(page);
      }
      const measurement={...results.reading[.9],reading:results.reading,textContrast:results.textContrast,version:await app.evaluate(({app})=>app.getVersion())};
      if(screenshots)await fs.writeFile(path.join(screenshots,'desktop-baseline.json'),JSON.stringify(measurement,null,2));
      console.log('기존 설치본 격리 측정',JSON.stringify(measurement));return;
    }
    results.appScale={full:await measureAppScale(app,page,1),reduced:await measureAppScale(app,page,.87)};
    const tabsTopGap=await page.locator('.dock-scope-tabs').evaluate(node=>
      node.getBoundingClientRect().top-node.previousElementSibling.getBoundingClientRect().bottom);
    assert(Math.abs(tabsTopGap-9)<.1,'대화 상단과 범위 선택 사이 간격 9px / '+tabsTopGap);
    results.chatSpacing=await page.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      const composer=rect('.conversation-dock .composer');
      const area=rect('.conversation-dock .composer-area');
      const input=rect('.conversation-dock .composer-input');
      return {tabs:document.querySelector('.dock-scope-tabs').getBoundingClientRect().top-rect('.dock-heading').bottom,
        composerLeft:composer.left-area.left,composerBottom:area.bottom-composer.bottom,inputTop:input.top-composer.top};
    });
    assert(Object.values(results.chatSpacing).every(gap=>gap>=4),JSON.stringify(results.chatSpacing));
    const {full,reduced}=results.appScale;
    assert.deepEqual(full.contentSize,reduced.contentSize,'실제 창 콘텐츠 크기를 유지한 확대 비교');
    assert(Math.abs(reduced.zoom-.87)<.001);
    assert.equal(reduced.messageScale,'0.9','대화 내용의 배율은 앱 창 확대와 별개입니다');
    results.contentScale=await page.evaluate(async()=>{
      const measurements=[];
      const root=document.documentElement;
      for(const scale of [1,.9]){
        root.style.setProperty('--chat-reading-scale',scale);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const img=document.querySelector('.message-prose img').getBoundingClientRect();
        const header=document.querySelector('.dock-heading').getBoundingClientRect();
        const input=document.querySelector('.composer').getBoundingClientRect();
        measurements.push({width:img.width,height:img.height,header:header.height,input:input.height});
      }
      root.style.removeProperty('--chat-reading-scale');
      return measurements;
    });
    const [baseContent,compactContent]=results.contentScale;
    assert(Math.abs(compactContent.width/baseContent.width-.9)<.025&&Math.abs(compactContent.height/baseContent.height-.9)<.025,
      '본문 그림의 두 치수도 90%로 줄어듭니다 '+JSON.stringify(results.contentScale));
    assert(Math.abs(baseContent.header-compactContent.header)<1&&Math.abs(baseContent.input-compactContent.input)<1);
    for(const key of ['menu','toolbar','heading'])assert(Math.abs(reduced.values[key].renderedHeight/full.values[key].renderedHeight-.87)<.02,key+' 전체 배율 실측');
    for(const key of ['menu','input','body'])assert(Math.abs(reduced.values[key].renderedFontSize/full.values[key].renderedFontSize-.87)<.005,key+' 글자 배율 실측');
    for(const [key,axis,expected] of [['menu','height',38],['heading','height',36],['toolbar','height',42],['side','width',236]])assert(Math.abs(reduced.values[key][axis]-expected)<2.05,key+' 실제 CSS 치수: '+JSON.stringify(reduced.values[key]));
    assert(reduced.sidebar['.side-project-list'].height<=126,'세 프로젝트 높이는 실제 행의 합을 따릅니다');
    assert(reduced.projectVisibility.length===3&&reduced.projectVisibility.every(item=>item.fullyVisible),'샘플 프로젝트 3개를 자르지 않고 표시 '+JSON.stringify(reduced.projectVisibility));
    assert.equal(await page.getByRole('button',{name:/이 대화에서 프로젝트 편집 허용/}).count(),0);
    assert.equal(await page.locator('.composer-footnote').count(),0);
    assert(reduced.values.body.font.includes('NanumSquareRound')&&reduced.fonts);
    results.textContrast=await sampleTextContrast(app,page);
    results.structure=await designStructure(page);
    assert.equal(results.structure.visibleToolbars,1,'프로젝트의 중앙 도구 막대는 하나');
    assert(results.structure.overviewToolbar,'프로젝트 공통 도구 막대 표시');
    assert.equal(results.structure.visibleLegacyTabs,0,'기존 9개 상세 탭을 본문에 상시 나열하지 않습니다');
    assert(results.structure.assistantBorders.every(b=>!b.width||b.style==='none'||b.color==='rgba(0, 0, 0, 0)'),'도우미 답변의 불필요한 외곽 테두리 제거');
    assert.equal(results.structure.assistantShadow,'none','도우미 본문은 그림자 없는 문서면');
    assert(results.structure.settingsAvailable,'설정 진입점 보존');
    const recommendation=page.locator('.followup-accept');
    await expect(recommendation).toContainText('갈림길과 쉬어 갈 곳을 표로 정리해줘');
    await expect(recommendation.locator('kbd')).toHaveText('Tab');
    if(screenshots){await fs.mkdir(screenshots,{recursive:true});results.capture=(await captureDesktop(app,path.join(screenshots,'desktop.png'))).geometry;}
    const work=page.locator('.turn-progress-trigger').first();
    await expect(work).toContainText('3분 26초 동안 작업');
    await work.click();
    await expect(page.locator('.turn-progress-list')).toContainText('현장 메모 3건 확인');
    if(screenshots){
      await settledLayout(page.locator('.turn-progress-list'));
      await captureDesktop(app,path.join(screenshots,'desktop-work-history.png'));
    }
    await work.click();
    await expect(page.locator('.turn-progress-list')).toHaveCount(0);
    if(screenshots)await fs.writeFile(path.join(screenshots,'desktop-scale-measurement.json'),JSON.stringify({initialZoom:results.initialZoom,appScale:results.appScale,capture:results.capture,structure:results.structure},null,2));
    if(screenshots){
      await page.locator('.workspace-side').getByRole('button',{name:'대시보드',exact:true}).click();
      await page.locator('.pf-dashboard-summary').waitFor();
      await page.mouse.move(582,53);
      await page.locator('#flowrium-icon-tip').waitFor({state:'hidden'});
      await page.evaluate(()=>document.fonts.ready);
      await settledLayout(page.locator('.pf-page'));
      await captureDesktop(app,path.join(screenshots,'desktop-dashboard.png'));
      await page.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();
      await page.mouse.move(582,53);
      await page.waitForFunction(()=>document.querySelector('.workspace-side').dataset.expanded==='false');
      await settledLayout(page.locator('.sidebar-surface'));
      await captureDesktop(app,path.join(screenshots,'desktop-sidebar-collapsed.png'));
      await page.locator('.workspace-side').hover();
      await page.getByRole('button',{name:'메뉴 고정',exact:true}).click();
      await page.locator('.side-project').filter({hasText:'도시 산책 안내서'}).click();
      await page.locator('.overview-goal progress').waitFor();
    }
    const input=page.getByLabel('Codex에 보낼 작업 요청');
    await input.press('Tab');
    await expect(input).toHaveValue('갈림길과 쉬어 갈 곳을 표로 정리해줘');
    await input.fill('');
    results.projectNavigation=await verifyProjectNavigation(page);
    await openConversation(page,'긴 안내문');
    results.reading={};
    for(const scale of [1,.87]){
      await app.evaluate(({BrowserWindow},value)=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value),scale);
      await settledLayout(page.locator('.messages'));
      await page.locator('.messages').evaluate(node=>node.scrollTop=0);
      results.reading[scale]={visibleCharacters:await visibleCharacters(page),layout:await page.locator('.messages').evaluate(node=>({scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,height:node.clientHeight,width:node.clientWidth,firstText:node.querySelector('.message-prose')?.textContent?.slice(0,30),firstY:node.querySelector('.message-prose')?.getBoundingClientRect().top,viewportY:node.getBoundingClientRect().top})),zoom:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())};
    }
    assert(results.reading[.87].visibleCharacters>results.reading[1].visibleCharacters,'전체 87%에서 더 많은 대화 내용 표시 '+JSON.stringify(results.reading));
    results.layouts=await verifyWidths(page);
    await page.bringToFront();
    const dockSelector='.conversation-dock';
    results.motion={};
    for(const [key,selector,trigger,enter,popup] of [
      ['dockClose',dockSelector,'.dock-heading button[aria-label="대화함 접기"]',false,false],['dockOpen',dockSelector,'.dock-reopen-tab',true,false],
      ['popupOpen','.music-popup .motion-surface','.header-music',true,true],
      ['popupClose','.music-popup .motion-surface','[aria-label="뮤직 닫기"]',false,true]]){
      results.motion[key]=verifyMotion(await sampleMotion(page,selector,trigger),enter,popup);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    const reducedMotion=await sampleMotion(page,'.music-popup .motion-surface','.header-music');
    assert(reducedMotion.filter(f=>f.width&&f.opacity>.02&&f.opacity<.98).length<=1);
    await page.getByRole('button',{name:'뮤직 닫기',exact:true}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});

    await page.locator('.header-music').click();
    const volume=page.getByRole('slider',{name:'음량',exact:true});
    await app.evaluate(({ipcMain})=>{
      const channel='flowrium:saveMusic',save=ipcMain._invokeHandlers.get(channel);
      if(!save)throw Error('음량 저장 동작을 찾을 수 없습니다.');
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel,async(event,value)=>{
        if(value.volume===100)await new Promise(resolve=>setTimeout(resolve,350));
        return save(event,value);
      });
    });
    await volume.focus();await volume.press('End');await volume.press('ArrowLeft');
    await page.waitForFunction(async()=>(await window.flowrium.musicState()).volume===99);
    await page.getByRole('button',{name:'뮤직 닫기',exact:true}).click();
    await page.locator('.overview-tools>summary').click();
    const goals=page.getByRole('region',{name:'기간 목표와 반복 일정'});
    await goals.getByRole('group',{name:'목표 기간'}).getByRole('button',{name:'월간'}).click();
    await goals.getByRole('textbox',{name:'기간 목표',exact:true}).fill('보행로 표지판 확인');
    const target=goals.getByRole('spinbutton',{name:'수치 목표',exact:true});
    await target.fill('10.5');await goals.getByRole('button',{name:'수치 목표 늘리기'}).click();assert.equal(await target.inputValue(),'11.5');
    await target.focus();await target.hover();await page.mouse.wheel(0,-60);await page.waitForTimeout(120);
    assert.equal(await target.inputValue(),'11.5');assert(await target.evaluate(el=>el===document.activeElement));
    await target.press('ArrowDown');assert.equal(await target.inputValue(),'10.5');
    const due=goals.getByLabel('목표 기한');await due.focus();await due.press('Enter');
    const calendar=page.getByRole('dialog',{name:'날짜 선택'});await calendar.getByRole('button',{name:day(now)}).click();
    assert.equal(await due.inputValue(),day(now));assert(await due.evaluate(el=>el===document.activeElement));
    await goals.getByRole('button',{name:'목표 추가',exact:true}).click();
    await goals.getByRole('checkbox',{name:/보행로 표지판 확인/}).waitFor();
    await goals.getByRole('combobox',{name:'반복 일정 시',exact:true}).selectOption('13');
    await goals.getByRole('combobox',{name:'반복 일정 분',exact:true}).selectOption('47');
    await goals.getByLabel('알릴 내용').fill('비 오는 날 산책길 확인');await goals.getByRole('button',{name:'일정 추가'}).click();
    await goals.getByRole('button',{name:'반복 일정 저장'}).click();
    const checkControls=async()=>{
      const {projects}=await window.flowrium.bootstrap(),details=await window.flowrium.readProjectDetails(projects.find(p=>p.name==='도시 산책 안내서').id);
      const goal=details.periodGoals?.find(g=>g.text==='보행로 표지판 확인');
      return {target:goal?.target,due:goal?.due,period:goal?.period,time:details.schedule?.find(s=>s.text==='비 오는 날 산책길 확인')?.time,volume:(await window.flowrium.musicState()).volume};
    };
    const expectedControls={target:10.5,due:day(now),period:'month',time:'13:47',volume:99};
    await expect.poll(()=>page.evaluate(checkControls),{timeout:10000}).toEqual(expectedControls);
    results.controls=await page.evaluate(checkControls);
    const weekdayBox=await goals.getByRole('combobox',{name:'반복 일정 요일',exact:true}).boundingBox(),timeBox=await goals.locator('.time-parts').boundingBox();
    assert(Math.abs(weekdayBox.y-timeBox.y)<1&&Math.abs(weekdayBox.height-timeBox.height)<1,'반복 일정 요일과 시각 기준선');
    if(screenshots){
      await goals.locator('.ag-schedule').evaluate(el=>{const view=el.closest('.project-document-scroll')||el.closest('.pf-page');if(view){view.scrollTop+=el.getBoundingClientRect().top-view.getBoundingClientRect().top-view.clientHeight*.53;}});
      await captureDesktop(app,path.join(screenshots,'desktop-controls.png'));
    }
    const rail=page.locator('.workspace-side');
    if(await rail.getAttribute('data-pinned')==='true')await rail.getByRole('button',{name:'메뉴 자동 접기',exact:true}).click();
    await page.mouse.move(650,80);
    await settledRail(rail,{expanded:false,pinned:false},'중앙 상단에서 개인 비서 진입 가능');
    await expect(rail.locator('.assistant-entry,.header-music,.header-decisions')).toHaveCount(0);
    const assistantEntry=page.locator('.workspace-utilities .assistant-entry');
    await expect(assistantEntry).toBeVisible();
    await assistantEntry.click();
    await page.waitForFunction(async()=> (await window.flowrium.bootstrap()).sessions.some(s=>s.generalAssistant));
    await expect(page.locator('.conversation-dock .session-heading h2')).toHaveText('개인 비서');
    const generalHeadingGap=await page.locator('.conversation-dock .session-heading').evaluate(heading=>
      heading.querySelector('h2').getBoundingClientRect().top-heading.querySelector('.eyebrow').getBoundingClientRect().bottom);
    assert(generalHeadingGap>=4.5,'일반 대화 종류와 제목 사이 간격');
    const ids=await page.evaluate(async()=>{const api=window.flowrium;return Promise.all([api.openGeneralAssistant(),api.openGeneralAssistant()].map(p=>p.then(s=>s.id)))});
    assert.equal(ids[0],ids[1]);assert.equal(await page.getByRole('region',{name:'Dots 공식 화면'}).count(),0);
    assert(await page.evaluate(async()=>{try{await window.flowrium.showDotsView({x:20,y:60,width:300,height:400});return false}catch{return true}}));
    await page.locator('.workspace-side').getByRole('button',{name:'설정',exact:true}).click();const dialog=page.getByRole('dialog',{name:'설정',exact:true});
    await dialog.waitFor();
    await expect(dialog.locator('[data-settings-target]')).toHaveText(['일반','카테고리 관리','보안','휴대폰','음성','계정과 모델','화면']);
    await expect(dialog.locator('.settings-group:visible')).toHaveCount(1);
    await dialog.locator('[data-settings-target=account]').click();
    await expect(dialog.locator('.connection-state')).toHaveText('ChatGPT(Plus)');
    const categoryToggle=dialog.getByRole('button',{name:'카테고리 관리',exact:true});
    await categoryToggle.click();
    const category=dialog.getByRole('region',{name:'프로젝트 카테고리 관리'});
    const projectChoice=category.getByRole('combobox',{name:'프로젝트',exact:true});
    await projectChoice.click();
    const choices=category.getByRole('listbox',{name:'프로젝트',exact:true});
    await settledLayout(choices);
    const choiceLayout=await projectChoice.evaluate(el=>{
      const menu=document.getElementById(el.getAttribute('aria-controls'));
      const a=el.getBoundingClientRect(),b=menu.getBoundingClientRect(),icon=el.querySelector(':scope > svg').getBoundingClientRect();
      const placement=menu.dataset.placement;
      return {placement,gap:placement==='up'?a.top-b.bottom:b.top-a.bottom,left:b.left-a.left,width:b.width-a.width,center:Math.abs((icon.top+icon.bottom-a.top-a.bottom)/2),inset:a.right-icon.right};
    });
    assert(choiceLayout.gap>=3.5&&choiceLayout.gap<=8.5&&Math.abs(choiceLayout.left)<1&&Math.abs(choiceLayout.width)<1,JSON.stringify(choiceLayout));
    assert(choiceLayout.center<1&&choiceLayout.inset>=11,JSON.stringify(choiceLayout));
    if(screenshots)await captureDesktop(app,path.join(screenshots,'desktop-choices.png'));
    await projectChoice.press('Escape');
    await expect(choices).toHaveCount(0);
    await category.getByRole('button',{name:'카테고리 이름 선택 목록'}).click();
    await expect(category.getByRole('option',{name:'업무',exact:true})).toBeVisible();
    const categoryName=category.getByRole('combobox',{name:'카테고리 이름'});
    await categoryName.press('Escape');
    await categoryName.fill('검증용 카테고리');
    await categoryToggle.click();
    await expect(categoryToggle).toHaveAttribute('aria-expanded','false');
    await expect(dialog.locator('.settings-group:visible')).toHaveCount(0);
    await categoryToggle.click();
    await expect(categoryToggle).toHaveAttribute('aria-expanded','true');
    await expect(categoryName).toHaveValue('검증용 카테고리');
    results.choiceLayout=choiceLayout;
    await dialog.locator('[data-settings-target=security]').click();
    const toggles=dialog.locator('.ui-switch-control input[type=checkbox]');
    assert(await toggles.count()>0);
    assert(await toggles.evaluateAll(inputs=>inputs.every(input=>getComputedStyle(input).appearance==='none')));
    const combo=page.getByRole('combobox',{name:'자리 비움 자동 잠금'});
    for(const height of [940,650]){
      await page.setViewportSize({width:1440,height});
      await combo.scrollIntoViewIfNeeded();await combo.click();await settledLayout(page.getByRole('listbox',{name:'자리 비움 자동 잠금'}));
      const list=page.getByRole('listbox',{name:'자리 비움 자동 잠금'}),a=await combo.boundingBox(),b=await list.boundingBox();
      const placement=await list.getAttribute('data-placement');
      const gap=placement==='up'?a.y-b.y-b.height:b.y-a.y-a.height;
      results.lock.push({height,placement,xDifference:b.x-a.x,widthDifference:b.width-a.width,gap});
      assert(Math.abs(a.x-b.x)<1&&Math.abs(a.width-b.width)<1&&gap>=3.5&&gap<=8.5);
      if(screenshots&&height===940)await captureDesktop(app,path.join(screenshots,'desktop-settings.png'));
      if(height===940){await combo.press('Escape');await dialog.waitFor();assert(await combo.evaluate(e=>e===document.activeElement));}
      else{await combo.press('End');await combo.press('Enter');await page.waitForFunction(async()=>(await window.flowrium.securityState()).preferences.idleMinutes===60);}
    }
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1180,height:740,deviceScaleFactor:1.5,mobile:false});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.15));
    await combo.scrollIntoViewIfNeeded();await combo.click();await settledLayout(page.getByRole('listbox',{name:'자리 비움 자동 잠금'}));
    const zoomedList=page.getByRole('listbox',{name:'자리 비움 자동 잠금'});
    const zoomBoxes=await page.evaluate(()=>{
      const button=document.querySelector('.idle-picker [role=combobox]');
      const menu=document.getElementById(button.getAttribute('aria-controls'));
      const trigger=button.getBoundingClientRect(),list=menu.getBoundingClientRect(),placement=menu.dataset.placement;
      return {dpr:window.devicePixelRatio,placement,xDifference:list.left-trigger.left,widthDifference:list.width-trigger.width,gap:placement==='up'?trigger.top-list.bottom:list.top-trigger.bottom};
    });
    assert(Math.abs(zoomBoxes.xDifference)<1&&Math.abs(zoomBoxes.widthDifference)<1&&zoomBoxes.gap>=3.5&&zoomBoxes.gap<=8.5);
    results.lock.push(zoomBoxes);
    await app.evaluate(({ipcMain})=>{
      const channel='flowrium:setSecurityPreferences';
      const save=ipcMain._invokeHandlers.get(channel);
      if(!save)throw Error('잠금 설정 저장 동작을 찾을 수 없습니다.');
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel,async(...args)=>{
        await new Promise(resolve=>setTimeout(resolve,300));
        return save(...args);
      });
    });
    await zoomedList.getByRole('option',{name:'30분 후'}).click();
    await zoomedList.waitFor({state:'detached'});
    await expect(combo).toBeFocused();
    await page.waitForFunction(async()=>(await window.flowrium.securityState()).preferences.idleMinutes===30);
    await combo.click();await combo.press('Tab');await zoomedList.waitFor({state:'detached'});
    await combo.click();await dialog.getByRole('heading',{name:'화면 잠금',exact:true}).click();await zoomedList.waitFor({state:'detached'});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(.87));
    await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.detach();
    await page.setViewportSize({width:1440,height:940});
    await dialog.locator('[data-settings-target=appearance]').click();
    for(const [theme,label] of [['dark','어둡게'],['light','밝게']])for(const [accent,name] of [['green','초록'],['purple','보라'],['blue','파랑']]){
      await dialog.getByRole('button',{name:label,exact:true}).click();await dialog.getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(({theme,accent})=>document.documentElement.dataset.theme===theme&&document.documentElement.dataset.accent===accent,{theme,accent});
      results.themes.push(await page.evaluate(()=>{
        const computed=getComputedStyle(document.documentElement),channels=key=>{const hex=computed.getPropertyValue(key).trim().replace('#','');return (hex.length===3?hex.split('').map(c=>c+c):hex.match(/../g)).map(s=>parseInt(s,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)};
        const lum=key=>channels(key).reduce((acc,v,i)=>acc+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const shell=getComputedStyle(document.querySelector('.app-shell'));
        const tabs=document.querySelector('.dock-scope-tabs');
        const selection=tabs?.querySelector('[aria-pressed=true]');
        return {theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,label:ratio('--muted','--panel'),selected:ratio('--accent-ink','--accent-soft'),primary:ratio('--on-primary','--accent-fill'),
          surfaces:['--bg','--sidebar','--panel','--panel-alt','--input'].map(key=>computed.getPropertyValue(key)).concat(shell.backgroundColor,shell.backgroundImage),
          scope:selection?getComputedStyle(selection).backgroundColor:null,track:tabs?getComputedStyle(tabs).backgroundColor:null};
      }));
    }
    assert(results.themes.every(row=>Math.min(row.label,row.selected,row.primary)>=4.5),JSON.stringify(results.themes));assert.deepEqual(results.errors,[]);
    const darkThemes=results.themes.filter(row=>row.theme==='dark');
    assert(darkThemes.every(row=>JSON.stringify(row.surfaces)===JSON.stringify(darkThemes[0].surfaces)));
    for (const mode of ['light','dark']) {
      const variants=results.themes.filter(row=>row.theme===mode);
      assert(variants.every(row=>row.scope&&row.scope!==row.track));
      assert.equal(new Set(variants.map(row=>row.scope)).size,3);
    }
    if(screenshots)await fs.writeFile(path.join(screenshots,'desktop-verification.json'),JSON.stringify(results,null,2));
    console.log('데스크톱 실제 창 / 글꼴 / 3열 치수 / 전체 앱87% / 메뉴·입력·본문 실측 / 대비 6조합 / 인라인 잠금 목록 / 일반 개인 비서',JSON.stringify(results));
  }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1});
