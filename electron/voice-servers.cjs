const fs=require('node:fs/promises');
const fss=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const processes=require('./voice-server-process.cjs');
const IDS=['recognition','synthesis'];
const LABELS={recognition:'음성 인식 서버',synthesis:'음성 합성 서버'};
const MAX_CONFIG=256*1024,MAX_LOG=48*1024;
const BLOCKED_ENV=/^(?:HOME|USERPROFILE|CODEX_HOME|FLOWRIUM_USER_DATA|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|LD_PRELOAD|DYLD_.*|GIT_ASKPASS|SSH_ASKPASS)$/i;
const copy=value=>structuredClone(value);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stale=()=>Error('계정이나 잠금 상태가 바뀌었습니다. 음성 서버 설정을 다시 열어 주세요.');
function id(value){if(!IDS.includes(value))throw Error('관리할 음성 서버를 선택해 주세요.');return value;}
function endpoint(value){
 if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1(?::[1-9][0-9]{0,4})?\/?$/.test(value))throw Error('서버 주소는 http://127.0.0.1 주소와 포트만 사용할 수 있습니다.');
 const url=new URL(value);if(Number(url.port||80)>65535)throw Error('서버 포트를 확인해 주세요.');return url.origin;
}
function text(value,label,max,empty=true){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(!empty&&!value.trim()))throw Error(label+'을 확인해 주세요.');return value;}
function defaults(key){return{id:key,command:'',args:[],cwd:'',endpoint:'http://127.0.0.1:'+(key==='recognition'?9890:9880),healthPath:'',startupTimeoutMs:60000,environmentNames:[],encryptedEnvironment:''};}
function config(value,key){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('음성 서버 실행 설정을 확인해 주세요.');
 for(const field of Object.keys(value))if(!['command','args','cwd','endpoint','healthPath','startupTimeoutMs'].includes(field))throw Error('지원하지 않는 음성 서버 설정입니다.');
 const command=text(value.command,'실행 파일',4000).trim(),cwd=text(value.cwd,'작업 폴더',4000).trim();
 if(/[\r\n]/.test(command+cwd))throw Error('실행 파일과 폴더는 한 줄로 입력해 주세요.');
 if(!Array.isArray(value.args)||value.args.length>100||value.args.some(a=>typeof a!=='string'||a.length>8000||a.includes('\0'))||JSON.stringify(value.args).length>64000)throw Error('실행 인자는 한 줄에 하나씩 100개까지 입력해 주세요.');
 const healthPath=text(value.healthPath,'준비 확인 경로',300);
 if(healthPath&&(!/^\/[A-Za-z0-9_~.!$&'()+,;=:@%/\-]*$/.test(healthPath)||healthPath.startsWith('//')||/%(?:0[0-9a-f]|1[0-9a-f]|2[fF]|5[cC])/i.test(healthPath)||healthPath.split('/').includes('..')))throw Error('준비 확인 경로는 이 서버의 /health 같은 경로로 입력해 주세요.');
 if(!Number.isInteger(value.startupTimeoutMs)||value.startupTimeoutMs<3000||value.startupTimeoutMs>300000)throw Error('시작 대기 시간은 3초에서 300초 사이로 정해 주세요.');
 return{id:key,command,args:[...value.args],cwd,endpoint:endpoint(value.endpoint),healthPath,startupTimeoutMs:value.startupTimeoutMs};
}
function environment(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>40)throw Error('서버 환경변수는 40개까지 지정할 수 있습니다.');
 const output=Object.create(null);for(const [key,val]of Object.entries(value)){if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)||BLOCKED_ENV.test(key)||['__proto__','constructor','prototype'].includes(key)||typeof val!=='string'||val.length>16000||/[\0\r\n]/.test(val))throw Error('환경변수 이름과 값을 확인해 주세요. 시스템·앱 인증 경로는 변경할 수 없습니다.');output[key]=val;}
 if(Buffer.byteLength(JSON.stringify(output))>64000)throw Error('환경변수 설정이 너무 큽니다.');return output;
}
function publicConfig(value){const{encryptedEnvironment,...rest}=value;return rest;}
function portableConfig(value){const base={...value};delete base.id;delete base.environmentNames;delete base.encryptedEnvironment;return config(base,id(value.id));}
function publicRun(key,run){return run?{id:key,phase:run.phase,pid:run.pid,startedAt:run.startedAt,finishedAt:run.finishedAt,exitCode:run.exitCode,message:run.message,logs:copy(run.logs)}:{id:key,phase:'stopped',message:'시작하지 않았습니다.',logs:[]};}
function redact(text,secrets=[]){
 let result=String(text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g,'');
 for(const secret of [...new Set(secrets.filter(v=>typeof v==='string'&&v))].sort((a,b)=>b.length-a.length))result=result.split(secret).join('[보호됨]');
 return result.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[보호됨]').replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [보호됨]').replace(/\b((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;"']+/gi,'$1[보호됨]').slice(-12000);
}
function portOpen(address,timeout=450){return new Promise(resolve=>{const url=new URL(address),socket=net.connect({host:'127.0.0.1',port:Number(url.port||80)});let ended=false;const end=value=>{if(ended)return;ended=true;socket.destroy();resolve(value)};socket.setTimeout(timeout);socket.on('connect',()=>end(true));socket.on('error',()=>end(false));socket.on('timeout',()=>end(false));});}
async function freePort(address){const url=new URL(address);return new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen({host:'127.0.0.1',port:Number(url.port||80),exclusive:true},()=>server.close(()=>resolve(true)));});}
async function executable(command,cwd,env){
 if(!command)throw Error('실행 파일을 지정해 주세요.');
 let candidates;
 if(path.isAbsolute(command)||/[\\/]/.test(command))candidates=[path.resolve(cwd,command)];
 else{const key=Object.keys(env).find(k=>k.toLowerCase()==='path');const paths=(env[key]||'').split(path.delimiter);if(process.platform==='darwin')paths.push('/opt/homebrew/bin','/usr/local/bin');const ext=process.platform==='win32'?(path.extname(command)?['']:(env.PATHEXT||env.Pathext||'.EXE;.COM').split(';')):[''];candidates=paths.filter(Boolean).flatMap(dir=>ext.map(suffix=>path.join(dir,command+suffix)));}
 for(const candidate of candidates){try{const stat=await fs.stat(candidate);if(!stat.isFile())continue;if(process.platform==='win32'&&/\.(?:cmd|bat)$/i.test(candidate))continue;if(process.platform!=='win32')await fs.access(candidate,fss.constants.X_OK);return{command:candidate,target:await fs.realpath(candidate),fingerprint:[stat.dev,stat.ino,stat.size,stat.mtimeMs].join(':')};}catch{}}
 throw Error('실행 파일을 찾거나 실행할 수 없습니다. Python 가상환경의 실행 파일이나 서버 실행 파일을 선택해 주세요.');
}
function registerVoiceServers(register,options){
 const{directory,secretStorage,canRun=()=>true,accountRevision=()=>0,accountOwner,chooseServerPath,spawnImpl=spawn,processTools=processes,fetchImpl=fetch,baseEnv=process.env}=options;
 let queue=Promise.resolve(),closed=false,lastRevision=String(accountRevision()),pendingInvalidation=Promise.resolve(),tickBusy=false;
 const runs=new Map(),plans=new Map();
 const owner=()=>String(accountOwner?.()||'unverified:'+accountRevision());
 const revision=()=>String(accountRevision());
 const filename=who=>path.join(directory,'voice-servers-'+createHash('sha256').update(who).digest('hex').slice(0,24)+'.json');
 function assertAllowed(who,epoch){if(closed||!canRun()||who!==owner()||epoch!==revision())throw stale();}
 function serial(action){const result=queue.catch(()=>{}).then(action);queue=result;return result;}
 async function read(who){
  try{
   const file=filename(who),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_CONFIG)throw Error('음성 서버 설정 파일을 확인해 주세요.');
   const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.version!==1||!Number.isSafeInteger(saved.revision)||saved.revision<0||!saved.servers||typeof saved.servers!=='object')throw Error('음성 서버 설정 형식이 다릅니다.');
   const output={version:1,revision:saved.revision,servers:{}};
   for(const key of IDS){const raw=saved.servers[key]||defaults(key);const value=portableConfig(raw);if(value.id!==key||!Array.isArray(raw.environmentNames)||raw.environmentNames.length>40||raw.environmentNames.some(n=>!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(n))||typeof raw.encryptedEnvironment!=='string'||raw.encryptedEnvironment.length>100000)throw Error('음성 서버 환경 설정을 확인해 주세요.');output.servers[key]={...value,environmentNames:[...raw.environmentNames],encryptedEnvironment:raw.encryptedEnvironment};}
   return output;
  }catch(error){if(error.code==='ENOENT')return{version:1,revision:0,servers:Object.fromEntries(IDS.map(key=>[key,defaults(key)]))};throw error;}
 }
 async function write(who,value){await fs.mkdir(directory,{recursive:true,mode:0o700});const file=filename(who),temporary=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}}
 function record(run,stream,value){const line={at:new Date().toISOString(),stream,text:redact(value,run.secrets)};if(!line.text)return;run.logs.push(line);while(run.logs.length>180||run.logs.reduce((total,row)=>total+row.text.length,0)>MAX_LOG)run.logs.shift();}
 function current(key,who=owner()){const run=runs.get(key);return run?.owner===who?run:undefined;}
 async function state(){const who=owner(),epoch=revision();assertAllowed(who,epoch);const saved=await read(who);assertAllowed(who,epoch);return{revision:saved.revision,servers:IDS.map(key=>({config:publicConfig(saved.servers[key]),run:publicRun(key,current(key,who))}))};}
 function appendOutput(run,stream,chunk,finish=false){
  const decoder=run.decoders[stream],value=(chunk?decoder.write(chunk):'')+(finish?decoder.end():'');
  run.buffers[stream]+=value;
  const lines=run.buffers[stream].split('\n');run.buffers[stream]=lines.pop();
  for(const line of lines){if(run.dropping[stream]){run.dropping[stream]=false;continue;}record(run,stream,line+'\n');}
  if(run.buffers[stream].length>128*1024){run.buffers[stream]='';run.dropping[stream]=true;record(run,'system','너무 긴 로그 한 줄을 생략했습니다.');}
  if(finish){if(!run.dropping[stream])record(run,stream,run.buffers[stream]);run.buffers[stream]='';}
 }
 async function capture(run){if(!Number.isInteger(run.child?.pid)||(!processTools.alive(run.child)&&!run.owned.has(run.child.pid)))return;try{const rows=await processTools.processes();if(processTools.alive(run.child)||run.owned.has(run.child.pid))processTools.tree(rows,run.child.pid,run.owned);}catch(error){run.captureError=error;}}
 async function stop(run,reason='사용자가 중지했습니다.'){
  if(!run||run.cleanup)return run?.cleanup;
  run.cancelled=true;run.phase='stopping';run.message='서버를 중지하고 있습니다.';clearInterval(run.watcher);
  run.cleanup=(async()=>{try{await processTools.stopOwned(run);run.cleanupFailed=false;run.phase='stopped';run.message=reason;run.finishedAt=new Date().toISOString();record(run,'system',reason);}catch(error){run.cleanupFailed=true;run.phase='failed';run.message='하위 프로세스의 종료를 확인하지 못했습니다. 다시 중지를 눌러 주세요.';record(run,'system',error.message);run.cleanup=null;throw error;}})();return run.cleanup;
 }
 function invalidate(reason='계정 또는 잠금 상태가 바뀌어 음성 서버를 중지했습니다.'){
  plans.clear();const old=[...runs.values()].filter(run=>!['stopped','external'].includes(run.phase));
  const result=Promise.allSettled(old.map(run=>stop(run,reason))).then(results=>{const failure=results.find(v=>v.status==='rejected');if(failure)throw failure.reason;});
  pendingInvalidation=Promise.allSettled([pendingInvalidation,result]).then(results=>{const failure=results.find(v=>v.status==='rejected');if(failure)throw failure.reason;});pendingInvalidation.catch(()=>{});return result;
 }
 async function plan(key){
  id(key);const who=owner(),epoch=revision();assertAllowed(who,epoch);const saved=await read(who),value=saved.servers[key];
  if(!value.cwd||!path.isAbsolute(value.cwd))throw Error('서버의 절대 작업 폴더를 선택해 주세요.');
  const cwd=await fs.realpath(value.cwd);if(!(await fs.stat(cwd)).isDirectory())throw Error('서버 작업 폴더를 찾을 수 없습니다.');
  const env=require('./runtime.cjs').runtimeEnvironment(baseEnv),binary=await executable(value.command,cwd,env);assertAllowed(who,epoch);
  const token=randomUUID(),expires=Date.now()+90000,descriptor={...binary,cwd};plans.set(token,{id:key,owner:who,epoch,revision:saved.revision,expires,descriptor});
  while(plans.size>20)plans.delete(plans.keys().next().value);
  return{id:key,token,expiresAt:new Date(expires).toISOString(),command:binary.command,args:[...value.args],cwd,endpoint:value.endpoint,healthPath:value.healthPath,environmentNames:[...value.environmentNames],notice:'사용자가 준비한 포그라운드 서버를 실행합니다. 모델은 설치하지 않으며 본 앱에서 시작한 프로세스만 중지합니다.'};
 }
 async function health(value){if(!await portOpen(value.endpoint))return false;if(!value.healthPath)return true;try{const res=await fetchImpl(value.endpoint+value.healthPath,{method:'GET',redirect:'error',signal:AbortSignal.timeout(1500)});try{return res.ok;}finally{await res.body?.cancel?.().catch(()=>{});}}catch{return false;}}
 async function settleReady(run,value){
  const deadline=Date.now()+value.startupTimeoutMs;
  try{
   while(Date.now()<deadline){
    if(run.cancelled||closed||run.owner!==owner()||run.epoch!==revision()||!canRun()){await stop(run,'계정 또는 잠금 상태가 바뀌어 중지했습니다.');return;}
    if(!processTools.alive(run.child))throw Error('서버가 준비되기 전에 종료됐습니다. 실행 명령과 로그를 확인해 주세요.');
    if(await health(value)){
     await capture(run);const owners=await processTools.listenerPids(Number(new URL(value.endpoint).port||80));
     if(owners.length&&!owners.every(pid=>run.owned.has(pid)))throw Error('다른 프로그램이 서버 포트를 사용합니다. 본 앱의 실행만 중지했습니다.');
     if(!owners.length)throw Error('서버 포트를 본 앱의 프로세스로 확인하지 못했습니다.');
     if(run.cancelled||run.owner!==owner()||run.epoch!==revision()||!canRun()){await stop(run);return;}
     run.phase='running';run.message=value.healthPath?'준비 확인 요청에 응답했습니다.':'본 앱의 서버 포트가 열렸습니다. 모델 동작은 실제 음성 입력에서 확인합니다.';record(run,'system',run.message);return;
    }
    await delay(250);
   }
   throw Error('서버 시작 대기 시간을 넘었습니다. 명령 / 포트 / 모델 경로를 확인해 주세요.');
  }catch(error){if(run.cancelled)return;const message=error.message;await stop(run,'시작하지 못해 본 앱의 실행을 정리했습니다.').catch(()=>{});run.phase='failed';run.message=message;record(run,'system',message);}
 }
 async function start(key,token,restart=false){
  const who=owner(),epoch=revision();assertAllowed(who,epoch);const prepared=plans.get(token);plans.delete(token);
  if(!prepared||prepared.id!==key||prepared.owner!==who||prepared.epoch!==epoch||prepared.expires<Date.now())throw Error('실행 미리보기가 만료되거나 바뀌었습니다. 다시 확인해 주세요.');
  const saved=await read(who);if(prepared.revision!==saved.revision)throw Error('서버 설정이 바뀌었습니다. 실행 미리보기를 다시 확인해 주세요.');
  const old=runs.get(key);if(old&&(['starting','running','stopping'].includes(old.phase)||old.cleanupFailed||processTools.alive(old.child))){if(old.owner===who&&['starting','running','stopping'].includes(old.phase)&&!restart)throw Error('이미 본 앱에서 실행 중인 음성 서버입니다.');await stop(old,'새 실행을 위해 이전 서버를 중지했습니다.');}
  const value=saved.servers[key],binary=await executable(value.command,prepared.descriptor.cwd,require('./runtime.cjs').runtimeEnvironment(baseEnv));
  if(binary.command!==prepared.descriptor.command||binary.target!==prepared.descriptor.target||binary.fingerprint!==prepared.descriptor.fingerprint)throw Error('실행 파일이 미리보기 이후 바뀌었습니다. 다시 확인해 주세요.');
  if(await fs.realpath(value.cwd)!==prepared.descriptor.cwd)throw Error('작업 폴더가 바뀌었습니다. 다시 선택해 주세요.');
  if(!await freePort(value.endpoint)){const run={id:key,owner:who,epoch,phase:'external',message:'이미 다른 프로그램이 이 포트를 사용합니다. 기존 서버는 종료하지 않았습니다.',logs:[],secrets:[]};runs.set(key,run);record(run,'system',run.message);throw Error(run.message);}
  let env={};if(value.encryptedEnvironment){if(!secretStorage?.isEncryptionAvailable?.())throw Error('환경변수를 열 운영체제 보안 저장소를 사용할 수 없습니다.');try{env=environment(JSON.parse(secretStorage.decryptString(Buffer.from(value.encryptedEnvironment,'base64'))));}catch{throw Error('저장한 서버 환경변수를 열지 못했습니다. 다시 입력해 주세요.');}}
  assertAllowed(who,epoch);const run={id:key,owner:who,epoch,phase:'starting',message:'서버의 시작을 기다리고 있습니다.',logs:[],secrets:Object.values(env),decoders:{stdout:new StringDecoder('utf8'),stderr:new StringDecoder('utf8')},buffers:{stdout:'',stderr:''},dropping:{stdout:false,stderr:false},owned:new Map(),startedAt:new Date().toISOString(),cancelled:false};
  const childEnv={...require('./runtime.cjs').runtimeEnvironment(baseEnv)};
  for(const name of Object.keys(childEnv))if(/^(?:OPENAI_API_KEY|OPENAI_ACCESS_TOKEN|CODEX_ACCESS_TOKEN|GH_TOKEN|GITHUB_TOKEN|ELECTRON_RUN_AS_NODE)$/i.test(name))delete childEnv[name];
  Object.assign(childEnv,env);
  run.child=spawnImpl(binary.command,value.args,{cwd:prepared.descriptor.cwd,env:childEnv,shell:false,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});run.pid=run.child.pid;
  run.exited=new Promise(resolve=>{run.child.once('exit',(code,signal)=>{run.exitCode=code;run.finishedAt=new Date().toISOString();record(run,'system','서버 실행 종료 / '+(code===null?(signal||'종료'):code));resolve();if(!run.cancelled){const message='서버가 종료됐습니다. 실행 로그를 확인해 주세요.';void stop(run,message).then(()=>{run.phase=code===0?'stopped':'failed';run.message=message;}).catch(()=>{});}});run.child.once('error',error=>{run.exitCode=null;record(run,'system',error.message);resolve();if(!run.cancelled)void stop(run,'서버를 시작하지 못했습니다. 실행 파일을 확인해 주세요.').then(()=>{run.phase='failed';run.message='서버를 시작하지 못했습니다. 실행 파일을 확인해 주세요.';}).catch(()=>{});});});
  run.child.stdout?.on('data',chunk=>appendOutput(run,'stdout',chunk));run.child.stderr?.on('data',chunk=>appendOutput(run,'stderr',chunk));run.child.stdout?.once('end',()=>appendOutput(run,'stdout',null,true));run.child.stderr?.once('end',()=>appendOutput(run,'stderr',null,true));runs.set(key,run);record(run,'system',LABELS[key]+' 실행을 시작했습니다.');
  run.watcher=setInterval(()=>{if(run.captureBusy||run.cancelled)return;run.captureBusy=true;void capture(run).finally(()=>{run.captureBusy=false;});},1000);run.watcher.unref?.();
  await capture(run);void settleReady(run,value);return state();
 }
 register('voiceServersState',state);
 register('configureVoiceServer',input=>serial(async()=>{
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['id','revision','config','environment'].includes(k)))throw Error('음성 서버 저장 요청을 확인해 주세요.');const key=id(input.id),who=owner(),epoch=revision();assertAllowed(who,epoch);const saved=await read(who);if(input.revision!==saved.revision)throw Error('다른 화면에서 서버 설정이 바뀌었습니다. 다시 불러와 주세요.');
  if(current(key,who)&&(['starting','running','stopping'].includes(current(key,who).phase)||current(key,who).cleanupFailed||processTools.alive(current(key,who).child)))throw Error('서버를 중지한 뒤 실행 설정을 변경해 주세요.');
  const value=config(input.config,key),prior=saved.servers[key];let encryptedEnvironment=prior.encryptedEnvironment,environmentNames=prior.environmentNames;
  if(input.environment!==undefined){const values=environment(input.environment);environmentNames=Object.keys(values);if(environmentNames.length){if(!secretStorage?.isEncryptionAvailable?.())throw Error('서버 환경변수 저장에 운영체제 보안 저장소가 필요합니다.');encryptedEnvironment=secretStorage.encryptString(JSON.stringify(values)).toString('base64');}else encryptedEnvironment='';}
  saved.servers[key]={...value,environmentNames,encryptedEnvironment};saved.revision++;assertAllowed(who,epoch);await write(who,saved);plans.clear();assertAllowed(who,epoch);return state();
 }));
 register('previewVoiceServer',key=>serial(()=>plan(id(key))));
 register('voiceServerAction',input=>serial(async()=>{
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['id','action','token'].includes(k)))throw Error('음성 서버 작업을 확인해 주세요.');const key=id(input.id),who=owner(),epoch=revision();assertAllowed(who,epoch);
  if(input.action==='start'||input.action==='restart')return start(key,input.token,input.action==='restart');
  if(input.action==='stop'){const run=current(key,who);await stop(run);if(run&&!run.cleanupFailed){run.phase='stopped';run.message='서버 실행의 종료를 확인했습니다.';}return state();}
  if(input.action==='clearLogs'){const run=current(key,who);if(run)run.logs=[];return state();}
  if(input.action==='probe'){const saved=await read(who);let run=current(key,who);if(run&&(['starting','running','stopping'].includes(run.phase)||run.cleanupFailed||processTools.alive(run.child)))return state();const occupied=await portOpen(saved.servers[key].endpoint);assertAllowed(who,epoch);run={id:key,owner:who,epoch,phase:occupied?'external':'stopped',message:occupied?'이 포트에는 기존 서버가 응답합니다. 본 앱에서 시작한 실행이 아니므로 종료하지 않습니다.':'현재 서버 포트가 열려 있지 않습니다.',logs:[],secrets:[]};runs.set(key,run);return state();}
  throw Error('지원하지 않는 음성 서버 작업입니다.');
 }));
 register('chooseVoiceServerPath',async kind=>{if(!['directory','executable'].includes(kind))throw Error('선택할 경로 종류를 확인해 주세요.');const who=owner(),epoch=revision();assertAllowed(who,epoch);if(!chooseServerPath)throw Error('이 기기에서 경로 선택 창을 사용할 수 없습니다. 직접 경로를 입력해 주세요.');const result=await chooseServerPath(kind);assertAllowed(who,epoch);return result;});
 const timer=setInterval(()=>{if(tickBusy)return;const changed=lastRevision!==revision();lastRevision=revision();const oldOwned=[...runs.values()].some(run=>(run.owner!==owner()||run.epoch!==revision())&&(run.cleanupFailed||processTools.alive(run.child)||['starting','running','stopping'].includes(run.phase)));if(closed||(!changed&&canRun()&&!oldOwned))return;tickBusy=true;void invalidate().catch(()=>{}).finally(()=>{tickBusy=false;});},350);timer.unref?.();
 return{invalidate,isBusy:()=>[...runs.values()].some(run=>run.cleanupFailed||processTools.alive(run.child)||['starting','running','stopping'].includes(run.phase)),async shutdown(){closed=true;clearInterval(timer);plans.clear();await invalidate('앱을 종료해 관리 중인 음성 서버를 중지했습니다.');await pendingInvalidation;await queue.catch(()=>{});}};
}
module.exports={registerVoiceServers,config,environment,endpoint,redact,executable,portableConfig,defaults,portOpen,freePort};
