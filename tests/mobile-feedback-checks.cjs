const assert = require('node:assert/strict');

async function confirmAction(page, name) {
  const dialog = page.getByRole('alertdialog');
  await page.getByRole('button',{name,exact:true}).click();
  await dialog.waitFor();
  await dialog.getByRole('button',{name,exact:true}).click();
  await dialog.waitFor({state:'hidden'});
}

async function verifyStopSheet(page, isStopped) {
  const trigger = page.getByRole('button',{name:'작업 중단',exact:true});
  const dialog = page.getByRole('alertdialog');
  const cancel = dialog.getByRole('button',{name:'취소',exact:true});
  const originalWidth = page.viewportSize().width;
  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    await trigger.click();
    await dialog.waitFor();
    assert(await cancel.evaluate(button=>document.activeElement===button),'기본 초점은 취소');
    await dialog.evaluate(async el=>{
      await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));
    });
    const metrics = await dialog.evaluate(el=>{
      const r=el.getBoundingClientRect();
      const button=el.querySelector('button');
      return {gap:innerHeight-r.bottom,top:r.top,center:r.left+r.width/2,viewport:innerWidth,
        overflow:el.scrollWidth-el.clientWidth, height:button?.getBoundingClientRect().height};
    });
    assert(metrics.top > 0 && metrics.gap >= -1 && metrics.gap <= 24,'확인 창은 화면 하단에 정착 '+JSON.stringify(metrics));
    assert(Math.abs(metrics.center-metrics.viewport/2)<=2 && metrics.overflow<=1);
    assert(metrics.height>=44,'터치 영역 높이 '+metrics.height);
    assert(!isStopped(),'확인 전에는 중단 요청을 보내지 않음');
    if(width===390) await page.keyboard.press('Escape');
    else if(width===768) await page.mouse.click(8,8);
    else await cancel.click();
    await dialog.waitFor({state:'hidden'});
    assert(!isStopped(),'취소 뒤에도 작업 유지');
    await page.waitForFunction(()=>document.activeElement?.textContent==='작업 중단');
  }
  await page.setViewportSize({width:originalWidth,height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await confirmAction(page,'작업 중단');
  await page.emulateMedia({reducedMotion:'no-preference'});
}

async function observeToast(page) {
  await page.evaluate(()=>{
    const notice=document.getElementById('notice');
    window.fixtureToastFrames={};
    notice.addEventListener('animationstart',event=>{
      if(event.target!==notice)return;
      const phase=notice.dataset.phase;
      const animation=notice.getAnimations().find(a=>a.animationName===event.animationName);
      if(!animation)return;
      const frames=animation.effect.getKeyframes();
      window.fixtureToastFrames[phase]={
        opacity:frames.map(f=>f.opacity),
        positions:frames.map(f=>JSON.stringify([f.transform,f.translate,f.top,f.bottom])),
        duration:animation.effect.getTiming().duration,
      };
    });
  });
}

async function verifyToast(page, message, leave) {
  const notice=page.locator('#notice');
  await notice.filter({hasText:message}).waitFor();
  assert.equal(await notice.getAttribute('role'),'status');
  assert.equal(await page.getByRole('alertdialog').count(),0);
  await page.waitForFunction(()=>Boolean(window.fixtureToastFrames.enter));
  await leave();
  await page.waitForFunction(()=>Boolean(window.fixtureToastFrames.exit));
  await notice.waitFor({state:'hidden'});
  const phases=await page.evaluate(()=>window.fixtureToastFrames);
  for(const [name,phase] of Object.entries(phases)){
    assert.equal(new Set(phase.positions).size,1,'토스트는 제자리에서 표시 / '+name);
    assert(Math.abs(Number(phase.opacity[0])-Number(phase.opacity.at(-1)))===1);
    assert(phase.duration>=200 && phase.duration<=400);
  }
}

module.exports={confirmAction,verifyStopSheet,observeToast,verifyToast};
