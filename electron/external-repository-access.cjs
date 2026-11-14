const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {UUID,readJSON}=require('./project-store.cjs'),{samePath}=require('./path-boundary.cjs');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),execute=promisify(execFile);
const unavailable=(access,message)=>Object.assign(Error(message),{code:'EXTERNAL_REPOSITORY_ACCESS',access});
function validId(value){if(typeof value!=='string'||!UUID.test(value))throw Error('프로젝트와 저장소 식별자를 확인해 주세요.');return value;}
class ExternalRepositoryAccess {
 constructor(store,options){this.store=store;this.options=options;this.file=path.join(options.directory,'external-repository-access.json');this.tail=Promise.resolve();this.closed=false;store.externalRepositoryAccess=this;}
 owner(){const owner=this.options.accountOwner?.()||'',revision=this.options.accountRevision?.()??0;if(typeof owner!=='string'||! /^[a-f0-9]{64}$/.test(owner)||!Number.isSafeInteger(revision)||revision<0)throw unavailable('account-required','ChatGPT 계정을 연결한 뒤 외부 저장소 폴더를 선택해 주세요.');return {owner,revision};}
 check(owner){const next=this.owner();if(this.closed||this.options.canRun?.()===false||owner.owner!==next.owner||owner.revision!==next.revision)throw unavailable('needs-selection','계정이나 작업 상태가 바뀌었습니다. 외부 저장소 폴더를 다시 선택해 주세요.');}
 project(id){validId(id);const p=this.store.state.projects.find(p=>p.id===id&&!p.conversationScope);if(!p)throw unavailable('missing-source','등록된 외부 프로젝트를 찾을 수 없습니다. 폴더를 다시 등록하고 연결하세요.');return p;}
 async root(project){
  const stat=await fs.lstat(project.path);if(!stat.isDirectory()||stat.isSymbolicLink())throw unavailable('moved','연결한 프로젝트의 실제 폴더를 다시 선택해 주세요.');
  const real=await fs.realpath(project.path);if(!samePath(real,project.path))throw unavailable('moved','프로젝트 폴더가 이동했습니다. 실제 폴더를 다시 선택해 주세요.');
  const metadataFolder=path.join(real,'.flowrium'),folderStat=await fs.lstat(metadataFolder);if(!folderStat.isDirectory()||folderStat.isSymbolicLink()||!samePath(metadataFolder,await fs.realpath(metadataFolder)))throw unavailable('moved','프로젝트 기록 폴더가 변경됐습니다. 원본 폴더를 다시 선택해 주세요.');
  const metadata=await readJSON(path.join(metadataFolder,'project.json'));if(metadata.id!==project.id)throw unavailable('moved','프로젝트 식별자가 변경됐습니다. 실제 폴더를 다시 선택해 주세요.');
  return {path:real,dev:String(stat.dev),ino:String(stat.ino)};
 }
 async load(){try{const stat=await fs.lstat(this.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error();const data=JSON.parse(await fs.readFile(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.grants)||data.grants.length>500||data.grants.some(g=>!g||!UUID.test(g.projectId)||!UUID.test(g.repositoryId)||!UUID.test(g.sourceProjectId)||! /^[a-f0-9]{64}$/.test(g.owner)||!Number.isSafeInteger(g.revision)||g.revision<0||!g.target||!g.source||[g.target,g.source].some(r=>typeof r.path!=='string'||!path.isAbsolute(r.path)||typeof r.dev!=='string'||typeof r.ino!=='string')))throw Error();return data.grants;}catch(e){if(e.code==='ENOENT')return [];throw Error('외부 저장소 권한 기록을 확인하지 못했습니다. 원본은 보존했습니다.');}}
 async save(grants){const temporary=this.file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});try{await fs.writeFile(temporary,JSON.stringify({version:1,grants}),{mode:0o600,flag:'wx'});await fs.rename(temporary,this.file);}finally{await fs.rm(temporary,{force:true});}}
 serial(action){const next=this.tail.then(action);this.tail=next.catch(()=>{});return next;}
 sources(projectId){this.project(projectId);return this.store.state.projects.filter(p=>p.id!==projectId&&!p.conversationScope).map(p=>({id:p.id,name:p.name,path:p.path}));}
 async status(project,repo){
  if(!repo.sourceProjectId)return {access:'local',message:'현재 프로젝트 안의 폴더'};
  try{await this.resolve(project,repo);return {access:'authorized',message:'이 기기에서 선택한 외부 프로젝트 폴더'};}catch(e){return {access:e.access||'unavailable',message:e.access?e.message:'외부 프로젝트 폴더를 확인하지 못했습니다. 다시 선택해 주세요.'};}
 }
 async gitBoundary(cwd,root){
  let top;
  try{top=(await execute('git',['rev-parse','--show-toplevel'],{cwd,env:{...require('./runtime.cjs').runtimeEnvironment(),GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C'},windowsHide:true,timeout:8000,maxBuffer:16384})).stdout.trim();}
  catch(error){if(error.code==='ENOENT'||error.code===128&&/not a git repository/i.test(error.stderr||''))return;throw unavailable('unavailable','외부 저장소의 Git 작업 폴더를 확인하지 못했습니다. Git 설정을 확인해 주세요.');}
  const actual=await fs.realpath(top),relative=require('./path-boundary.cjs').relativePath(root,actual);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw unavailable('unavailable','Git 작업 폴더가 선택한 외부 프로젝트 밖을 가리킵니다. 연결 범위를 넓히지 않았습니다.');
 }
 async resolve(project,repo){
  const owner=this.owner();this.check(owner);project=this.project(project.id);validId(repo.id);validId(repo.sourceProjectId);if(project.id===repo.sourceProjectId)throw unavailable('needs-selection','현재 프로젝트의 저장소는 내부 폴더 방식으로 연결하세요.');
  const source=this.project(repo.sourceProjectId),grants=await this.load();this.check(owner);
  const grant=grants.find(g=>g.projectId===project.id&&g.repositoryId===repo.id&&g.sourceProjectId===source.id&&g.owner===owner.owner&&g.revision===owner.revision);
  if(!grant)throw unavailable('needs-selection','이 기기에서 외부 저장소 폴더를 선택해 연결 권한을 확인해 주세요.');
  const [targetRoot,sourceRoot]=await Promise.all([this.root(project),this.root(source)]);this.check(owner);
  for(const [current,previous]of [[targetRoot,grant.target],[sourceRoot,grant.source]])if(!samePath(current.path,previous.path)||current.dev!==previous.dev||current.ino!==previous.ino)throw unavailable('moved','연결한 폴더가 이동하거나 교체됐습니다. 외부 저장소 폴더를 다시 선택해 주세요.');
  const cwd=await require('./project-repositories.cjs').inside(sourceRoot.path,repo.path);await this.gitBoundary(cwd,sourceRoot.path);this.check(owner);return cwd;
 }
 async action(projectId,input){
  const project=this.project(projectId);
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('외부 저장소 연결 작업을 확인해 주세요.');
  if(input.action==='sources'){if(Object.keys(input).some(k=>k!=='action'))throw Error('외부 저장소 목록 형식을 확인해 주세요.');return {sources:this.sources(projectId)};}
  if(input.action==='status'){
   if(Object.keys(input).some(k=>!['action','repositories'].includes(k))||!Array.isArray(input.repositories)||input.repositories.length>32)throw Error('저장소 연결 목록을 확인해 주세요.');
   const rows=await Promise.all(input.repositories.map(async repo=>{validId(repo?.id);if(repo.sourceProjectId!==undefined)validId(repo.sourceProjectId);return {repositoryId:repo.id,sourceProjectId:repo.sourceProjectId,...await this.status(project,repo)};}));return {sources:this.sources(projectId),repositories:rows};
  }
  const owner=this.owner();this.check(owner);
  if(!['authorize','revoke'].includes(input.action)||Object.keys(input).some(k=>!['action','repositoryId','sourceProjectId'].includes(k)))throw Error('지원하지 않는 외부 저장소 연결 작업입니다.');
  const repositoryId=validId(input.repositoryId),sourceProjectId=validId(input.sourceProjectId);
  if(input.action==='revoke')return this.serial(async()=>{this.check(owner);const grants=await this.load();await this.save(grants.filter(g=>!(g.projectId===projectId&&g.repositoryId===repositoryId&&g.owner===owner.owner)));this.check(owner);return {revoked:true};});
  const source=this.project(sourceProjectId);if(source.id===project.id)throw Error('다른 등록 프로젝트를 선택해 주세요.');
  const [targetRoot,sourceRoot]=await Promise.all([this.root(project),this.root(source)]);this.check(owner);
  const selected=await this.options.chooseDirectory({project,source,defaultPath:sourceRoot.path});this.check(owner);if(!selected)return null;
  const stat=await fs.lstat(selected),chosen=await fs.realpath(selected);if(!stat.isDirectory()||!samePath(chosen,sourceRoot.path))throw Error('선택한 등록 프로젝트의 최상위 폴더를 정확히 선택해 주세요. 다른 폴더 권한은 추가하지 않았습니다.');
  const [targetAgain,sourceAgain]=await Promise.all([this.root(project),this.root(source)]);this.check(owner);
  for(const [before,after]of [[targetRoot,targetAgain],[sourceRoot,sourceAgain]])if(!samePath(before.path,after.path)||before.dev!==after.dev||before.ino!==after.ino)throw Error('폴더가 변경됐습니다. 다시 선택해 주세요.');
  return this.serial(async()=>{this.check(owner);let grants=await this.load();grants=grants.filter(g=>!(g.projectId===projectId&&g.repositoryId===repositoryId&&g.owner===owner.owner));if(grants.length>=500)throw Error('외부 저장소 연결 권한이 많습니다. 사용하지 않는 연결을 먼저 해제하세요.');grants.push({projectId,repositoryId,sourceProjectId,...owner,target:targetAgain,source:sourceAgain,createdAt:new Date().toISOString()});await this.save(grants);this.check(owner);return {authorized:true,sourceProjectId};});
 }
 async shutdown(){this.closed=true;await this.tail;}
}
function registerExternalRepositoryAccess(register,store,options){const runtime=new ExternalRepositoryAccess(store,options);register('repositoryAccessAction',(projectId,input)=>runtime.action(projectId,input));return runtime;}
module.exports={ExternalRepositoryAccess,registerExternalRepositoryAccess,unavailable};
