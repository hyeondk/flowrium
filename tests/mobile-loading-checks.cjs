const assert = require('node:assert/strict');

// Hold a real response until the screen has been inspected. The request and
// production response still pass through the normal authenticated server.
async function holdResponse(page, pattern) {
  const release = Promise.withResolvers();
  const handler = async route => {
    await release.promise;
    await route.continue();
  };
  await page.route(pattern, handler, {times:1});
  return {started:page.waitForRequest(pattern), finish:() => release.resolve()};
}

async function verifyDashboardLoading(page, url) {
  const state = await holdResponse(page, '**/api/mobile/state');
  const facts = await holdResponse(page, '**/api/mobile/dashboard');
  try {
    await page.goto(url, {waitUntil:'domcontentloaded'});
    await state.started;
    const full = page.locator('main[aria-busy="true"] .mobile-skeleton[data-layout="dashboard"]');
    await full.waitFor();
    assert.equal(await full.getAttribute('role'),'status');
    assert.match(await full.getAttribute('aria-label'), /불러오는 중/);
    assert(await full.locator('[aria-hidden="true"]').count() > 0);
    assert.equal(await full.locator('button, input, a[href], [tabindex="0"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'다시 확인'}).count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await full.evaluate(el=>el.getAnimations({subtree:true})
      .some(a=>a.playState==='running' && a.effect.getTiming().iterations===Infinity)),false);
    await page.emulateMedia({reducedMotion:'no-preference'});
    state.finish();
    await facts.started;
    await page.getByRole('heading',{name:'대시보드',exact:true}).waitFor();
    await page.locator('.mobile-today .mobile-skeleton[data-layout="rows"]').waitFor();
    assert.equal(await full.count(),0);
  } finally {
    state.finish(); facts.finish();
  }
  await page.locator('.mobile-today').getByText('모바일 검토 마무리',{exact:true}).waitFor();
  assert.equal(await page.locator('main[aria-busy="true"], main .mobile-skeleton').count(),0);
}

async function verifyChatLoading(page, open, id) {
  const pending = await holdResponse(page, '**/api/mobile/sessions/'+id+'*');
  try {
    await open();
    await pending.started;
    const skeleton=page.locator('.mobile-skeleton[data-layout="chat"]');
    await skeleton.waitFor();
    assert.match(await skeleton.getAttribute('aria-label'),/불러오는 중/);
    assert.equal(await page.locator('.message').count(),0);
  } finally { pending.finish(); }
  await page.locator('.message').first().waitFor();
  assert.equal(await page.locator('.mobile-skeleton[data-layout="chat"]').count(),0);
}


async function verifyRefreshingChat(page, id, update, anchor) {
  const initialTop=await anchor.evaluate(el=>el.getBoundingClientRect().top);
  const pending=await holdResponse(page, '**/api/mobile/sessions/'+id+'*');
  try {
    update();
    await pending.started;
    assert.equal(await page.locator('.mobile-skeleton[data-layout="chat"]').count(),0);
    await anchor.waitFor({state:'visible'});
    const heldTop=await anchor.evaluate(el=>el.getBoundingClientRect().top);
    assert(Math.abs(initialTop-heldTop)<=1,'갱신 대기 동안 읽던 본문 위치 유지');
  } finally { pending.finish(); }
}

module.exports={verifyDashboardLoading, verifyChatLoading, verifyRefreshingChat};
