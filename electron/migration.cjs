const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const F=require('./migration-files.cjs');
const {legacySnapshot,scrub}=require('./migration-legacy.cjs');
const {ProjectStore,readJSON,UUID}=require('./project-store.cjs');
const clone=v=>structuredClone(v),now=()=>new Date().toISOString();
const appFiles=new Set(['portfolio-tools.json','project-ports.json','music.json']);
const voiceIdentity=(hooks,revision)=>createHash('sha256').update(String(hooks.accountOwner?.()||'unverified:'+revision)).digest('hex').slice(0,24);
function portableVoice(record,restore=false){
 if(record?.version!==1||!Number.isSafeInteger(record.revision)||!record.servers||typeof record.servers!=='object')throw Error('음성 서버 설정 원문을 확인해 주세요.');
 const out={version:1,revision:record.revision,servers:{}};
 for(const key of ['recognition','synthesis']){const source=record.servers[key];if(!source)continue;const config=require('./voice-servers.cjs').portableConfig({...source,id:key});const names=source.environmentNames||[];if(!Array.isArray(names)||names.length>40||names.some(n=>typeof n!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n)))throw Error('음성 서버 환경변수 이름을 확인해 주세요.');out.servers[key]={...config,environmentNames:names,...(restore?{encryptedEnvironment:''}:{})};}
 return out;
}
function remap(value,ids,paths={},key=''){
 if(Array.isArray(value))return value.map(v=>remap(v,ids,paths,key));
 if(!value||typeof value!=='object'){
  if(typeof value!=='string')return value;
  if(/^(?:id|projectId|sessionId|sessionIds|session|sourceId|targetId|project|assistantId|memberSessionId|coordinatorId|reportProjects|order)$/.test(key))return ids[value]||value;
  if(/^(?:path|cwd|folder|chatCwd|command|args)$/.test(key)){for(const [old,next]of Object.entries(paths)){if(!next)continue;if(value===old)return next;if(value.startsWith(old+'/')||value.startsWith(old+'\\'))return path.join(next,...value.slice(old.length+1).split(/[\\/]/));}}
  return value;
 }
 const out={};for(const [k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('이관 문서에 예약된 키가 있습니다.');out[k]=remap(v,ids,paths,k);}return out;
}
function inactive(value){
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(inactive);
 const out={};for(const [k,v]of Object.entries(value)){if(['threadId','turnId','sourceThreadId','encryptedEnvironment'].includes(k))continue;if(k==='queuedMessages'&&Array.isArray(v)){out[k]=v.map(q=>({...q,...(['queued','sending'].includes(q.status)?{status:'cancelled',owner:'migration-archive',error:'이관한 대기 지시는 자동으로 전송하지 않습니다.'}:{})}));continue;}out[k]=inactive(v);}
 if(Object.hasOwn(out,'enabled')&&Object.hasOwn(out,'intervalMinutes'))out.enabled=false;
 if(Object.hasOwn(out,'autoStart'))out.autoStart=false;
 if(Object.hasOwn(out,'automatic'))out.automatic=false;
 if(out.status&&['pending','running','dispatching','queued','writing'].includes(out.status)){out.status='held';out.result='이관한 실행은 자동으로 재개하지 않았습니다. 원문과 결과를 확인한 뒤 새 작업을 요청해 주세요.';}
 if(out.preferences?.enabled)out.preferences.enabled=false;
 if(out.context)delete out.context;
 return out;
}
async function canonicalPaths(value,key=''){
 if(Array.isArray(value))return Promise.all(value.map(v=>canonicalPaths(v,key)));
 if(!value||typeof value!=='object'){if(typeof value==='string'&&/^(?:path|cwd|folder|chatCwd|command|args)$/.test(key)&&path.isAbsolute(value))return fs.realpath(value).catch(()=>value);return value;}
 const out={};for(const [k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('이관 설정에 예약된 키가 있습니다.');out[k]=await canonicalPaths(v,k);}return out;
}
function restoredWorkflow(record){
 const out=clone(record);out.preferences={...out.preferences,enabled:false};
 for(const p of out.proposals||[])if(['pending','running'].includes(p.status)){p.status='held';p.result='이관한 요청입니다. 내용을 확인한 뒤 새로 요청해 주세요.';}
 for(const d of out.deliveries||[])if(['queued','dispatching'].includes(d.status)){d.status='held';d.error='이관한 전달은 자동으로 보내지 않았습니다.';}
 for(const r of out.reports||[])if(['queued','writing'].includes(r.status)){r.status='failed';r.error='이관한 보고는 자동으로 작성하지 않았습니다.';}
 for(const r of out.recommendations||[])if(['queued','running'].includes(r.status)){r.status='failed';r.error='이관한 추천은 자동으로 실행하지 않았습니다.';}
 for(const r of out.reminders||[]){r.cancelled=true;r.cancelledAt=now();}
 return out;
}
async function optional(file){try{return await F.bytes(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function slug(value){return value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,70)||'프로젝트';}
async function nativeSnapshot(store,options={},hooks={}){
 await store.queue;await store.syncConversationOwner();
 const selected=options.projectIds?new Set(options.projectIds):null,projects=[],entries=[],excluded=[],warnings=[];
 const all=[...store.state.projects,...(options.includePrivate!==false?store.conversations.projects():[])];
 for(const p of all){if(selected&&!selected.has(p.id)&&!p.conversationScope)continue;const key='p-'+p.id,scope=p.conversationScope||'project';
  const files=await F.walk(p.path,{filter:(rel,ent)=>F.fileFilter(rel,ent)&&(options.includeFiles||rel==='.flowrium'||rel.startsWith('.flowrium/')),excluded,prefix:p.name+'/'});
  projects.push({key,id:p.id,name:p.name,scope,createdAt:p.createdAt,folderHint:p.path});entries.push(...files.map(e=>({...e,group:key})));
 }
 const base=path.dirname(store.file),revision=hooks.accountRevision?.()??0;
 if(options.includeSettings!==false){
  for(const file of appFiles){const data=await optional(path.join(base,file));if(data)entries.push({group:'app',...F.objectEntry(file,JSON.stringify(scrub(JSON.parse(data.toString()),excluded,file),null,2))});}
  const workflow=await optional(path.join(base,`workflow-${revision}.json`));if(workflow)entries.push({group:'app',...F.objectEntry('workflow.json',JSON.stringify(scrub(JSON.parse(workflow.toString()),excluded,'workflow'),null,2))});
  if(hooks.readDrafts)entries.push({group:'app',...F.objectEntry('drafts.json',await hooks.readDrafts(revision))});
  const voice=await optional(path.join(base,`voice-servers-${voiceIdentity(hooks,revision)}.json`));if(voice){const raw=JSON.parse(voice.toString());entries.push({group:'app',...F.objectEntry('voice-servers.json',portableVoice(raw))});for(const [id,s]of Object.entries(raw.servers||{}))if(s.encryptedEnvironment)excluded.push('음성서버/'+id+'/encryptedEnvironment');warnings.push('음성 서버 환경변수 값은 이관하지 않습니다. 새 기기에서 다시 입력해 주세요.');}
  const vp=await optional(path.join(base,`voice-${revision}.json`));if(vp)entries.push({group:'app',...F.objectEntry('voice-preferences.json',JSON.stringify(scrub(JSON.parse(vp.toString()),excluded,'음성설정'),null,2))});
 }
 try{const memories=await F.walk(path.join(base,'personal-memory'),{filter:F.fileFilter,excluded,prefix:'기억/'});entries.push(...memories.map(e=>({...e,path:'personal-memory/'+e.path,group:'app'})));}catch(e){if(e.code!=='ENOENT')throw e;}
 const settings={...store.state.settings};delete settings.codexPath;
 return{format:'flowrium-transfer',version:1,id:randomUUID(),createdAt:now(),sourceKind:'flowrium',projects,entries,settings:options.includeSettings!==false?settings:{},excluded,warnings};
}
class Migration {
 constructor(store,options={}){this.store=store;this.options=options;this.base=path.dirname(store.file);this.directory=path.join(this.base,'migration-records');this.plans=new Map();this.roots={};this.busy=false;this.restartRequired=false;}
 account(){return this.options.accountRevision?.()??0;}
 ready(){if(this.options.canRun?.()===false)throw Error('잠금을 해제하고 계정 연결을 확인한 뒤 이관해 주세요.');if(this.busy||this.options.isBusy?.())throw Error('실행 중인 작업을 마친 뒤 이관해 주세요.');if(this.restartRequired)throw Error('이관 후 앱을 다시 시작해야 합니다.');}
 async choose(kind){const result=await this.options.chooseDirectory?.(kind);if(!result)return null;return F.directory(result);}
 summarize(plan){const m=plan.snapshot;return{id:plan.id,kind:plan.kind,sourceKind:m.sourceKind,createdAt:m.createdAt,projects:m.projects.map(p=>({...p,target:plan.targets[p.key]||'',conflict:this.store.state.projects.some(x=>x.id===p.id)})),files:m.entries.length,bytes:m.entries.reduce((n,e)=>n+e.size,0),excluded:m.excluded||[],warnings:m.warnings||[],hasSettings:!!m.entries.some(e=>e.group==='app')||!!Object.keys(m.settings||{}).length};}
 plan(snapshot,kind){F.validateManifest(F.publicManifest(snapshot));const p={id:randomUUID(),kind,snapshot,account:this.account(),at:Date.now(),targets:{}};this.plans.set(p.id,p);while(this.plans.size>5)this.plans.delete(this.plans.keys().next().value);return this.summarize(p);}
 get(id){const p=this.plans.get(id);if(!p||Date.now()-p.at>3600000||p.account!==this.account())throw Error('이관 미리보기 시간이 지났거나 계정이 바뀌었습니다. 다시 확인해 주세요.');return p;}
 async action(input){
  if(input?.action==='restart'){if(!this.restartRequired)throw Error('재시작할 이관 작업이 없습니다.');return this.options.onRestart?.();}
  if(input?.action==='receipts')return this.receipts();
  if(input?.action==='inspectReceipt')return this.inspect(input.id);
  if(input?.action==='readOriginal')return this.original(input.id,input.index);
  if(input?.action==='status')return{restartRequired:this.restartRequired,projects:this.store.state.projects.map(({id,name,path})=>({id,name,path})),source:this.roots.source||'',workspace:this.roots.workspace||'',memory:this.roots.memory||''};
  this.ready();
  if(input?.action==='chooseSource'||input?.action==='chooseWorkspace'||input?.action==='chooseMemory'){const key={chooseSource:'source',chooseWorkspace:'workspace',chooseMemory:'memory'}[input.action],folder=await this.choose(key);if(folder)this.roots[key]=folder;return{[key]:folder};}
  if(input?.action==='previewExport')return this.plan(await nativeSnapshot(this.store,input,this.options),'export');
  if(input?.action==='previewImport'){
   const source=this.roots.source||await this.choose('source');if(!source)return null;this.roots.source=source;
   let snapshot;if(await optional(path.join(source,'manifest.json')))snapshot=await F.readBundle(source);else snapshot=await legacySnapshot(source,{workspace:this.roots.workspace,memory:this.roots.memory,includeFiles:!!input.includeFiles});
   for(const e of snapshot.entries)await F.content(e);await this.checkPorts(snapshot,snapshot.projects);return this.plan(snapshot,'import');
  }
  if(input?.action==='target'){
   const p=this.get(input.id),parent=await this.choose('target');if(!parent)return this.summarize(p);
   for(const project of p.snapshot.projects.filter(x=>x.scope==='project'&&(!input.key||x.key===input.key))){let target=path.join(parent,slug(project.name));let n=1;while(Object.entries(p.targets).some(([key,v])=>key!==project.key&&v.toLowerCase()===target.toLowerCase())||await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))target=path.join(parent,slug(project.name)+'-'+(++n));p.targets[project.key]=target;}
   return this.summarize(p);
  }
  if(input?.action==='export'){const p=this.get(input.id);if(p.kind!=='export')throw Error('내보내기 계획을 확인해 주세요.');const parent=await this.choose('export');if(!parent)return null;return{path:await F.writeBundle(p.snapshot,parent)};}
  if(input?.action==='applyImport'){const p=this.get(input.id);if(p.kind!=='import')throw Error('가져오기 계획을 확인해 주세요.');return this.apply(p,input);}
  throw Error('지원하는 이관 요청을 선택해 주세요.');
 }
 async receipts(){try{const dirs=await fs.readdir(this.directory),out=[];for(const id of dirs.filter(x=>UUID.test(x))){try{const receipt=await readJSON(path.join(this.directory,id,'receipt.json'));out.push(receipt);}catch(e){if(e.code!=='ENOENT')throw e;}}return out.sort((a,b)=>b.at.localeCompare(a.at));}catch(e){if(e.code==='ENOENT')return[];throw e;}}
 async inspect(id){if(!UUID.test(id))throw Error('이관 기록을 확인해 주세요.');const root=path.join(this.directory,id),receipt=await readJSON(path.join(root,'receipt.json'));let manifest;try{manifest=await readJSON(path.join(root,'source','manifest.json'));}catch(e){if(e.code!=='ENOENT')throw e;return{...receipt,files:[],excluded:[],warnings:['원문 보관 묶음을 생성하기 전에 중단되었습니다. 원본 자료는 변경하지 않았습니다.']};}return{...receipt,files:manifest.files.map((e,index)=>({index,group:e.group,path:e.path,size:e.size,sha256:e.sha256})),excluded:manifest.excluded||[],warnings:[...(receipt.warnings||[]),...(manifest.warnings||[])].filter((v,i,all)=>all.indexOf(v)===i)};}
 async original(id,index){const view=await this.inspect(id);if(!Number.isSafeInteger(index)||index<0||index>=view.files.length)throw Error('원문 파일을 선택해 주세요.');const file=view.files[index];if(file.size>2*1024*1024)return{path:file.path,text:'큰 파일은 이관 보관 폴더에 원본 바이트로 보존되어 있습니다.',binary:true};const data=await F.bytes(path.join(this.directory,id,'source','objects',file.sha256));if(F.digest(data)!==file.sha256)throw Error('보관 원문의 검증값이 다릅니다.');const text=data.toString('utf8');return{path:file.path,text:/\x00/.test(text)?'바이너리 원본은 이관 보관 폴더에 보존되어 있습니다.':text,binary:/\x00/.test(text)};}
 async apply(plan,input){
  const snapshot=plan.snapshot,keys=new Set(input.projectKeys||snapshot.projects.map(p=>p.key));if([...keys].some(k=>!snapshot.projects.some(p=>p.key===k)))throw Error('가져올 프로젝트를 확인해 주세요.');
  if(!['copy','skip'].includes(input.conflict||'copy'))throw Error('충돌 처리 방법을 확인해 주세요.');
  const selected=snapshot.projects.filter(p=>keys.has(p.key)&&!((input.conflict==='skip')&&this.store.state.projects.some(x=>x.id===p.id)));
  for(const p of selected.filter(p=>p.scope==='project'))if(plan.targets[p.key]){const target=plan.targets[p.key];if(!path.isAbsolute(target))throw Error('이관 대상은 절대 경로여야 합니다.');plan.targets[p.key]=path.join(await F.directory(path.dirname(target)),path.basename(target));}
  const fingerprintManifest=F.publicManifest(snapshot);delete fingerprintManifest.warnings;
  const fingerprint=F.digest(JSON.stringify({source:fingerprintManifest,keys:[...keys].sort(),settings:!!input.includeSettings,targets:plan.targets,policy:input.conflict||'copy'}));
  const previous=(await this.receipts()).find(r=>r.fingerprint===fingerprint&&r.status==='completed');if(previous)return{...previous,duplicate:true,restartRequired:this.restartRequired};
  if(!selected.length&&!input.includeSettings)throw Error('가져올 프로젝트 또는 앱 설정을 선택해 주세요.');
  for(const p of selected.filter(p=>p.scope==='project')){const target=plan.targets[p.key];if(!target)throw Error(p.name+' / 대상 작업 폴더를 선택해 주세요.');await F.directory(path.dirname(target));if(await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw Error(p.name+' / 대상 폴더가 이미 있습니다. 새 대상 위치를 선택해 주세요.');for(const source of snapshot.projects){if(source.folderHint&&path.isAbsolute(source.folderHint)){const rel=path.relative(source.folderHint,target);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('원본 프로젝트 내부를 이관 대상으로 사용할 수 없습니다.');}}}
  // 모든 원본의 검증을 종료한 뒤에만 실행 런타임을 중지합니다.
  await F.verifySnapshot(snapshot);
  const id=randomUUID(),root=path.join(this.directory,id),stage=path.join(root,'stage'),backup=path.join(root,'backup');
  await fs.mkdir(stage,{recursive:true,mode:0o700});await fs.mkdir(backup,{mode:0o700});this.busy=true;
  let stopped=false;const mutations=[],staged=[],ids={},paths={},registryOld=await optional(this.store.file);
  try{
   // 원문 묶음은 변환 전 상태로 보관합니다. 원본은 읽기만 합니다.
   const bundle=await F.writeBundle(snapshot,root);await fs.rename(bundle,path.join(root,'source'));
   const registry=registryOld?JSON.parse(registryOld.toString()):{version:2,projects:clone(this.store.state.projects),settings:clone(this.store.state.settings),localThreads:{}};
   const used=new Set((this.store.visibleSessions?.()||this.store.state.sessions).map(s=>s.id)),sessionProjects=new Map(),portPlan=await this.checkPorts(snapshot,selected);
   for(const p of selected){ids[p.id]=p.scope==='project'?randomUUID():require('./conversation-store.cjs').identity(this.store.conversations.owner(),p.scope);if(p.folderHint)paths[p.folderHint]=plan.targets[p.key];}
   for(const p of selected)for(const e of snapshot.entries.filter(e=>e.group===p.key&&/^\.flowrium\/sessions\/.+\.json$/.test(e.path))){const record=JSON.parse((await F.content(e)).toString());if(!UUID.test(record.sessionId)||sessionProjects.has(record.sessionId)&&sessionProjects.get(record.sessionId)!==p.key)throw Error('이관 대화의 식별자가 다른 프로젝트와 충돌합니다.');sessionProjects.set(record.sessionId,p.key);if(!ids[record.sessionId]){let value=randomUUID();while(used.has(value))value=randomUUID();ids[record.sessionId]=value;used.add(value);}}
   for(const p of selected){
    const destination=p.scope==='project'?plan.targets[p.key]:await this.privateTarget(p.scope),folder=p.scope==='project'?path.join(path.dirname(destination),'.flowrium-transfer-'+id+'-'+p.key):path.join(stage,p.key);
    staged.push({key:p.key,source:p,folder,destination,existing:false});
    await fs.writeFile(path.join(root,'preparation.json'),JSON.stringify({version:1,id,staged:staged.map(({key,folder,destination})=>({key,folder,destination}))}),{mode:0o600});await fs.mkdir(folder,{mode:0o700});
    const existing=p.scope!=='project'&&await fs.lstat(destination).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(existing){await F.directory(destination);const files=await F.walk(destination);staged[staged.length-1].existingChecks=files;for(const e of files)await F.writeEntry(folder,e.path,await F.content(e));}
    const sourceFiles=snapshot.entries.filter(e=>e.group===p.key);
    for(const e of sourceFiles){let relative=e.path,data=await F.content(e);
     if(relative.endsWith('.json')&&relative.startsWith('.flowrium/')){
      let record=remap(JSON.parse(data.toString()),ids,paths);
      if(relative==='.flowrium/project.json'){record.id=ids[p.id];if(existing)continue;}
      if(relative.startsWith('.flowrium/sessions/')){relative='.flowrium/sessions/'+record.sessionId+'--'+record.revision+'.json';if(record.session)record.session=inactive(record.session);}
      if(record.session&&p.scope!=='project'){record.session.scope=p.scope;delete record.session.workflow;delete record.session.personalAssistant;}
      data=Buffer.from(JSON.stringify(record,null,2));
     }
     const exists=await optional(path.join(folder,...relative.split('/')));if(exists){if(F.digest(exists)===F.digest(data))continue;throw Error(p.name+' / 가져올 첨부 또는 기록이 대상 파일과 충돌합니다. 원본을 보존했습니다.');}
     await F.writeEntry(folder,relative,data);
    }
    if(portPlan[p.key]?.disabled){const head=portPlan[p.key].head,record={version:1,previous:head.revision,data:{...head,projectId:ids[p.id],revision:randomUUID(),enabled:false,number:null,ports:null,updatedAt:now()}};await F.writeEntry(folder,'.flowrium/ports/'+head.revision+'.json',JSON.stringify(record,null,2));}
    const directed=new Map();for(const e of sourceFiles.filter(e=>/^\.flowrium\/teams\/directed\/[0-9a-f-]{36}\/\d{8}\.json$/i.test(e.path))){const parent=path.posix.dirname(e.path),prior=directed.get(parent);if(!prior||e.path>prior.path)directed.set(parent,e);}
    for(const [parent,e]of directed){const record=remap(JSON.parse((await F.content(e)).toString()),ids,paths),d=record.directed;if(!d||!Number.isInteger(d.revision)||d.revision<1||d.revision>=100000)throw Error('팀 실행 개정 기록을 확인해 주세요.');if(!['done','stopped'].includes(d.phase)){d.resumePhase=d.phase;d.phase='paused';}for(const key of ['autoDispatch','autoPM','autoQA','autoIntegrate'])if(Object.hasOwn(d,key))d[key]=false;for(const n of [d.lead,...d.nodes].filter(Boolean))if(n.status==='running'){n.status='interrupted';n.summary='이관한 실행은 자동으로 재개하지 않았습니다.';}d.revision++;await F.writeEntry(folder,parent+'/'+String(d.revision).padStart(8,'0')+'.json',JSON.stringify(record,null,2));}
    const repository=await ProjectStore.open(folder,ids[p.id]);if(repository.id!==ids[p.id])throw Error('이관 프로젝트 식별자 변환에 실패했습니다.');
    {const canonical=await fs.realpath(folder),temporaryProject={id:ids[p.id],path:canonical},temporaryStore={file:path.join(stage,'validation-registry.json'),project:()=>temporaryProject};for(const session of repository.saved.values())for(const message of session.messages)if(message.attachments?.length)await require('./chat-attachments.cjs').resolveAttachments(temporaryStore,ids[p.id],message.attachments.map(a=>a.id));await require('./memory.cjs').listMemory(temporaryStore,ids[p.id]);}
    if(sourceFiles.some(e=>e.path.startsWith('.flowrium/ports/'))){const canonical=await fs.realpath(folder);await require('./project-ports.cjs').readAssignment({file:this.store.file,state:{projects:[{id:ids[p.id],path:canonical}]}},ids[p.id]);}
    try{const canonical=await fs.realpath(folder);await require('./project-details.cjs').readDetails({project:()=>({id:ids[p.id],path:canonical})},ids[p.id]);}catch(e){if(e.code!=='ENOENT')throw e;}
    staged[staged.length-1].existing=!!existing;
    if(p.scope==='project')registry.projects.push({id:ids[p.id],name:p.name,path:destination,createdAt:p.createdAt||now()});
   }
   const globals=[];
   if(input.includeSettings){
    const portableSettings={...snapshot.settings};delete portableSettings.codexPath;registry.settings=require('./store.cjs').settings(portableSettings,registry.settings);
    for(const e of snapshot.entries.filter(e=>e.group==='app')){
     let relative=e.path,data=await F.content(e),record;try{record=JSON.parse(data.toString());}catch{throw Error('앱 설정 원문의 형식을 확인해 주세요.');}
     record=remap(await canonicalPaths(record),ids,paths);
     if(relative==='workflow.json'){relative=`workflow-${plan.account}.json`;record=restoredWorkflow(record);record.revision=(Number.isInteger(record.revision)?record.revision:0)+1;}
     else if(relative==='drafts.json'){relative='composer-drafts/'+String(plan.account)+'.json';const drafts={};for(const [key,value]of Object.entries(record)){const [type,old]=key.split(':');drafts[type+':'+(ids[old]||old)]=value;}record={version:1,revision:plan.account,drafts};}
     else if(relative==='voice-servers.json'){relative=`voice-servers-${voiceIdentity(this.options,plan.account)}.json`;record=portableVoice(record,true);}
     else if(relative==='voice-preferences.json')relative=`voice-${plan.account}.json`;
     else if(relative.startsWith('personal-memory/')){if(!/^personal-memory\/[0-9a-f-]+\/(?:first|[0-9a-f-]+)\.json$/i.test(relative))throw Error('개인 기억 경로를 확인해 주세요.');const old=record.id,newId=ids[old]||(ids[old]=randomUUID());record.id=newId;relative=relative.replace('/'+old+'/', '/'+newId+'/');}
     else if(!appFiles.has(relative))throw Error('지원하지 않는 앱 설정 파일입니다.');
     globals.push({relative,data:Buffer.from(JSON.stringify(record,null,2))});
    }
   }
   await this.validateGlobals(globals,stage,staged,plan.account);
   if(plan.account!==this.account())throw Error('이관 중 계정이 바뀌었습니다. 원본을 보존했습니다.');
   if(this.options.beforeApply){stopped=true;await this.options.beforeApply();}
   if(plan.account!==this.account())throw Error('이관 중 계정이 바뀌었습니다.');
   const latestRegistry=await optional(this.store.file);if((latestRegistry&&F.digest(latestRegistry))!==(registryOld&&F.digest(registryOld)))throw Error('미리보기 이후 대상 앱의 프로젝트나 설정이 바뀌었습니다. 원본을 보존했습니다.');
   for(const p of staged.filter(p=>p.existing)){const latest=await F.walk(p.destination),before=p.existingChecks;if(JSON.stringify(latest.map(e=>[e.path,e.sha256]))!==JSON.stringify(before.map(e=>[e.path,e.sha256])))throw Error('대상 계정의 대화가 이관 도중 바뀌었습니다. 원본을 보존했습니다.');}
   // 적용 전 백업을 먼저 완료합니다. 실패하면 역순으로 되돌립니다.
   if(registryOld)await fs.writeFile(path.join(backup,'workspace-v2.json'),registryOld,{flag:'wx',mode:0o600});
   for(const g of globals){const old=await optional(path.join(this.base,...g.relative.split('/')));if(old)await F.writeEntry(backup,g.relative,old);g.old=old;}
   await fs.writeFile(path.join(root,'transaction.json'),JSON.stringify({version:1,id,at:now(),status:'prepared',registryExisted:!!registryOld,registrySha256:F.digest(JSON.stringify(registry,null,2)),staged:staged.map(({key,folder,destination,existing,source})=>({key,folder,destination,existing,targetId:ids[source.id]})),globals:globals.map(g=>({relative:g.relative,existed:!!g.old,sha256:F.digest(g.data)}))},null,2),{flag:'wx',mode:0o600});
   for(const p of staged){await fs.mkdir(path.dirname(p.destination),{recursive:true,mode:0o700});if(p.existing){const old=path.join(backup,p.key);await fs.rename(p.destination,old);mutations.push({kind:'project',target:p.destination,old});}else mutations.push({kind:'project',target:p.destination});await fs.rename(p.folder,p.destination);await this.options.afterMutation?.(mutations.length);}
   for(const g of globals){const target=path.join(this.base,...g.relative.split('/'));await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});mutations.push({kind:'file',target,old:g.old});const tmp=target+'.'+id+'.tmp';try{await fs.writeFile(tmp,g.data,{flag:'wx',mode:0o600});await fs.rename(tmp,target);}finally{await fs.rm(tmp,{force:true});}await this.options.afterMutation?.(mutations.length);}
   mutations.push({kind:'file',target:this.store.file,old:registryOld});const tmp=this.store.file+'.'+id+'.tmp';try{await fs.writeFile(tmp,JSON.stringify(registry,null,2),{flag:'wx',mode:0o600});await fs.rename(tmp,this.store.file);}finally{await fs.rm(tmp,{force:true});}
   const receipt={id,at:now(),fingerprint,status:'completed',sourceKind:snapshot.sourceKind,projects:staged.map(p=>({name:p.source.name,id:ids[p.source.id],path:p.destination,scope:p.source.scope})),files:snapshot.entries.length,excluded:snapshot.excluded||[],warnings:[...(snapshot.warnings||[]),'기록을 보존했습니다. 이전 엔진의 실행 문맥과 인증은 새로 연결해야 합니다.'],restartRequired:true,path:root};
   await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});this.restartRequired=true;await fs.rm(stage,{recursive:true,force:true});await this.options.onImported?.(receipt);return receipt;
  }catch(error){
   const failures=[];for(const change of mutations.reverse())try{if(change.kind==='project'){await fs.rm(change.target,{recursive:true,force:true});if(change.old)await fs.rename(change.old,change.target);}else if(change.old){await fs.writeFile(change.target,change.old,{mode:0o600});}else await fs.rm(change.target,{force:true});}catch(e){failures.push(e.message);}
   const receipt={id,at:now(),fingerprint,status:failures.length?'recovery-required':'rolled-back',error:String(error.message),rollbackErrors:failures,restartRequired:stopped,path:root,projects:[]};await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600}).catch(()=>{});await fs.rm(stage,{recursive:true,force:true});
   if(stopped){this.restartRequired=true;await this.options.onImported?.(receipt);}
   throw Error(error.message+(failures.length?' / 복구를 마치지 못한 파일이 있습니다. 이관 결과와 백업을 확인해 주세요.':' / 적용한 변경을 되돌렸습니다.')+(stopped?' 앱을 다시 시작해 주세요.':''));
  }finally{for(const p of staged)await fs.rm(p.folder,{recursive:true,force:true}).catch(()=>{});this.busy=false;}
 }
 async privateTarget(scope){const owner=this.store.conversations.owner(),base=await this.store.conversations.base(),key=createHash('sha256').update(owner).digest('hex').slice(0,32);return path.join(base,key,scope);}
 async validateGlobals(globals,stage,projects,account){
  if(!globals.length)return;const directory=path.join(stage,'app-validation');await fs.mkdir(directory,{mode:0o700});for(const g of globals)await F.writeEntry(directory,g.relative,g.data);
  let project;if(projects.length)project={id:projects[0].source.id,path:await fs.realpath(projects[0].folder)};
  // 검증용 프로젝트는 실제 등록하거나 사용자 작업 폴더에 적용하지 않습니다.
  if(!project){const folder=path.join(directory,'validation-project');await fs.mkdir(folder);const repo=await ProjectStore.open(folder);project={id:repo.id,path:await fs.realpath(folder)};}else project.id=(await readJSON(path.join(project.path,'.flowrium','project.json'))).id;
  const temporaryStore={file:path.join(directory,'workspace-v2.json'),state:{projects:[],sessions:[]},project:()=>project};await require('./memory.cjs').listMemory(temporaryStore,project.id);
  if(globals.some(g=>g.relative.startsWith('composer-drafts/'))){const drafts=new(require('./drafts.cjs').Drafts)(directory,{accountRevision:account,locked:false,loggingOut:false},{});drafts.known=true;await drafts.read(account);}
  if(globals.some(g=>g.relative==='music.json')){const handlers=new Map(),music=require('./music.cjs').registerMusic((name,fn)=>handlers.set(name,fn),directory);try{await handlers.get('musicState')();}finally{await music.shutdown();}}
  if(globals.some(g=>g.relative===`workflow-${account}.json`)){const controller=new(require('node:events').EventEmitter)();controller.runs=new Map();const workflow=new(require('./workflow.cjs').WorkflowRuntime)(temporaryStore,controller,{accountRevision:()=>account,canRun:()=>false});try{await workflow.load();}finally{await workflow.shutdown();}}
  const reservations=globals.find(g=>g.relative==='project-ports.json');if(reservations){const value=JSON.parse(reservations.data.toString());if(value.version!==1||value.revision!==null&&!UUID.test(value.revision)||!Array.isArray(value.reserved)||value.reserved.length>4096||new Set(value.reserved).size!==value.reserved.length||value.reserved.some(n=>!Number.isInteger(n)||n<1024||n>65535))throw Error('예약 포트 설정 원문을 확인해 주세요.');}
 }
 async checkPorts(snapshot,projects){
  const result={},seen=[];snapshot.warnings||=[];
  const warn=value=>{if(!snapshot.warnings.includes(value))snapshot.warnings.push(value);};
  for(const p of projects.filter(p=>p.scope==='project')){
   const records=new Map();for(const e of snapshot.entries.filter(e=>e.group===p.key&&e.path.startsWith('.flowrium/ports/')&&e.path.endsWith('.json'))){const record=JSON.parse((await F.content(e)).toString()),key=path.basename(e.path,'.json');if(record.version!==1||record.previous!==(key==='first'?null:key)||key!=='first'&&!UUID.test(key)||records.has(key))throw Error('프로젝트 포트 개정 기록을 확인해 주세요.');require('./project-ports.cjs').validateAssignment(record.data,p.id);records.set(key,record.data);}
   if(!records.size)continue;let head=null,count=0;while(records.has(head?.revision||'first')&&count<=records.size){head=records.get(head?.revision||'first');count++;}if(count!==records.size)throw Error('프로젝트 포트 개정 기록이 갈라져 원본을 보존했습니다.');if(!head.enabled)continue;
   const check=await require('./project-ports.cjs').inspectProjectPorts(this.store,{projectId:randomUUID(),number:head.number,ports:head.ports});
   const internal=seen.some(x=>x.number===head.number||Object.values(x.ports).some(port=>Object.values(head.ports).includes(port))),disabled=check.conflicts.length>0||internal;
   result[p.key]={head,disabled};if(disabled)warn(p.name+' / 프로젝트 번호 또는 포트가 이미 사용 중이어서 새 배정은 비활성화합니다. 원래 번호와 개정은 보존 원문에서 확인할 수 있습니다.');else seen.push(head);
   if(check.checks.some(c=>c.status==='listening'||c.status==='unavailable'))warn(p.name+' / 현재 기기에서 포트가 사용 중이거나 확인되지 않았습니다. 서비스를 시작하기 전에 포트표를 확인해 주세요.');
  }
  return result;
 }
}
async function recoverMigrations(directory){
 let base;try{base=await F.directory(directory);}catch(e){if(e.code==='ENOENT')return[];throw e;}const records=path.join(base,'migration-records'),results=[];
 let folders;try{folders=await fs.readdir(records);}catch(e){if(e.code==='ENOENT')return[];throw e;}
 for(const id of folders.filter(x=>UUID.test(x))){
  const root=path.join(records,id),prior=await optional(path.join(root,'receipt.json'));if(prior){const receipt=JSON.parse(prior.toString());if(receipt.status==='recovery-required')results.push(receipt);continue;}
  const data=await optional(path.join(root,'transaction.json'));if(!data){const preparing=await optional(path.join(root,'preparation.json'));if(!preparing)continue;const state=JSON.parse(preparing.toString()),errors=[];if(state.version!==1||state.id!==id||!Array.isArray(state.staged))throw Error('이관 준비 복구 기록을 확인해 주세요.');for(const p of state.staged)try{if(!/^[a-z0-9_-]{1,100}$/i.test(p.key))throw Error('이관 준비 경로를 확인해 주세요.');const parent=await fs.realpath(path.dirname(p.folder)),folder=path.join(parent,path.basename(p.folder)),ownStage=path.join(root,'stage',p.key);if(folder!==ownStage&&!(path.basename(folder)==='.flowrium-transfer-'+id+'-'+p.key&&path.dirname(folder)===path.dirname(p.destination)))throw Error('이관 임시 경로가 올바르지 않습니다.');await fs.rm(folder,{recursive:true,force:true});}catch(e){if(e.code!=='ENOENT')errors.push(e.message);}const receipt={id,at:now(),status:errors.length?'recovery-required':'rolled-back',error:'자료 준비 중 앱이 종료되어 임시 사본을 정리했습니다. 원본과 대상은 변경하지 않았습니다.',rollbackErrors:errors,projects:[],restartRequired:false,path:root};await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});results.push(receipt);continue;}
  const transaction=JSON.parse(data.toString()),errors=[];
  if(transaction.version!==1||transaction.id!==id||!Array.isArray(transaction.staged)||!Array.isArray(transaction.globals))throw Error('중단된 이관의 복구 기록을 확인해 주세요.');
  for(const p of [...transaction.staged].reverse())try{
   if(!/^[a-z0-9_-]{1,100}$/i.test(p.key)||!UUID.test(p.targetId)||!path.isAbsolute(p.destination)||!path.isAbsolute(p.folder))throw Error('이관 복구 경로가 올바르지 않습니다.');
   const parent=await fs.realpath(path.dirname(p.folder)),folder=path.join(parent,path.basename(p.folder)),stageName=path.basename(folder);if(!(folder===path.join(root,'stage',p.key)||stageName==='.flowrium-transfer-'+id+'-'+p.key&&path.dirname(folder)===path.dirname(p.destination)))throw Error('이관 임시 경로가 올바르지 않습니다.');
   const old=path.join(root,'backup',p.key),backup=await fs.lstat(old).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
   if(p.existing&&backup){await F.directory(old);await fs.rm(p.destination,{recursive:true,force:true});await fs.rename(old,p.destination);}
   else if(!p.existing){const metadata=await optional(path.join(p.destination,'.flowrium','project.json'));if(metadata){if(JSON.parse(metadata.toString()).id!==p.targetId)throw Error('대상 프로젝트가 이관 이후 바뀌어 자동으로 되돌리지 않았습니다.');await fs.rm(p.destination,{recursive:true,force:true});}}
   await fs.rm(p.folder,{recursive:true,force:true});
  }catch(e){errors.push(e.message);}
  for(const g of transaction.globals)try{
   F.safe(g.relative);if(!(appFiles.has(g.relative)||/^personal-memory\/[0-9a-f-]+\/(?:first|[0-9a-f-]+)\.json$/i.test(g.relative)||/^(?:workflow-\d+|voice-\d+|voice-servers-[a-f0-9]{24})\.json$/.test(g.relative)||/^composer-drafts\/\d+\.json$/.test(g.relative)))throw Error('앱 설정 복구 경로가 올바르지 않습니다.');
   const target=path.join(base,...g.relative.split('/')),old=await optional(path.join(root,'backup',...g.relative.split('/')));if(g.existed){if(!old)throw Error('설정 백업이 없어 원본을 보존했습니다.');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,old,{mode:0o600});}else{const current=await optional(target);if(current&&F.digest(current)===g.sha256)await fs.rm(target,{force:true});else if(current)throw Error('대상 설정이 이관 이후 바뀌어 원본을 보존했습니다.');}
  }catch(e){errors.push(e.message);}
  try{const target=path.join(base,'workspace-v2.json'),old=await optional(path.join(root,'backup','workspace-v2.json'));if(transaction.registryExisted){if(!old)throw Error('프로젝트 등록 정보의 백업이 없습니다.');await fs.writeFile(target,old,{mode:0o600});}else{const current=await optional(target);if(current&&F.digest(current)===transaction.registrySha256)await fs.rm(target,{force:true});else if(current)throw Error('등록 정보가 이관 이후 바뀌어 원본을 보존했습니다.');}}catch(e){errors.push(e.message);}
  const receipt={id,at:now(),status:errors.length?'recovery-required':'rolled-back',error:'앱이 종료되어 중단된 이관을 확인했습니다.',rollbackErrors:errors,projects:[],restartRequired:false,path:root};await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});results.push(receipt);
 }
 return results;
}
function registerMigration(register,store,options){const runtime=new Migration(store,options);register('migrationAction',input=>runtime.action(input));return runtime;}
module.exports={Migration,registerMigration,recoverMigrations,nativeSnapshot,remap,inactive};
