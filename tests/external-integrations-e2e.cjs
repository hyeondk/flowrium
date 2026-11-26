const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {_electron:electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
(async()=>{
 const base=path.resolve(__dirname,'../.flowrium-tmp/qa-261115_03');await fs.mkdir(base,{recursive:true});const temp=await fs.mkdtemp(path.join(base,'external-ui-'));let app;
 try{
  const profile=path.join(temp,'profile'),directory=path.join(temp,'project'),codex=path.join(temp,'codex');await fs.mkdir(directory);await fs.mkdir(codex);
  const store=new Store(profile);await store.load();await store.addProject(directory);await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:codex};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[path.resolve(__dirname,'..')],env,timeout:45000});const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(20000);
  const original=await page.evaluate(async()=>({google:await window.flowrium.readGoogleConnection(),native:await window.flowrium.macPimStatus()}));
  assert.equal(original.google.phase,'unconfigured','새 프로필의 Google 연결은 꺼져 있다');
  assert.equal(original.native.available,process.platform==='darwin','실제 운영체제의 기본 앱 사용 가능 여부를 보존한다');
  await app.evaluate(async({ipcMain},{root,temp})=>{
   const req=process.getBuiltinModule('node:module').createRequire(root+'/package.json'),{EventEmitter}=req('node:events'),{PassThrough,Writable}=req('node:stream');
   const tools=req('./electron/external-tools.cjs').createExternalTools({handlers:new Map(),workflow:{},store:{}});
   globalThis.externalDefinitions=tools.definitions.map(row=>row.name);globalThis.externalWrites=[];globalThis.externalCalls=[];globalThis.externalEvents=[];
   const spawnImpl=()=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};let raw='';
    child.stdin=new Writable({write(chunk,_,done){raw+=chunk;done()},final(done){done();setImmediate(()=>{
     try{
      const input=JSON.parse(raw);globalThis.externalCalls.push(input);let value;
      if(input.action==='calendars')value=[{id:'native',title:'합성 업무 일정',primary:true,writable:true}];
      else if(input.action==='events')value=globalThis.externalEvents;
      else if(input.action==='event')value=globalThis.externalEvents.find(row=>row.id===input.eventId);
      else if(input.action==='mails')value=[{id:'1',title:'합성 업무 안내',from:'fixture@example.test',at:'2026-11-15T01:00:00Z'}];
      else if(input.action==='mail')value={id:'1',title:'합성 업무 안내',body:'기본 메일의 합성 본문 확인'};
      else if(['create','update','delete'].includes(input.action)){
       globalThis.externalWrites.push(input);
       if(input.action==='delete'){globalThis.externalEvents=[];value=true;}
       else{value={id:'event',calendarId:'native',title:input.summary,description:input.description,location:input.location,at:new Date(input.start).toISOString(),end:new Date(input.end).toISOString(),etag:'revision-'+globalThis.externalWrites.length};globalThis.externalEvents=[value];}
      }else throw Error('합성 검사에서 허용하지 않은 기본 앱 작업');
      child.stdout.end(JSON.stringify({ok:true,value}));child.emit('close',0);
     }catch(error){child.stdout.end(JSON.stringify({ok:false,error:error.message}));child.emit('close',0);}
    })}});return child;
   };
   req('./electron/mac-pim.cjs').registerMacPim((name,fn)=>{ipcMain.removeHandler('flowrium:'+name);ipcMain.handle('flowrium:'+name,(_, ...args)=>fn(...args));},{directory:temp+'/native-fixture',platform:'darwin',spawnImpl});
  },{root:path.resolve(__dirname,'..'),temp});
  const definitions=await app.evaluate(()=>globalThis.externalDefinitions);assert(!definitions.some(name=>/google/i.test(name)));assert(definitions.includes('flowrium_mac_read'));assert(definitions.includes('flowrium_mac_calendar_propose'));
  assert.equal(await page.title(),'Flowrium');await page.locator('.workspace-side').hover();await page.getByRole('button',{name:'설정',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'외부 자료',exact:true}).count(),0);
  assert.equal(await dialog.getByText('Google 메일과 캘린더',{exact:true}).count(),0,'Google 연결은 업무 센터에서 관리한다');
  await dialog.getByRole('button',{name:'설정 닫기'}).click();await page.getByRole('button',{name:'업무 센터',exact:true}).click();
  const services=page.locator('.work-resources>summary');await services.getByText('연결 서비스',{exact:true}).waitFor();await services.click();
  const google=page.getByRole('region',{name:'Google 메일과 캘린더'});
  await google.getByRole('button',{name:'OAuth 파일 선택',exact:true}).waitFor();
  assert.equal(await google.getByRole('button',{name:'Google 계정 연결',exact:true}).count(),0);
  assert.equal(await google.getByRole('navigation',{name:'Google 자료'}).count(),0);
  await google.getByText('Google 연결 설정 방법',{exact:true}).click();
  await google.getByRole('button',{name:'Google Cloud 콘솔 열기',exact:true}).waitFor();
  const panel=page.locator('.native-pim-panel'),button=name=>panel.getByRole('button',{name,exact:true});
  await button('Mac 기본 앱 연결 켜기').click();await button('Mac 기본 앱 연결 끄기').waitFor();assert.equal(await app.evaluate(()=>globalThis.externalCalls.length),0,'명시 조회 전에는 기본 앱을 실행하지 않는다');
  await button('Mac 일정 조회').click();await panel.getByLabel('일정 제목',{exact:true}).fill('새 합성 일정');await panel.getByLabel('시작',{exact:true}).fill('2026-11-16T09:00');await panel.getByLabel('종료',{exact:true}).fill('2026-11-16T10:00');
  await button('변경할 일정 검토').click();await panel.getByRole('region',{name:'일정 변경 검토'}).waitFor();assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),0);
  await button('취소').click();assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),0);await button('변경할 일정 검토').click();await button('확인하고 일정 등록').click();await panel.getByText('일정을 등록했습니다.',{exact:true}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),1);await button('일정 상세와 수정').click();await panel.getByLabel('일정 제목',{exact:true}).fill('수정한 합성 일정');await button('변경할 일정 검토').click();await button('확인하고 일정 수정').click();await panel.getByText('일정을 수정했습니다.',{exact:true}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.externalWrites[1].etag),'revision-1');await button('일정 상세와 수정').click();await panel.getByLabel('일정 작업',{exact:true}).selectOption('delete');await button('변경할 일정 검토').click();await button('확인하고 일정 삭제').click();await panel.getByText('일정을 삭제했습니다.',{exact:true}).waitFor();assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),3);
  await button('Mac 메일 조회').click();await button('메일 본문 읽기').click();await panel.getByText('기본 메일의 합성 본문 확인',{exact:true}).waitFor();await button('Mac 기본 앱 연결 끄기').click();await button('Mac 기본 앱 연결 켜기').waitFor();
  console.log('Google 초기 연결 화면 / Mac 서비스 동시 노출 / 명시 연결과 조회 / 일정 검토·취소·등록·수정·삭제 / 메일 본문 합성 검사 통과');
 }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
})().catch(error=>{console.error(error);process.exitCode=1;});
