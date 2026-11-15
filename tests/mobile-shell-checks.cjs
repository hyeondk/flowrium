const assert = require('node:assert/strict');

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
  await page.mouse.move(from.x+from.width/2,from.y+22);await page.mouse.down();
  await page.mouse.move(to.x+to.width/2,to.y+22,{steps:8});await page.mouse.up();
  assert.equal(await approvals.getAttribute('aria-current'),'page');
  await page.emulateMedia({reducedMotion:'reduce'});
  await home.click();
  assert.equal(await page.locator('#content').evaluate(e=>e.getAnimations().length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(process.env.FLOWRIUM_MOBILE_SCREENSHOT){
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:process.env.FLOWRIUM_MOBILE_SCREENSHOT,animations:'disabled'});
  }
  console.log('모바일 하단 바 320/390/768px, 44px 터치 영역, 본문 하단 여백, 끌어 이동, 키보드 탐색, 동작 줄이기 통과');
}
module.exports={checkMobileShell};
