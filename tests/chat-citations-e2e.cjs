const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {_electron}=require('playwright');
const {Store}=require('../electron/store.cjs');
const {openConversation}=require('./shell-test-helpers.cjs');
const {closeInstalledApp}=require('./update-installed-ui.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(root,'.flowrium-tmp','citation-ui-'));
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
  const citation=(name,group)=>':codex-file-citation{path='+JSON.stringify(out+'/'+name)+(group?' artifactId="report"':'')+'}';
  const links='[최종 결과보고서 V1.1 한글 파일](<'+hwp.split(path.sep).join('/')+'>) / [보고용 피디에프]('+pathToFileURL(pdf).href+') / [누락 파일](<회의 자료 (최종)/누락.pdf>)';
  const text=range+'\n\n'+links+'\n\n![표지](<'+out+'/표지.png>)'+citation('표지.png',true)+citation('표지.png',true)+citation('내역.csv',true)+'\n'+citation('없는.png',false);
  const messages=[{id:randomUUID(),role:'user',text:range+'\n`'+citation('표지.png',true)+'`',createdAt:new Date().toISOString()},{id:randomUUID(),role:'assistant',text,createdAt:new Date().toISOString()}];
  const session=await store.createSession(project.id,{title:'참조 표시 확인',messages});
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:store.directory||path.join(temp,'profile'),CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RENDERER_URL;delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[root],env});const page=await app.firstWindow();
  await app.evaluate(({shell},realReveal)=>{
   globalThis.openedCitationFiles=[];
   const showItemInFolder=shell.showItemInFolder.bind(shell);
   shell.showItemInFolder=file=>{
    globalThis.openedCitationFiles.push(file);
    if(realReveal)showItemInFolder(file);
   };
  },process.env.FLOWRIUM_TEST_NATIVE_REVEAL==='1');
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
  await answer.getByRole('link',{name:'누락 파일'}).click();
  await answer.getByText('파일 위치를 열 수 없습니다. 연결된 파일이 현재 위치에 없습니다.').waitFor();
  const picked=await app.evaluate(()=>globalThis.openedCitationFiles);
  assert.deepEqual(picked.map(file=>file.normalize('NFC')),[hwp,pdf].map(file=>file.normalize('NFC')));
  await answer.getByText('미리보기를 열 수 없습니다.',{exact:false}).waitFor();
  assert((await page.locator('.message.user').innerText()).includes('codex-file-citation'));
  assert.equal((await page.evaluate(async id=>(await window.flowrium.bootstrap()).sessions.find(s=>s.id===id).messages.at(-1).text,session.id)),text);
  console.log('실제 PC / 다른 폴더의 한글·현재 프로젝트 PDF 링크를 파일 관리자로 전달 / 미리보기 1회 / 누락 안내 / 원문 보존');
 }finally{if(app)await closeInstalledApp(app,'참조 시험 앱 종료');await fs.rm(temp,{recursive:true,force:true,maxRetries:6});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
