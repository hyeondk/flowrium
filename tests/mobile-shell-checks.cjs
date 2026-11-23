const assert = require('node:assert/strict');

async function checkTouchAndWheel(page, nav) {
  const current = () => nav.locator('[aria-current=page]').getAttribute('data-view');
  const center = async view => {
    const r = await nav.locator('[data-view='+view+']').boundingBox();
    return {x:r.x+r.width/2, y:r.y+r.height/2};
  };
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent',
    {type, touchPoints:point ? [{x:point.x,y:point.y,id:1}] : []});
  const clickLog = await nav.evaluateHandle(el => {
    const events = [], stop = new AbortController();
    el.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(button) events.push(button.dataset.view);
    },{signal:stop.signal});
    return {events,stop};
  });
  try {
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
    const start = await center('approvals'), end = await center('settings');
    await touch('touchStart',start);
    await touch('touchMove',{x:start.x+12,y:start.y});
    await touch('touchMove',{x:end.x+30,y:end.y});
    assert.equal(await current(),'approvals');
    assert.equal(await nav.locator('[data-drag-target]').getAttribute('data-view'),'settings');
    await touch('touchEnd');
    assert.equal(await current(),'settings');
    assert.deepEqual(await clickLog.evaluate(log=>log.events),['settings']);

    await touch('touchStart',end);
    await touch('touchMove',start);
    await touch('touchCancel');
    assert.equal(await current(),'settings');
    assert.equal(await nav.locator('[data-drag-target]').count(),0);
    const beforeVertical=await page.evaluate(()=>window.scrollY);
    await touch('touchStart',end);
    for(let n=1;n<=4;n++) await touch('touchMove',{x:end.x-2,y:end.y-20*n});
    await touch('touchEnd');
    await page.waitForFunction(before=>scrollY>before+1,beforeVertical);
    assert.deepEqual(await clickLog.evaluate(log=>log.events),['settings']);

    const wheelStart=Date.now()/1000;
    for(const [elapsed,deltaX,deltaY] of [[0,-50,0],[.016,-35,0],[.032,0,70]]) {
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...start,deltaX,deltaY,timestamp:wheelStart+elapsed});
    }
    await page.waitForFunction(()=>document.querySelector('#nav [aria-current]')?.dataset.view==='assistant');
    assert.deepEqual(await clickLog.evaluate(log=>log.events),['settings','assistant']);

    // Larger system text makes the five destinations wider than the glass bar.
    await page.evaluate(()=>document.documentElement.style.fontSize='32px');
    await page.waitForFunction(()=>document.querySelector('#nav').hasAttribute('data-overflow'));
    await nav.evaluate(el=>el.scrollLeft=0);
    const box=await nav.boundingBox(),point={x:box.x+box.width-25,y:box.y+box.height/2};
    await touch('touchStart',point);
    for(let n=1;n<=6;n++) await touch('touchMove',{x:point.x-n*30,y:point.y});
    await touch('touchEnd');
    await page.waitForFunction(()=>document.querySelector('#nav').scrollLeft>20);
    assert.equal(await current(),'assistant','확대 화면을 스크롤해도 탭 선택을 유지');
    const last=await center('settings');
    assert(last.x>box.x && last.x<box.x+box.width);
    await touch('touchStart',last);await touch('touchEnd');
    await page.waitForFunction(()=>document.querySelector('#nav [aria-current]')?.dataset.view==='settings');
    assert.deepEqual(await clickLog.evaluate(log=>log.events),['settings','assistant','settings']);
  } finally {
    await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
    await clickLog.evaluate(log=>log.stop.abort());
    await clickLog.dispose();
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp.detach();
  }
}

async function checkMobileShell(page) {
  const nav = page.getByRole('navigation', {name:'모바일 메뉴'});
  await nav.waitFor();
  const geometry = () => nav.evaluate(el => {
    const bounds = el.getBoundingClientRect(), root = document.documentElement;
    return {left:bounds.left,right:root.clientWidth-bounds.right,bottom:innerHeight-bounds.bottom,
      viewport:innerWidth,available:root.clientWidth,content:root.scrollWidth,
      padding:parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),
      height:bounds.height,buttons:[...el.querySelectorAll('button')].map(button=>[button.offsetWidth,button.offsetHeight])};
  });
  // Windows reserves scrollbar space inside innerWidth. Preserve the native
  // layout first, then exercise real classic-scrollbar geometry on every host.
  const classic = await page.evaluateHandle(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('html::-webkit-scrollbar {width:16px} html {overflow-y:scroll}');
    sheet.disabled = true;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets,sheet];
    return sheet;
  });
  for (const fixed of [false,true]) {
    await classic.evaluate((sheet, enabled) => sheet.disabled = !enabled, fixed);
    for (const width of [320,390,430,768]) {
      await page.setViewportSize({width,height:844});
      const r = await geometry();
      assert(r.left>=9 && r.right>=9 && r.bottom>=8,JSON.stringify(r));
      assert.equal(r.content, r.available, '문서 가로 넘침 '+JSON.stringify(r));
      if (fixed) assert.equal(r.viewport-r.available,16,'고정 스크롤바 공간 '+JSON.stringify(r));
      assert(r.padding>r.height+r.bottom);
      assert(r.buttons.every(([w,h])=>w>=44 && h>=44));
    }
  }
  // An 8px leak is smaller than the reserved 16px. It still must be detected.
  const probe = await page.evaluateHandle(() => {
    const sample = document.createElement('div');
    sample.style.cssText='position:absolute;left:0;top:0;height:1px;pointer-events:none';
    sample.style.width=(document.documentElement.clientWidth+8)+'px';
    document.body.append(sample);
    return sample;
  });
  try {
    const r = await geometry();
    assert.equal(r.content-r.available,8,JSON.stringify(r));
    assert(r.content < r.viewport,'창 전체 폭을 쓰면 이 넘침을 놓칩니다.');
  } finally { await probe.evaluate(el=>el.remove()); await probe.dispose(); }
  await page.setViewportSize({width:390,height:844});
  const home=nav.locator('[data-view=projects]'),approvals=nav.locator('[data-view=approvals]');
  await home.focus();await page.keyboard.press('ArrowRight');
  assert.equal(await nav.locator('[data-view=running]').getAttribute('aria-current'),'page');
  const from=await nav.locator('[data-view=running]').boundingBox(),to=await approvals.boundingBox();
  const offset=()=>nav.evaluate(el=>new DOMMatrix(getComputedStyle(el,'::before').transform).m41);
  await nav.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));
  const resting=await offset();
  await page.mouse.move(from.x+from.width/2,from.y+22);await page.mouse.down();
  await page.mouse.move(from.x+from.width*.75,from.y+22,{steps:4});
  const shift=await offset()-resting;
  assert(Math.abs(shift-from.width*.25)<2,`반 칸 미만 드래그가 손가락을 따라야 함: ${shift}px / 목표 ${from.width*.25}px`);
  assert.equal(await nav.locator('[data-view=running]').getAttribute('aria-current'),'page');
  await page.mouse.move(to.x+to.width*.72,to.y+22,{steps:8});
  const finger=await offset();
  await nav.evaluate(el=>{
    const x=()=>new DOMMatrix(getComputedStyle(el,'::before').transform).m41;
    el.addEventListener('pointerup',()=>{
      const t=performance.now(),samples=[x()];
      el.settledFrames=new Promise(resolve=>{
        function tick(){samples.push(x());if(performance.now()-t>360)resolve(samples);else requestAnimationFrame(tick);}
        requestAnimationFrame(tick);
      });
    },{once:true});
  });
  await page.mouse.up();
  const samples=await nav.evaluate(el=>el.settledFrames);
  const last=samples.at(-1);assert(Math.abs(samples[0]-finger)<1.5);
  assert(samples.length>=3 && samples.every((x,i)=>i===0||x<=samples[i-1]+1),'손을 뗀 뒤 역방향 튐 '+samples);
  assert(last<finger-2 && Math.abs(last-samples.at(-2))<1,'정착 안정성 '+samples);
  console.log('탭 릴리스 표시 프레임 '+samples.length+' / 좌표 '+[finger,samples[0],last].map(n=>n.toFixed(1)).join(' → '));
  assert.equal(await approvals.getAttribute('aria-current'),'page');
  await checkTouchAndWheel(page,nav);
  await page.emulateMedia({reducedMotion:'reduce'});
  await home.click();
  assert.equal(await page.locator('#content').evaluate(e=>e.getAnimations().length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(process.env.FLOWRIUM_MOBILE_SCREENSHOT){
    await classic.evaluate(sheet=>sheet.disabled=true);
    await page.mouse.move(0,0);await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});
    await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);
    await page.screenshot({path:process.env.FLOWRIUM_MOBILE_SCREENSHOT,animations:'disabled'});
    await classic.evaluate(sheet=>sheet.disabled=false);
  }
  await classic.dispose();
  console.log('모바일 하단 바 320/390/768px, 44px 터치 영역, 선택 표시 연속 추적, 양 끝에서 단일 선택, 세로 및 취소 동작, 가로 휠 관성, 확대 글자에서 실제 스크롤, 키보드 탐색 및 동작 줄이기 통과');
}

function workspaceGeometry() {
  const header=document.querySelector('.bar'),main=document.querySelector('#content'),nav=document.querySelector('#nav'),
    logo=document.querySelector('#home'),root=document.documentElement;
  const box=el=>el.getBoundingClientRect(),height=main.style.minHeight;
  main.style.minHeight=(innerHeight+160)+'px';scrollTo(0,110);
  const headerStyle=getComputedStyle(header);
  const paint=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  paint.fillStyle=headerStyle.backgroundColor;
  paint.fillRect(0,0,1,1);
  const geometry={headerTop:box(header).top,headerBottom:box(header).bottom,logoTop:box(logo).top,logoLeft:box(logo).left,scroll:scrollY,
    layer:document.elementFromPoint(box(logo).left+4,Math.max(1,box(header).height/3))?.closest('.bar')===header,
    filter:headerStyle.backdropFilter||headerStyle.webkitBackdropFilter||'none',
    opaque:paint.getImageData(0,0,1,1).data[3]===255&&headerStyle.backgroundImage==='none',
    reducedTransparency:matchMedia('(prefers-reduced-transparency:reduce)').matches,
    supportsFilter:CSS.supports('backdrop-filter','blur(1px)')||CSS.supports('-webkit-backdrop-filter','blur(1px)'),
    navTop:box(nav).top,navBottom:innerHeight-box(nav).bottom,
    navLeft:box(nav).left,navRight:box(nav).right,contentLeft:box(main).left,
    contentCols:getComputedStyle(main).gridTemplateColumns.split(' ').length,
    overflow:root.scrollWidth-root.clientWidth};
  main.style.minHeight=height;scrollTo(0,0);
  return geometry;
}

function checkHeaderCover(values,summary) {
  assert(values.scroll>=100 && Math.abs(values.headerTop)<=1 && values.layer,summary);
  if(values.reducedTransparency || !values.supportsFilter)
    assert(values.filter==='none' && values.opaque,summary);
  else
    assert(values.filter.includes('blur('),summary);
}

async function checkWorkspaceSizes(page) {
  const cdp=await page.context().newCDPSession(page);
  const desktop=(name,w,h)=>[
    {name:name+' 세로',w,h,layout:'wide',top:24,bottom:20},
    {name:name+' 가로',w:h,h:w,layout:'wide',top:24,bottom:20},
  ];
  const devices=[
    {name:'아이폰',w:390,h:844,layout:'compact',top:47,bottom:34},
    {name:'아이폰 가로',w:844,h:390,layout:'compact',left:47,right:47,bottom:21},
    {name:'안드로이드 휴대폰',w:412,h:915,layout:'compact',top:28,bottom:24},
    {name:'안드로이드 휴대폰 가로',w:915,h:412,layout:'compact',left:32,right:15,bottom:16},
    {name:'아이패드 미니 세로',w:744,h:1133,layout:'compact',top:24,bottom:20},
    {name:'아이패드 미니 가로',w:1133,h:744,layout:'compact',top:24,bottom:20},
    {name:'이전 아이패드 미니 가로',w:1024,h:768,layout:'compact',top:20},
    ...desktop('아이패드 10.2형',810,1080),
    ...desktop('아이패드 11형',834,1194),
    ...desktop('아이패드 13형',1024,1366),
    {name:'아이패드 11형 분할 화면',w:540,h:834,screenWidth:1194,screenHeight:834,layout:'compact',top:24,bottom:20},
  ];
  const metrics=[];
  try {
    for (const device of devices) {
      const {name,w,h,screenWidth=w,screenHeight=h,layout,top=0,bottom=0,left=0,right=0}=device;
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,screenWidth,screenHeight,deviceScaleFactor:2,mobile:true,
        screenOrientation:{type:screenWidth>screenHeight?'landscapePrimary':'portraitPrimary',angle:screenWidth>screenHeight?90:0}});
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top,bottom,left,right}});
      await page.waitForFunction(({layout,w})=>document.documentElement.dataset.workspaceLayout===layout && innerWidth===w,{layout,w});
      const values=await page.evaluate(workspaceGeometry);
      const summary=JSON.stringify({name,layout,...values});
      checkHeaderCover(values,summary);
      assert(values.logoTop>=top+4 && values.logoLeft>=left && values.overflow<=1,summary);
      assert(values.navLeft>=left-1 && values.navRight<=w-right+1 && values.navBottom>=bottom-1,summary);
      if(layout==='wide')assert(values.navTop>=values.headerBottom-1 && values.navRight<=values.contentLeft+1 && values.contentCols===2,summary);
      else assert(values.navTop>h/2 && values.navBottom>=8 && values.navBottom>=bottom+4,summary);
      metrics.push([name,layout,values.navBottom]);
    }
    for (const value of ['reduce','no-preference']) {
      await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value}]});
      const values=await page.evaluate(workspaceGeometry);
      const summary=JSON.stringify({preference:value,...values});
      assert.equal(values.reducedTransparency,value==='reduce',summary);
      checkHeaderCover(values,summary);
    }
  } finally {
    await cdp.send('Emulation.setEmulatedMedia',{features:[]});
    await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{}});
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
    await page.setViewportSize({width:390,height:844});
  }
  console.log('모바일 안전 영역, 두 투명도 설정에서 스크롤 가림, 기기 회전 및 분할 창 '+JSON.stringify(metrics));
}
module.exports={checkMobileShell,checkWorkspaceSizes};
