const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron} = require('playwright');
const {Store} = require('../electron/store.cjs');
const {settledLayout} = require('./shell-test-helpers.cjs');

async function checkCalendar() {
  const root = path.resolve(__dirname,'..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-project-calendar-'));
  const profile = path.join(temp,'profile');
  let app;
  try {
    const store = new Store(profile);
    await store.load();
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
    const env = {...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    app = await _electron.launch({args:[root],env,timeout:45000});
    const page = await app.firstWindow();
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('heading',{name:'프로젝트 대시보드',exact:true}).waitFor();
    await page.locator('.pf-heading').getByRole('button',{name:'새 프로젝트',exact:true}).click();
    const start = page.getByLabel('시작일',{exact:true}), deadline = page.getByLabel('목표일',{exact:true});
    const panel = page.getByRole('dialog',{name:'날짜 선택',exact:true});
    const date = key=>panel.getByRole('button',{name:key,exact:true});
    const size = ()=>panel.evaluate(calendar=>({width:calendar.offsetWidth,height:calendar.offsetHeight}));
    const title = text=>panel.getByRole('button',{name:new RegExp('^'+text+' / 연도와 달 선택$')});
    async function geometry(field) {
      await settledLayout(panel);
      const input = await field.elementHandle();
      return panel.evaluate((calendar,field)=>{
        const box=calendar.getBoundingClientRect();
        const input=field.getBoundingClientRect();
        const screenWidth=document.documentElement.clientWidth, screenHeight=document.documentElement.clientHeight;
        return {side:calendar.dataset.placement,
          gap:calendar.dataset.placement==='up'?input.y-box.bottom:box.top-input.y-input.height,
          left:box.left,right:box.right,top:box.top,bottom:box.bottom,screenWidth,screenHeight,
          outline:getComputedStyle(document.activeElement).outlineStyle};
      },input);
    }

    await start.fill('2026-11-16');
    await deadline.fill('2026-11-18');
    await deadline.click();
    const november = await geometry(deadline);
    assert(november.gap>=4 && november.gap<=8 && november.right<=november.screenWidth-5,JSON.stringify(november));
    assert.equal(november.outline,'none');
    assert.equal(await date('2026-11-15').isDisabled(),true);
    const fixedSize = await size();
    assert.equal(await panel.locator('.flow-date-days>*').count(),42);
    await title('2026년 11월').click();
    const year = panel.getByLabel('이동할 연도',{exact:true});
    await year.fill('2028');
    await panel.getByRole('button',{name:'2월로 이동',exact:true}).click();
    await title('2028년 2월').waitFor();
    assert.equal(await date('2028-02-29').isEnabled(),true);
    assert.equal(await panel.locator('.flow-date-days>*').count(),42);
    assert.deepEqual(await size(),fixedSize,'월의 날짜 개수가 달라도 달력 외곽 크기가 같습니다.');
    await title('2028년 2월').click();
    assert.deepEqual(await size(),fixedSize,'연도·월 선택 화면도 같은 크기입니다.');
    await year.fill('2026');
    assert.equal(await panel.getByRole('button',{name:'10월로 이동',exact:true}).isDisabled(),true);
    await panel.getByRole('button',{name:'11월로 이동',exact:true}).click();
    await date('2026-11-20').click();
    await panel.waitFor({state:'detached'});
    assert.equal(await deadline.inputValue(),'2026-11-20');
    assert(await deadline.evaluate(el=>el===document.activeElement));

    await deadline.press('Alt+ArrowDown');
    await panel.waitFor();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'detached'});
    assert.equal(await deadline.inputValue(),'2026-11-20','취소는 선택을 반영하지 않습니다.');
    await deadline.press('Alt+ArrowDown');
    await panel.waitFor();
    await start.click();
    assert.equal(await date('2026-11-21').isDisabled(),true,'다른 필드 클릭으로 바뀐 최대 날짜가 반영됩니다.');
    await page.getByLabel('프로젝트 이름',{exact:true}).click();
    await panel.waitFor({state:'detached'});
    assert(await page.getByLabel('프로젝트 이름',{exact:true}).evaluate(el=>el===document.activeElement));

    for(const width of [390,320]) {
      await page.setViewportSize({width,height:744});
      await page.evaluate(()=>{
        document.querySelector('#calendar-low-fixture')?.remove();
        const input=document.createElement('input');
        input.id='calendar-low-fixture';input.type='date';input.value='2026-11-19';
        input.setAttribute('aria-label','아래쪽 날짜');
        Object.assign(input.style,{position:'fixed',bottom:'16px',left:'18px',width:'170px',zIndex:'90',zoom:'1'});
        document.body.append(input);
      });
      const low = page.getByLabel('아래쪽 날짜',{exact:true});
      await low.click();
      const narrow = await geometry(low);
      assert(narrow.side==='up' && narrow.gap>=4 && narrow.gap<=8 && narrow.top>=5 && narrow.left>=5 && narrow.right<=narrow.screenWidth-5,JSON.stringify(narrow));
      const frames = await panel.evaluate(calendar=>new Promise(resolve=>{
        const animation=calendar.getAnimations().find(item=>item.animationName==='flow-calendar-open');
        if(!animation)return resolve([]);
        animation.pause();
        animation.currentTime=0;
        const first=calendar.getBoundingClientRect().y;
        animation.currentTime=180;
        const last=calendar.getBoundingClientRect().y;
        animation.finish();
        resolve([first,last]);
      }));
      assert(frames.length===2 && frames[0]-frames[1]>=5,JSON.stringify(frames));
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'detached'});
    }
    await page.setViewportSize({width:800,height:760});
    for(const [edge,expected] of [['top','-6px'],['bottom','6px']]) {
      await page.evaluate(edge=>{
        document.querySelector('#calendar-low-fixture')?.remove();
        document.querySelector('#native-select-fixture')?.remove();
        const select=document.createElement('select');
        select.id='native-select-fixture';
        for(let i=0;i<8;i++)select.add(new Option('시험 항목 '+i));
        Object.assign(select.style,{position:'fixed',[edge]:'16px',left:'190px',width:'170px',zIndex:'1500'});
        document.querySelector('.app-shell').append(select);
      },edge);
      const select = page.locator('#native-select-fixture');
      await select.click();
      await page.waitForFunction(()=>document.querySelector('#native-select-fixture')?.matches(':open'));
      const option = await select.evaluate(el=>({travel:getComputedStyle(el.options[0]).getPropertyValue('--option-travel').trim(),
        menuTop:el.options[0].getBoundingClientRect().top,triggerTop:el.getBoundingClientRect().top}));
      assert.equal(option.travel,expected,JSON.stringify({edge,...option}));
      assert.equal(option.menuTop<option.triggerTop,edge==='bottom',JSON.stringify(option));
      await page.keyboard.press('Escape');
    }
    console.log('프로젝트 달력 / 클릭한 필드 옆 / 42칸 고정 / 연도·월 이동 / 유효 범위 / 선택·취소·초점 / 390·320픽셀에서 아래에서 위로 열림 / 일반 선택 목록의 위·아래 방향');
  } finally {
    if(app)await app.close();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:150});
  }
}

checkCalendar().catch(error=>{console.error(error);process.exitCode=1;});
