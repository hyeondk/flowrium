const fs=require('node:fs/promises');
const {constants,createReadStream,readFileSync}=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {runtimePaths}=require('./runtime.cjs');
const {connectDesktop,stopBroker}=require('./mobile-bridge.cjs');
const {fetchRelayProbe}=require('./relay-public-probe.cjs');
const isOrigin=v=>typeof v==='string' && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(v);
const validVersion=v=>typeof v==='string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v);
const validRuntime=v=>validVersion(v?.node) && validVersion(v?.cloudflared) && /^[a-f\d]{64}$/.test(v?.bridge);
const validBinary=(v,role)=>typeof v==='string' && v.startsWith(role+'-') && /-[a-f\d]{64}(\.exe)?$/.test(v) &&
  v.length===role.length+65+(process.platform==='win32'?4:0) && path.basename(v)===v;
const validBinaries=v=>validBinary(v?.node,'node') && validBinary(v?.cloudflared,'cloudflared');
async function hash(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
function installedRuntime(paths=runtimePaths()){
  try {
    const {versions}=JSON.parse(readFileSync(path.join(paths.root,'flowrium-runtime.json'),'utf8'));
    const bridge=createHash('sha256').update(readFileSync(path.join(__dirname,'mobile-bridge.cjs'))).digest('hex');
    const runtime={node:versions.node,cloudflared:versions.cloudflared,bridge};
    return validRuntime(runtime)?runtime:undefined;
  } catch { return undefined; }
}
async function transportFolder(dir){
  const folder=path.join(dir,'mobile-transport');
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  if(!(await fs.lstat(folder)).isDirectory())throw Error('휴대폰 중계 저장 폴더를 확인해 주세요.');
  return folder;
}
// The broker and its child outlive the app. Store their verified executables
// outside the replaceable application on both Mac and Windows.
async function transportBinary(file,folder,role){
  const digest=await hash(file),ext=process.platform==='win32'?'.exe':'';
  const target=path.join(folder,role+'-'+digest+ext);
  try {
    if((await fs.lstat(target)).isFile() && await hash(target)===digest){
      await fs.access(target,constants.X_OK);return target;
    }
  }catch(error){if(error.code!=='ENOENT' && error.code!=='EACCES')throw error;}
  const temp=target+'.'+randomUUID()+'.tmp';
  try {
    await fs.copyFile(file,temp,constants.COPYFILE_EXCL);
    if(await hash(temp)!==digest)throw Error('휴대폰 중계 실행 파일을 검증하지 못했습니다.');
    if(process.platform!=='win32')await fs.chmod(temp,0o700);
    await fs.rename(temp,target);
  }finally{await fs.rm(temp,{force:true});}
  return target;
}
async function launchBroker(directory,secret,paths=runtimePaths()){
  const folder=await transportFolder(directory);
  const [node,command,source]=await Promise.all([transportBinary(paths.node,folder,'node'),transportBinary(paths.cloudflared,folder,'cloudflared'),fs.readFile(path.join(__dirname,'mobile-bridge.cjs'),'utf8')]);
  // Run the bundled source, never a JS file from a user-writable cache.
  const script=source+'\nstartProcess();';
  const child=spawn(node,['--input-type=commonjs','-e',script],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',ELECTRON_RUN_AS_NODE:''}});
  return new Promise((resolve,reject)=>{
    const fail=()=>{clearTimeout(timer);child.kill();reject(Error('기기의 휴대폰 연결을 시작하지 못했습니다.'));};
    const timer=setTimeout(fail,45000);
    child.once('error',fail);child.once('exit',fail);
    child.once('message',message=>{
      if(!Number.isInteger(message.port)||!isOrigin(message.origin)){fail();return;}
      clearTimeout(timer);child.removeListener('exit',fail);child.unref();
      resolve({port:message.port,origin:message.origin,secret,runtime:installedRuntime(paths),binaries:{node:path.basename(node),cloudflared:path.basename(command)}});
    });
    child.send({command,secret},error=>{if(error)fail();});
  });
}
async function confirmPublicRelay(lease,fetchPublic){
  const host=new URL(lease.origin).host,challenge=randomBytes(32).toString('hex'),route='/relay-check/'+randomUUID();
  const probe=http.createServer((req,res)=>{
    if(req.method!=='GET'||req.headers.host!==host||req.url!==route){res.writeHead(404).end();return;}
    res.writeHead(200,{'Cache-Control':'no-store','Content-Length':challenge.length}).end(challenge);
  });
  let link;
  try {
    await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
    link=connectDesktop(lease,probe,()=>{});await link.ready;
    const deadline=Date.now()+25000;
    do {
      try {
        const response=await fetchPublic(lease.origin+route,{redirect:'error',signal:AbortSignal.timeout(3500)});
        if(response.status===200 && Number(response.headers.get('content-length'))===challenge.length && await response.text()===challenge)return;
        await response.body?.cancel();
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,750));
    }while(Date.now()<deadline);
    throw Error('새 중계의 외부 접속을 확인하지 못했습니다. 기존 휴대폰 연결을 유지합니다.');
  }finally{
    link?.close();probe.closeAllConnections();probe.close();
  }
}
class MobilePairing {
  constructor(directory,storage,launch=launchBroker,{runtime=installedRuntime(),fetchPublic=fetchRelayProbe}={}){
    this.directory=directory;this.storage=storage;this.launch=launch;this.file=path.join(directory,'mobile-pairing-v1.json');this.queue=Promise.resolve();
    this.runtime=runtime;this.fetchPublic=fetchPublic;
  }
  async read(){
    try{const info=await fs.lstat(this.file);if(!info.isFile()||info.size>32768)return;
      const v=JSON.parse(this.storage.decryptString(Buffer.from(await fs.readFile(this.file,'utf8'),'base64')));
      if(v?.version===1 && typeof v.owner==='string' && /^[\w-]{43}$/.test(v.key) && /^[a-f\d]{64}$/.test(v.lease?.secret) && isOrigin(v.lease.origin) && Number.isInteger(v.lease.port) && v.lease.port>0 && v.lease.port<65536)return v;
    }catch(err){if(err.code!=='ENOENT')throw Error('저장된 휴대폰 연결을 읽지 못했습니다. 컴퓨터의 보안 저장소를 확인하세요.');}
  }
  serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
  link(saved,attached){
    const running=validRuntime(saved.lease.runtime)?saved.lease.runtime:undefined,available=this.runtime;
    const relay=available&&{version:running?.cloudflared,availableVersion:available.cloudflared,
      canUpdate:!running||running.node!==available.node||running.cloudflared!==available.cloudflared||running.bridge!==available.bridge};
    return {key:saved.key,origin:saved.lease.origin,close:attached.close,relay};
  }
  async provision(owner,server,onClose,{beforeAttach,assertCurrent=()=>{},activate,rollback}={}){
    // A released public hostname cannot protect its former token.
    const key=randomBytes(32).toString('base64url');
    const lease=await this.launch(this.directory,randomBytes(32).toString('hex'));
    const saved={version:1,owner,key,lease};
    const temp=this.file+'.'+randomUUID()+'.tmp';
    let attached,recorded=false;
    try {
      await beforeAttach?.(lease);
      attached=connectDesktop(lease,server,onClose);
      await attached.ready;
      const receipt=this.storage.encryptString(JSON.stringify(saved));
      await fs.writeFile(temp,receipt.toString('base64'),{mode:0o600,flag:'wx'});
      assertCurrent();
      if(!attached.isOpen())throw Error('새 휴대폰 중계 연결이 종료됐습니다.');
      await fs.rename(temp,this.file);
      recorded=true;
      assertCurrent();
      if(!attached.isOpen())throw Error('새 휴대폰 중계 연결이 종료됐습니다.');
      const link=this.link(saved,attached);
      activate?.(link);
      return {saved,link};
    }catch(error){
      attached?.close();
      await stopBroker(lease);
      if(recorded && rollback){
        rollback.preserve=true;
        await fs.rename(rollback.path,this.file);
        rollback.preserve=false;
      }
      throw error;
    }
    finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  async retire(previous,current){
    if(!await stopBroker(previous)||!validBinaries(previous.binaries))return;
    const folder=await transportFolder(this.directory);
    for(const role of ['node','cloudflared']){
      const file=previous.binaries[role];
      if(file===current?.binaries?.[role])continue;
      const target=path.join(folder,file);
      for(let attempt=0;attempt<10;attempt++){
        try{await fs.unlink(target);break;}catch(error){
          if(error.code!=='EPERM' && error.code!=='EBUSY' && error.code!=='EACCES')break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }
    }
  }
  open(owner,server,onClose,explicit){
    return this.serial(async()=>{
      let saved=await this.read();
      if(!explicit && (!saved||saved.owner!==owner))return null;
      if(!owner || !this.storage.isEncryptionAvailable())throw Error('휴대폰 연결을 보관하려면 계정 연결과 컴퓨터의 보안 저장소를 확인하세요.');
      if(saved && saved.owner!==owner){await stopBroker(saved.lease);await fs.unlink(this.file);saved=undefined;}
      if(saved){
        const attached=connectDesktop(saved.lease,server,onClose);
        try{await attached.ready;return this.link(saved,attached);}catch{attached.close();}
        if(!explicit)throw Error('기존 휴대폰 중계에 다시 연결하고 있습니다.');
      }
      const beforeAttach=saved?lease=>confirmPublicRelay(lease,this.fetchPublic):undefined;
      const next=await this.provision(owner,server,onClose,{beforeAttach});
      if(saved)await this.retire(saved.lease,next.saved.lease).catch(()=>{});
      return next.link;
    });
  }
  update(owner,server,onClose,assertCurrent,activate){
    return this.serial(async()=>{
      const previous=await this.read();
      if(!previous||previous.owner!==owner||!this.storage.isEncryptionAvailable())throw Error('현재 휴대폰 연결을 먼저 확인해 주세요.');
      assertCurrent();
      const rollback={path:this.file+'.'+randomUUID()+'.tmp',preserve:false};
      const beforeAttach=lease=>{
        if(lease.origin===previous.lease.origin)throw Error('새 휴대폰 중계 주소를 준비하지 못했습니다.');
        return confirmPublicRelay(lease,this.fetchPublic);
      };
      try {
        await fs.copyFile(this.file,rollback.path,constants.COPYFILE_EXCL);
        const next=await this.provision(owner,server,onClose,{beforeAttach,assertCurrent,activate,rollback});
        await this.retire(previous.lease,next.saved.lease).catch(()=>{});
        return next.link;
      }finally{if(!rollback.preserve)await fs.rm(rollback.path,{force:true}).catch(()=>{});}
    });
  }
  revoke(){return this.serial(async()=>{
    let saved;try{saved=await this.read();}catch{}
    await fs.rm(this.file,{force:true});
    if(saved)await this.retire(saved.lease).catch(()=>{});
  });}
}
module.exports={MobilePairing,launchBroker};
