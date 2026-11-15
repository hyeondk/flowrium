const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const {Store}=require('../electron/store.cjs'),{CodexClient}=require('../electron/codex.cjs'),{Controller}=require('../electron/controller.cjs'),{TrashRuntime}=require('../electron/trash.cjs');
const hash=str=>createHash('sha256').update(str).digest('hex');
async function run(){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-trash-native-')));
 const folder=path.join(root,'합성 작업 폴더'),codex=path.join(root,'codex');
 const owner=hash('합성계정'),device=hash('합성기기');
 const overrides=(bin,args,opts)=>spawn(bin,args,{...opts,env:{...opts.env,HOME:root,USERPROFILE:root,CODEX_HOME:codex,FLOWRIUM_OFFLINE_KEY:'local-fixture'}});
 const binary=process.platform==='win32'?'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe':'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex';
 const client=new CodexClient({descriptor:{command:path.resolve(binary),prefix:[]},spawn:overrides,configOverrides:{model_provider:'flowrium_test'}});
 let controller,server;
 try{
  await fs.mkdir(codex);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'보존.txt'),'프로젝트 파일 보존');
  server=require('node:http').createServer(async(req,res)=>{
    for await(const chunk of req){}
    const id=randomUUID(),answer={type:'message',id:randomUUID(),role:'assistant',status:'completed',content:[{type:'output_text',text:'합성 답변',annotations:[]}]};
    const events=[{type:'response.created',response:{id,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item:answer},{type:'response.completed',response:{id,status:'completed',output:[answer],usage:{input_tokens:5,output_tokens:4,total_tokens:9}}}];
    res.writeHead(200,{'Content-Type':'text/event-stream'}).end(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  await fs.writeFile(path.join(codex,'config.toml'),['cli_auth_credentials_store = "file"','model = "gpt-5.5"','[model_providers.flowrium_test]','name = "Flowrium test"','base_url = "http://127.0.0.1:'+server.address().port+'/v1"','wire_api = "responses"','env_key = "FLOWRIUM_OFFLINE_KEY"','supports_websockets = false','[analytics]','enabled = false'].join('\n'));
  await client.start();const store=new Store(path.join(root,'profile'));await store.load();const p=await store.addProject(folder);
  const registered=(await client.request('project/create',{idempotencyKey:randomUUID(),name:'시험 프로젝트',roots:[{path:folder}]})).project;
  controller=new Controller(store);const trash=new TrashRuntime(store,controller,{accountOwner:()=>'합성계정',canRun:()=>true});
  const context=trash.context();const transfer=controller.codexTransfer={client,device:async()=>device,guard(){},isBusy:()=>false,ready:async()=>context};
  async function sweep(){return trash.syncNative([],context,transfer,{force:true});}
  async function make(label){
   const thread=(await client.request('thread/start',{projectId:registered.id,cwd:folder,approvalPolicy:'never',sandbox:'read-only'})).thread;
   const finished=Promise.withResolvers();
   const listener=e=>{if(e.method==='turn/completed'&&e.params.threadId===thread.id)finished.resolve();};
   const timer=setTimeout(()=>finished.reject(Error('합성 응답 지연')),15000);client.on('notification',listener);
   try{await client.request('turn/start',{threadId:thread.id,input:[{type:'text',text:label}]});await finished.promise;}finally{clearTimeout(timer);client.off('notification',listener);}
   const session=await store.createSession(p.id,{title:label});
   const local=store.session(session.id);local.threadId=thread.id;local.desktopThread={threadId:thread.id,cwd:folder,ownerHash:owner};
   local.messages=[{id:randomUUID(),createdAt:new Date().toISOString(),role:'user',text:label}];await store.save();return {thread:thread.id,session:session.id,label};
  }
  const sample=await make('합성 동기 대상'),other=await make('별도 대화');
  const entries=()=>trash.action({action:'list'});
  const has=(id,archive)=>client.request('thread/list',{archived:archive,limit:100,useStateDbOnly:true,modelProviders:[]}).then(v=>v.data.some(row=>row.id===id));
  await sweep();
  await client.request('thread/archive',{threadId:sample.thread});await sweep();
  assert(!store.peekSession(sample.session),'Codex 보관 → Flowrium 휴지통');
  assert(store.peekSession(other.session));assert((await trash.excludedThreadIds()).has(sample.thread));
  await client.request('thread/unarchive',{threadId:sample.thread});await sweep();
  assert.equal(store.session(sample.session).messages[0].text,sample.label,'Codex 보관 해제 → 동일한 Flowrium 대화');
  const preview=await trash.action({action:'preview',kind:'session',id:sample.session});assert(preview.native.available);
  const removed=await trash.action({action:'delete',token:preview.token,native:'archive'});assert(await has(sample.thread,true));
  await trash.action({action:'restore',id:removed.entry.id});assert(await has(sample.thread,false));
  await client.request('thread/delete',{threadId:sample.thread});await sweep();assert(!store.peekSession(sample.session),'Codex 영구 삭제 → 로컬 휴지통');
  const stale=(await entries()).find(e=>e.title===sample.label);await trash.action({action:'restore',id:stale.id});assert.equal(store.session(sample.session).threadId,undefined);
  const outgoing=await trash.action({action:'preview',kind:'session',id:other.session});
  await trash.action({action:'delete',token:outgoing.token,native:'delete',confirmTitle:other.label});
  assert(!await has(other.thread,false)&&!await has(other.thread,true));
  const archived=await make('휴지통에서 함께 지울 합성 원본');
  const archival=await trash.action({action:'preview',kind:'session',id:archived.session});
  const trashed=await trash.action({action:'delete',token:archival.token,native:'archive'});
  const select=await trash.action({action:'purgePreview',scope:'selected',ids:[trashed.entry.id]});
  assert.deepEqual(select.codexTargets.map(row=>row.id),[archived.thread]);
  const hard=await trash.action({action:'purge',token:select.token,acknowledged:true,confirmText:select.confirmation,deleteCodexOriginals:true});
  assert.deepEqual(hard.failed,[]);assert(!await has(archived.thread,true));
  const purge=await trash.action({action:'purgePreview',scope:'all'});
  await trash.action({action:'purge',token:purge.token,confirmText:purge.confirmation,acknowledged:true});
  const retry=new TrashRuntime(store,controller,{accountOwner:()=>'합성계정',canRun:()=>true});
  assert((await retry.excludedThreadIds()).has(other.thread),'휴지통 비우기 및 재시작 후 재가져오기 방지');
  console.log('실제 내장 Codex / 대화 보관·복원·영구 삭제 양방향 및 휴지통 비운 후 제외 통과');
  const member=await make('프로젝트 연결 유지 시험');await sweep();
  await client.request('project/delete',{projectId:registered.id});await sweep();assert(!store.state.projects.some(row=>row.id===p.id));
  assert.equal(await fs.readFile(path.join(folder,'보존.txt'),'utf8'),'프로젝트 파일 보존');
  const projectReceipt=(await entries()).find(e=>e.kind==='project');await trash.action({action:'restore',id:projectReceipt.id});
  assert(store.state.projects.some(row=>row.id===p.id));const recreated=(await client.request('project/list',{limit:100})).data.find(row=>row.roots.some(r=>r.path===folder));assert(recreated);
  assert.equal((await client.request('thread/read',{threadId:member.thread,includeTurns:false})).thread.projectId,recreated.id,'보존한 대화가 복원한 프로젝트에 속해야 함');
  await sweep();
  const connect=transfer.ready;transfer.ready=async()=>{throw Error('합성 연결 끊김');};
  const offlinePlan=await trash.action({action:'preview',kind:'project',id:p.id});assert(offlinePlan.projectLink);
  const offlineRemoval=await trash.action({action:'delete',token:offlinePlan.token,native:'keep',removeProjectRegistration:true});
  assert((await client.request('project/list',{limit:100})).data.some(row=>row.id===recreated.id));
  transfer.ready=connect;await sweep();assert(!(await client.request('project/list',{limit:100})).data.some(row=>row.id===recreated.id));
  transfer.ready=async()=>{throw Error('합성 연결 끊김');};
  await trash.action({action:'restore',id:offlineRemoval.entry.id});
  assert(store.state.projects.some(row=>row.id===p.id));transfer.ready=connect;await sweep();await sweep();
  assert((await client.request('project/list',{limit:100})).data.some(row=>row.roots.some(r=>r.path===folder)));
  const projectPlan=await trash.action({action:'preview',kind:'project',id:p.id});assert(projectPlan.projectLink);
  await trash.action({action:'delete',token:projectPlan.token,native:'keep',removeProjectRegistration:true});
  assert(!(await client.request('project/list',{limit:100})).data.some(row=>row.roots.some(r=>r.path===folder)));
  assert.equal(await fs.readFile(path.join(folder,'보존.txt'),'utf8'),'프로젝트 파일 보존');
  await client.request('project/create',{idempotencyKey:randomUUID(),name:'다시 등록한 합성 프로젝트',roots:[{path:folder}]});
  const returned=await sweep();assert(returned.projectsChanged&&returned.restoredProjectIds.includes(p.id),'Codex에서 재등록하면 Flowrium 휴지통에서 프로젝트 복원');
  assert(store.session(member.session));
  console.log('실제 내장 Codex / 오프라인 삭제·복원 재시도 / 두 방향 프로젝트 목록 등록 해제·복원 / 실제 폴더 파일 유지 통과');
 }finally{await controller?.shutdown();client.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
