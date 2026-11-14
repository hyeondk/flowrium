const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{_electron}=require('playwright'),{setup}=require('./external-repositories-fixtures.cjs'),{samePath}=require('../electron/path-boundary.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),base=path.join(root,'.flowrium-tmp/qa-261115_02');await fs.mkdir(base,{recursive:true});const f=await setup(base);let app,page,stage='준비';
 async function close(){if(!app)return;const child=app.process();let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('외부 저장소 시험 앱 정상 종료 시간 초과')),15000)})]);}catch(e){child.kill('SIGKILL');throw e;}finally{clearTimeout(timer);app=null;}}
 try{
  await f.store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs'),theme:'light'});await fs.mkdir(path.join(f.root,'gh'));const empty=path.join(f.root,'empty-git-config');await fs.writeFile(empty,'');
  const env={...process.env,FLOWRIUM_USER_DATA:f.profile,CODEX_HOME:path.join(f.root,'codex'),GH_CONFIG_DIR:path.join(f.root,'gh'),GIT_CONFIG_GLOBAL:empty,GIT_CONFIG_NOSYSTEM:'1'};for(const key of ['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL','GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'])delete env[key];
  async function launch(){app=await _electron.launch({args:[root],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(16000);await page.setViewportSize({width:1440,height:1000});await page.locator('.side-usage[data-connected=true]').waitFor();await page.locator('.workspace-side').hover();await page.locator('.side-project').getByText(f.target.name,{exact:true}).click();await page.getByRole('heading',{name:f.target.name,exact:true}).waitFor();await page.getByRole('navigation',{name:'프로젝트 상세 탭'}).getByRole('button',{name:'프로젝트 설정',exact:true}).click();await page.locator('.project-repositories').waitFor();}
  await launch();const panel=()=>page.locator('.project-repositories');
  await app.evaluate(({dialog},{selected,permissionFile})=>{
   globalThis.repositoryPickerCalls=[];globalThis.repositoryPick=selected;dialog.showOpenDialog=async(_window,options)=>{globalThis.repositoryPickerCalls.push({title:options.title,defaultPath:options.defaultPath});return {canceled:!globalThis.repositoryPick,filePaths:globalThis.repositoryPick?[globalThis.repositoryPick]:[]};};
   // 실제 권한 조회만 늦춰 폴더 선택 오류 뒤에 배경 조회가 완료되는 순서를 재현한다.
   const fileSystem=process.getBuiltinModule('node:fs/promises'),original=fileSystem.lstat;
   globalThis.repositoryStatusGate={pending:false,finished:false};
   fileSystem.lstat=async function(target,...args){
    const gate=globalThis.repositoryStatusGate;
    if(String(target)===permissionFile&&!gate.pending){gate.pending=true;await new Promise(resolve=>{gate.release=resolve;});try{return await original.call(this,target,...args);}finally{gate.finished=true;}}
    return original.call(this,target,...args);
   };
   globalThis.restoreRepositoryStatusGate=()=>{globalThis.repositoryStatusGate.release?.();fileSystem.lstat=original;};
  },{selected:f.other,permissionFile:path.join(f.profile,'external-repository-access.json')});
  await panel().getByRole('button',{name:'저장소 연결 추가',exact:true}).click();await panel().getByLabel('저장소 이름 2',{exact:true}).fill('분리된 외부 저장소');await panel().getByLabel('저장소 기준 프로젝트 2',{exact:true}).selectOption(f.source.id);await panel().getByLabel('저장소 폴더 2',{exact:true}).fill('.');
  stage='배경 권한 조회 지연';await assertGatePending();
  stage='허가 전 저장 차단';await panel().getByRole('button',{name:'저장소와 대화 폴더 저장',exact:true}).click();await panel().getByRole('alert').filter({hasText:'폴더를 선택'}).waitFor();assert.equal((await page.evaluate(id=>window.flowrium.readProjectDetails(id),f.target.id)).repositories,undefined);
  stage='다른 폴더 선택 오류';await panel().getByRole('button',{name:'외부 폴더 선택 / 연결 허용',exact:true}).click();await panel().getByRole('status').filter({hasText:'정확히 선택'}).waitFor();await assert.rejects(fs.stat(path.join(f.profile,'external-repository-access.json')),{code:'ENOENT'});
  stage='배경 조회 후 사용자 오류 보존';await app.evaluate(()=>globalThis.repositoryStatusGate.release());await panel().getByText('이 기기에서 외부 저장소 폴더를 선택해 연결 권한을 확인해 주세요.',{exact:true}).waitFor();assert.equal(await app.evaluate(()=>globalThis.repositoryStatusGate.finished),true);assert.match(await panel().getByRole('status').innerText(),/정확히 선택/);await app.evaluate(()=>globalThis.restoreRepositoryStatusGate());
  stage='정확한 폴더 선택과 허가';
  await app.evaluate((_,selected)=>globalThis.repositoryPick=selected,f.source.path);await panel().getByRole('button',{name:'외부 폴더 선택 / 연결 허용',exact:true}).click();await panel().locator('[data-access=authorized]').waitFor();await panel().getByRole('button',{name:'저장소와 대화 폴더 저장',exact:true}).click();await page.waitForFunction(async id=>(await window.flowrium.readProjectDetails(id)).repositories?.length===2,f.target.id);
  const details=await page.evaluate(id=>window.flowrium.readProjectDetails(id),f.target.id),external=details.repositories.find(repo=>repo.sourceProjectId);assert.equal(external.sourceProjectId,f.source.id);assert.equal(external.path,'.');assert.equal(details.chatCwd,'.');const calls=await app.evaluate(()=>globalThis.repositoryPickerCalls);assert.equal(calls.length,2);assert(calls.every(call=>samePath(call.defaultPath,f.source.path)));
  await fs.writeFile(path.join(f.source.path,'b.txt'),'분리된 외부 저장소의 변경\n');const rows=await page.evaluate(({id,repositoryId})=>window.flowrium.repositoryAction(id,{action:'changes',repositoryId}),{id:f.target.id,repositoryId:external.id});assert(rows.some(row=>row.file==='b.txt'));assert(!rows.some(row=>row.file==='a.txt'));assert.equal(await fs.readFile(path.join(f.target.path,'a.txt'),'utf8'),'합성 원본\n');
  await panel().getByLabel('저장소 폴더 2',{exact:true}).fill(f.other);await panel().getByRole('button',{name:'저장소와 대화 폴더 저장',exact:true}).click();await panel().getByRole('alert').waitFor();assert.equal((await page.evaluate(id=>window.flowrium.readProjectDetails(id),f.target.id)).repositories.find(repo=>repo.id===external.id).path,'.');await panel().getByLabel('저장소 폴더 2',{exact:true}).fill('.');
  stage='재시작 권한 복원';await close();await launch();await panel().locator('[data-access=authorized]').waitFor();assert.equal((await page.evaluate(id=>window.flowrium.repositoryAction(id,{action:'repositories'}),f.target.id)).find(repo=>repo.id===external.id).access,'authorized');
  await panel().getByRole('button',{name:'이 기기의 연결 권한 해제',exact:true}).click();await panel().locator('[data-access=needs-selection]').waitFor();const refused=await page.evaluate(async ({id,repositoryId})=>{try{await window.flowrium.repositoryAction(id,{action:'changes',repositoryId});return false}catch{return true}},{id:f.target.id,repositoryId:external.id});assert.equal(refused,true);assert.equal(await fs.readFile(path.join(f.source.path,'b.txt'),'utf8'),'분리된 외부 저장소의 변경\n');
  console.log('외부 저장소 실제 화면 / 잘못된 폴더 선택 오류와 늦은 배경 조회 경합 / 오류 보존 / 별도 등록 root 선택 / 임의·절대경로 거절 / native 선택 검증·권한 저장 / source ID 연결 / 실제 별도 Git 변경 조회 / 대상 원본 보존 / 재시작 권한 유지 / 권한 해제 즉시 실행 차단');
 }catch(error){
  const diagnostics={stage};
  try{diagnostics.screen=await page.locator('.project-repositories').evaluate(element=>({statuses:[...element.querySelectorAll('[role=status],[role=alert]')].map(row=>row.textContent),access:[...element.querySelectorAll('[data-access]')].map(row=>({state:row.getAttribute('data-access'),text:row.textContent})),buttons:[...element.querySelectorAll('button')].filter(row=>row.textContent.includes('외부 폴더')).map(row=>({text:row.textContent,disabled:row.disabled}))}));}catch{}
  try{diagnostics.runtime=await app.evaluate(()=>({pickerCalls:globalThis.repositoryPickerCalls,gate:globalThis.repositoryStatusGate&&{pending:globalThis.repositoryStatusGate.pending,finished:globalThis.repositoryStatusGate.finished}}));}catch{}
  console.error('외부 저장소 화면 실패 진단',JSON.stringify(diagnostics));throw error;
 }finally{if(app)await app.evaluate(()=>globalThis.restoreRepositoryStatusGate?.()).catch(()=>{});await close();await fs.rm(f.root,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
 async function assertGatePending(){for(let attempt=0;attempt<100;attempt++){if(await app.evaluate(()=>globalThis.repositoryStatusGate.pending))return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('지연할 배경 권한 조회가 시작되지 않았습니다.');}
}
main().catch(e=>{console.error(e);process.exitCode=1});
