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
  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    const rects = await nav.evaluate(el => {
      const bounds=el.getBoundingClientRect();
      return {inset:bounds.left,bottom:innerHeight-bounds.bottom,overflow:document.documentElement.scrollWidth-innerWidth,
        padding:parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),
        height:bounds.height,buttons:[...el.querySelectorAll('button')].map(button=>[button.offsetWidth,button.offsetHeight])};
    });
    assert(rects.inset>=9 && rects.bottom>=8 && rects.overflow===0);
    assert(rects.padding>rects.height+rects.bottom);
    assert(rects.buttons.every(([w,h])=>w>=44 && h>=44));
  }
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
  await page.mouse.move(to.x+to.width/2,to.y+22,{steps:8});await page.mouse.up();
  assert.equal(await approvals.getAttribute('aria-current'),'page');
  await checkTouchAndWheel(page,nav);
  await page.emulateMedia({reducedMotion:'reduce'});
  await home.click();
  assert.equal(await page.locator('#content').evaluate(e=>e.getAnimations().length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(process.env.FLOWRIUM_MOBILE_SCREENSHOT){
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:process.env.FLOWRIUM_MOBILE_SCREENSHOT,animations:'disabled'});
  }
  console.log('모바일 하단 바 320/390/768px, 44px 터치 영역, 선택 표시 연속 추적, 양 끝에서 단일 선택, 세로 및 취소 동작, 가로 휠 관성, 확대 글자에서 실제 스크롤, 키보드 탐색 및 동작 줄이기 통과');
}
module.exports={checkMobileShell};
