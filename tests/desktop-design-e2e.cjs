const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
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
  const messages=[message('user','중앙역에서 도시숲까지 걷는 길을 정리해줘.'),message('assistant',response)];
  await store.createSession(project.id,{title,messages});
  await store.createSession(project.id,{title:'쉬어 갈 수 있는 장소',messages:[message('user','벤치와 쉼터 위치를 기록해줘.')]});
  const text=Array.from({length:40},(_,i)=>(i+1)+'번째 구간에서는 골목과 계단을 차례로 지나 산책로를 따라 공원으로 이어집니다.').join('\n\n');
  await store.createSession(project.id,{title:'긴 안내문',messages:[message('assistant',text)]});
  await store.saveSettings({codexPath:fixture,theme:'light',accentColor:'blue'});
}
const map='<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160" viewBox="0 0 420 160"><rect width="420" height="160" fill="#eef3e9"/><path fill="#d4e7ea" d="m200 0 25 0-88 160h-25z"/><g fill="none" stroke="#fff" stroke-width="12"><path d="M0 70h420M40 20l335 120M45 155l33-155M300 165l62-165"/></g><path d="M48 112L82 70h98l65 25 78-54" fill="none" stroke="#2669aa" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><g fill="white" stroke="#2669aa" stroke-width="3"><circle cx="48" cy="112" r="6"/><circle cx="180" cy="70" r="6"/><circle cx="323" cy="41" r="6"/></g><g fill="#314b55" font-size="14" font-family="sans-serif"><text x="23" y="138">중앙역</text><text x="152" y="51">골목 서점</text><text x="314" y="21">도시숲</text></g></svg>';
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
  assert(moving.length>=4,'여러 연속 프레임을 그려야 합니다: '+JSON.stringify(rows));
  assert(enter?rows.at(-1).opacity>.99:rows.at(-1).opacity===0);
  assert(Math.abs(rows[0].opacity-(enter?0:1))<.025);
  for(let i=1;i<moving.length;i++){
    assert(enter?moving[i].opacity>=moving[i-1].opacity-.001:moving[i].opacity<=moving[i-1].opacity+.001,'투명도 방향 유지');
    if(popup){assert(Math.abs(moving[i].x-moving[0].x)<1&&Math.abs(moving[i].y-moving[0].y)<1,'중앙 축 유지');}
    else assert(enter?moving[i].main<=moving[i-1].main+1:moving[i].main>=moving[i-1].main-1,'중앙 문서 너비를 연속적으로 변경');
  }
  return {frames:rows.length,changingFrames:moving.length,start:rows[0].opacity,end:rows.at(-1).opacity,maxFrameGap:Math.max(...moving.slice(1).map((p,i)=>p.t-moving[i].t))};
}
const baseline=process.argv.includes('--baseline');
async function run(){
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-desktop-design-')));
  const profile=path.join(temp,'profile'), store=new Store(profile);
  let app,page;const results={themes:[],lock:[],reading:{},errors:[]};
  try{
    await setup(store,temp);
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex'),FLOWRIUM_TEST_PLAN:'plus'};
    delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
    if(baseline){
      const registry=JSON.parse(await fs.readFile(store.file,'utf8'));
      delete registry.settings.accentColor;await fs.writeFile(store.file,JSON.stringify(registry));
      delete env.FLOWRIUM_USER_DATA;
      app=await _electron.launch({executablePath:'/Applications/Flowrium.app/Contents/MacOS/Flowrium',args:['--user-data-dir='+profile],env,timeout:45000});
      assert.equal(await fs.realpath(await app.evaluate(({app})=>app.getPath('userData'))),await fs.realpath(profile));
    }else app=await _electron.launch({args:[root],env,timeout:45000});
    page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>results.errors.push(error.message));
    await page.route('https://i.ytimg.com/flowrium-isolated-test/walk.svg',route=>route.fulfill({body:map,contentType:'image/svg+xml'}));
    await page.setViewportSize({width:1440,height:940});
    await page.locator('.side-usage[data-connected=true]').waitFor();
    await page.locator('.workspace-side').hover();
    await page.getByRole('button',{name:'메뉴 고정',exact:true}).click();
    await page.locator('.side-project').filter({hasText:'도시 산책 안내서'}).click();
    if(!baseline)await page.locator('.overview-goal progress').waitFor();
    await openConversation(page,title);
    await page.locator('.message-prose img').evaluate(img=>img.decode());
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(360);
    for(const scale of baseline?[1]:[1,.94,.9]){
      await page.evaluate(scale=>document.documentElement.style.setProperty('--chat-reading-scale',scale),scale);
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      results.reading[scale]=await page.evaluate(()=>{
        const rect=sel=>{const {x,y,width,height}=document.querySelector(sel).getBoundingClientRect();return{x,y,width,height}};
        return {image:rect('.message-prose img'),dock:rect('.conversation-dock'),heading:rect('.dock-heading'),toolbar:rect('.topbar'),composer:rect('.composer'),main:rect('.main-shell'),side:rect('.workspace-side'),font:getComputedStyle(document.querySelector('.message-prose')).fontFamily,fonts:document.fonts.check('700 14px NanumSquareRound','한글 123')};
      });
    }
    const full=results.reading[1],reduced=results.reading[.9];
    if(!baseline){
    for(const side of ['width','height'])assert(Math.abs(reduced.image[side]/full.image[side]-.9)<.02,'그림 '+side+' '+JSON.stringify(results.reading));
    for(const fixed of ['dock','heading','toolbar','composer','main','side'])assert.deepEqual(full[fixed],reduced[fixed],fixed);
    assert.equal(reduced.heading.height,36);assert.equal(reduced.toolbar.height,56);assert.equal(reduced.side.width,248);
    assert(reduced.font.includes('NanumSquareRound')&&reduced.fonts);
    if(screenshots){await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,'desktop.png'),animations:'disabled'});}
    }
    await openConversation(page,'긴 안내문');
    for(const scale of baseline?[1]:[1,.94,.9]){
      await page.evaluate(value=>{document.documentElement.style.setProperty('--chat-reading-scale',value);document.querySelector('.messages').scrollTop=0},scale);
      await page.waitForTimeout(40);
      results.reading[scale].visibleCharacters=await page.evaluate(()=>{
        const viewport=document.querySelector('.messages'),bounds=viewport.getBoundingClientRect();let count=0;
        const walker=document.createTreeWalker(viewport.querySelector('.message-prose'),NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){const text=walker.currentNode;for(let i=0;i<text.length;i++){const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const r=range.getBoundingClientRect();if(r.top>=bounds.top&&r.bottom<=bounds.bottom&&r.width>0)count++;}}
        return count;
      });
    }
    if(baseline){
      const measurement=results.reading[1];measurement.version=await app.evaluate(({app})=>app.getVersion());
      if(screenshots)await fs.writeFile(path.join(screenshots,'desktop-baseline.json'),JSON.stringify(measurement,null,2));
      console.log('기존 설치본 격리 측정',JSON.stringify(measurement));return;
    }
    assert(reduced.visibleCharacters>full.visibleCharacters);
    await page.bringToFront();
    const dockSelector='.conversation-dock';
    results.motion={};
    for(const [key,selector,trigger,enter,popup] of [
      ['dockClose',dockSelector,'.dock-toggle',false,false],['dockOpen',dockSelector,'.dock-toggle',true,false],
      ['popupOpen','.music-popup .motion-surface','.header-music',true,true],
      ['popupClose','.music-popup .motion-surface','[aria-label="뮤직 닫기"]',false,true]]){
      results.motion[key]=verifyMotion(await sampleMotion(page,selector,trigger),enter,popup);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    const reducedMotion=await sampleMotion(page,'.music-popup .motion-surface','.header-music');
    assert(reducedMotion.filter(f=>f.width&&f.opacity>.02&&f.opacity<.98).length<=1);
    await page.getByRole('button',{name:'뮤직 닫기',exact:true}).click();
    await page.emulateMedia({reducedMotion:'no-preference'});

    await page.getByRole('button',{name:'개인 비서 보기'}).click();
    await page.waitForFunction(async()=> (await window.flowrium.bootstrap()).sessions.some(s=>s.generalAssistant));
    const ids=await page.evaluate(async()=>{const api=window.flowrium;return Promise.all([api.openGeneralAssistant(),api.openGeneralAssistant()].map(p=>p.then(s=>s.id)))});
    assert.equal(ids[0],ids[1]);assert.equal(await page.getByRole('region',{name:'Dots 공식 화면'}).count(),0);
    assert(await page.evaluate(async()=>{try{await window.flowrium.showDotsView({x:20,y:60,width:300,height:400});return false}catch{return true}}));
    const button=(name)=>page.getByRole('button',{name,exact:true});
    await button('설정').click();const dialog=page.getByRole('dialog',{name:'설정',exact:true});
    await dialog.waitFor();assert.equal(await dialog.locator('[data-settings-target]').count(),6);
    const combo=page.getByRole('combobox',{name:'자리 비움 자동 잠금'});
    for(const height of [940,650]){
      await page.setViewportSize({width:1440,height});
      await combo.scrollIntoViewIfNeeded();await combo.click();await page.waitForTimeout(220);
      const list=page.getByRole('listbox',{name:'자리 비움 자동 잠금'}),a=await combo.boundingBox(),b=await list.boundingBox();
      results.lock.push({height,xDifference:b.x-a.x,widthDifference:b.width-a.width,gap:b.y-a.y-a.height});
      assert(Math.abs(a.x-b.x)<1&&Math.abs(a.width-b.width)<1&&Math.abs(b.y-a.y-a.height-6)<1);
      if(screenshots&&height===940)await page.screenshot({path:path.join(screenshots,'desktop-settings.png'),animations:'disabled'});
      if(height===940){await combo.press('Escape');await dialog.waitFor();assert(await combo.evaluate(e=>e===document.activeElement));}
      else{await combo.press('End');await combo.press('Enter');await page.waitForFunction(async()=>(await window.flowrium.securityState()).preferences.idleMinutes===60);}
    }
    await page.setViewportSize({width:1440,height:940});
    for(const [theme,label] of [['dark','어둡게'],['light','밝게']])for(const [accent,name] of [['green','초록'],['purple','보라'],['blue','파랑']]){
      await dialog.locator('[data-settings-target=appearance]').click();await dialog.getByRole('button',{name:label,exact:true}).click();await dialog.getByRole('button',{name,exact:true}).click();
      await page.waitForFunction(({theme,accent})=>document.documentElement.dataset.theme===theme&&document.documentElement.dataset.accent===accent,{theme,accent});
      results.themes.push(await page.evaluate(()=>{
        const computed=getComputedStyle(document.documentElement),channels=key=>{const hex=computed.getPropertyValue(key).trim().replace('#','');return (hex.length===3?hex.split('').map(c=>c+c):hex.match(/../g)).map(s=>parseInt(s,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)};
        const lum=key=>channels(key).reduce((acc,v,i)=>acc+v*[.2126,.7152,.0722][i],0),ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        return {theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,label:ratio('--muted','--panel'),selected:ratio('--accent-ink','--accent-soft'),primary:ratio('--on-primary','--accent-fill')};
      }));
    }
    assert(results.themes.every(row=>Math.min(row.label,row.selected,row.primary)>=4.5),JSON.stringify(results.themes));assert.deepEqual(results.errors,[]);
    if(screenshots)await fs.writeFile(path.join(screenshots,'desktop-verification.json'),JSON.stringify(results,null,2));
    console.log('데스크톱 실제 창 / 글꼴 / 3열 치수 / 본문 3개 배율 / 그림 양축 / 대비 6조합 / 인라인 잠금 목록 / 일반 개인 비서',JSON.stringify(results));
  }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
run().catch(error=>{console.error(error);process.exitCode=1});
