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

async function holdJson(page, pathname) {
  await page.evaluate(pathname=>{
    const state=Promise.withResolvers();
    window.loadingFixture={pathname,...state};
  },pathname);
  return () => page.evaluate(()=>{
    window.loadingFixture?.resolve();
    delete window.loadingFixture;
  });
}

async function verifySizes(page, skeleton, layout) {
  const previous=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  try {
    for (const viewport of [{width:320,height:700},{width:390,height:844},{width:1024,height:834}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(({width,height})=>{
        for (const [name,value] of Object.entries({width,height}))
          Object.defineProperty(screen,name,{configurable:true,value});
        window.dispatchEvent(new Event('resize'));
      },viewport);
      const dimensions=await skeleton.evaluate(region=>{
        const body=region.getBoundingClientRect();
        const boxes=[...region.querySelectorAll('.mobile-loading-card,.mobile-loading-bubble,.mobile-loading-progress')].map(row=>row.getBoundingClientRect());
        const columns=region.querySelector('.mobile-loading-columns');
        return {width:innerWidth,left:body.left,right:body.right,shapes:boxes.length,
          overflow:boxes.some(row=>row.left<body.left-1||row.right>body.right+1),
          columns:columns?getComputedStyle(columns).gridTemplateColumns.split(' ').length:undefined};
      });
      assert(dimensions.shapes>=2 && dimensions.left>=0 && dimensions.right<=dimensions.width && !dimensions.overflow, JSON.stringify({layout,viewport,dimensions}));
      if(layout==='dashboard')assert.equal(dimensions.columns,viewport.width>=1000?2:1);
    }
  } finally {
    await page.setViewportSize(previous);
    await page.evaluate(()=>{
      delete screen.width;
      delete screen.height;
      window.dispatchEvent(new Event('resize'));
    });
  }
}

async function verifyDashboardLoading(page, url) {
  await page.addInitScript(()=>{
    const fetchResponse=window.fetch.bind(window);
    window.fetch=async (...args)=>{
      const response=await fetchResponse(...args);
      const fixture=window.loadingFixture;
      if(fixture && new URL(response.url).pathname===fixture.pathname){
        const parse=response.json.bind(response);
        response.json=async()=>{await fixture.promise;return parse();};
      }
      return response;
    };
  });
  const state = await holdResponse(page, '**/api/mobile/state');
  const facts = await holdResponse(page, '**/api/mobile/dashboard');
  let finishBody;
  try {
    await page.goto(url, {waitUntil:'domcontentloaded'});
    await state.started;
    const full = page.locator('main[aria-busy="true"] .mobile-skeleton[data-layout="dashboard"]');
    await full.waitFor();
    const progress=full.getByRole('progressbar');
    assert.equal(await progress.getAttribute('aria-valuemin'),'0');
    assert.equal(await progress.getAttribute('aria-valuenow'),'0');
    assert.equal(await progress.getAttribute('aria-valuemax'),'2');
    await verifySizes(page,full,'dashboard');
    assert.equal(await full.getAttribute('role'),'status');
    assert.match(await full.getAttribute('aria-label'), /불러오는 중/);
    assert(await full.locator('[aria-hidden="true"]').count() > 0);
    assert.equal(await full.locator('button, input, a[href], [tabindex="0"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'다시 확인'}).count(),0);
    await page.locator('#home').focus();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await full.evaluate(el=>el.getAnimations({subtree:true})
      .some(a=>a.playState==='running' && a.effect.getTiming().iterations===Infinity)),false);
    assert.equal(await full.locator('.mobile-loading-spinner').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    finishBody=await holdJson(page,'/api/mobile/state');
    state.finish();
    await full.locator('[aria-valuenow="1"][aria-valuemax="2"]').waitFor();
    assert.match(await progress.getAttribute('aria-valuetext'),/1단계 완료/);
    assert.equal(await progress.evaluate(el=>el.style.getPropertyValue('--mobile-loading-ratio')),'0.5');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'home');
    await finishBody();
    finishBody=undefined;
    await facts.started;
    await page.getByRole('heading',{name:'대시보드',exact:true}).waitFor();
    await page.locator('.mobile-today .mobile-skeleton[data-layout="rows"]').waitFor();
    assert.equal(await full.count(),0);
  } finally {
    state.finish(); facts.finish();
    await finishBody?.();
  }
  await page.locator('.mobile-today').getByText('모바일 검토 마무리',{exact:true}).waitFor();
  assert.equal(await page.locator('main[aria-busy="true"], main .mobile-skeleton').count(),0);
}

async function verifyChatLoading(page, open, id) {
  const pending = await holdResponse(page, '**/api/mobile/sessions/'+id+'*');
  let finishBody;
  try {
    await open();
    await pending.started;
    const skeleton=page.locator('.mobile-skeleton[data-layout="chat"]');
    await skeleton.waitFor();
    assert.match(await skeleton.getAttribute('aria-label'),/불러오는 중/);
    assert.equal(await page.locator('.message').count(),0);
    assert.equal(await skeleton.getByRole('progressbar').getAttribute('aria-valuenow'),'0');
    await verifySizes(page,skeleton,'chat');
    await page.locator('.mobile-chat-back').focus();
    await page.evaluate(()=>{window.loadingFixtureFocus=document.activeElement;});
    finishBody=await holdJson(page,'/api/mobile/sessions/'+id);
    pending.finish();
    await skeleton.locator('[aria-valuenow="1"][aria-valuemax="2"]').waitFor();
    assert.equal(await page.evaluate(()=>{
      const held=window.loadingFixtureFocus===document.activeElement;
      delete window.loadingFixtureFocus;
      return held;
    }),true,'진행 단계만 바뀔 때 뒤로 가기 포커스를 유지');
  } finally { pending.finish();await finishBody?.(); }
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

async function verifyProjectLoading(page, open, method, layout) {
  const release=Promise.withResolvers();
  const pattern='**/api/mobile/call';
  let inFlight;
  const handler=request=>{
    if(inFlight||request.request().postDataJSON()?.method!==method)return request.fallback();
    inFlight=release.promise.then(()=>request.continue());
    return inFlight;
  };
  await page.route(pattern,handler);
  const wait=page.waitForRequest(request=>request.url().endsWith('/api/mobile/call') && request.postDataJSON()?.method===method);
  const skeleton=page.locator('.mobile-skeleton[data-layout="'+layout+'"]');
  try {
    await open();
    await wait;
    await skeleton.waitFor();
    assert.equal(await skeleton.getByRole('progressbar').getAttribute('aria-valuenow'),'0');
    await verifySizes(page,skeleton,layout);
  }finally{
    release.resolve();
    await inFlight;
    await page.unroute(pattern,handler);
  }
  await skeleton.waitFor({state:'detached'});
}

module.exports={verifyDashboardLoading, verifyChatLoading, verifyRefreshingChat, verifyProjectLoading};
