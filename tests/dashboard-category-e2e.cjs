const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');
const {settledLayout}=require('./shell-test-helpers.cjs');

async function verifyCardReorder(page, cards) {
  const selector = '.pf-project-entries [data-project-sort-id]';
  const ids = await cards.locator('button').evaluateAll(rows=>rows.map(row=>row.dataset.projectSortId));
  const [first,second,third,last]=ids;
  const card=id=>cards.locator('[data-project-sort-id="'+id+'"]');
  const currentOrder=expected=>page.waitForFunction(({selector,expected})=>
    [...document.querySelectorAll(selector)].map(row=>row.dataset.projectSortId).join()===expected.join(),{selector,expected});
  const center=async id=>{
    const box=await card(id).boundingBox();
    assert(box);
    return {x:box.x+box.width/2,y:box.y+box.height/2};
  };
  const held=(id)=>card(id).and(page.locator('[data-project-drag="moving"]')).waitFor();
  const settle=()=>settledLayout(cards);
  await settle();
  await card(last).hover();
  const origin=await center(last), target=await center(first);
  assert(origin.y>target.y,'시작과 대상은 서로 다른 행');
  await page.mouse.move(origin.x,origin.y);
  await page.mouse.down();
  await held(last);
  await page.mouse.move(target.x,target.y,{steps:8});
  await page.waitForFunction(({selector,last,first,target})=>{
    const cards=[...document.querySelectorAll(selector)];
    const box=id=>cards.find(e=>e.dataset.projectSortId===id).getBoundingClientRect();
    const source=box(last), neighbor=box(first);
    return Math.hypot(source.x+source.width/2-target.x,source.y+source.height/2-target.y)<14
      && Math.hypot(neighbor.x+neighbor.width/2-target.x,neighbor.y+neighbor.height/2-target.y)>18;
  },{selector,last,first,target});
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await currentOrder(ids);
  await settle();
  const canceled=await center(last);
  assert(Math.hypot(canceled.x-origin.x,canceled.y-origin.y)<1,
    '취소하면 원래 자리로 복귀 '+JSON.stringify({origin,canceled}));
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();await held(last);
  await page.mouse.move(target.x+18,target.y+12,{steps:8});await page.mouse.up();
  assert.equal(await card(last).getAttribute('data-project-drag'),'settling');
  await currentOrder([last,first,second,third]);
  await settle();
  const placed=await center(last);
  assert(Math.hypot(placed.x-target.x,placed.y-target.y)<1,'놓으면 대상의 자리에 맞춰짐');
  assert.equal(await page.locator('.pf-portfolio-dashboard').count(),1,'드래그가 프로젝트 열기로 이어지지 않음');

  const client=await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const from=await center(last),to=await center(third);
    const touch=(type,point)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:point?[point]:[]});
    await touch('touchStart',from);await held(last);
    await touch('touchMove',{x:(from.x+to.x)/2,y:(from.y+to.y)/2});
    await touch('touchMove',to);await touch('touchEnd');
    await currentOrder(ids);
    await settle();
  } finally {
    await client.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await client.detach();
  }
  await card(first).focus();await page.keyboard.press('Alt+ArrowRight');
  await currentOrder([second,first,third,last]);await settle();
  assert(await card(first).evaluate(node=>node===document.activeElement),'키보드로 이동해도 카드 초점을 유지');
  await page.keyboard.press('Alt+ArrowLeft');await currentOrder(ids);await settle();
  console.log('대시보드 카드 / 2차원 포인터 추종 / 이웃 카드 자리 확보 / Escape 복귀 / 마우스·터치 드롭과 키보드 재정렬 통과');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-dashboard-categories-'));
  const profile = path.join(temp,'profile');
  let app;
  try {
    const store = new Store(profile);
    await store.load();
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    for (const name of ['산책 안내서','독서 모임','겨울 지도','계절의 기록']) {
      const folder = path.join(temp, name);
      await fs.mkdir(folder);
      const project = await store.addProject(folder);
      await store.createSession(project.id,{title:name+' 초안'});
    }
    const env = {...process.env, FLOWRIUM_USER_DATA:profile, CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root], env});
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({width:1440,height:900});
    await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus();});
    const cards = page.locator('.pf-project-entries');
    const recent = page.locator('.pf-recent-cards');
    const summary = page.locator('.pf-dashboard-summary');
    await cards.locator('button').nth(3).waitFor();
    const cols = list => list.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(await cols(cards),3);
    assert.equal(await cols(recent),2);
    assert.equal(await cols(summary),3);
    const summaryGeometry = await summary.evaluate(node => ({height:node.getBoundingClientRect().height, rows:[...node.children].map(row => {
      const label=row.querySelector('span').getBoundingClientRect(), value=row.querySelector('strong').getBoundingClientRect();
      return {sameLine:Math.abs(label.top+label.height/2-value.top-value.height/2)<1,numberAtEnd:value.right>label.right};
    })}));
    assert(summaryGeometry.height>=44 && summaryGeometry.height<=50,JSON.stringify(summaryGeometry));
    assert(summaryGeometry.rows.every(row=>row.sameLine && row.numberAtEnd),JSON.stringify(summaryGeometry));
    const recentGeometry = await recent.locator('.pf-row').evaluateAll(nodes=>nodes.map(node=>{
      const style=getComputedStyle(node);
      return {height:node.getBoundingClientRect().height,border:parseFloat(style.borderTopWidth),
        radius:style.borderTopLeftRadius,devicePixel:1/devicePixelRatio};
    }));
    assert(recentGeometry.every(row=>row.height>=46&&row.height<=52&&row.border>=.5&&
      row.border<=Math.max(1,row.devicePixel)+.05&&row.radius==='8px'),JSON.stringify(recentGeometry));
    const geometry = await cards.locator('button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
    assert.deepEqual(geometry.slice(0,3),[geometry[0],geometry[0],geometry[0]]);
    assert(geometry[3]>geometry[2]);
    await verifyCardReorder(page,cards);
    const search = page.getByRole('textbox',{name:'프로젝트 검색',exact:true});
    assert(await search.evaluate(input=>{
      const style=getComputedStyle(input),context=document.createElement('canvas').getContext('2d');
      context.font=style.font;
      return context.measureText(input.placeholder).width<=input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    }),'검색 안내 문구가 전체 표시되어야 합니다.');
    const searchBorders = await search.evaluate(input=>({
      widths:[input,input.parentElement].map(node=>parseFloat(getComputedStyle(node).borderTopWidth)),
      devicePixel:1/devicePixelRatio,
    }));
    const [innerBorder,outerBorder]=searchBorders.widths;
    assert(innerBorder===0&&outerBorder>=.5&&outerBorder<=Math.max(1,searchBorders.devicePixel)+.05,JSON.stringify(searchBorders));
    await search.focus();
    assert.equal(await search.evaluate(n=>getComputedStyle(n).boxShadow),'none');
    assert.notEqual(await search.evaluate(n=>getComputedStyle(n.parentElement).boxShadow),'none');
    await search.fill('산책');assert.equal(await cards.locator('button').count(),1);
    await search.fill('');
    const card = cards.getByRole('button',{name:/산책 안내서/});
    await card.click({button:'right'});
    await page.getByRole('menuitem',{name:'카테고리 관리'}).click();
    const editor = page.getByRole('region',{name:'프로젝트 카테고리 관리'});
    const input = editor.getByRole('combobox',{name:'카테고리 이름',exact:true});
    await input.fill('현장 조사');
    await editor.getByRole('button',{name:'저장',exact:true}).click();
    await editor.getByText('저장했습니다.').waitFor();
    await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
    await card.locator('.pf-category').filter({hasText:'현장 조사'}).waitFor();
    await page.reload();await card.locator('.pf-category').filter({hasText:'현장 조사'}).waitFor();
    const categoryGeometry = await card.evaluate(node=>{
      const category=node.querySelector('.pf-category'), title=node.querySelector('.pf-project-name');
      return {front:category.getBoundingClientRect().bottom<=title.getBoundingClientRect().top,font:parseFloat(getComputedStyle(category).fontSize),weight:Number(getComputedStyle(category).fontWeight),wrap:getComputedStyle(category).wordBreak};
    });
    assert(categoryGeometry.front && categoryGeometry.font>=12 && categoryGeometry.font<=13 && categoryGeometry.weight>=700 && categoryGeometry.wrap==='keep-all',JSON.stringify(categoryGeometry));
    await page.setViewportSize({width:1024,height:900});
    assert.equal(await cols(summary),3);
    assert(await summary.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
    await page.setViewportSize({width:1440,height:900});
    if (process.env.FLOWRIUM_DASHBOARD_SCREENSHOT) {
      await page.evaluate(() => document.fonts.ready);
      await summary.evaluate(node => node.closest('.pf-page').scrollTo({top:0,behavior:'instant'}));
      await page.mouse.move(0,0);
      await page.waitForTimeout(260);
      const shot = await app.evaluate(async ({BrowserWindow}) =>
        (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await fs.writeFile(process.env.FLOWRIUM_DASHBOARD_SCREENSHOT, Buffer.from(shot, 'base64'));
    }
    await card.click();
    await page.getByRole('button',{name:'프로젝트 메뉴',exact:true}).click();
    await page.getByRole('navigation',{name:'프로젝트 상세 탭'}).getByRole('button',{name:'프로젝트 설정'}).click();
    await page.getByRole('button',{name:/현장 조사 \/ 카테고리 관리/}).click();
    assert.equal(await input.inputValue(),'현장 조사');
    await input.fill('');
    const categoryOptions=editor.getByRole('listbox',{name:'카테고리 이름',exact:true});
    await categoryOptions.waitFor();
    await input.press('Escape');assert.equal(await categoryOptions.count(),0);assert(await input.evaluate(node=>node===document.activeElement));
    await input.press('ArrowDown');await categoryOptions.waitFor();
    await input.press('Tab');assert.equal(await categoryOptions.count(),0);
    await input.focus();await input.press('ArrowDown');await categoryOptions.waitFor();
    await editor.evaluate(node=>{
      window.__categorySaveEvents=[];
      for(const type of ['pointerdown','mousedown','mouseup','click','submit','focusout'])document.addEventListener(type,event=>{
        if(window.__categorySaveEvents.length>=20)return;
        const save=node.querySelector('button[type=submit],button.primary'),rect=save.getBoundingClientRect();
        window.__categorySaveEvents.push({type,target:event.target.tagName,text:event.target.textContent.slice(0,24),saveTop:rect.top,saveBottom:rect.bottom,y:event.clientY});
      },true);
    });
    await editor.getByRole('button',{name:'저장',exact:true}).click();
    await editor.getByText('저장했습니다.').waitFor().catch(async error=>{
      const status=await editor.locator('[role=status]').allTextContents();
      const events=await page.evaluate(()=>window.__categorySaveEvents);
      throw new Error('카테고리를 비워 저장한 뒤 응답: '+JSON.stringify({status,events}),{cause:error});
    });
    const saveEvents=await page.evaluate(()=>window.__categorySaveEvents);
    assert.equal(saveEvents.filter(event=>event.type==='submit').length,1,'바깥 저장 버튼 한 번 클릭으로 한 번 제출');
    assert(saveEvents.filter(event=>['pointerdown','mouseup','click'].includes(event.type)).every(event=>event.target==='BUTTON'&&event.text==='저장'),JSON.stringify(saveEvents));
    await page.getByRole('button',{name:'설정 닫기',exact:true}).click();
    await page.getByRole('button',{name:/미분류 \/ 카테고리 관리/}).waitFor();
    console.log('대시보드 실제 앱 확인 / 한 줄 요약 '+summaryGeometry.height+'px / 프로젝트 3열 / 최근 업무 2열 테두리 '+recentGeometry[0].height+'px / 검색 외곽선과 초점 및 필터 / 앞쪽 카테고리 배지 / 좁은 화면 넘침 없음 / 우클릭 분류 저장 / 재실행 보존 / 프로젝트 설정에서 미분류 복귀 통과');
  } finally {
    await app?.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:3});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
