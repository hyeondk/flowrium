const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {EventEmitter} = require('node:events');
const {_electron} = require('playwright');
const {createElement}=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {QRCodeSVG}=require('qrcode.react');
const {Store} = require('../electron/store.cjs');
const {registerRemote} = require('../electron/remote.cjs');
const {checkMobileUpdate, productRelease, startingVersion} = require('./mobile-update-checks.cjs');

function qrSVG(value){return renderToStaticMarkup(createElement(QRCodeSVG,{value,size:320,level:'M',marginSize:4,xmlns:'http://www.w3.org/2000/svg'}));}
async function qrImage(page,value){
  const data=await page.evaluate(async svg=>{
    const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=320;
    canvas.getContext('2d').drawImage(image,0,0,320,320);
    return canvas.toDataURL('image/png').split(',')[1];
  },qrSVG(value));
  return {name:'시험-QR.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}

function simulatedTunnel() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.exitCode = child.signalCode = null;
  child.kill = () => { child.exitCode = 0; child.emit('exit',0); };
  setTimeout(() => child.stderr.emit('data',Buffer.from('https://install-fixture.trycloudflare.com Registered tunnel connection')),5);
  return child;
}

async function main() {
  const root = path.resolve(__dirname,'..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-mobile-install-'));
  let app, service;
  try {
    const profile=path.join(temp,'desktop'), store=new Store(profile);
    await store.load();
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),model:'gpt-6.1-sol',effort:'high'});
    const controller=new EventEmitter();
    controller.runs=new Map(); controller.status={available:true,authenticated:true};
    controller.connectionStatus=async()=>controller.status;
    const handlers=new Map(), register=(name,fn)=>handlers.set(name,fn);
    register('securityPending',()=>[]);
    register('connect',async()=>({status:controller.status,models:[{id:'gpt-6.1-sol',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}]}));
    register('readAccountUsage',async()=>({buckets:[{name:'Codex',plan:'Pro',windows:[{key:'primary',usedPercent:16,minutes:300,resetsAt:null}]}]}));
    const release=await productRelease();
    service=registerRemote(register,{store,controller,handlers,isLocked:()=>false,version:startingVersion,
      mobileUpdateDirectory:profile,mobileUpdateFetch:release.fetch,tunnelFactory:simulatedTunnel});
    const access=await handlers.get('startRemoteAccess')();
    const origin=new URL(access.localUrl).origin;
    const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app=await _electron.launch({args:[root],env,timeout:45000});
    const desktop=await app.firstWindow();
    desktop.setDefaultTimeout(15000);
    await desktop.locator('.app-shell').waitFor();
    await app.evaluate(({ipcMain},value)=>{
      ipcMain.removeHandler('flowrium:remoteAccess');
      ipcMain.handle('flowrium:remoteAccess',()=>value);
    },access);
    await desktop.emulateMedia({reducedMotion:'reduce'});
    await desktop.locator('.workspace-side').getByRole('button',{name:'설정',exact:true}).evaluate(button=>button.click());
    await desktop.getByRole('navigation',{name:'설정 분류'}).getByRole('button',{name:'휴대폰',exact:true}).evaluate(button=>button.click());
    const remotePanel=desktop.locator('.remote-panel');
    assert.equal(await remotePanel.getByLabel('휴대폰 연결 주소').count(),0);
    assert.equal(await remotePanel.getByRole('button',{name:'연결 주소 복사',exact:true}).count(),0);
    const qr=remotePanel.getByRole('img',{name:'휴대폰 연결 QR 코드'});
    assert.equal(await qr.count(),0);
    await remotePanel.getByRole('button',{name:'QR 코드 보기'}).click();
    await qr.waitFor();
    assert((await qr.locator('path').count())>=2);
    await remotePanel.getByRole('button',{name:'QR 코드 닫기'}).click();
    assert.equal(await qr.count(),0);

    const opened=app.waitForEvent('window');
    await app.evaluate(({BrowserWindow})=>{
      const win=new BrowserWindow({width:390,height:750,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'flowrium-install-test'}});
      globalThis.fixtureInstallWindow=win; void win.loadURL('about:blank');
    });
    const mobile=await opened;
    mobile.setDefaultTimeout(12000);
    const errors=[],external=[],leaks=[];
    mobile.on('pageerror',err=>errors.push(err.message));
    await mobile.route('**/*',route=>{
      const address=new URL(route.request().url());
      if (address.protocol.startsWith('http') && address.origin!==origin) {
        external.push(address.origin); return route.abort();
      }
      if (address.search.includes('key=') || address.search.includes('handoff=')) leaks.push(address.pathname);
      return route.continue();
    });
    await mobile.goto(origin);
    const scan=mobile.getByRole('button',{name:'QR 코드로 연결',exact:true});
    const scanner=mobile.getByRole('dialog',{name:'QR 코드로 연결',exact:true});
    await mobile.getByRole('heading',{name:'휴대폰 연결이 필요합니다'}).waitFor();
    const manifest=await (await mobile.request.get(origin+'/manifest.webmanifest')).json();
    assert.equal(manifest.display,'standalone'); assert.equal(manifest.start_url,'/'); assert.equal(manifest.id,'/');
    for (const icon of manifest.icons) {
      const image=await (await mobile.request.get(origin+icon.src)).body();
      assert.equal(image.readUInt32BE(16)+'x'+image.readUInt32BE(20),icon.sizes);
    }
    assert.deepEqual(manifest.icons.map(i=>i.sizes),['192x192','512x512']);
    assert.equal(await mobile.evaluate(async()=>Boolean((await navigator.serviceWorker.ready).active)),true);
    assert.equal(await mobile.locator('.bar button').count(),1,'상단에는 대시보드만 유지');
    assert.equal(await mobile.getByRole('button',{name:'홈 화면에 설치'}).count(),0);
    assert.equal(await mobile.getByLabel('연결 주소 붙여넣기').count(),0);
    await mobile.evaluate(()=>Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw new DOMException('거절','NotAllowedError');}}}));
    await scan.click();
    await scanner.getByText(/카메라를 사용할 수 없습니다/).waitFor();
    const picture=scanner.locator('input[type=file]');
    await picture.setInputFiles(await qrImage(mobile,'https://different.invalid/#key='+'x'.repeat(43)));
    await scanner.getByText('Flowrium 연결 QR 코드를 읽어 주세요.',{exact:true}).waitFor();
    await picture.setInputFiles(await qrImage(mobile,'https://other-flowrium.trycloudflare.com/#key='+'y'.repeat(43)));
    await scanner.getByText(/중계 주소가 바뀌었습니다/).waitFor();
    assert.equal(await mobile.evaluate(()=>location.origin),origin);
    const oneTime=service.issueLink({ttlMinutes:5}).url;
    await picture.setInputFiles(await qrImage(mobile,origin+'/'+new URL(oneTime).hash));
    const settings=mobile.getByRole('navigation',{name:'모바일 메뉴'}).getByRole('button',{name:'설정',exact:true});
    await settings.waitFor();
    assert.equal(await mobile.evaluate(()=>location.hash),'');
    assert.equal(await mobile.evaluate(()=>localStorage.getItem('flowrium.mobile.rememberedKey')),null);
    await settings.click();
    const help=mobile.getByRole('button',{name:'도움말',exact:true});
    assert.deepEqual(await mobile.locator('.settings-guides > button').evaluateAll(rows=>rows.map(row=>row.dataset.settingsGuide)),['help','install']);
    // Reserve a classic scrollbar even when the host uses overlay scrollbars.
    await mobile.evaluate(()=>{
      const sheet=Array.from(document.styleSheets).at(-1);
      sheet.insertRule('html::-webkit-scrollbar {width:16px}',sheet.cssRules.length);
      sheet.insertRule('html {overflow-y:scroll}',sheet.cssRules.length);
    });
    await help.click();
    const helpDialog=mobile.getByRole('dialog',{name:'도움말',exact:true});
    for(const title of ['처음 연결하기','대시보드','프로젝트 대화','결정과 대기','다시 접속하기']) {
      await helpDialog.getByRole('heading',{name:title,exact:true}).waitFor();
    }
    assert.equal(await mobile.locator('dialog[open]').count(),1);
    const centerOffset = await helpDialog.evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {x:(r.left+r.right-innerWidth)/2,y:(r.top+r.bottom-innerHeight)/2};
    });
    assert(Math.abs(centerOffset.x)<2 && Math.abs(centerOffset.y)<2,'도움말 중심 오차 '+JSON.stringify(centerOffset));
    assert.equal(await helpDialog.locator('[data-install-details]').isVisible(),false);
    await helpDialog.getByRole('button',{name:'도움말 닫기'}).click();
    await mobile.waitForFunction(()=>document.activeElement?.dataset.settingsGuide==='help');
    assert.equal(await mobile.evaluate(()=>getComputedStyle(document.documentElement).overflowY),'scroll');
    await mobile.evaluate(()=>document.dispatchEvent(new Event('flowrium-install-state')));
    assert.equal(await mobile.evaluate(()=>document.activeElement?.dataset.settingsGuide),'help','설정 갱신 후에도 원래 도움말 행의 초점을 유지');
    const install=mobile.getByRole('button',{name:'홈 화면에 설치',exact:true});
    await install.click();
    const guide=mobile.getByRole('dialog',{name:'홈 화면에 설치'});
    await guide.getByText(/브라우저 메뉴/).waitFor();
    await guide.getByRole('button',{name:'설치 안내 닫기'}).click();
    await mobile.evaluate(()=>Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone) AppleWebKit Safari'}));
    await install.click(); await guide.getByText(/Safari에서 공유/).waitFor();
    await guide.getByRole('button',{name:'설치 안내 닫기'}).click();
    await mobile.evaluate(()=>{
      const event=new Event('beforeinstallprompt',{cancelable:true});
      event.prompt=()=>{document.body.dataset.installPrompt='true';};
      event.userChoice=Promise.resolve({outcome:'dismissed'});
      dispatchEvent(event);
    });
    await install.click(); await guide.getByRole('button',{name:'앱 설치',exact:true}).click();
    await guide.getByText(/Safari에서 공유/).waitFor();
    assert.equal(await mobile.locator('body').getAttribute('data-install-prompt'),'true');
    await guide.getByRole('button',{name:'설치 안내 닫기'}).click();

    assert.equal(await mobile.locator('dialog[open]').count(),0);
    await mobile.waitForFunction(()=>document.activeElement?.dataset.settingsGuide==='install');
    const remember=mobile.getByRole('switch',{name:'이 기기에서 연결 유지'});
    for(const label of ['이 기기에서 연결 유지','작업 후 검증','필요한 다음 질문','문맥 자동 압축']) {
      const control=mobile.getByRole('switch',{name:label,exact:true});
      await control.waitFor();
      assert(await control.evaluate(input=>{
        const label=input.closest('label'),r=label.getBoundingClientRect(),track=input.nextElementSibling.getBoundingClientRect();
        return Math.abs(r.right-track.right)<2 && track.width>=36 && r.height>=44;
      }),'설정 오른쪽 스위치 정렬 '+label);
    }
    if(process.env.FLOWRIUM_MOBILE_SETTINGS_SCREENSHOT){
      await mobile.setViewportSize({width:390,height:844});
      await mobile.evaluate(()=>{window.scrollTo(0,0);return document.fonts.ready;});
      assert(!/Dropbox|\/Users\/|127\.0\.0\.1|#key=|#handoff=|trycloudflare|@/.test(await mobile.locator('body').innerText()));
      await mobile.screenshot({path:process.env.FLOWRIUM_MOBILE_SETTINGS_SCREENSHOT,animations:'disabled'});
    }
    assert.equal(await remember.isChecked(),false);
    await remember.check();
    assert(await mobile.evaluate(()=>Boolean(localStorage.getItem('flowrium.mobile.rememberedKey'))));
    await mobile.evaluate(()=>sessionStorage.clear()); await mobile.reload();
    await settings.click(); assert.equal(await remember.isChecked(),true);
    await checkMobileUpdate(mobile,release);
    await mobile.evaluate(()=>dispatchEvent(new Event('appinstalled')));
    const installed=mobile.getByRole('button',{name:/홈 화면에 설치.*설치됨/});
    await installed.click();
    await guide.getByText(/지금 홈 화면에 추가한/).waitFor();
    assert.equal(await guide.locator('[data-help]').isVisible(),false);
    assert.equal(await guide.getByRole('button',{name:'앱 설치',exact:true}).isVisible(),false);
    await guide.getByRole('button',{name:'설치 안내 닫기'}).click();
    await remember.uncheck(); await mobile.evaluate(()=>sessionStorage.clear()); await mobile.reload(); await scan.waitFor();
    await mobile.evaluate(({svg})=>{
      Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
        const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=canvas.height=320;
        const context=canvas.getContext('2d');
        const stream=canvas.captureStream(12);window.fixtureQrTrack=stream.getVideoTracks()[0];
        const next=()=>{if(window.fixtureQrTrack.readyState==='live'){context.drawImage(image,0,0,320,320);requestAnimationFrame(next);}};
        next();
        return stream;
      }}});
    },{svg:qrSVG(access.localUrl)});
    await scan.click();
    await settings.waitFor();
    assert.equal(await mobile.evaluate(()=>window.fixtureQrTrack.readyState),'ended');
    assert.equal(await mobile.evaluate(()=>Boolean(localStorage.getItem('flowrium.mobile.rememberedKey'))),true);
    await mobile.evaluate(()=>sessionStorage.clear());await mobile.reload();
    await settings.waitFor();
    assert.equal(await scan.count(),0);
    assert.equal(await mobile.evaluate(()=>location.hash),'');
    assert.deepEqual(errors,[]); assert.deepEqual(leaks,[]); assert.deepEqual(external,[]);
    console.log('휴대폰 QR 전용 연결 / 주소 복사·붙여넣기 삭제 / 다른 주소 차단 / 카메라 거절 시 사진 판독 / 일회용 QR / 홈 화면 앱의 카메라 판독·연결 보존 / 모바일 업데이트 뒤 다시 연결 통과');
  } finally {
    if (app) await app.close().catch(()=>{});
    if (service) await service.shutdown();
    await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
