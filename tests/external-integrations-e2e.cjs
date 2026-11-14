const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-external-ui-'));let app;
 try{
  const profile=path.join(temp,'profile'),directory=path.join(temp,'project'),codex=path.join(temp,'codex');await fs.mkdir(directory);await fs.mkdir(codex);
  const store=new Store(profile);await store.load();const project=await store.addProject(directory);await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:codex};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(20000);
  await app.evaluate(async({ipcMain},{root,profile})=>{
   const req=process.getBuiltinModule('node:module').createRequire(root+'/package.json'),fs=req('node:fs/promises');
   const {Store}=req('./electron/store.cjs'),store=new Store(profile);await store.load();
   await fs.writeFile(profile+'/google-ui.enc',JSON.stringify({}));
   const fixture=profile+'/google-ui';await fs.mkdir(fixture);await fs.writeFile(fixture+'/google.enc',JSON.stringify({clientId:'fixture.apps.googleusercontent.com',accessToken:'fixture',refreshToken:'fixture',expiresAt:Date.now()+3600000,scopes:['https://www.googleapis.com/auth/calendar.events']}));
   globalThis.externalWrites=[];globalThis.externalEvents=[];
   const runtime=req('./electron/integrations.cjs').registerIntegrations((name,fn)=>{ipcMain.removeHandler('flowrium:'+name);ipcMain.handle('flowrium:'+name,(_, ...args)=>fn(...args));},store,{
    directory:fixture,secretStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},openExternal:async()=>{},
    fetchImpl:async(url,options={})=>{
     if(url.includes('calendarList'))return Response.json({items:[{id:'work@example.test',summary:'업무 캘린더',primary:true,accessRole:'owner'},{id:'shared@example.test',summary:'공유 캘린더',accessRole:'reader'}]});
     if(url.includes('/calendar/v3/')){
      const id=/\/events\/([^?]+)/.exec(url)?.[1];
      if(options.method){globalThis.externalWrites.push({method:options.method,headers:options.headers,body:options.body});
       if(options.method==='DELETE'){globalThis.externalEvents=[];return new Response(null,{status:204});}
       const value=JSON.parse(options.body);value.etag='"rev'+globalThis.externalWrites.length+'"';globalThis.externalEvents=[value];return Response.json(value);}
      return Response.json(id?globalThis.externalEvents.find(e=>e.id===id):{items:globalThis.externalEvents});
     }
     if(url.includes('/gmail/')){
      if(url.includes('/messages?'))return Response.json({messages:[{id:'mail1'}]});
      const full=url.includes('format=full');return Response.json({id:'mail1',internalDate:'1000',snippet:'짧은 미리보기',payload:{headers:[{name:'Subject',value:'업무 안내'},{name:'From',value:'fixture@example.test'}],...(full&&{mimeType:'text/plain',body:{data:Buffer.from('본문까지 읽은 확인 문장').toString('base64url')}})}});
     }
     if(url.includes('/drive/v3/files?'))return Response.json({files:[{id:'sheet123',name:'검증 표',mimeType:'application/vnd.google-apps.spreadsheet'}]});
     if(url.includes('/drive/v3/files/sheet123?fields='))return Response.json({id:'sheet123',name:'검증 표',mimeType:'application/vnd.google-apps.spreadsheet'});
     if(url.includes('/drive/v3/files/sheet123/export'))return new Response('항목,수량\n실제 저장,3');
     throw Error('시험에서 허용하지 않은 외부 요청');
    }
   });globalThis.externalRuntime=runtime;
  },{root:path.resolve(__dirname,'..'),profile});
  assert.equal(await page.title(),'Flowrium');
  const button=name=>page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name,exact:true});
  await page.getByRole('button',{name:'프로젝트 추가',exact:true}).first().waitFor();
  const projectButton=page.getByRole('button',{name:new RegExp(project.name)}).first();if(await projectButton.count())await projectButton.click();
  await page.locator('.settings-button').click();await button('일정').click();
  await page.getByLabel('일정 제목',{exact:true}).fill('새 업무 일정');
  await page.getByLabel('시작',{exact:true}).fill('2026-11-15T09:00');await page.getByLabel('종료',{exact:true}).fill('2026-11-15T10:00');
  await page.getByLabel('설명',{exact:true}).fill('검토한 일정 본문');
  await button('변경할 일정 검토').click();await page.getByRole('region',{name:'일정 변경 검토'}).getByText(/새 업무 일정/).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),0);
  await button('확인하고 일정 등록').click();await page.getByText('일정을 등록했습니다.',{exact:true}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),1);
  await button('일정 상세와 수정').click();await page.getByLabel('일정 제목',{exact:true}).fill('수정한 업무 일정');await button('변경할 일정 검토').click();
  await button('확인하고 일정 수정').click();await page.getByText('일정을 수정했습니다.',{exact:true}).waitFor();
  assert.equal(await app.evaluate(()=>globalThis.externalWrites[1].headers['If-Match']),'"rev1"');
  await button('일정 상세와 수정').click();await page.getByLabel('일정 작업',{exact:true}).selectOption('delete');await button('변경할 일정 검토').click();
  await button('취소').click();assert.equal(await app.evaluate(()=>globalThis.externalWrites.length),2);
  await button('변경할 일정 검토').click();await button('확인하고 일정 삭제').click();await page.getByText('일정을 삭제했습니다.',{exact:true}).waitFor();
  await button('메일').click();await button('본문 읽기').click();await page.locator('.integration-body').getByText('본문까지 읽은 확인 문장',{exact:true}).waitFor();
  await button('드라이브').click();await button('본문 읽기').click();await page.locator('.integration-body').getByText(/실제 저장,3/).waitFor();
  await button('가져오기').click();await page.getByRole('status').filter({hasText:'프로젝트에 저장했습니다'}).waitFor();
  const files=await fs.readdir(path.join(directory,'산출물'));assert(files.some(f=>f.endsWith('.csv')));assert.match(await fs.readFile(path.join(directory,'산출물',files.find(f=>f.endsWith('.csv'))),'utf8'),/실제 저장,3/);
  console.log('실제 앱 제목 / 다중 캘린더 / 검토 후 일정 등록·수정·삭제 / 취소·ETag / 메일 본문 / 표 읽기와 실제 파일 가져오기 통과');
 }finally{if(app){await app.evaluate(()=>globalThis.externalRuntime?.shutdown()).catch(()=>{});await app.close();}await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
})().catch(error=>{console.error(error);process.exitCode=1;});
