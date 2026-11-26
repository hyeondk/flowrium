const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {openConversation}=require('./shell-test-helpers.cjs');
const {closeInstalledApp}=require('./update-installed-ui.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flowrium-citation-ui-'));
 let app;
 try {
  const folder=path.join(temp,'샘플'),out=path.join(folder,'outputs');
  await fs.mkdir(out,{recursive:true});
  await fs.copyFile(path.join(root,'assets','flowrium.png'),path.join(out,'표지.png'));
  await fs.writeFile(path.join(out,'내역.csv'),'월,매출\n1,2400');
  const notes=path.join(temp,'최종보고서 [완료]'),hwp=path.join(notes,'최종 결과보고서 V1.1 한글.hwp'),pdf=path.join(folder,'보고서.pdf');
  await fs.mkdir(notes);
  await Promise.all([hwp,pdf].map(file=>fs.writeFile(file,'fixture')));
  const store=new Store(path.join(temp,'profile'));await store.load();
  const project=await store.addProject(folder);
  const range='예상 소요 시간은 25~35분이고 발표는 18~20장이야. ~ 안녕 ~ ~~두 번~~';
  const guide='https://developer.apple.com/design/human-interface-guidelines';
  const example='https://example.test/read?q=guide#intro';
  const citation=(name,group)=>':codex-file-citation{path='+JSON.stringify(out+'/'+name)+(group?' artifactId="report"':'')+'}';
  const canonicalFile=hwp.split(path.sep).join('/');
  const previousFile=process.platform==='darwin'?canonicalFile.replace(/^\/private\//,'/'):process.platform==='win32'?'/'+canonicalFile:canonicalFile;
  const oldFile='[이전 문서 위치](<'+previousFile+':12>)';
  const links='[최종 결과보고서 V1.1 한글 파일](<'+hwp.split(path.sep).join('/')+'>) / [보고용 피디에프]('+pathToFileURL(pdf).href+') / [누락 파일](<회의 자료 (최종)/누락.pdf>)';
  const text=range+'\n\n'+links+'\n\n'+oldFile+'\n\n'+guide+'\n\n[설계 안내]('+example+')\n\n![표지](<'+out+'/표지.png>)'+citation('표지.png',true)+citation('표지.png',true)+citation('내역.csv',true)+'\n'+citation('없는.png',false);
  const messages=[{id:randomUUID(),role:'user',text:range+'\n'+String.fromCharCode(96)+citation('표지.png',true)+String.fromCharCode(96),createdAt:'2025-02-11T08:00:00.000Z'},{id:randomUUID(),role:'assistant',text,createdAt:'2025-02-11T08:01:00.000Z'}];
  const session=await store.createSession(project.id,{title:'참조 표시 확인',messages});
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:store.directory||path.join(temp,'profile'),CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RENDERER_URL;delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[root],env});const page=await app.firstWindow();
  await app.evaluate(({shell},{realReveal,realWeb,guideUrl})=>{
   globalThis.openedCitationFiles=[];
   globalThis.openedChatWebPages=[];
   const openExternal=shell.openExternal.bind(shell);
   shell.openExternal=async url=>{
    globalThis.openedChatWebPages.push(url);
    if(realWeb&&url===guideUrl){
     await openExternal(url);
     globalThis.nativeChatWebPageOpened=url;
    }
   };
   const showItemInFolder=shell.showItemInFolder.bind(shell);
   shell.showItemInFolder=file=>{
    globalThis.openedCitationFiles.push(file);
    if(realReveal)showItemInFolder(file);
   };
  },{realReveal:process.env.FLOWRIUM_TEST_NATIVE_REVEAL==='1',
    realWeb:process.env.FLOWRIUM_TEST_NATIVE_WEB_LINK==='1',guideUrl:guide});
  await page.setViewportSize({width:1440,height:900});await openConversation(page,session.title);
  const answer=page.locator('.message.assistant').last();
  await answer.locator('.citation-image img').waitFor();
  assert.equal(await answer.locator('.citation-image img').count(),1);
  assert.equal(await answer.locator('.chat-citation').count(),2);
  assert.equal(await answer.locator('del').count(),0);
  assert((await answer.innerText()).includes(range));
  assert(!(await answer.innerText()).includes('codex-file-citation'));
  assert(!(await answer.innerText()).includes(out));
  await answer.getByRole('link',{name:'최종 결과보고서 V1.1 한글 파일'}).click();
  await answer.getByRole('link',{name:'보고용 피디에프'}).press('Enter');
  await answer.getByRole('link',{name:'이전 문서 위치'}).click();
  assert.equal(await answer.getByRole('link',{name:guide}).locator('svg[aria-hidden="true"]').count(),1);
  await answer.getByRole('link',{name:guide}).click();
  await answer.getByRole('link',{name:'설계 안내'}).press('Enter');
  await assert.rejects(page.evaluate(()=>window.flowrium.openChatWebLink('file:///etc/hosts')),/웹 링크/);
  const deadline=Date.now()+3000;
  while(Date.now()<deadline && (await app.evaluate(()=>globalThis.openedChatWebPages.length))<2)
   await new Promise(resolve=>setTimeout(resolve,50));
  assert.deepEqual(await app.evaluate(()=>globalThis.openedChatWebPages),[guide,example]);
  if(process.env.FLOWRIUM_TEST_NATIVE_WEB_LINK==='1'){
   const nativeDeadline=Date.now()+3000;
   while(Date.now()<nativeDeadline && !await app.evaluate(()=>globalThis.nativeChatWebPageOpened))
    await new Promise(resolve=>setTimeout(resolve,50));
   assert.equal(await app.evaluate(()=>globalThis.nativeChatWebPageOpened),guide);
  }
  await answer.getByRole('link',{name:'누락 파일'}).click();
  await answer.getByText('파일 위치를 열 수 없습니다. 연결된 파일이 현재 위치에 없습니다.').waitFor();
  const picked=await app.evaluate(()=>globalThis.openedCitationFiles);
  assert.deepEqual(picked.map(file=>file.normalize('NFC')),[hwp,pdf,hwp].map(file=>file.normalize('NFC')));
  await answer.getByText('미리보기를 열 수 없습니다.',{exact:false}).waitFor();
  assert((await page.locator('.message.user').innerText()).includes('codex-file-citation'));
  assert.equal((await page.evaluate(async id=>(await window.flowrium.bootstrap()).sessions.find(s=>s.id===id).messages.at(-1).text,session.id)),text);
  console.log('실제 PC / 이전 대화와 현재 파일 링크를 파일 관리자로 전달 / 웹 링크를 기본 브라우저에 전달 / 미리보기 / 누락 안내 / 원문 보존');
 }finally{if(app)await closeInstalledApp(app,'참조 시험 앱 종료');await fs.rm(temp,{recursive:true,force:true,maxRetries:6});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
