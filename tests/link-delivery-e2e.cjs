const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {_electron:electron}=require('playwright');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-link-ui-'));let app;
 try{
  const env={...process.env,FLOWRIUM_USER_DATA:path.join(temp,'profile'),CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow();page.setDefaultTimeout(20000);
  await app.evaluate(async({ipcMain},{root,temp})=>{
   const req=process.getBuiltinModule('node:module').createRequire(root+'/package.json');globalThis.linkSent=[];globalThis.linkUrls=[];
   globalThis.delivery=req('./electron/link-delivery.cjs').registerLinkDelivery((name,fn)=>{ipcMain.removeHandler('flowrium:'+name);ipcMain.handle('flowrium:'+name,(_, ...args)=>fn(...args));},{
    directory:temp,callbackPort:0,secretStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()},
    openExternal:async url=>globalThis.linkUrls.push(url),getContext:()=>({enabled:true,scopeId:'test-scope'}),ensureRemote:async()=>{},
    issueLink:async()=>({url:'https://test-work.trycloudflare.com/#handoff='+'b'.repeat(40),scopeId:'test-scope'}),
    mailProvider:()=>({search:async()=>[],send:async value=>globalThis.linkSent.push(value)}),
    fetchImpl:async url=>Response.json(url.endsWith('/oauth/token')?{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}:{result_code:0}),
   });
  },{root:path.resolve(__dirname,'..'),temp});
  await page.locator('.settings-button').click();const panel=page.getByRole('region',{name:'연결 주소 전달'});await panel.waitFor();
  await panel.getByText('카카오톡 연결',{exact:true}).click();await panel.getByLabel('REST API 키',{exact:true}).fill('fixture-rest-key-value');
  await panel.getByRole('button',{name:'카카오 설정 저장',exact:true}).click();await panel.getByText('설정을 반영했습니다.',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'카카오 로그인',exact:true}).click();await panel.getByText(/브라우저에서 카카오 로그인을/).waitFor();
  const auth=new URL(await app.evaluate(()=>globalThis.linkUrls[0]));const callback=await fetch(auth.searchParams.get('redirect_uri')+'?state='+auth.searchParams.get('state')+'&code=fixture');assert.equal(callback.status,200);
  await panel.getByRole('button',{name:'연결 확인',exact:true}).click();await panel.getByRole('button',{name:'나에게 연결 주소 보내기',exact:true}).waitFor();
  await panel.getByText('메일로 연결 주소 요청',{exact:true}).click();await panel.getByLabel('허용할 발신 주소 / 최대 5개',{exact:true}).fill('me@example.test');
  await panel.getByLabel('허용한 메일 요청에 자동으로 연결 주소 답장',{exact:true}).check();await panel.getByRole('button',{name:'메일 요청 설정 저장',exact:true}).click();
  await panel.getByLabel('허용한 주소로 시험 전송',{exact:true}).selectOption('me@example.test');await panel.getByRole('button',{name:'시험 전송',exact:true}).click();
  await panel.getByText('선택한 주소로 일회용 주소를 보냈습니다.',{exact:true}).waitFor();
  const sent=await app.evaluate(()=>globalThis.linkSent);assert.equal(sent.length,1);assert.equal(sent[0].to,'me@example.test');assert.match(sent[0].body,/#handoff=/);
  assert.equal(await page.title(),'Flowrium');console.log('연결 주소 UI / 카카오 상태·로그인 / 메일 허용목록 저장 / 명시적 시험 전송 / 일회용 주소 통과');
 }finally{if(app){await app.evaluate(()=>globalThis.delivery?.shutdown()).catch(()=>{});await app.close()}await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200})}
})().catch(error=>{console.error(error);process.exitCode=1});
