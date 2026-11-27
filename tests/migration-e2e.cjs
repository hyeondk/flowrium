const {settledLayout,waitForCodexConnection}=require('./shell-test-helpers.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron}=require('playwright');const{randomUUID}=require('node:crypto');const {Store}=require('../electron/store.cjs');const{nativeSnapshot}=require('../electron/migration.cjs');const F=require('../electron/migration-files.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-migration-ui-'))),profile=path.join(temp,'검증 프로필'),source=path.join(temp,'이관 원본 프로젝트'),target=path.join(temp,'새 작업 위치'),exports=path.join(temp,'내보내기');let app,page;const errors=[];
 try{
  for(const p of [source,target,exports])await fs.mkdir(p);const old=new Store(path.join(temp,'원본 설정'));await old.load();const project=await old.addProject(source);await old.createSession(project.id,{title:'첨부와 도구 보존 대화',messages:[{id:randomUUID(),role:'user',text:'이관 확인 질문',createdAt:new Date().toISOString()},{id:randomUUID(),role:'system',text:'도구 입력 / 실행 결과 보존',createdAt:new Date().toISOString()},{id:randomUUID(),role:'assistant',text:'이관 확인 답변',createdAt:new Date().toISOString()}]});await fs.writeFile(path.join(source,'프로젝트 문서.md'),'합성 작업 파일');const before=await F.walk(source),bundle=await F.writeBundle(await nativeSnapshot(old,{includeFiles:true}),exports);
  const store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  async function launch(){app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});await waitForCodexConnection(page);await page.getByRole('button',{name:'업무 센터',exact:true}).click();await page.locator('.work-resources>summary').click();assert.equal(await page.getByRole('region',{name:'전체 자료 이관',exact:true}).count(),0);assert.equal(await page.locator('.work-resources .migration-panel').count(),0);await page.locator('.workspace-side').hover();await page.getByRole('button',{name:'설정',exact:true}).click();await page.locator('.settings-backup>summary').click();await page.getByRole('region',{name:'Flowrium 백업 및 복원',exact:true}).waitFor();await app.evaluate(({dialog},v)=>{dialog.showOpenDialog=async(_window,options)=>({canceled:false,filePaths:[options.title.includes('저장 위치')?v.target:options.title.includes('저장 위치 선택')?v.target:options.title.includes('저장')?v.exports:v.bundle]});},{target,exports,bundle});}
  const panel=()=>page.getByRole('region',{name:'Flowrium 백업 및 복원',exact:true}),button=name=>panel().getByRole('button',{name,exact:true});
  await launch();
  const backupCard=await page.locator('.settings-backup').evaluate(card=>{
   const header=card.querySelector('summary'),style=getComputedStyle(header);
   return {top:parseFloat(style.paddingTop),bottom:parseFloat(style.paddingBottom),horizontal:parseFloat(style.paddingLeft),
    radius:parseFloat(getComputedStyle(card).borderRadius),marker:style.listStyleType,icons:header.querySelectorAll('svg').length};
  });
  assert(backupCard.top>=12&&backupCard.top===backupCard.bottom&&backupCard.horizontal>=12&&backupCard.radius>=10&&backupCard.marker==='none'&&backupCard.icons===2,JSON.stringify(backupCard));
  console.log('백업 및 복원 카드 여백과 기본 삼각 표시 제거',JSON.stringify(backupCard));
  await app.evaluate(({app})=>{
   const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
   const connection=require('./electron/chat-connection.cjs'),original=connection.desktopAppInstalled;
   globalThis.migrationDetectionStarted=false;
   const waiting=new Promise(resolve=>{globalThis.finishMigrationDetection=()=>{connection.desktopAppInstalled=original;resolve(false);};});
   connection.desktopAppInstalled=async()=>{globalThis.migrationDetectionStarted=true;return waiting;};
  });
  const detection=page.evaluate(()=>window.flowrium.readDesktopChatInstallation());
  const preview=panel().getByRole('region',{name:'이관 미리보기',exact:true});
  try{
   for(let attempt=0;!await app.evaluate(()=>globalThis.migrationDetectionStarted);attempt++){
    assert(attempt<50,'데스크톱 앱 감지 요청이 시작되지 않았습니다.');
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   await button('현재 자료 내보내기 미리보기').click();
   const busyMessage=panel().getByText('실행 중인 작업을 마친 뒤 이관해 주세요.',{exact:true});
   await preview.or(busyMessage).waitFor();
   assert(await preview.isVisible(),'데스크톱 앱 감지 중 내보내기 미리보기가 차단됐습니다.');
  }finally{await app.evaluate(()=>globalThis.finishMigrationDetection());await detection;}
  await button('저장할 폴더 선택 후 내보내기').click();await panel().getByRole('status').filter({hasText:'내보내기를 완료했습니다.'}).waitFor();await preview.getByRole('button',{name:'닫기',exact:true}).click();
  await button('가져올 자료 미리보기').click();await panel().getByRole('region',{name:'이관 미리보기',exact:true}).waitFor();await button('프로젝트 대상 폴더 일괄 선택').click();await panel().getByText(target,{exact:false}).waitFor();await button('백업 후 이 계획 적용').click();await button('Flowrium 다시 시작').waitFor();await panel().getByRole('status').filter({hasText:'자료 이관을 완료했습니다'}).waitFor();
  const receipts=await page.evaluate(()=>window.flowrium.migrationAction({action:'receipts'}));assert.equal(receipts.length,1);assert.equal(receipts[0].status,'completed');assert.equal(receipts[0].projects.length,1);const destination=receipts[0].projects[0].path;assert.equal(await fs.readFile(path.join(destination,'프로젝트 문서.md'),'utf8'),'합성 작업 파일');assert.equal(await panel().getByText('이관 결과와 보존 원문',{exact:true}).count(),0);const original=await page.evaluate(async id=>{const info=await window.flowrium.migrationAction({action:'inspectReceipt',id});const entry=info.files.find(file=>file.path==='프로젝트 문서.md');return window.flowrium.migrationAction({action:'readOriginal',id,index:entry.index});},receipts[0].id);assert.equal(original.text,'합성 작업 파일');
  const widths=[];for(const width of [1440,800,390]){await page.setViewportSize({width,height:1000});await settledLayout(panel());widths.push(await panel().evaluate(e=>({width:innerWidth,document:document.documentElement.scrollWidth,panel:e.clientWidth,scroll:e.scrollWidth})));}assert(widths.every(v=>v.document<=v.width+1&&v.scroll<=v.panel+1),JSON.stringify(widths));
  await app.close();app=null;await launch();const snapshot=await page.evaluate(()=>window.flowrium.bootstrap());assert.equal(snapshot.projects.length,1);assert.equal(snapshot.sessions[0].messages[1].text,'도구 입력 / 실행 결과 보존');assert.equal(await panel().getByText('이관 결과와 보존 원문',{exact:true}).count(),0);const after=await F.walk(source);assert.deepEqual(after.map(e=>[e.path,e.sha256]),before.map(e=>[e.path,e.sha256]));assert.deepEqual(errors,[]);
  if(process.env.FLOWRIUM_MIGRATION_SCREENSHOT){await fs.mkdir(path.dirname(process.env.FLOWRIUM_MIGRATION_SCREENSHOT),{recursive:true});await panel().screenshot({path:process.env.FLOWRIUM_MIGRATION_SCREENSHOT});}
  console.log('업무 센터에서 이관 화면 제거 / 설정에서 백업과 복원 / 설치 감지 중 내보내기 / 원문 보존과 재시작 복원 / 반응형 검증 통과');
 }catch(e){if(page&&!page.isClosed())console.error('이관 화면 진단',await page.locator('body').innerText().catch(()=>''));throw e;}
 finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
})().catch(e=>{console.error(e);process.exitCode=1;});
