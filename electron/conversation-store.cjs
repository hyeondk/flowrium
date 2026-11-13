const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {ProjectStore,projectDirectory}=require('./project-store.cjs');
const SCOPES=['general','integrated'];
const labels={general:'일반 대화',integrated:'통합 채팅'};
const stale=()=>Error('대화의 연결 계정이 바뀌었습니다. 현재 계정에서 다시 선택해 주세요.');
function identity(owner,scope){
 const hex=createHash('sha256').update('flowrium-hub-v1\0'+owner+'\0'+scope).digest('hex');
 return [hex.slice(0,8),hex.slice(8,12),'8'+hex.slice(13,16),'a'+hex.slice(17,20),hex.slice(20,32)].join('-');
}
class ConversationStore{
 constructor(directory){this.directory=directory;this.getOwner=()=>0;this.pools=new Map();this.tail=Promise.resolve();}
 owner(){const value=String(this.getOwner());if(!value||value.length>100)throw stale();return value;}
 async base(create=false){if(create)await fs.mkdir(this.directory,{recursive:true,mode:0o700});const base=await fs.realpath(this.directory).catch(e=>{if(!create&&e.code==='ENOENT')return path.resolve(this.directory);throw e;});return path.join(base,'conversation-hub');}
 async isManagedPath(value){const relative=path.relative(await this.base(),value);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
 serial(action){const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;}
 async sync(){return this.serial(async()=>{const owner=this.owner();if(!this.pools.has(owner))await this.load(owner);if(owner!==this.owner())throw stale();return this.pools.get(owner);});}
 async folder(owner,scope,create=false){
  const base=await this.base(create),key=createHash('sha256').update(owner).digest('hex').slice(0,32),parent=path.join(base,key),directory=path.join(parent,scope);
  if(create){await projectDirectory(base);await projectDirectory(parent);await projectDirectory(directory);}
  else{for(const item of [base,parent,directory]){const stat=await fs.lstat(item);if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(item,await fs.realpath(item)))throw Error('개인 대화 저장 위치가 변경됐습니다. 원본을 보존했습니다.');}}
  return directory;
 }
 async readProject(owner,scope,create=false){
  const directory=await this.folder(owner,scope,create),id=identity(owner,scope),repository=await ProjectStore.open(directory,id);
  if(repository.id!==id)throw Error('개인 대화 식별자가 달라 원본을 보존했습니다.');
  const project={id,name:labels[scope],path:directory,createdAt:repository.createdAt,conversationScope:scope};
  const sessions=[...repository.saved.values()].map(saved=>{if(saved.scope!==scope||saved.workflow||saved.personalAssistant)throw Error('개인 대화 종류가 달라 원본을 보존했습니다.');return {...structuredClone(saved),compacting:false};});
  return{project,repository,sessions};
 }
 async load(owner){const pool={owner,projects:[],repositories:new Map(),sessions:[]};for(const scope of SCOPES){try{const value=await this.readProject(owner,scope);pool.projects.push(value.project);pool.repositories.set(value.project.id,value.repository);pool.sessions.push(...value.sessions);}catch(e){if(e.code!=='ENOENT')throw e;}}this.pools.set(owner,pool);return pool;}
 async ensure(scope){if(!SCOPES.includes(scope))throw Error('일반 대화 또는 통합 채팅을 선택해 주세요.');await this.sync();return this.serial(async()=>{const owner=this.owner(),pool=this.pools.get(owner);let project=pool.projects.find(p=>p.conversationScope===scope);if(!project){const value=await this.readProject(owner,scope,true);if(owner!==this.owner())throw stale();project=value.project;pool.projects.push(project);pool.repositories.set(project.id,value.repository);pool.sessions.push(...value.sessions);}return project;});}
 current(){return this.pools.get(this.owner());}
 projects(){return this.current()?.projects||[];}
 sessions(){return this.current()?.sessions||[];}
 findProject(id){return this.projects().find(p=>p.id===id);}
 findSession(id){return this.sessions().find(s=>s.id===id);}
 peekSession(id){for(const pool of this.pools.values()){const found=pool.sessions.find(s=>s.id===id);if(found)return found;}}
 poolForProject(id){return this.current()?.projects.some(p=>p.id===id)?this.current():undefined;}
 isCurrent(id){const any=this.peekSession(id);return !any||!!this.findSession(id);}
 snapshots(){return [...this.pools.values()].map(pool=>({pool,sessions:structuredClone(pool.sessions)}));}
 async commit(snapshots){for(const {pool,sessions}of snapshots)for(const project of pool.projects){const repository=pool.repositories.get(project.id),values=sessions.filter(s=>s.projectId===project.id);await repository.commit(values,{local:true});}}
}
module.exports={ConversationStore,SCOPES,labels,identity};
