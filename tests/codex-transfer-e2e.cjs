const {trustRegisteredFixtureFolder} = require('./project-trust-fixture.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {_electron}=require('playwright'),{Store}=require('../electron/store.cjs');
const {Security}=require('../electron/security.cjs');
const {waitForCodexConnection}=require('./shell-test-helpers.cjs');
async function main(){const root=path.resolve(__dirname,'..'),temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-copy-ui-')));let app,page;
 try{
  const profile=path.join(temp,'profile'),folder=path.join(temp,'합성 프로젝트'),fixture=path.join(temp,'source.json');await fs.mkdir(folder);
  const projectOnly=path.join(temp,'대화 없는 시험 폴더'),excluded=path.join(temp,'선택 해제한 시험 폴더');
  await fs.mkdir(projectOnly);await fs.mkdir(excluded);
  const threadId=crypto.randomUUID(),now=Math.floor(Date.now()/1000),source={threadId,folder,title:'이어갈 합성 프로젝트 대화',createdAt:now-10,updatedAt:now,turns:[{id:crypto.randomUUID(),status:'completed',startedAt:now-5,completedAt:now-4,items:[{id:crypto.randomUUID(),type:'userMessage',content:[{type:'text',text:'이전 프로젝트 요청'}]},{id:crypto.randomUUID(),type:'agentMessage',text:'이전 프로젝트 답변',phase:'final_answer'},{id:crypto.randomUUID(),type:'commandExecution',command:'검증 명령',aggregatedOutput:'보존할 합성 도구 기록'}]}]};const missingImage=path.join(temp,'사라진 합성 이미지.png'),rollout=path.join(temp,'rollout-synthetic.jsonl'),png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';source.rolloutPath=rollout;source.turns[0].items[0].content=[{type:'text',text:'이전 프로젝트 요청 / '+missingImage},{type:'localImage',path:missingImage}];await fs.writeFile(rollout,JSON.stringify({type:'session_meta',payload:{id:threadId,cwd:folder}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:source.turns[0].items[0].content[0].text},{type:'input_image',image_url:'data:image/png;base64,'+png}]}})+'\n');const rolloutHash=crypto.createHash('sha256').update(await fs.readFile(rollout)).digest('hex');await fs.writeFile(fixture,JSON.stringify(source));
  source.projects=[{name:'공식 프로젝트 표시 이름',roots:[{path:folder}]},{name:'폴더만 불러올 프로젝트',roots:[{path:projectOnly}]},{name:'불러오지 않을 프로젝트',roots:[{path:excluded}]}];
  await fs.writeFile(fixture,JSON.stringify(source));
  const original=crypto.createHash('sha256').update(await fs.readFile(fixture)).digest('hex');const store=new Store(profile);await store.load();await store.saveSettings({codexPath:path.join(__dirname,'codex-transfer-fake.cjs')});
  const security=new Security(profile);await security.load();
  await security.accountOwner({type:'chatgpt',email:'synthetic@example.invalid'},false,true);
  const unrelatedFolder=path.join(temp,'그대로 둘 프로젝트');await fs.mkdir(unrelatedFolder);
  const unrelatedProject=await store.addProject(unrelatedFolder);
  const unrelated=await store.createSession(unrelatedProject.id,{title:'변경하지 않을 대화'});
  const preserved={id:crypto.randomUUID(),role:'user',text:'기존 대화 보존 확인',createdAt:new Date().toISOString()};
  store.session(unrelated.id).messages.push(preserved);await store.save();
  const env={...process.env,FLOWRIUM_USER_DATA:profile,FLOWRIUM_CODEX_TRANSFER_FIXTURE:fixture,CODEX_HOME:path.join(temp,'codex')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(16000);
  // 격리된 시험 폴더도 후보에 허용하되 프로젝트 목록, 원문 및 저장은 실제 IPC 흐름을 확인합니다.
  await app.evaluate(({app})=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),{CodexTransfer}=req('./electron/codex-transfer.cjs'),original=CodexTransfer.prototype.projects;CodexTransfer.prototype.projects=function(input){this.options.allowTemporaryProjects=true;return original.call(this,input);};});
  await waitForCodexConnection(page);
  await page.locator('.workspace-side').getByRole('button',{name:'설정',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'설정',exact:true});
  await settings.getByRole('button',{name:'계정과 모델',exact:true}).click();
  const panel=settings.getByRole('region',{name:'Codex 대화와 프로젝트 불러오기',exact:true});
  await app.evaluate(({app})=>{
    const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    const {Store}=req('./electron/store.cjs'),original=Store.prototype.syncConversationOwner;
    Store.prototype.syncConversationOwner=async function(...args){
      Store.prototype.syncConversationOwner=original;
      await new Promise(resolve=>{global.__releaseTransferRead=resolve;});
      return original.apply(this,args);
    };
  });
  await page.evaluate(()=>{window.__transferRead=window.flowrium.bootstrap();});
  try{
    for(let n=0;n<100&&!await app.evaluate(()=>!!global.__releaseTransferRead);n++)await new Promise(resolve=>setTimeout(resolve,30));
    assert(await app.evaluate(()=>!!global.__releaseTransferRead),'작업 공간 읽기와 대화 검색의 경합 재현');
    await panel.getByRole('button',{name:'불러올 대화와 프로젝트 찾기',exact:true}).click();
    await panel.getByRole('checkbox',{name:'대화 '+source.title,exact:true}).waitFor();
  }finally{
    await app.evaluate(()=>{global.__releaseTransferRead?.();delete global.__releaseTransferRead;});
  }
  await page.evaluate(()=>window.__transferRead.then(()=>undefined));
  await panel.getByRole('checkbox',{name:'프로젝트 불러오지 않을 프로젝트',exact:true}).uncheck();
  assert(await panel.getByRole('checkbox',{name:'프로젝트 공식 프로젝트 표시 이름',exact:true}).isChecked());
  assert(await panel.getByRole('checkbox',{name:'프로젝트 폴더만 불러올 프로젝트',exact:true}).isChecked());
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(fixture)).digest('hex'),original,'미리보기 원본 불변');
  await app.evaluate(({app})=>{
    const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json');
    const {CodexTransfer}=req('./electron/codex-transfer.cjs'),original=CodexTransfer.prototype.archive;
    CodexTransfer.prototype.archive=async function(...args){
      CodexTransfer.prototype.archive=original;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('합성 원문 보관 걸쇠의 제한 시간을 넘었습니다.')),12000);
        global.__releaseTransferArchive=()=>{clearTimeout(timer);resolve();};
      });
      return original.apply(this,args);
    };
  });
  await panel.getByRole('button',{name:'선택한 항목 불러오기',exact:true}).click();
  let before;
  try{
    for(let n=0;n<100&&!await app.evaluate(()=>!!global.__releaseTransferArchive);n++)await new Promise(resolve=>setTimeout(resolve,50));
    assert(await app.evaluate(()=>!!global.__releaseTransferArchive),'원문 보관 중 변경 경합 재현');
    before=await page.evaluate(async(folder)=>{
      const data=await window.flowrium.bootstrap(),project=data.projects.find(row=>row.path.normalize('NFC')===folder.normalize('NFC'));
      window.__afterArchive=null;
      window.flowrium.createSession(project.id).then(
        row=>{window.__afterArchive={id:row.id};},
        error=>{window.__afterArchive={error:String(error)};}
      );
      return data.sessions.map(row=>row.id).sort();
    },folder);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>window.__afterArchive),null,'연결 작업 중 쓰기 요청이 대기한다');
    assert.deepEqual(await page.evaluate(async()=>(await window.flowrium.bootstrap()).sessions.map(row=>row.id).sort()),before,'대기 중 저장이 일어나지 않는다');
  }finally{
    await app.evaluate(()=>{global.__releaseTransferArchive?.();delete global.__releaseTransferArchive;});
  }
  await page.waitForFunction(()=>window.__afterArchive!==null,undefined,{timeout:12000});
  const queued=await page.evaluate(()=>window.__afterArchive);
  assert(!queued.error&&queued.id,'대기하던 새 대화가 성공적으로 등록된다');
  await panel.getByRole('status').filter({hasText:'프로젝트 2개 / 대화 연결 1개'}).waitFor();assert.equal(crypto.createHash('sha256').update(await fs.readFile(fixture)).digest('hex'),original,'가져오는 동안 원본 불변');
  let snapshot=await page.evaluate(()=>window.flowrium.bootstrap()),session=snapshot.sessions.find(s=>s.threadId===threadId);assert(session?.codexLink);assert.equal(session.codexLink.mode,'linked');assert(session.messages.some(m=>m.text.includes('보존할 합성 도구 기록')));assert.equal(session.messages[0].attachments?.length,1,'사라진 이미지의 대화 기록 사본 복구');assert.equal(crypto.createHash('sha256').update(await fs.readFile(rollout)).digest('hex'),rolloutHash,'복구 전후 원본 기록 바이트 보존');
  assert.deepEqual(snapshot.sessions.filter(row=>!before.includes(row.id)).map(row=>row.id).sort(),[session.id,queued.id].sort(),'연결한 대화와 대기시킨 대화만 각각 한 번 저장된다');
  const folderOnlyProject=snapshot.projects.find(row=>row.name==='폴더만 불러올 프로젝트');
  assert(folderOnlyProject&&!snapshot.sessions.some(row=>row.projectId===folderOnlyProject.id),'선택한 빈 프로젝트만 별도로 등록');
  assert(!snapshot.projects.some(row=>row.name==='불러오지 않을 프로젝트'),'선택하지 않은 프로젝트 등록 금지');
  await assert.rejects(fs.access(path.join(excluded,'.flowrium')),{code:'ENOENT'});
  assert.deepEqual(snapshot.sessions.find(row=>row.id===unrelated.id)?.messages,[preserved],'다른 프로젝트에 있던 원문을 보존한다');
  await panel.locator('summary').filter({hasText:'대화 연결 기록'}).click();await panel.getByRole('button',{name:'보관 원문',exact:true}).click();await panel.locator('pre').filter({hasText:'flowrium-codex-source'}).waitFor();
  await panel.getByRole('button',{name:'대화 열기',exact:true}).click();await settings.waitFor({state:'detached'});
  await page.locator('.dock-chat .session-heading').getByRole('heading',{name:source.title,exact:true}).waitFor();
  const assistantReplies=page.locator('.dock-chat .messages article.message.assistant .message-bubble');
  await page.getByLabel('대화 연결 및 작업 도구',{exact:true}).click();await page.locator('.codex-link-bar').waitFor();await page.getByRole('button',{name:'좋아요',exact:true}).first().click();
  const changed=JSON.parse(await fs.readFile(fixture,'utf8')),at=now+5;changed.updatedAt=at;changed.turns.push({id:crypto.randomUUID(),status:'completed',startedAt:at,completedAt:at,items:[{id:crypto.randomUUID(),type:'userMessage',content:[{type:'text',text:'원래 앱에서 추가한 합성 요청'}]},{id:crypto.randomUUID(),type:'agentMessage',text:'원래 앱에서 추가한 합성 답변',phase:'final_answer'}]});await fs.writeFile(fixture,JSON.stringify(changed));
  await assistantReplies.getByText('원래 앱에서 추가한 합성 답변',{exact:true}).waitFor();snapshot=await page.evaluate(()=>window.flowrium.bootstrap());session=snapshot.sessions.find(s=>s.threadId===threadId);assert(session.messages.some(m=>m.reaction==='like'),'갱신 뒤 로컬 반응 보존');
  await trustRegisteredFixtureFolder(profile,folder,'synthetic@example.invalid');
  const request='Flowrium에서 이어 쓰는 합성 요청';await page.getByLabel('Codex에 보낼 작업 요청').fill(request);await page.getByRole('button',{name:'작업 보내기',exact:true}).click();await assistantReplies.getByText('연결한 대화에서 받은 합성 응답',{exact:true}).waitFor();const finalSource=JSON.parse(await fs.readFile(fixture,'utf8'));assert.equal(finalSource.lastInput.filter(part=>part.type==='text').map(part=>part.text).join('\n'),request,'사용자 원문을 내부 프롬프트로 바꾸지 않음');
  assert.equal(finalSource.turns[0].items[0].content[0].text,source.turns[0].items[0].content[0].text,'과거 사용자 원문 보존');
  console.log('계정과 모델의 대화·프로젝트 불러오기 / 작업 공간을 읽는 중에도 검색 / 등록 프로젝트 이름과 빈 폴더 선택 / 선택 해제한 프로젝트 제외 / 미리보기·원본 불변·보관 원문 / 대화 열기 / 외부 새 메시지 갱신 / 좋아요 유지 / 같은 대화에서 사용자 원문 전송·응답 통과');
 }catch(error){if(page)console.error('합성 화면 상태',await page.locator('body').innerText().catch(()=>''));throw error;}finally{if(app)await app.close().catch(()=>{});await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:200});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
