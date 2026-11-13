const fs=require('node:fs/promises'),path=require('node:path');
const YAML=require('yaml');
const {randomUUID}=require('node:crypto');
const {uuid,objectEntry,walk,fileFilter,bytes,directory,digest}=require('./migration-files.cjs');
const {UUID,validateSession}=require('./project-store.cjs');
const iso=value=>new Date(Number.isFinite(value)?value:Date.now()).toISOString();
const string=(v,n=300)=>typeof v==='string'?v.slice(0,n):'';
function plain(value,depth=0){
 if(depth>30)throw Error('설정 문서의 깊이가 너무 큽니다.');
 if(value===null||['string','boolean','number'].includes(typeof value))return value;
 if(Array.isArray(value))return value.map(v=>plain(v,depth+1));
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('설정 문서에 지원하지 않는 자료형이 있습니다.');
 const out={};for(const [key,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('설정 문서의 예약된 키를 사용할 수 없습니다.');out[key]=plain(v,depth+1);}return out;
}
function frontmatter(text){
 if(Buffer.byteLength(text)>4*1024*1024)throw Error('프로젝트 카드가 4MB를 넘었습니다.');
 const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
 if(!match)return{data:{},body:text};
 const doc=YAML.parseDocument(match[1],{schema:'core',uniqueKeys:true,customTags:[],maxAliasCount:0});
 if(doc.errors.length||doc.warnings.length)throw Error('프로젝트 카드의 설정 문법을 확인해 주세요.');
 let aliases=false;YAML.visit(doc,{Alias(){aliases=true;}});if(aliases)throw Error('설정 문서의 별칭 참조는 지원하지 않습니다.');
 const data=plain(doc.toJS({maxAliasCount:0}));if(!data||Array.isArray(data)||typeof data!=='object')throw Error('프로젝트 카드의 설정은 객체여야 합니다.');return{data,body:match[2]};
}
function scrub(value,excluded=[],prefix=''){
 if(Array.isArray(value))return value.map((v,i)=>scrub(v,excluded,prefix+'/'+i));
 if(!value||typeof value!=='object')return value;
 const result={};for(const [key,v]of Object.entries(value)){if(/(?:password|passwd|secret|token|credential|encryptedEnvironment|apiKey|privateKey|clientSecret|pinHash|salt|pin)$/i.test(key)){excluded.push(prefix+'/'+key);continue;}if(['__proto__','constructor','prototype'].includes(key))continue;result[key]=scrub(v,excluded,prefix+'/'+key);}return result;
}
function baseSession(meta,projectId,scope,key){const now=iso(meta.createdAt);return{id:uuid(key+'/chat/'+meta.id),projectId,title:string(meta.title)||'가져온 대화',createdAt:now,updatedAt:iso(meta.updatedAt),messages:[],...(scope!=='project'?{scope}:{} )};}
function recordSession(entries,project,session,seed){validateSession(session,project.id);const revision=uuid(seed+'/revision/'+session.id);entries.push({group:project.key,...objectEntry('.flowrium/sessions/'+session.id+'--'+revision+'.json',{version:1,projectId:project.id,sessionId:session.id,revision,parentRevision:null,deleted:false,session})});}
function makeProject(entries,key,name,scope,createdAt,seed){const id=uuid(seed+'/project/'+key),p={key,id,name:string(name)||'가져온 프로젝트',scope,createdAt:iso(createdAt)};entries.push({group:key,...objectEntry('.flowrium/project.json',{version:1,id,createdAt:p.createdAt})});return p;}
async function legacySnapshot(root,{workspace,memory,includeFiles=false}={}){
 root=await directory(root);const entries=[],sourceChecks=[],excluded=[],warnings=[],projects=[],seed=digest(root),projectMap=new Map();
 const cards=path.join(root,'data','projects'),state=path.join(root,'data','state');
 await directory(cards);await directory(state);
 const cardFiles=(await fs.readdir(cards)).filter(f=>/^[a-z0-9][a-z0-9-]{0,40}\.md$/.test(f)).sort();
 for(const file of cardFiles){
  const cardFile=path.join(cards,file),raw=await bytes(cardFile),{data,body}=frontmatter(raw.toString('utf8')),slug=file.slice(0,-3),key='legacy-'+slug,p=makeProject(entries,key,data.name||slug,'project',Date.parse(data.startedAt),seed);sourceChecks.push({source:cardFile,size:raw.length,sha256:digest(raw)});
  p.folderHint=typeof data.folder==='string'?data.folder:'';projects.push(p);projectMap.set(slug,p);
  entries.push({group:'raw',...objectEntry('cards/'+file,raw)});
  const relative=v=>{if(typeof v!=='string'||!workspace)return undefined;const resolved=path.resolve(workspace,v),base=path.resolve(workspace,data.folder||'.'),rel=path.relative(base,resolved).split(path.sep).join('/');return rel===''?'.':!rel.startsWith('../')&&!path.isAbsolute(rel)?rel:undefined;};
  const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:'';
  const rev=uuid(seed+'/details/'+slug),details={projectId:p.id,revision:rev,owner:string(data.myRole,150),goal:string(data.summary||body,4000),dueDate:day(data.dueAt),archivedAt:data.archivedAt?iso(Date.parse(data.archivedAt)):null,checklist:(Array.isArray(data.checklist)?data.checklist:[]).slice(0,250).filter(c=>typeof c.text==='string'&&c.text.trim()).map((c,i)=>({id:uuid(seed+slug+'/check/'+i),text:string(c.text,500),done:!!c.done})),kickoff:{name:string(p.name,140),phase:['킥오프','진행','유지보수','중단','완료'].includes(data.status)?data.status:'킥오프',category:string(data.kind,80),privacy:string(data.security,80),client:string(data.client,200),owner:string(data.myRole,150),members:(Array.isArray(data.members)?data.members:[]).filter(x=>typeof x==='string').join(' / ').slice(0,1500),goal:string(data.summary,4000),startedAt:day(data.startedAt),dueDate:day(data.dueAt),repository:'',notes:string(body,8000)},periodGoals:[],schedule:[],repositories:[],services:[]};
  if(details.kickoff.startedAt>details.kickoff.dueDate&&details.kickoff.dueDate)details.kickoff.startedAt='';
  for(const [i,r]of (Array.isArray(data.repos)?data.repos:[]).entries()){const rel=relative(r.path);if(rel)details.repositories.push({id:uuid(seed+slug+'/repo/'+i),name:string(r.name)||'저장소',path:rel,...(typeof r.github==='string'?{github:r.github}:{}),...(typeof r.base==='string'?{base:r.base}:{})});else warnings.push(p.name+' / 외부 저장소 경로는 원문에서 확인해 다시 연결해 주세요.');}
  // 다른 엔진에서 쓰던 서비스 명령은 원문에만 보존하며 자동 실행하지 않습니다.
  require('./project-details.cjs').validateDetails(details);
  entries.push({group:key,...objectEntry('.flowrium/migration-card.md',raw)});
  entries.push({group:key,...objectEntry('.flowrium/details/first.json',{version:1,previous:null,data:details})});
  if(Number.isInteger(data.no)&&data.no>=1&&data.no<=99){const n=data.no;entries.push({group:key,...objectEntry('.flowrium/ports/first.json',{version:1,previous:null,data:{projectId:p.id,revision:uuid(seed+'/ports/'+slug),enabled:true,number:n,mode:'automatic',ports:{web:2000+n,admin:2100+n,api:3000+n,db:4000+n,aux:4100+n},updatedAt:iso()}})});}
  if(includeFiles&&workspace&&typeof data.folder==='string'){
   const base=await directory(workspace),folder=path.resolve(base,data.folder),rel=path.relative(base,folder);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error(p.name+' / 작업 폴더가 선택한 원본 작업 공간을 벗어납니다.');
   const items=await walk(folder,{filter:(r,e)=>e.name!=='.flowrium'&&fileFilter(r,e),excluded,prefix:p.name+'/'});entries.push(...items.map(e=>({...e,group:key})));
  }
 }
 let chats=[];try{chats=JSON.parse((await bytes(path.join(state,'chats.json'))).toString('utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!Array.isArray(chats)||chats.length>100000)throw Error('원본 대화 목록의 형식을 확인해 주세요.');
 for(const meta of chats){
  if(!meta||typeof meta.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(meta.id))throw Error('원본 대화의 식별자를 확인해 주세요.');
  let p=projectMap.get(meta.scope);if(!p){const scope=meta.scope==='global'?'integrated':'general';p=projects.find(x=>x.scope===scope);if(!p){p=makeProject(entries,'legacy-'+scope,scope==='general'?'일반 대화':'통합 채팅',scope,meta.createdAt,seed);projects.push(p);}}
  const session=baseSession(meta,p.id,p.scope,seed),raw=await bytes(path.join(state,'chats',meta.id+'.json')),items=JSON.parse(raw.toString('utf8'));if(!Array.isArray(items))throw Error('원본 대화 본문의 형식을 확인해 주세요.');
  for(const [i,item]of items.entries()){
   const message={id:uuid(seed+'/'+meta.id+'/'+i+'/'+item.id),role:['user','assistant'].includes(item.kind)?item.kind:'system',text:typeof item.text==='string'?item.text:JSON.stringify(item,null,2),createdAt:iso(item.at)};
   if(message.text.length>2000000){warnings.push(session.title+' / 긴 기록은 원문 보관에서 전체 내용을 볼 수 있습니다.');message.text=message.text.slice(0,1999000)+'\n[전체 내용은 이관 원문 보관에서 확인해 주세요.]';}
   if(item.attachments?.length){message.attachments=[];for(const a of item.attachments){
    if(!a||typeof a.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(a.id)||typeof a.name!=='string'||path.basename(a.name)!==a.name)throw Error('원본 첨부 경로를 확인해 주세요.');
    let data;try{data=await bytes(path.join(state,'uploads',a.id,a.name));}catch(e){if(e.code==='ENOENT'){warnings.push(session.title+' / 첨부 원본 없음: '+a.name);continue;}throw e;}
    const id=uuid(seed+'/attachment/'+a.id),attachment={id,name:a.name,type:string(a.type,200)||'application/octet-stream',size:data.length,sha256:digest(data)};
    try{require('./chat-attachments.cjs').checkedAttachments([attachment]);entries.push({group:p.key,...objectEntry('.flowrium/attachments/'+id+'/'+a.name,data)},{group:p.key,...objectEntry('.flowrium/attachments/'+id+'/attachment.json',attachment)});message.attachments.push(attachment);}catch{warnings.push(session.title+' / 현재 첨부 제한을 넘는 파일은 원문에 보존했습니다: '+a.name);entries.push({group:'raw',...objectEntry('uploads/'+id+'/'+a.name,data)});}
   }if(!message.attachments.length)delete message.attachments;}
   session.messages.push(message);
  }
  recordSession(entries,p,session,seed);entries.push({group:'raw',...objectEntry('chats/'+meta.id+'.json',raw)});
 }
 const rawState=await walk(state,{filter:fileFilter,excluded,prefix:'원본 상태/'});sourceChecks.push(...rawState);
 for(const e of rawState){let data=await bytes(e.source);if(e.path.endsWith('.json')){const removed=[];data=Buffer.from(JSON.stringify(scrub(JSON.parse(data.toString()),removed,e.path),null,2));excluded.push(...removed);}entries.push({group:'raw',...objectEntry('state/'+e.path,data)});}
 if(memory){const files=await walk(await directory(memory),{filter:fileFilter,excluded,prefix:'기억/'});sourceChecks.push(...files);for(const e of files){const raw=await bytes(e.source);entries.push({group:'raw',...objectEntry('memory/'+e.path,raw)});if(!e.path.endsWith('.md')||path.basename(e.path)==='MEMORY.md'||e.path.split('/').some(p=>p.startsWith('.')))continue;const {data,body}=frontmatter(raw.toString()),id=uuid(seed+'/memory/'+e.path),rev=uuid(seed+'/memory-rev/'+e.path);if(body.length>16000){warnings.push('긴 기억은 원문에 보존했습니다: '+e.path);continue;}entries.push({group:'app',...objectEntry('personal-memory/'+id+'/first.json',{version:1,id,projectId:null,rev,parent:null,at:iso(),title:string(data.name||path.basename(e.path,'.md'),120),body,role:'',link:'',linked:false,deleted:false})});}}
 // 동일한 첨부를 여러 메시지가 참조하는 경우 하나만 보존합니다.
 const unique=new Map();for(const e of entries){const k=e.group+'/'+e.path,old=unique.get(k);if(old&&old.sha256!==e.sha256)throw Error('동일한 경로에 서로 다른 원본 파일이 있습니다.');unique.set(k,e);}
 return{format:'flowrium-transfer',version:1,id:uuid(seed+'/'+digest(JSON.stringify([...unique.values()].map(e=>[e.group,e.path,e.sha256])))),createdAt:iso(),sourceKind:'workspace-records',projects,entries:[...unique.values()],sourceChecks,excluded,warnings,settings:{}};
}
module.exports={legacySnapshot,frontmatter,scrub};
