const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');

async function run() {
  const root = path.resolve(__dirname, '..');
  const tempRoot = path.join(root, '.flowrium-tmp');
  await fs.mkdir(tempRoot, { recursive: true });
  const temp = await fs.mkdtemp(path.join(tempRoot, 'ui-motion-'));
  const route = '/' + path.relative(root, temp).split(path.sep).join('/');
  let app, server, page;
  const errors = [], requests = [];
  try {
    await fs.writeFile(path.join(temp, 'index.html'), '<!doctype html><html lang="ko"><meta charset="UTF-8"><div id="root"></div><script type="module" src="' + route + '/fixture.tsx"></script></html>');
    await fs.writeFile(path.join(temp, 'fixture.tsx'), `
      import React, {useState, useRef, useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {MotionOverlay, Snackbar, Toast, AnimatedCheckbox} from '/src/ui-motion.tsx';
      import CommandCenter from '/src/CommandCenter.tsx';
      import {AssistantShortcut} from '/src/ProjectMemory.tsx';
      import '/src/styles.css'; import '/src/ui-motion.css';
      window.flowrium = {portfolioAction: async()=>({shortcuts:{search:'mod+k'}}),assistantHome:async()=>({connected:false})};
      function Fixture(){
        const [popup,setPopup]=useState(false),[sheet,setSheet]=useState(false),[toast,setToast]=useState(''),[snack,setSnack]=useState(''),[checked,setChecked]=useState(false);
        const check=useRef(null);
        useEffect(()=>{window.motion={setPopup,setSheet,setToast,setSnack,check:()=>check.current};},[]);
        return <main style={{padding:24,width:'min(620px,100%)',display:'grid',gap:12}}>
          <div className="ui-title-stagger"><h1>제목 순차 등장</h1><p>설명은 한 줄씩 자연스럽게 표시합니다.</p></div>
          <div className="pf-goals"><label><span>완료 상태</span><AnimatedCheckbox ref={check} aria-label="완료 상태" checked={checked} onChange={e=>setChecked(e.target.checked)}/></label></div>
          <label>일반 입력<input aria-label="일반 입력" defaultValue="일정한 행 높이"/></label>
          <button className="button" onClick={()=>setPopup(true)}>팝업 열기</button>
          <button className="button" onClick={()=>setSheet(true)}>하단 시트 열기</button>
          <button onClick={()=>setToast('저장했습니다.')}>토스트 표시</button>
          <button onClick={()=>setSnack('실행을 취소했습니다.')}>스낵바 표시</button>
          <div data-motion="loading" aria-label="로딩" style={{width:20,height:20}}>◌</div>
          <CommandCenter projects={[]} sessions={[]} onProject={()=>{}} onSession={()=>{}} onView={()=>{}} onNew={()=>{}}/>
          <AssistantShortcut projects={[]} onOpen={()=>{}}/>
          <MotionOverlay open={popup} onClose={()=>setPopup(false)} label="검증 팝업"><h2>검증 팝업</h2><button>첫 버튼</button><button>끝 버튼</button></MotionOverlay>
          <MotionOverlay open={sheet} onClose={()=>setSheet(false)} label="검증 시트" kind="sheet"><h2>검증 시트</h2><button onClick={()=>setSheet(false)}>시트 닫기</button></MotionOverlay>
          <Toast message={toast} onClose={()=>setToast('')}/><Snackbar message={snack} onClose={()=>setSnack('')}/>
        </main>
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `);
    const { createServer } = await import('vite');
    server = await createServer({ configFile: false, root, cacheDir:path.join(temp,'vite-cache'), server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    const entry = path.join(temp, 'browser.cjs');
    await fs.writeFile(entry, 'const {BrowserWindow,app}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({width:1000,height:950,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.loadURL("about:blank");});');
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args:[entry, '--user-data-dir='+path.join(temp,'profile')], env });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error=>errors.push(error.message));
    page.on('console', message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('request', request=>requests.push(request.url()));
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+route+'/index.html');
    await page.waitForFunction(()=>Boolean(window.motion));
    const fonts = await page.evaluate(async()=>{
      const rows = await Promise.all([300,400,700,800].map(weight=>document.fonts.load(weight+' 14px NanumSquareRound','한글')));
      return {counts:rows.map(row=>row.length),family:getComputedStyle(document.body).fontFamily};
    });
    assert.deepEqual(fonts.counts,[1,1,1,1]); assert.match(fonts.family,/NanumSquareRound/);
    assert.equal(requests.some(url=>/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:')),false,'외부 글꼴 요청 없이 실행');
    assert.equal(await page.getByRole('textbox',{name:'일반 입력'}).evaluate(e=>e.getBoundingClientRect().height),40);
    assert.equal(await page.getByRole('button',{name:'팝업 열기'}).evaluate(e=>e.getBoundingClientRect().height),40);
    assert.equal(await page.locator('.ui-title-stagger p').evaluate(e=>getComputedStyle(e).animationDelay),'0.06s');
    const loading = await page.locator('[data-motion=loading]').evaluate(e=>({timing:getComputedStyle(e).animationTimingFunction,count:getComputedStyle(e).animationIterationCount,duration:getComputedStyle(e).animationDuration}));
    assert.deepEqual(loading,{timing:'linear',count:'infinite',duration:'0.4s'});
    const checkbox=page.getByRole('checkbox',{name:'완료 상태'});
    assert.equal(await checkbox.evaluate(e=>window.motion.check()===e),true,'원래 입력 참조 보존');
    await page.getByText('완료 상태',{exact:true}).click();assert.equal(await checkbox.isChecked(),true,'기존 라벨 클릭 보존');assert.equal(await checkbox.evaluate(e=>e.parentElement.getBoundingClientRect().width),20,'기존 넓은 span 선택자와 체크박스 크기 충돌 없음');
    await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('.ui-checkbox-control path')).strokeDashoffset)===0);
    await checkbox.focus(); await page.keyboard.press('Space'); assert.equal(await checkbox.isChecked(),false);
    await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('.ui-checkbox-control path')).strokeDashoffset)===1);
    const draw=await page.evaluate(()=>{const input=document.querySelector('.ui-checkbox-control input');input.click();const path=input.nextElementSibling.querySelector('path');const style=getComputedStyle(path);return {duration:style.transitionDuration,ease:style.transitionTimingFunction};});
    assert.equal(draw.duration,'0.24s'); assert.equal(draw.ease,'cubic-bezier(0.4, 0, 0.2, 1)');
    await page.waitForTimeout(70);const midway=await checkbox.evaluate(e=>parseFloat(getComputedStyle(e.nextElementSibling.querySelector('path')).strokeDashoffset));assert.ok(midway>0&&midway<1,'체크 선이 실제로 그려지는 중간 프레임');
    await page.getByRole('button',{name:'팝업 열기'}).click();
    const popup=page.locator('.motion-surface[aria-label="검증 팝업"]'); await popup.waitFor();
    const popupMotion=await popup.evaluate(e=>{const a=e.getAnimations()[0];return {name:getComputedStyle(e).animationName,duration:a.effect.getTiming().duration,ease:getComputedStyle(e).animationTimingFunction,frames:a.effect.getKeyframes().map(k=>k.transform)};});
    assert.equal(popupMotion.name,'ui-popup-in');assert.equal(popupMotion.duration,240);assert.equal(popupMotion.ease,'cubic-bezier(0.16, 1, 0.3, 1)');assert.deepEqual(popupMotion.frames,['scale(0.9)','scale(1)']);
    await page.getByRole('button',{name:'끝 버튼',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'첫 버튼',exact:true}).evaluate(e=>e===document.activeElement),true);
    await page.keyboard.press('Escape');
    const exit=await page.locator('.motion-overlay').evaluate(e=>({phase:e.dataset.phase,ease:getComputedStyle(e).animationTimingFunction}));
    assert.equal(exit.phase,'exit');assert.equal(exit.ease,'cubic-bezier(0.7, 0, 0.84, 0)');
    await page.waitForTimeout(80);assert.equal(await popup.count(),1,'닫힘 도중 유지');await popup.waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'팝업 열기'}).evaluate(e=>e===document.activeElement),true,'닫힌 뒤 시작 버튼으로 초점 복구');
    await page.evaluate(()=>window.motion.setPopup(true));await popup.waitFor();await page.evaluate(()=>window.motion.setPopup(false));await page.waitForTimeout(90);await page.evaluate(()=>window.motion.setPopup(true));await page.waitForTimeout(280);assert.equal(await popup.count(),1,'닫히던 팝업을 다시 열면 이전 종료 취소');await page.evaluate(()=>window.motion.setPopup(false));await popup.waitFor({state:'detached'});
    for(const [kind,label] of [['toast','토스트 표시'],['snackbar','스낵바 표시']]){
      await page.getByRole('button',{name:label}).click();const surface=page.locator('[data-motion='+kind+']');await surface.waitFor();
      assert.equal(await surface.evaluate(e=>getComputedStyle(e).animationName),kind==='toast'?'ui-fade-in':'ui-snackbar-in');
      await page.evaluate(kind=>window.motion[kind==='toast'?'setToast':'setSnack'](''),kind);
      assert.equal(await surface.evaluate(e=>getComputedStyle(e).animationName),kind==='toast'?'ui-fade-out':'ui-snackbar-out');await surface.waitFor({state:'detached'});
    }
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'하단 시트 열기'}).click();const sheet=page.locator('.motion-surface[aria-label="검증 시트"]');await sheet.waitFor();
    assert.equal(await sheet.evaluate(e=>getComputedStyle(e).animationName),'ui-sheet-in');
    assert.equal(await page.locator('.motion-overlay').evaluate(e=>getComputedStyle(e).animationName),'ui-fade-in');
    await page.getByRole('button',{name:'시트 닫기'}).click();assert.equal(await sheet.evaluate(e=>getComputedStyle(e).animationName),'ui-sheet-out');await sheet.waitFor({state:'detached'});
    await page.setViewportSize({width:1000,height:950});await page.getByRole('button',{name:'프로젝트와 화면 찾기'}).click();const command=page.locator('.command-scrim [role=dialog]');await command.waitFor();await page.getByRole('textbox',{name:'전체 검색어'}).fill('검증');await page.keyboard.press('Escape');assert.equal(await page.locator('.command-scrim').getAttribute('data-phase'),'exit');await command.waitFor({state:'detached'});
    await page.getByRole('button',{name:'개인 비서',exact:true}).click();const assistant=page.locator('dialog[aria-label="개인 비서 연결"]');await assistant.waitFor();assert.equal(await assistant.evaluate(e=>e.open),true);await page.keyboard.press('Escape');assert.equal(await assistant.getAttribute('data-phase'),'exit');assert.equal(await assistant.evaluate(e=>e.open),true,'기본 Escape 닫힘을 지연하여 종료 애니메이션 보장');await assistant.waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.motion.setPopup(true));await popup.waitFor();assert.equal(await popup.evaluate(e=>getComputedStyle(e).transform),'none');await page.evaluate(()=>window.motion.setPopup(false));await popup.waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
    console.log('통과: 공식 로컬 글꼴 4종 / 제어 요소 높이 / 체크박스 참조와 키보드 / 팝업과 알림 입퇴장 / 시트 / 실제 검색과 비서 팝업 / 재열기 / 동작 줄이기');
  } catch(error) {
    if(errors.length) console.error("렌더러 오류",errors);
    if(page)console.error("실패 시 화면 상태",await page.evaluate(()=>({url:location.href,body:document.body.innerText.slice(0,500)})));
    throw error;
  } finally {
    if(app) await app.close().catch(()=>{});
    if(server) await server.close();
    await fs.rm(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
