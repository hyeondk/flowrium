const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const path=require('node:path');
const exec=promisify(execFile);
const platform=process.platform;
const windowsRoot=()=>process.env.SystemRoot||process.env.SYSTEMROOT||'C:\\Windows';
function powershell(){return path.win32.join(windowsRoot(),'System32','WindowsPowerShell','v1.0','powershell.exe');}
async function ps(script){return exec(powershell(),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:8000,maxBuffer:4*1024*1024});}
async function processes(){
 if(platform==='win32'){
  const {stdout}=await ps("$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Where-Object {$_.SessionId -eq (Get-Process -Id $PID).SessionId} | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | ConvertTo-Json -Compress");
  const rows=JSON.parse(stdout||'[]');return(Array.isArray(rows)?rows:[rows]).map(r=>({pid:Number(r.ProcessId),ppid:Number(r.ParentProcessId),identity:String(r.CreationDate)+'|'+String(r.ExecutablePath||'')}));
 }
 const {stdout}=await exec('/bin/ps',['-U',String(process.getuid()),'-o','pid=,ppid=,lstart=,comm='],{env:{...process.env,LC_ALL:'C'},timeout:5000,maxBuffer:4*1024*1024});
 return stdout.split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/.exec(line);return m?[{pid:Number(m[1]),ppid:Number(m[2]),identity:m[3].replace(/\s+/g,' ')+'|'+m[4]}]:[]});
}
function tree(rows,root,known=new Map()){
 const candidates=new Map(rows.map(r=>[r.pid,r]));const current=candidates.get(root);
 const prior=known.get(root);if(current&&(!prior||prior.identity===current.identity))known.set(root,current);
 let changed=true;while(changed){changed=false;for(const row of rows){if(known.has(row.pid))continue;const parent=known.get(row.ppid),actualParent=candidates.get(row.ppid);if(parent&&(!actualParent||actualParent.identity===parent.identity)){known.set(row.pid,row);changed=true;}}}
 return known;
}
async function listenerPids(port){
 if(platform==='win32'){
  const {stdout}=await ps("$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort "+port+" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress");
  const value=JSON.parse(stdout||'[]');return (Array.isArray(value)?value:[value]).map(Number).filter(v=>Number.isInteger(v)&&v>0);
 }
 try{const {stdout}=await exec('/usr/sbin/lsof',['-nP','-a','-iTCP:'+port,'-sTCP:LISTEN','-Fp'],{timeout:5000,maxBuffer:1024*1024});return [...new Set(stdout.split('\n').flatMap(line=>/^p\d+$/.test(line)?[Number(line.slice(1))]:[]))];}
 catch(error){if(error.code===1)return[];throw error;}
}
const alive=child=>child&&child.exitCode===null&&child.signalCode===null;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopOwned(run){
 if(run.stopPromise)return run.stopPromise;
 run.stopPromise=(async()=>{
  if(!Number.isInteger(run.child?.pid)||run.child.pid<1)return;
  let rows=await processes().catch(()=>[]);
  // 종료된 부모의 PID만 보고 새 프로세스를 소유 목록에 추가하지 않습니다.
  if(alive(run.child)||run.owned.has(run.child.pid))tree(rows,run.child.pid,run.owned);
  if(platform==='win32'){
   if(alive(run.child)){
    const current=rows.find(r=>r.pid===run.child.pid),prior=run.owned.get(run.child.pid);
    if(current&&prior&&current.identity!==prior.identity)throw Error('음성 서버의 프로세스 식별자가 달라 중지를 보류했습니다.');
    await exec(path.win32.join(windowsRoot(),'System32','taskkill.exe'),['/PID',String(run.child.pid),'/T','/F'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024}).catch(error=>{if(alive(run.child))throw error;});
   }
  }else if(!run.groupReleased){
   try{process.kill(-run.child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  if(alive(run.child))await Promise.race([run.exited,wait(1600)]);
  rows=await processes().catch(()=>[]);
  // 분리된 하위 프로세스도 실행 때 기록한 시작 시각과 경로가 같을 때만 종료합니다.
  for(const record of [...run.owned.values()].reverse()){
   if(record.pid===process.pid)continue;const current=rows.find(r=>r.pid===record.pid);if(!current||current.identity!==record.identity)continue;
   if(platform==='win32')await exec(path.win32.join(windowsRoot(),'System32','taskkill.exe'),['/PID',String(record.pid),'/T','/F'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024}).catch(()=>{});
   else try{process.kill(record.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  if(platform!=='win32'&&!run.groupReleased){try{process.kill(-run.child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}run.groupReleased=true;}
  if(alive(run.child)){try{run.child.kill('SIGKILL');}catch{}await Promise.race([run.exited,wait(1600)]);}
  if(alive(run.child))throw Error('관리 중인 음성 서버의 종료를 확인하지 못했습니다.');
  const after=await processes().catch(()=>null);
  if(after&&after.some(row=>run.owned.get(row.pid)?.identity===row.identity))throw Error('음성 서버의 하위 프로세스가 아직 종료되지 않았습니다. 잠시 뒤 다시 확인해 주세요.');
 })();
 try{return await run.stopPromise;}catch(error){run.stopPromise=null;throw error;}
}
module.exports={processes,tree,listenerPids,stopOwned,alive};
