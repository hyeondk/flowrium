const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
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
  const store=new Store(path.join(temp,'profile'));await store.load();
  const project=await store.addProject(folder);
  const range='예상 소요 시간은 25~35분이고 발표는 18~20장이야. ~ 안녕 ~ ~~두 번~~';
  const citation=(name,group)=>':codex-file-citation{path='+JSON.stringify(out+'/'+name)+(group?' artifactId="report"':'')+'}';
  const text=range+'\n\n![표지](<'+out+'/표지.png>)'+citation('표지.png',true)+citation('표지.png',true)+citation('내역.csv',true)+'\n'+citation('없는.png',false);
  const messages=[{id:randomUUID(),role:'user',text:range+'\n`'+citation('표지.png',true)+'`',createdAt:new Date().toISOString()},{id:randomUUID(),role:'assistant',text,createdAt:new Date().toISOString()}];
  const session=await store.createSession(project.id,{title:'참조 표시 확인',messages});
  await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
  const env={...process.env,FLOWRIUM_USER_DATA:store.directory||path.join(temp,'profile'),CODEX_HOME:path.join(temp,'codex')};
  delete env.ELECTRON_RENDERER_URL;delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({args:[root],env});const page=await app.firstWindow();
  await page.setViewportSize({width:1440,height:900});await openConversation(page,session.title);
  const answer=page.locator('.message.assistant').last();
  await answer.locator('.citation-image img').waitFor();
  assert.equal(await answer.locator('.citation-image img').count(),1);
  assert.equal(await answer.locator('.chat-citation').count(),2);
  assert.equal(await answer.locator('del').count(),0);
  assert((await answer.innerText()).includes(range));
  assert(!(await answer.innerText()).includes('codex-file-citation'));
  assert(!(await answer.innerText()).includes(out));
  await answer.getByText('미리보기를 열 수 없습니다.',{exact:false}).waitFor();
  assert((await page.locator('.message.user').innerText()).includes('codex-file-citation'));
  assert.equal((await page.evaluate(async id=>(await window.flowrium.bootstrap()).sessions.find(s=>s.id===id).messages.at(-1).text,session.id)),text);
  console.log('실제 PC / 독립 파일 2개 / 미리보기 1회 / 누락 파일 해당 위치 오류 / 물결표와 인용 원문 보존');
 }finally{if(app)await closeInstalledApp(app,'참조 시험 앱 종료');await fs.rm(temp,{recursive:true,force:true,maxRetries:6});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
