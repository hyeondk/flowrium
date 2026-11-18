const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { Store } = require('../electron/store.cjs');

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
    const recentGeometry = await recent.locator('.pf-row').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,border:getComputedStyle(node).borderTopWidth,radius:getComputedStyle(node).borderTopLeftRadius})));
    assert(recentGeometry.every(row=>row.height>=46 && row.height<=52 && parseFloat(row.border)>=.5 && parseFloat(row.border)<=1.1 && row.radius==='8px'),JSON.stringify(recentGeometry));
    const geometry = await cards.locator('button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
    assert.deepEqual(geometry.slice(0,3),[geometry[0],geometry[0],geometry[0]]);
    assert(geometry[3]>geometry[2]);
    const search = page.getByRole('textbox',{name:'프로젝트 검색',exact:true});
    assert(await search.evaluate(input=>{
      const style=getComputedStyle(input),context=document.createElement('canvas').getContext('2d');
      context.font=style.font;
      return context.measureText(input.placeholder).width<=input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    }),'검색 안내 문구가 전체 표시되어야 합니다.');
    const searchBorders = await search.evaluate(n=>[n,n.parentElement].map(el=>parseFloat(getComputedStyle(el).borderTopWidth)));
    assert(searchBorders[0]===0 && searchBorders[1]>=.5 && searchBorders[1]<=1.1,JSON.stringify(searchBorders));
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
