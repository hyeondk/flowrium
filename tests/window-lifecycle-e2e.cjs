const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {_electron}=require('playwright'),{Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.flowrium-tmp','qa-261115_03'),baseline=process.argv.includes('--expect-existing-gap');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message,timeout=8000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(40);}throw Error(message);}
(async()=>{
 await fs.mkdir(qa,{recursive:true});const temp=await fs.mkdtemp(path.join(qa,'window-lifecycle-')),profile=path.join(temp,'profile'),codex=path.join(temp,'codex'),preload=path.join(temp,'delay-registry.cjs');let app;const children=new Set(),result={baseline,syntheticProfile:true,paidModelRequests:0};
 try{
  const store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});await fs.mkdir(codex);
  await fs.writeFile(preload,`const fs=require('node:fs/promises');const original=fs.readFile;let once=false;fs.readFile=async function(file,...args){if(!once&&String(file)===${JSON.stringify(path.join(profile,'workspace-v2.json'))}){once=true;globalThis.__flowriumDelayEntered=true;await new Promise(resolve=>setTimeout(resolve,3000));}return original.call(this,file,...args);};`);
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:codex,FLOWRIUM_LIFECYCLE_DIAGNOSTICS:'1'};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.NODE_OPTIONS;
  app=await _electron.launch({args:['-r',preload,root],env,timeout:30000});assert.equal(path.relative(await app.evaluate(({app})=>app.getPath('userData')),profile),'','실제 사용자 프로필과 격리한다');
  await app.evaluate(({app})=>{globalThis.__flowriumSecondInstances=0;app.on('second-instance',()=>globalThis.__flowriumSecondInstances++);});
  async function second(){const child=spawn(require('electron'),[root],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});children.add(child);let errors='';child.stderr.on('data',part=>{errors+=part;});const exit=await Promise.race([new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}),delay(10000).then(()=>{throw Error('격리한 두 번째 실행이 종료되지 않았습니다.');})]);assert.equal(exit.code,0,'두 번째 실행은 기존 앱에 요청을 전달하고 종료한다');children.delete(child);return errors;}
  await until(()=>app.evaluate(()=>!!globalThis.__flowriumDelayEntered),'합성 초기 자료 읽기 대기에 진입하지 못했습니다.');
  const early=await app.evaluate(({BrowserWindow})=>({delayed:!!globalThis.__flowriumDelayEntered,windows:BrowserWindow.getAllWindows().length}));assert.equal(early.delayed,true);assert.equal(early.windows,0,'초기 자료 읽기가 끝나기 전 두 번째 실행을 보낸다');await second();
  const first=await app.firstWindow({timeout:15000});first.setDefaultTimeout(15000);await first.waitForLoadState('domcontentloaded');assert.equal(await first.title(),'Flowrium');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);result.earlySecondInstanceWaited=true;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await Promise.all([second(),second()]);
  await until(()=>app.evaluate(({BrowserWindow})=>{const windows=BrowserWindow.getAllWindows();return windows.length===1&&!windows[0].isMinimized()&&windows[0].isVisible();}),'기존 창을 복원하지 못했습니다.');result.existingWindowRestoredWithoutDuplicate=true;
  await app.evaluate(({app})=>{if(process.platform!=='darwin'){globalThis.__flowriumSavedCloseListeners=app.listeners('window-all-closed');app.removeAllListeners('window-all-closed');}});
  await first.close();await until(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length===0),'마지막 격리 창을 닫지 못했습니다.');
  const next=app.waitForEvent('window',{timeout:6000}).catch(error=>{if(error.name==='TimeoutError')return null;throw error;});await Promise.all([second(),second()]);const reopened=await next;
  if(baseline){assert.equal(reopened,null,'기존 코드의 창 없는 재실행 결함이 재현되어야 합니다.');result.existingGapReproduced=true;}
  else{assert(reopened,'창을 닫은 뒤 두 번째 실행으로 새 창을 복구해야 합니다.');await reopened.waitForLoadState('domcontentloaded');assert.equal(await reopened.title(),'Flowrium');await until(()=>app.evaluate(({BrowserWindow})=>{const windows=BrowserWindow.getAllWindows();return windows.length===1&&windows[0].isVisible()&&!windows[0].isMinimized();}),'재실행 후 창을 하나만 표시해야 합니다.');result.closedWindowRecreatedOnce=true;}
  await app.evaluate(({app})=>{for(const listener of globalThis.__flowriumSavedCloseListeners||[])app.on('window-all-closed',listener);});
  result.secondInstanceEvents=await app.evaluate(()=>globalThis.__flowriumSecondInstances);assert.equal(result.secondInstanceEvents,5);result.nonMacPersistenceFixture=process.platform!=='darwin';
  console.log(baseline?'격리 프로필 / 초기 대기 / 기존 창 복원 / 창 없는 두 번째 실행 결함 재현':'격리 프로필 / 초기 대기 중 두 번째 실행 / 최소화 복원 / 닫은 창 복구 / 동시 재실행 중복 창 차단 통과');
 }finally{
  if(app)await app.close();for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill();await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100});
  await fs.writeFile(path.join(qa,baseline?'window-lifecycle-baseline.json':'window-lifecycle-result.json'),JSON.stringify(result,null,2)+'\n');
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
