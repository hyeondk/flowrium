const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright'),{Store}=require('../electron/store.cjs'),{png}=require('./chat-fixtures.cjs');
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-chat-screen-')),profile=path.join(temp,'profile');let app,page;
 const store=new Store(profile);await store.load();await fs.mkdir(path.join(temp,'project'));await fs.mkdir(path.join(temp,'other'));
 const project=await store.addProject(path.join(temp,'project')),other=await store.addProject(path.join(temp,'other'));
 const session=await store.createSession(project.id,{title:'첨부 검증 대화'});await store.createSession(other.id,{title:'다른 프로젝트 대화'});await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
 const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const button=name=>page.getByRole('button',{name,exact:true});const input=()=>page.getByLabel('Codex에 보낼 작업 요청');
 async function launch(){app=await _electron.launch({args:[path.resolve(__dirname,'..')],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(16000);await button('개인 비서').waitFor();}
 async function snapshot(){return page.evaluate(()=>window.flowrium.bootstrap());}
 async function until(fn){for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('채팅 화면 상태 대기 시간 초과');}
 async function open(title){await page.locator('.workspace-side').getByRole('button',{name:'대시보드',exact:true}).click();await page.locator('.pf-row').filter({hasText:title}).first().click();await input().waitFor();}
 try{
  await launch();await open('첨부 검증 대화');
  await page.getByLabel('채팅에 첨부할 파일').setInputFiles({name:'원본.md',mimeType:'text/markdown',buffer:Buffer.from('실제 첨부 원문')});
  await page.locator('.attachment-composer .chat-attachment-list').getByText('원본.md',{exact:true}).waitFor();await input().fill('저장할 미전송 초안');
  const paste=await page.evaluateHandle(bytes=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'캡처.png',{type:'image/png'}));return data;},[...png]);
  await input().evaluate((el,data)=>el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})),paste);await page.locator('.attachment-composer .chat-attachment-list img').waitFor();await paste.dispose();
  const drop=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['끌어놓은 자료'],'드롭.txt',{type:'text/plain'}));return data;});
  await page.locator('.attachment-composer').dispatchEvent('drop',{dataTransfer:drop});await page.locator('.attachment-composer').getByText('드롭.txt',{exact:true}).waitFor();await drop.dispose();
  await open('다른 프로젝트 대화');assert.equal(await page.locator('.attachment-composer .chat-attachment-list').count(),0);assert.equal(await input().inputValue(),'');
  await open('첨부 검증 대화');assert.equal(await input().inputValue(),'저장할 미전송 초안');assert.equal(await page.locator('.attachment-composer .chat-attachment-list li').count(),3);
  await app.close();app=null;await launch();await open('첨부 검증 대화');assert.equal(await input().inputValue(),'저장할 미전송 초안');assert.equal(await page.locator('.attachment-composer .chat-attachment-list li').count(),3);
  await button('드롭.txt 첨부 제거').click();await input().fill('');await button('작업 보내기').click();
  await until(async()=> (await snapshot()).sessions.find(s=>s.id===session.id).messages.some(m=>m.role==='assistant'));
  let current=(await snapshot()).sessions.find(s=>s.id===session.id);assert.equal(current.messages[0].attachments.length,2);assert.equal(current.messages[0].text,'첨부한 자료를 확인해 주세요.');
  await until(async()=>await button('작업 보내기').isVisible());
  await input().fill('대기검증');await input().press('Enter');await button('작업 중지').waitFor();
  await input().fill('후속 지시');await button('추가 지시 대기열에 넣기').click();await page.locator('.chat-queue-panel').getByText('후속 지시',{exact:true}).waitFor();
  await input().fill('취소할 추가 지시');await button('추가 지시 대기열에 넣기').click();const row=page.locator('.chat-queue-panel > div').filter({hasText:'취소할 추가 지시'});await row.getByRole('button',{name:'대기 취소',exact:true}).click();
  await button('작업 중지').click();
  await until(async()=>{const s=(await snapshot()).sessions.find(s=>s.id===session.id);return s.queuedMessages.some(q=>q.text==='후속 지시'&&q.status==='sent')&&s.messages.filter(m=>m.role==='assistant').length===2;});
  current=(await snapshot()).sessions.find(s=>s.id===session.id);assert(!current.messages.some(m=>m.text==='취소할 추가 지시'));assert(current.queuedMessages.some(q=>q.status==='cancelled'));
  await until(async()=>await button('작업 보내기').isVisible());await button('대화 관리').click();await page.getByLabel('기준 요청').selectOption({index:1});await button('여기까지 새 대화로 분기').click();await page.getByRole('heading',{name:'분기 / '+current.title,exact:true}).waitFor();
  let branched=(await snapshot()).sessions.find(s=>s.title==='분기 / '+current.title);assert(branched.threadId!==current.threadId);assert.equal(branched.messages.filter(m=>m.role==='user').length,1);assert.equal(branched.messages[0].attachments.length,2);
  await button('대화 관리').click();await page.getByLabel('기준 요청').selectOption({index:1});await button('이 요청 전으로 되감기').click();await button('되감기 확인').click();
  await until(async()=> (await snapshot()).sessions.find(s=>s.id===branched.id).messages.length===0);await until(async()=>await input().inputValue()==='첨부한 자료를 확인해 주세요.');assert.equal(await page.locator('.attachment-composer .chat-attachment-list li').count(),2);
  await button('대화 관리').click();await page.getByLabel('대화 동작은 앱 기본 설정 따르기').uncheck();await page.getByLabel('답변 길이',{exact:true}).selectOption('short');await page.getByLabel('실행 허용 범위').selectOption('read-only');await button('대화 연결 설정 저장').click();
  const saved=(await snapshot()).sessions.find(s=>s.id===branched.id);assert.equal(saved.preferences.answerLength,'short');assert.equal(saved.preferences.sandbox,'read-only');
  console.log('실제 Electron 채팅 통과 / 파일 선택·캡처 붙여넣기·드롭 / 프로젝트별 첨부 초안과 재기동 복원 / 첨부만 전송 / 지시 큐·취소·순차 실행 / 내부 분기와 되감기 / 요청 초안 복원 / 대화 동작 설정');
 }catch(e){if(app)console.error('첨부 화면 진단',await page.locator('.attachment-composer').innerText().catch(()=>''),await page.getByRole('status').allTextContents().catch(()=>[]));throw e;}finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
