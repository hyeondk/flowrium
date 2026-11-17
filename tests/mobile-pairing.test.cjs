const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {MobilePairing}=require('../electron/mobile-pairing.cjs');
const {runBroker}=require('../electron/mobile-bridge.cjs');
const {registerRemote}=require('../electron/remote.cjs');

test('저장된 휴대폰 연결은 앱 교체 후 원래 주소와 키로 돌아오며 연결 해제와 계정 교체 시 폐기된다',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-pairing-'));
  const cipherKey=randomBytes(32);
  const storage={isEncryptionAvailable:()=>true,encryptString(text){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cipherKey,iv);
    const data=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);
  },decryptString(data){
    const d=createDecipheriv('aes-256-gcm',cipherKey,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));
    return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString();
  }};
  let created=0,proxyPort,controlPort,locked=false,owner='test-account',revision=0,active;
  const brokers=new Set();
  const launch=async(_directory,secret)=>{
    const result=Promise.withResolvers();
    const origin='https://pairing-'+(++created)+'.trycloudflare.com';
    const close=await runBroker({secret},({port,error})=>error?result.reject(Error(error)):result.resolve(port),port=>{
      proxyPort=port;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
      child.kill=()=>{};setImmediate(()=>child.stderr.emit('data',origin+' Registered tunnel connection'));return child;
    });
    brokers.add(close);controlPort=await result.promise;return {port:controlPort,secret,origin};
  };
  const startApp=()=>{
    const handlers=new Map(),controller=new EventEmitter();
    controller.runs=new Map();controller.status={authenticated:false};controller.connectionStatus=async()=>controller.status;
    const pairing=new MobilePairing(dir,storage,launch);
    const service=registerRemote((k,v)=>handlers.set(k,v),{pairing,controller,handlers,accountRevision:()=>revision,accountOwner:()=>owner,isLocked:()=>locked,
      store:{state:{settings:{theme:'dark',accentColor:'purple',password:'private'},projects:[],sessions:[]}},version:'261117_01'});
    controller.status.authenticated=true;controller.emit('event',{type:'status',status:'connected'});
    active=service;return {service,handlers};
  };
  const get=(port,route,host,token)=>new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:route,headers:{host,...token&&{Authorization:'Bearer '+token}},agent:false},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()}));
    });req.setTimeout(4000,()=>req.destroy(Error('시한 초과')));req.on('error',reject);
  });
  const waitFor=async(fn)=>{for(let i=0;i<200;i++){const res=await fn();if(res)return res;await new Promise(r=>setTimeout(r,15));}throw Error('연결 자동 복원 지연');};
  try{
    const first=startApp();await new Promise(r=>setTimeout(r,25));assert.equal(created,0);
    const initial=await first.handlers.get('startRemoteAccess')();const url=new URL(initial.url);
    const token=new URLSearchParams(url.hash.slice(1)).get('key'),file=path.join(dir,'mobile-pairing-v1.json');
    assert(!(await fs.readFile(file,'utf8')).includes(token));
    assert.equal((await get(controlPort,'/listen','127.0.0.1')).status,403);
    assert.equal((await get(proxyPort,'/api/mobile/state',url.host,'x')).status,401);
    let res=await get(proxyPort,'/api/mobile/state',url.host,token);assert.equal(res.status,200);assert.equal(JSON.parse(res.text).settings.theme,'dark');assert(!res.text.includes('private'));
    locked=true;assert.equal((await get(proxyPort,'/api/mobile/state',url.host,token)).status,403);locked=false;
    await first.service.shutdown();
    await waitFor(async()=>{try{return (await get(proxyPort,'/api/mobile/state',url.host,token)).status===503;}catch{return false;}});
    const second=startApp();await waitFor(()=>second.service.state().url===initial.url);
    assert.equal(created,1);assert.equal((await get(proxyPort,'/api/mobile/state',url.host,token)).status,200);
    revision++;owner='other-account';assert.equal((await get(proxyPort,'/api/mobile/state',url.host,token)).status,401);
    await second.service.stopAccess();await assert.rejects(fs.stat(file),{code:'ENOENT'});
    const other=await second.handlers.get('startRemoteAccess')();assert.notEqual(other.url,initial.url);assert.equal(created,2);
    assert.equal((await get(proxyPort,'/api/mobile/state',new URL(other.url).host,token)).status,401);
    await second.handlers.get('stopRemoteAccess')();await assert.rejects(fs.stat(file),{code:'ENOENT'});
  }finally{await active?.shutdown();for(const stop of brokers)stop();await fs.rm(dir,{recursive:true,force:true});}
});
