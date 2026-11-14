const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {relativePath}=require('./path-boundary.cjs'),{UUID}=require('./project-store.cjs');
const invalid=()=>Error('프로젝트 바로가기의 이름과 위치를 확인해 주세요.');
function validateShortcuts(input){
 if(!Array.isArray(input)||input.length>32)throw Error('바로가기는 프로젝트마다 32개까지 저장할 수 있습니다.');
 const seen=new Set();return input.map(item=>{
  if(!item||!UUID.test(item.id)||seen.has(item.id)||!['operation','local','drive'].includes(item.kind)||typeof item.label!=='string'||!item.label.trim()||item.label.length>100||typeof item.target!=='string'||!item.target.trim()||item.target.length>4096||/[\x00-\x1f\x7f]/.test(item.target)||item.disabled!==undefined&&typeof item.disabled!=='boolean')throw invalid();seen.add(item.id);
  const value={id:item.id,kind:item.kind,label:item.label.trim(),target:item.target.trim(),...(item.disabled!==undefined&&{disabled:item.disabled})};
  if(item.kind==='local'){
   if(!['relative','absolute'].includes(item.localMode))throw invalid();value.localMode=item.localMode;
   if(item.localMode==='relative'){if(path.posix.isAbsolute(value.target)||path.win32.isAbsolute(value.target)||value.target.includes('\\')||value.target.includes(':')||value.target.split('/').some(part=>!part||['..','.git','.flowrium'].includes(part)))throw invalid();}
   else if(!path.posix.isAbsolute(value.target)&&!path.win32.isAbsolute(value.target))throw invalid();
  }else{
   if(item.localMode!==undefined)throw invalid();let url;try{url=new URL(value.target);}catch{throw invalid();}
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('계정 정보가 없는 http 또는 https 주소를 입력해 주세요.');
   if(item.kind==='drive'&&(url.protocol!=='https:'||url.hostname!=='drive.google.com'||!/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)))throw Error('Google Drive의 공식 폴더 주소를 입력해 주세요.');
   value.target=url.href;
  }return value;
 });
}
function migratedShortcuts(values){return validateShortcuts(values).map(item=>item.kind==='local'&&item.localMode==='absolute'?{...item,disabled:true}:item);}
async function localFolder(store,projectId,item){
 if(item.disabled)throw Error('이관한 외부 폴더는 이 기기에서 다시 선택해 주세요.');const project=store.project(projectId),target=item.localMode==='relative'?path.join(project.path,...item.target.split('/')):item.target;
 if(!path.isAbsolute(target))throw Error('이 운영체제에서 사용할 폴더를 다시 선택해 주세요.');const canonical=await fs.realpath(target).catch(error=>{if(error.code==='ENOENT')throw Error('폴더를 찾지 못했습니다. 프로젝트 설정에서 다시 선택해 주세요.');throw error;});
 if(relativePath(target,canonical)!==''||!(await fs.stat(canonical)).isDirectory())throw Error('폴더 위치가 바뀌었습니다. 프로젝트 설정에서 다시 선택해 주세요.');
 if(item.localMode==='relative'){const relative=relativePath(await fs.realpath(project.path),canonical);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('프로젝트 내부 폴더가 다른 위치를 가리킵니다. 다시 선택해 주세요.');}return canonical;
}
function registerProjectShortcuts(register,store,options={}){
 const selections=new Map();
 const context=()=>({revision:options.accountRevision?.()??0,epoch:options.stateEpoch?.()??0}),guard=before=>{const now=context();if(options.canRun?.()===false||before.revision!==now.revision||before.epoch!==now.epoch)throw Error('계정이나 잠금 상태가 바뀌었습니다. 다시 확인해 주세요.');};
 register('projectShortcutAction',async(projectId,input)=>{
  const before=context();guard(before);const project=store.project(projectId);if(project.conversationScope)throw Error('연결한 프로젝트에서 바로가기를 설정해 주세요.');if(!input||typeof input!=='object')throw invalid();
  if(input.action==='chooseLocal'){
   const selected=await options.chooseDirectory?.(project);guard(before);if(!selected)return null;const folder=await fs.realpath(selected);if(!(await fs.stat(folder)).isDirectory())throw invalid();const relative=relativePath(await fs.realpath(project.path),folder),inside=relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);guard(before);const entry={id:randomUUID(),kind:'local',label:path.basename(folder)||project.name,target:inside?(relative.split(path.sep).join('/')||'.'):folder,localMode:inside?'relative':'absolute'};selections.set(entry.id,{projectId,before,entry,at:Date.now()});for(const [id,pick]of selections)if(Date.now()-pick.at>300000||selections.size>64)selections.delete(id);return entry;
  }
  const {readDetails,updateDetails}=require('./project-details.cjs');
  if(input.action==='save'){const values=validateShortcuts(input.shortcuts),current=await readDetails(store,projectId);for(const item of values)if(item.kind==='local'&&!item.disabled){const existing=(current.shortcuts||[]).find(old=>old.id===item.id&&!old.disabled&&old.kind==='local'&&old.target===item.target&&old.localMode===item.localMode),pick=selections.get(item.id);if(!existing&&(!pick||pick.projectId!==projectId||pick.before.revision!==before.revision||pick.before.epoch!==before.epoch||Date.now()-pick.at>300000||pick.entry.target!==item.target||pick.entry.localMode!==item.localMode))throw Error('로컬 폴더 선택 버튼으로 폴더를 다시 골라 주세요.');await localFolder(store,projectId,item);}guard(before);const result=await updateDetails(store,projectId,input.revision,{action:'shortcuts',shortcuts:values});for(const item of values)selections.delete(item.id);guard(before);return result;}
  if(input.action==='open'){const details=await readDetails(store,projectId),entry=validateShortcuts(details.shortcuts||[]).find(item=>item.id===input.id);if(!entry)throw Error('저장된 프로젝트 바로가기를 선택해 주세요.');if(entry.disabled)throw Error('이관한 외부 폴더는 이 기기에서 다시 선택해 주세요.');if(entry.kind==='local'){const folder=await localFolder(store,projectId,entry);guard(before);await options.openPath(folder);}else{guard(before);await options.openExternal(entry.target);}guard(before);return{opened:true};}
  throw invalid();
 });
}
module.exports={registerProjectShortcuts,validateShortcuts,migratedShortcuts,localFolder};
