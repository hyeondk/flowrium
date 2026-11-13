const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readDetails, updateDetails } = require('./project-details.cjs');
const { repositoriesFor } = require('./project-repositories.cjs');
const exec = promisify(execFile);
const phases = ['킥오프','진행','유지보수','중단','완료'];
const defaults = () => ({revision:null,columns:[...phases],order:[],shortcuts:{search:'mod+k',dashboard:'mod+shift+1',newChat:'mod+n',history:'mod+2',settings:'mod+,'}});
async function atomic(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.'+randomUUID()+'.tmp';
  try { await fs.writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});await fs.rename(tmp,file); }
  finally { await fs.rm(tmp,{force:true}); }
}
function registerPortfolioOperations(register,store,{chooseFolder}={}) {
  const file=path.join(path.dirname(store.file),'portfolio-tools.json');
  const previews=new Map();let queue=Promise.resolve();
  async function read() {
    try {const s=JSON.parse(await fs.readFile(file,'utf8'));if(!s || !Array.isArray(s.order)||!Array.isArray(s.columns))throw Error();return {...defaults(),...s};}
    catch(e){if(e.code==='ENOENT')return defaults();throw new Error('프로젝트 보드 설정을 읽지 못했습니다.');}
  }
  register('portfolioAction',(input)=>{
    const task=queue.catch(()=>{}).then(async()=>{
      if(!input||typeof input!=='object')throw new Error('프로젝트 도구 요청을 확인해 주세요.');
      const s=await read();
      if(input.action==='read')return s;
      if(input.action==='save') {
        if(input.revision!==s.revision)throw new Error('보드 설정이 변경됐습니다. 새로고침해 주세요.');
        if(input.order!==undefined){
          if(!Array.isArray(input.order)||input.order.length>1000||new Set(input.order).size!==input.order.length||input.order.some(id=>!store.state.projects.some(p=>p.id===id)))throw new Error('프로젝트 순서를 확인해 주세요.');
          s.order=input.order;
        }
        if(input.columns!==undefined){if(!Array.isArray(input.columns)||input.columns.length!==phases.length||new Set(input.columns).size!==phases.length||input.columns.some(c=>!phases.includes(c)))throw new Error('보드 칸을 확인해 주세요.');s.columns=input.columns;}
        if(input.shortcuts!==undefined){
          const nextShortcuts={...defaults().shortcuts,...input.shortcuts};
          const values=Object.values(nextShortcuts);
          if(Object.keys(input.shortcuts).some(k=>!Object.hasOwn(defaults().shortcuts,k))||values.some(v=>typeof v!=='string'||!/^mod\+(?:shift\+)?[a-z0-9,/]$/.test(v))||new Set(values).size!==values.length||values.some(v=>['mod+q','mod+w','mod+c','mod+v','mod+x','mod+a','mod+z'].includes(v)))throw new Error('단축키 형식이나 중복을 확인해 주세요.');
          s.shortcuts=nextShortcuts;
        }
        s.revision=randomUUID();await atomic(file,s);return s;
      }
      if(input.action==='export') {
        const cards=[];
        for(const project of store.state.projects){const details=await readDetails(store,project.id);cards.push({id:project.id,name:details.kickoff?.name||project.name,folderHint:path.basename(project.path),details});}
        return {format:'flowrium-project-cards',version:1,createdAt:new Date().toISOString(),cards};
      }
      if(input.action==='previewImport') {
        if(typeof input.text!=='string'||Buffer.byteLength(input.text)>2*1024*1024)throw new Error('가져올 카드 파일은 2MB까지 가능합니다.');
        let data;try{data=JSON.parse(input.text);}catch{throw new Error('JSON 카드 파일을 확인해 주세요.');}
        if(data?.format!=='flowrium-project-cards'||data.version!==1||!Array.isArray(data.cards)||!data.cards.length||data.cards.length>200)throw new Error('지원하는 프로젝트 카드 파일이 아닙니다.');
        const cards=data.cards.map((c,index)=>{
          if(!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>140||!c.details||typeof c.details!=='object')throw new Error('가져올 프로젝트 카드의 형식이 올바르지 않습니다.');
          const existing=store.state.projects.find(p=>p.id===c.id||p.name===c.name);
          require('./project-details.cjs').validateDetails({...structuredClone(c.details),projectId:randomUUID(),revision:randomUUID()});
          return {index,name:c.name,details:structuredClone(c.details),existingId:existing?.id||null};
        });
        const token=randomUUID(),revisions={};
        for(const c of cards)if(c.existingId)revisions[c.existingId]=(await readDetails(store,c.existingId)).revision;
        previews.clear();previews.set(token,{cards,revisions,at:Date.now()});
        return {token,cards:cards.map(({index,name,existingId})=>({index,name,existingId,willReplace:!!existingId}))};
      }
      if(input.action==='applyImport') {
        const p=previews.get(input.token);
        if(!p||Date.now()-p.at>15*60*1000||!Array.isArray(input.selected)||!input.selected.length||new Set(input.selected).size!==input.selected.length)throw new Error('가져오기 미리보기를 다시 확인해 주세요.');
        const selected=input.selected.map(i=>p.cards.find(c=>c.index===i));if(selected.some(c=>!c))throw new Error('가져올 카드를 선택해 주세요.');
        for(const c of selected)if(c.existingId){if(input.overwrite!==true)throw new Error('기존 카드 덮어쓰기를 확인해 주세요.');if((await readDetails(store,c.existingId)).revision!==p.revisions[c.existingId])throw new Error('기존 프로젝트가 변경됐습니다. 미리보기를 다시 여세요.');}
        const applied=[],skipped=[];
        for(const c of selected){
          let project=c.existingId&&store.project(c.existingId);
          if(!project){const chosen=await chooseFolder?.(false);if(!chosen){skipped.push(c.name);continue;}project=await store.addProject(chosen);}
          const previous=await readDetails(store,project.id);
          if(previous.revision){const backup=path.join(path.dirname(store.file),'portfolio-backups',randomUUID()+'.json');await atomic(backup,{projectId:project.id,at:new Date().toISOString(),details:previous});}
          await updateDetails(store,project.id,previous.revision,{action:'import',data:c.details});
          applied.push(project.id);
        }
        previews.delete(input.token);return {applied,skipped,projects:applied.map(id=>structuredClone(store.project(id)))};
      }
      if(input.action==='insights'){
        const end=new Date(),dates=Array.from({length:14},(_,i)=>new Date(end.getTime()-(13-i)*86400000).toISOString().slice(0,10));
        const projects=[];let dirtyRepositories=0,commits7=0,openPulls=0;
        for(const project of store.state.projects){
          const item={projectId:project.id,name:project.name,days:dates.map(day=>({day,count:0})),repositories:[],errors:[]};
          try{for(const repo of await repositoriesFor(store,project)){
            const env={...require('./runtime.cjs').runtimeEnvironment(),GIT_TERMINAL_PROMPT:'0',GH_PROMPT_DISABLED:'true',GIT_OPTIONAL_LOCKS:'0'};
            const run=async(cmd,args)=> (await exec(cmd,args,{cwd:repo.cwd,env,windowsHide:true,timeout:8000,maxBuffer:1024*1024})).stdout;
            try{
              const status=await run('git',['status','--porcelain=v1','--untracked-files=normal']);
              const dirty=status.split(/\r?\n/).filter(l=>l&&!l.slice(3).startsWith('.flowrium')).length;
              const log=await run('git',['log','--since='+dates[0]+'T00:00:00','--format=%aI','--no-show-signature']);
              for(const line of log.trim().split(/\r?\n/)){const day=line.slice(0,10),cell=item.days.find(d=>d.day===day);if(cell){cell.count++;if(day>=dates[7])commits7++;}}
              if(dirty)dirtyRepositories++;let pulls=null;
              try{const rows=JSON.parse(await run('gh',['pr','list','--state','open','--limit','100','--json','number']));pulls=rows.length;openPulls+=pulls;}catch{item.errors.push(repo.name+' / 변경 요청 조회 불가');}
              item.repositories.push({id:repo.id,name:repo.name,dirty,pulls});
            }catch{item.errors.push(repo.name+' / Git 기록 조회 불가');}
          }}catch{item.errors.push('저장소 설정 확인 필요');}
          projects.push(item);
        }
        return {at:end.toISOString(),commits7,dirtyRepositories,openPulls,projects};
      }
      throw new Error('지원하지 않는 프로젝트 도구입니다.');
    });queue=task;return task;
  });
}
module.exports={registerPortfolioOperations,atomic};
