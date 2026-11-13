const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const HASH=/^[a-f0-9]{64}$/;
const MAX_FILE=512*1024*1024,MAX_TOTAL=8*1024*1024*1024,MAX_FILES=100000;
const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>{const h=digest(value);return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const secret=/^(?:\.env.*|\.?auth(?:entication)?|oauth(?:[-_].*)?|credentials?|tokens?|secrets?|security|lock|cookies?|google|kakao|deploy[_-]?key|id_(?:rsa|ed25519)|.*\.(?:pem|p12|pfx|key|enc))$/i;
const ignored=new Set(['.git','node_modules','.next','.venv','venv','__pycache__','.DS_Store']);
function safe(relative){
 if(typeof relative!=='string'||!relative||relative.length>4096||relative.includes('\\')||relative.includes('\0')||relative.startsWith('/')||relative.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('이관 파일의 경로가 안전하지 않거나 Windows에서 사용할 수 없습니다.');
 return relative;
}
async function directory(value){const stat=await fs.lstat(value);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('이관 위치는 연결 폴더가 아닌 일반 폴더여야 합니다.');return fs.realpath(value);}
async function bytes(file){
 const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>MAX_FILE)throw Error('이관 파일이 일반 파일이 아니거나 512MB를 넘었습니다.');
 const handle=await fs.open(file,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_FILE||stat.dev!==before.dev||stat.ino!==before.ino)throw Error('읽는 중 이관 파일이 바뀌었습니다.');return await handle.readFile();}finally{await handle.close();}
}
async function walk(root,{filter=()=>true,excluded=[],prefix=''}={}){
 const canonical=await directory(root),result=[];
 async function visit(current,relative){
  for(const ent of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const rel=relative?relative+'/'+ent.name:ent.name;
   if(!filter(rel,ent)){excluded.push(prefix+rel);continue;}
   try{safe(rel);}catch(error){throw Error(`${prefix+rel} / ${error.message}`);}
   const file=path.join(current,ent.name),stat=await fs.lstat(file);
   if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error(`${prefix+rel} / 연결 파일이나 특수 파일은 원본을 보존한 채 이관을 중단합니다.`);
   if(stat.isDirectory())await visit(file,rel);else{const data=await bytes(file);result.push({path:rel,sha256:digest(data),size:data.length,source:file});if(result.length>MAX_FILES)throw Error('이관 파일 수가 100,000개를 넘었습니다.');}
  }
 }
 await visit(canonical,'');return result;
}
function fileFilter(rel,ent){const name=ent.name;if(ignored.has(name)||secret.test(name)||secret.test(name.replace(/\.(?:json5?|toml|ya?ml|ini|cfg|conf)$/i,'')))return false;return true;}
function objectEntry(relative,data){const b=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data,null,2));return{path:safe(relative),sha256:digest(b),size:b.length,data:b};}
async function content(entry){const data=entry.data||await bytes(entry.source);if(data.length!==entry.size||digest(data)!==entry.sha256)throw Error('미리보기 이후 원본이 바뀌었습니다. 이관 미리보기를 다시 진행해 주세요.');return data;}
function publicManifest(snapshot){const result=structuredClone({...snapshot,entries:undefined,sourceChecks:undefined});delete result.entries;delete result.sourceChecks;result.files=snapshot.entries.map(({group,path,sha256,size})=>({group,path,sha256,size}));return result;}
async function verifySnapshot(snapshot){for(const e of [...(snapshot.sourceChecks||[]),...snapshot.entries])await content(e);}
function validateManifest(value){
 if(value?.format!=='flowrium-transfer'||value.version!==1||!require('./project-store.cjs').UUID.test(value.id)||!Array.isArray(value.projects)||!Array.isArray(value.files)||value.files.length>MAX_FILES||value.projects.length>1000)throw Error('지원하는 자료 이관 묶음이 아닙니다.');
 const keys=new Set(),projectIds=new Set(),names=new Set();let total=0;
 const scopes=new Set();for(const p of value.projects){if(!p||typeof p.key!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(p.key)||['app','raw'].includes(p.key)||keys.has(p.key)||projectIds.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>300||!require('./project-store.cjs').UUID.test(p.id)||!['project','general','integrated'].includes(p.scope)||p.scope!=='project'&&scopes.has(p.scope))throw Error('이관 프로젝트의 식별자를 확인해 주세요.');keys.add(p.key);projectIds.add(p.id);scopes.add(p.scope);}
 for(const e of value.files){safe(e.path);if(!['app','raw',...keys].includes(e.group)||!HASH.test(e.sha256)||!Number.isSafeInteger(e.size)||e.size<0||e.size>MAX_FILE)throw Error('이관 파일 목록이 올바르지 않습니다.');const key=(e.group+'/'+e.path).normalize('NFC').toLowerCase();if(names.has(key))throw Error('대소문자 또는 유니코드 정규화가 겹치는 파일은 이관할 수 없습니다.');names.add(key);total+=e.size;}
 if(total>MAX_TOTAL)throw Error('한 번의 이관은 8GB까지 지원합니다. 프로젝트를 나누어 주세요.');
 return value;
}
async function readBundle(folder){
 const base=await directory(folder),manifest=JSON.parse((await bytes(path.join(base,'manifest.json'))).toString('utf8'));validateManifest(manifest);
 const objects=await directory(path.join(base,'objects'));
 return{...manifest,entries:manifest.files.map(e=>({...e,source:path.join(objects,e.sha256)}))};
}
async function writeBundle(snapshot,parent){
 validateManifest(publicManifest(snapshot));await verifySnapshot(snapshot);const root=path.join(await directory(parent),'Flowrium-transfer-'+randomUUID());await fs.mkdir(root,{mode:0o700});
 try{await fs.mkdir(path.join(root,'objects'),{mode:0o700});const done=new Set();for(const e of snapshot.entries){const data=await content(e);if(!done.has(e.sha256)){await fs.writeFile(path.join(root,'objects',e.sha256),data,{flag:'wx',mode:0o600});done.add(e.sha256);}}await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(publicManifest(snapshot),null,2),{flag:'wx',mode:0o600});return root;}catch(error){await fs.rm(root,{recursive:true,force:true});throw error;}
}
async function writeEntry(root,relative,data){safe(relative);const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,data,{flag:'wx',mode:0o600});}
module.exports={digest,uuid,safe,directory,bytes,walk,fileFilter,objectEntry,content,verifySnapshot,publicManifest,validateManifest,readBundle,writeBundle,writeEntry,secret};
