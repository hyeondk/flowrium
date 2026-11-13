const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {Store}=require('../electron/store.cjs'),{Controller}=require('../electron/controller.cjs');
const {registerConversationScopes,callScopeTool,snapshot,toolDefinitions}=require('../electron/conversation-scopes.cjs');
class Client extends EventEmitter{
 constructor(){super();this.ready=true;this.options={};this.inputs=new Map();this.approvals=new Map();this.calls=[];this.number=0;}
 async start(){}
 async request(method,params){this.calls.push({method,params});if(method==='account/read')return{account:{type:'chatgpt'}};if(method==='config/read')return{config:{mcp_servers:{example:{command:'secret-command'}},plugins:{example:{enabled:true}},apps:{example:{enabled:true}}}};if(method.startsWith('thread/'))return{thread:{id:'thread-'+(++this.number)},activePermissionProfile:{id:params.permissions}};if(method==='turn/start')return{turn:{id:'turn-'+this.number}};return{};}
 answerTool(requestId,result){this.lastToolAnswer={requestId,result};}
 close(){this.ready=false;}
}
test('일반 / 통합 대화의 계정별 영속 저장과 실행 범위 격리',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-scope-test-'));let controller;
 try{
  let owner=0;const store=new Store(path.join(temp,'app'));await store.load();const apis=new Map(),client=new Client(),scoped=[];let externalCalls=0;
  controller=new Controller(store,{client,queueOwner:()=>owner,canRun:()=>true,scopeClientFactory:overrides=>{const c=new Client();c.overrides=overrides;scoped.push(c);return c;},applicationTools:()=>{externalCalls++;return[{name:'danger'}];},callApplicationTool:()=>{externalCalls++;}});
  const proposals=[];registerConversationScopes((name,fn)=>apis.set(name,fn),store,controller,{accountRevision:()=>owner,accountOwner:()=>undefined,workflowAction:async input=>{proposals.push(input);return{id:'proposal',status:'pending'};}});
  const create=apis.get('createHubConversation');
  const general=await create({scope:'general'}),integrated=await create({scope:'integrated'});
  assert.equal(store.state.projects.length,0);assert.equal(store.state.sessions.length,0);assert.equal(store.snapshot().conversationProjects.length,2);assert.equal(store.snapshot().sessions.length,2);
  const original=await fs.mkdtemp(path.join(temp,'project-'));const project=await store.addProject(original);const work=await store.createSession(project.id,{title:'진행할 업무'});
  await assert.rejects(controller.listCodexHistory(general.projectId),/프로젝트 대화/);
  await assert.rejects(controller.importCodexHistory(general.projectId,['다른 내부 기록']),/프로젝트 대화/);
  const attachments=require('../electron/chat-attachments.cjs'),[attachment]=await attachments.addAttachments(store,general.projectId,[{name:'계정별.txt',type:'text/plain',bytes:Buffer.from('계정별 첨부 원문')}]);
  const readFile=fs.readFile;
  try{fs.readFile=async(file,...args)=>{const result=await readFile(file,...args);if(String(file).endsWith(path.sep+'계정별.txt'))owner=1;return result;};await assert.rejects(attachments.resolveAttachments(store,general.projectId,[attachment.id]),/프로젝트를 찾을 수/);}
  finally{fs.readFile=readFile;owner=0;await store.syncConversationOwner();}
  assert.equal((await attachments.resolveAttachments(store,general.projectId,[attachment.id]))[0].name,'계정별.txt');
  store.session(work.id).messages.push({id:require('node:crypto').randomUUID(),role:'assistant',text:'프로젝트 현황 근거',createdAt:new Date().toISOString()});await store.save();
  const g=store.session(general.id);g.preferences={sandbox:'danger-full-access',networkAccess:true,approval:'on-request',testing:true};
  await controller.send({sessionId:g.id,text:'일반 질문',mode:'build'});
  for(let i=0;i<200&&!controller.runs.get(g.id)?.turnId;i++)await new Promise(r=>setTimeout(r,10));
  const run=controller.runs.get(g.id);assert(run?.turnId);assert.equal(externalCalls,0);assert.equal(scoped.length,1);
  client.emit('tool',{requestId:'다른 연결의 실행 도구',params:{threadId:run.threadId,turnId:run.turnId,tool:'danger',arguments:{}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(client.lastToolAnswer.result.success,false);assert.equal(externalCalls,0);
  const start=scoped[0].calls.find(c=>c.method==='thread/start').params,turn=scoped[0].calls.find(c=>c.method==='turn/start').params;
  assert.equal(start.permissions,'flowrium_hub_general');assert.equal(start.approvalPolicy,'never');assert(!start.dynamicTools);assert(!start.sandbox);assert.equal(turn.permissions,start.permissions);assert(!turn.sandboxPolicy);assert.equal(start.config.permissions[start.permissions].network.enabled,false);assert.equal(start.config.permissions[start.permissions].filesystem[':root'],'deny');assert.equal(scoped[0].overrides['features.shell_tool'],false);assert.equal(scoped[0].overrides['mcp_servers."example".enabled'],false);
  assert(!JSON.stringify(turn.input).includes('프로젝트 현황 근거'));assert(!JSON.stringify(turn.input).includes(original));
  await assert.rejects(callScopeTool(controller,run,{tool:'flowrium_hub_snapshot',arguments:{query:''}}),/일반 대화/);
  await controller.finish(run,'completed');
  const loaded=new Store(path.join(temp,'app'));await loaded.load();loaded.conversations.getOwner=()=>owner;await loaded.syncConversationOwner();assert.equal(loaded.session(g.id).threadId,g.threadId);assert.equal(loaded.session(g.id).messages[0].text,'일반 질문');
  const hub=store.session(integrated.id),hubRun={sessionId:hub.id,ownerRevision:owner};
  const value=await callScopeTool(controller,hubRun,{tool:'flowrium_hub_snapshot',arguments:{query:''}});assert(value.projects.some(p=>p.id===project.id));assert(JSON.stringify(value).includes('프로젝트 현황 근거'));assert(!JSON.stringify(value).includes(original));
  await callScopeTool(controller,hubRun,{tool:'flowrium_hub_delegate',arguments:{projectId:project.id,title:'변경 제안',text:'검증 후 구현'}});assert.equal(proposals.length,1);assert.equal(proposals[0].action,'request');assert.equal(store.state.sessions.length,1,'승인 전에 업무 대화를 만들지 않는다.');
  await assert.rejects(callScopeTool(controller,hubRun,{tool:'flowrium_chat_send',arguments:{targetId:work.id,text:'실행'}}),/허용되지/);
  await assert.rejects(callScopeTool(controller,hubRun,{tool:'flowrium_hub_delegate',arguments:{projectId:hub.projectId,title:'금지',text:'금지'}}),/등록된 프로젝트/);
  controller.options.canRun=()=>false;await assert.rejects(callScopeTool(controller,hubRun,{tool:'flowrium_hub_delegate',arguments:{projectId:project.id,title:'잠금 중 금지',text:'실행 금지'}}),/잠금/);assert.equal(proposals.length,1);controller.options.canRun=()=>true;
  owner=1;await store.syncConversationOwner();assert.equal(store.snapshot().conversationProjects.length,0);assert.equal(store.snapshot().sessions.length,1);assert.throws(()=>store.session(g.id),/찾을 수/);
  await assert.rejects(callScopeTool(controller,hubRun,{tool:'flowrium_hub_snapshot',arguments:{query:''}}),/계정/);
  const other=await create({scope:'general'});assert.notEqual(other.projectId,g.projectId);assert.notEqual(other.id,g.id);
  let emitted=false;controller.on('event',e=>{if(e.sessionId===g.id)emitted=true;});controller.emitEvent({type:'session',sessionId:g.id,session:g});assert.equal(emitted,false);
  owner=0;await store.syncConversationOwner();assert.equal(store.session(g.id).id,g.id);assert.equal(store.snapshot().sessions.length,3);await assert.rejects(store.addProject(store.project(g.projectId).path),/개인 대화 저장소/);
  await assert.rejects(store.createSession(g.projectId,{workflow:{kind:'research'}}),/프로젝트 업무/);
  assert.equal((await snapshot(controller)).projects.length,1);
  await controller.saveSettings({codexPath:path.join(temp,'다른 실행 파일')});assert.equal(scoped[0].ready,false);assert.equal(controller.scopeClients.size,0);assert.equal(controller.loadedThreads.size,0);
 }finally{await controller?.shutdown();await fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});

test('통합 현황의 검색 일치 수와 등록 전체 수를 구분하고 빈 검색어로 실제 확인 근거를 반환한다',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-hub-search-'));
 try{
  const store=new Store(path.join(temporary,'app'));await store.load();const controller={store,runs:new Map()};
  const empty=await snapshot(controller);assert.equal(empty.totalProjects,0);assert.equal(empty.matchedProjects,0);assert.equal(empty.returnedProjects,0);
  const folder=path.join(temporary,'안내 문구 프로젝트');await fs.mkdir(folder);const project=await store.addProject(folder);
  await store.createSession(project.id,{title:'안내 문구 점검',messages:[{id:require('node:crypto').randomUUID(),role:'assistant',text:'합성 안내 문구 3개를 확인했습니다.',createdAt:new Date().toISOString()}]});
  const filtered=await snapshot(controller,'안내문구점검 확인개수');assert.equal(filtered.totalProjects,1);assert.equal(filtered.matchedProjects,0);assert.equal(filtered.returnedProjects,0);assert.equal(filtered.query,'안내문구점검 확인개수');assert.deepEqual(filtered.projects,[]);assert.equal(filtered.scannedProjects,1);assert.equal(filtered.cap.projectScanReached,false);
  const all=await snapshot(controller,'  ');assert.equal(all.totalProjects,1);assert.equal(all.matchedProjects,1);assert.equal(all.returnedProjects,1);assert.equal(all.query,'');assert.equal(all.projects[0].conversations[0].recentMessages[0].text,'합성 안내 문구 3개를 확인했습니다.');assert.equal(all.limits.conversationsPerProject,15);assert.equal(all.limits.messagesPerConversation,4);assert.equal(all.truncated,false);
  const keyword=await snapshot(controller,'점검');assert.equal(keyword.totalProjects,1);assert.equal(keyword.matchedProjects,1);assert.equal(keyword.projects[0].id,project.id);
  const description=toolDefinitions.find(t=>t.name==='flowrium_hub_snapshot');assert.match(description.description,/빈 문자열/);assert.match(description.inputSchema.properties.query.description,/자연어 질문은 넣지/);
  const capped=await snapshot({store:{state:{projects:Array.from({length:101},(_,i)=>({id:String(i),name:'합성 '+i})),sessions:[]}},runs:new Map()});assert.equal(capped.totalProjects,101);assert.equal(capped.matchedProjects,100);assert.equal(capped.returnedProjects,100);assert.equal(capped.scannedProjects,100);assert.equal(capped.cap.projectScanReached,true);assert.equal(capped.truncated,true);
 }finally{await fs.rm(temporary,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});

test('통합 업무 제안은 실제 결정함 승인 뒤 프로젝트에서 실행하고 결과를 원대화에 회신한다',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-hub-workflow-'));let workflow;
 try{
  let revision=0,account='계정-가';const store=new Store(path.join(temporary,'app'));await store.load();const folder=path.join(temporary,'project');await fs.mkdir(folder);const project=await store.addProject(folder);
  class WorkController extends EventEmitter{
   constructor(){super();this.store=store;this.options={queueOwner:()=>revision,canRun:()=>true};this.runs=new Map();this.editingSessions=new Set();this.sent=[];}
   async send(input){const s=store.session(input.sessionId);s.messages.push({id:require('node:crypto').randomUUID(),role:'user',text:input.text,createdAt:new Date().toISOString()});await store.save();this.sent.push(input);this.runs.set(s.id,{sessionId:s.id});return{accepted:true};}
   async finish(id){const s=store.session(id);s.messages.push({id:require('node:crypto').randomUUID(),role:'assistant',text:'실제 프로젝트 검증 결과',createdAt:new Date().toISOString()});await store.save();this.runs.delete(id);this.emit('event',{type:'done',sessionId:id,status:'completed'});}
  }
  const controller=new WorkController(),apis=new Map();workflow=new(require('../electron/workflow.cjs').WorkflowRuntime)(store,controller,{canRun:()=>true,accountRevision:()=>revision,intervalMs:3600000});await workflow.state();
  registerConversationScopes((n,f)=>apis.set(n,f),store,controller,{accountRevision:()=>revision,accountOwner:()=>account,workflowAction:input=>workflow.action(input)});
  const integrated=await apis.get('createHubConversation')({scope:'integrated'}),run={sessionId:integrated.id,ownerRevision:revision};
  const proposed=await callScopeTool(controller,run,{tool:'flowrium_hub_delegate',arguments:{projectId:project.id,title:'프로젝트 구현',text:'명시한 범위의 변경을 구현하고 검증해 주세요.'}});
  assert.equal(proposed.status,'pending');assert.equal(controller.sent.length,0);assert.equal(store.state.sessions.length,0);
  const row=(await workflow.state()).proposals[0];await workflow.action({action:'approve',id:row.id,revision:row.revision});
  assert.equal(controller.sent.length,1);assert.equal(controller.sent[0].mode,'build');const target=store.session(controller.sent[0].sessionId);assert.equal(target.projectId,project.id);assert(!target.scope);
  await controller.finish(target.id);
  for(let i=0;i<100&&controller.sent.length<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(controller.sent.length,2);assert.equal(controller.sent[1].sessionId,integrated.id);assert.match(controller.sent[1].text,/실제 프로젝트 검증 결과/);assert.equal(controller.sent[1].mode,'plan');
  revision=1;await store.syncConversationOwner();assert.equal(store.session(integrated.id).scope,'integrated','같은 계정의 재로그인은 기존 대화를 보존한다.');
  await assert.rejects(callScopeTool(controller,run,{tool:'flowrium_hub_snapshot',arguments:{query:''}}),/계정/);
  account='계정-나';await store.syncConversationOwner();assert.throws(()=>store.session(integrated.id),/찾을 수/);account='계정-가';await store.syncConversationOwner();assert.equal(store.session(integrated.id).scope,'integrated');
 }finally{await workflow?.shutdown();await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
