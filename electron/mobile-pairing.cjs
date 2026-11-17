const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {runtimePaths}=require('./runtime.cjs');
const {connectDesktop,stopBroker}=require('./mobile-bridge.cjs');
const isOrigin=v=>typeof v==='string' && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(v);
async function hash(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
// Windows keeps running EXEs locked. Keep this one opt-in transport outside
// the installation so replacing Flowrium never has to terminate its tunnel.
async function transportBinary(file,dir){
  if(process.platform!=='win32')return file;
  const digest=await hash(file),base=path.basename(file);
  const folder=path.join(dir,'mobile-transport');await fs.mkdir(folder,{recursive:true,mode:0o700});
  const target=path.join(folder,base.slice(0,-4)+'-'+digest+'.exe');
  try {if((await fs.lstat(target)).isFile() && await hash(target)===digest)return target;}catch(error){if(error.code!=='ENOENT')throw error;}
  const temp=target+'.'+randomUUID()+'.tmp';
  try{await fs.copyFile(file,temp);await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
  for(const f of await fs.readdir(folder)){if(f===path.basename(target)||!f.startsWith(base.slice(0,-4)+'-')||!/^([a-z]+)-[a-f0-9]{64}\.exe$/.test(f))continue;await fs.unlink(path.join(folder,f)).catch(()=>{});}
  return target;
}
async function launchBroker(directory,secret,paths=runtimePaths()){
  const [node,command,source]=await Promise.all([transportBinary(paths.node,directory),transportBinary(paths.cloudflared,directory),fs.readFile(path.join(__dirname,'mobile-bridge.cjs'),'utf8')]);
  // Run the bundled source, never a JS file from a user-writable cache.
  const script=source+'\nstartProcess();';
  const child=spawn(node,['--input-type=commonjs','-e',script],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',ELECTRON_RUN_AS_NODE:''}});
  return new Promise((resolve,reject)=>{
    const fail=()=>{clearTimeout(timer);child.kill();reject(Error('기기의 휴대폰 연결을 시작하지 못했습니다.'));};
    const timer=setTimeout(fail,45000);
    child.once('error',fail);child.once('exit',fail);
    child.once('message',message=>{
      if(!Number.isInteger(message.port)||!isOrigin(message.origin)){fail();return;}
      clearTimeout(timer);child.removeListener('exit',fail);child.unref();resolve({port:message.port,origin:message.origin,secret});
    });
    child.send({command,secret},error=>{if(error)fail();});
  });
}
class MobilePairing {
  constructor(directory,storage,launch=launchBroker){
    this.directory=directory;this.storage=storage;this.launch=launch;this.file=path.join(directory,'mobile-pairing-v1.json');this.queue=Promise.resolve();
  }
  async read(){
    try{const info=await fs.lstat(this.file);if(!info.isFile()||info.size>32768)return;
      const v=JSON.parse(this.storage.decryptString(Buffer.from(await fs.readFile(this.file,'utf8'),'base64')));
      if(v?.version===1 && typeof v.owner==='string' && /^[\w-]{43}$/.test(v.key) && /^[a-f\d]{64}$/.test(v.lease?.secret) && isOrigin(v.lease.origin) && Number.isInteger(v.lease.port) && v.lease.port>0 && v.lease.port<65536)return v;
    }catch(err){if(err.code!=='ENOENT')throw Error('저장된 휴대폰 연결을 읽지 못했습니다. 컴퓨터의 보안 저장소를 확인하세요.');}
  }
  serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
  open(owner,server,onClose,explicit){
    return this.serial(async()=>{
      let saved=await this.read();
      if(!explicit && (!saved||saved.owner!==owner))return null;
      if(!owner || !this.storage.isEncryptionAvailable())throw Error('휴대폰 연결을 보관하려면 계정 연결과 컴퓨터의 보안 저장소를 확인하세요.');
      if(saved && saved.owner!==owner){await stopBroker(saved.lease);await fs.unlink(this.file);saved=undefined;}
      if(saved){
        const attached=connectDesktop(saved.lease,server,onClose);
        try{await attached.ready;return {key:saved.key,origin:saved.lease.origin,close:attached.close};}catch{attached.close();}
      }
      // A released Quick Tunnel hostname can no longer protect its former token.
      const key=randomBytes(32).toString('base64url');
      const lease=await this.launch(this.directory,randomBytes(32).toString('hex'));
      const attached=connectDesktop(lease,server,onClose);
      const temp=this.file+'.'+randomUUID()+'.tmp';
      try{
        await attached.ready;
        const receipt=this.storage.encryptString(JSON.stringify({version:1,owner,key,lease}));
        await fs.writeFile(temp,receipt.toString('base64'),{mode:0o600,flag:'wx'});await fs.rename(temp,this.file);
        return {key,origin:lease.origin,close:attached.close};
      }catch(error){attached.close();await stopBroker(lease);throw error;}finally{await fs.rm(temp,{force:true});}
    });
  }
  revoke(){return this.serial(async()=>{
    let saved;try{saved=await this.read();}catch{}
    await fs.rm(this.file,{force:true});
    if(saved)await stopBroker(saved.lease);
  });}
}
module.exports={MobilePairing,launchBroker};
