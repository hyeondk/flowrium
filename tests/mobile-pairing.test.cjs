const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto');
const {MobilePairing,launchBroker}=require('../electron/mobile-pairing.cjs');
const {runBroker}=require('../electron/mobile-bridge.cjs');
const {fetchRelayProbe}=require('../electron/relay-public-probe.cjs');
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

test('실제 분리된 중계 프로세스와 기기 재접속', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-mobile-transport-'));
  const previous=process.cwd(), windows=process.platform==='win32';
  const file=path.join(dir,'tunnel'),executable=windows?path.join(dir,'cloudflared.exe'):process.execPath;
  let lease,link,server;
  try {
    await fs.writeFile(file,'console.error("https://detached-fixture.trycloudflare.com Registered tunnel connection");setInterval(()=>{},10000);\n');
    // Node receives the same "tunnel" argument as cloudflared. Both platforms
    // run a real detached process without connecting to an outside service.
    if(windows)await fs.copyFile(process.execPath,executable);
    process.chdir(dir);
    try {
      const secret=randomBytes(32).toString('hex');
      lease=await launchBroker(dir,secret,{node:process.execPath,cloudflared:executable});
    }finally{process.chdir(previous);}
    assert.equal(lease.origin,'https://detached-fixture.trycloudflare.com');
    const cached=await fs.readdir(path.join(dir,'mobile-transport'));
    assert.deepEqual(cached.sort(),Object.values(lease.binaries).sort());
    assert.match(lease.binaries.node,/^node-[a-f0-9]{64}(\.exe)?$/);
    assert.match(lease.binaries.cloudflared,/^cloudflared-[a-f0-9]{64}(\.exe)?$/);
    server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const {connectDesktop}=require('../electron/mobile-bridge.cjs');
    link=connectDesktop(lease,server,()=>{});await link.ready;link.close();
    link=connectDesktop(lease,server,()=>{});await link.ready;
  }finally{
    link?.close();if(lease)await require('../electron/mobile-bridge.cjs').stopBroker(lease);
    if(server)await new Promise(r=>server.close(r));
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

test('기존 휴대폰 중계는 새 공개 접속과 영수증 교체가 끝날 때까지 유지된다',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-relay-update-'));
  const file=path.join(dir,'mobile-pairing-v1.json');
  const current={node:'24.22.3',cloudflared:'2026.11.1',bridge:'a'.repeat(64)};
  const storage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:buffer=>buffer.toString()};
  const brokers=new Map();
  const controller=new EventEmitter(),handlers=new Map();
  const verified=[];
  let created=0,revision=0,gate;
  const launch=async(_directory,secret)=>{
    const ready=Promise.withResolvers(),profile=++created;
    const origin=`https://relay-update-${profile}.trycloudflare.com`;
    let proxy;
    const close=await runBroker({secret},({port,error})=>error?ready.reject(Error(error)):ready.resolve(port),port=>{
      proxy=port;
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
      setImmediate(()=>child.stderr.emit('data',origin+' Registered tunnel connection'));
      return child;
    });
    const port=await ready.promise;
    brokers.set(origin,{close,proxy,port});
    return {port,secret,origin,runtime:profile===1?undefined:current};
  };
  const request=(port,route,host,token)=>new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:route,headers:{host,...token&&{Authorization:'Bearer '+token}},agent:false},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.setTimeout(3500,()=>req.destroy(Error('접속 확인 시간 초과')));req.on('error',reject);
  });
  const pairing=new MobilePairing(dir,storage,launch,{runtime:current,fetchPublic:async url=>{
    const target=new URL(url);
    verified.push(target.origin);
    if(gate){gate.started.resolve();await gate.resume.promise;}
    return request(brokers.get(target.origin).proxy,target.pathname,target.host);
  }});
  controller.runs=new Map();controller.status={authenticated:true};controller.connectionStatus=async()=>controller.status;
  const startApp=()=>registerRemote((key,value)=>handlers.set(key,value),{pairing,controller,handlers,accountRevision:()=>revision,
    accountOwner:()=>'test-account',isLocked:()=>false,store:{state:{settings:{},projects:[],sessions:[]}},version:'261123_09'});
  let service=startApp();
  const mobile=(value,token)=>{
    const url=new URL(value),key=token??new URLSearchParams(url.hash.slice(1)).get('key');
    return request(brokers.get(url.origin).proxy,'/api/mobile/state',url.host,key);
  };
  const rename=fs.rename;
  try {
    const initial=await handlers.get('startRemoteAccess')();
    const saved=await fs.readFile(file,'utf8');
    assert.deepEqual(initial.relay,{version:undefined,availableVersion:'2026.11.1',canUpdate:true});
    assert.equal((await mobile(initial.url)).status,200);
    fs.rename=async (source,target)=>{
      await rename(source,target);
      if(target===file){revision++;fs.rename=rename;}
    };
    await assert.rejects(handlers.get('updateRemoteRelay')(),/연결 상태가 바뀌어/);
    revision--;
    assert.equal(await fs.readFile(file,'utf8'),saved);
    assert.equal(service.state().url,initial.url);
    assert.equal((await mobile(initial.url)).status,200);

    gate={started:Promise.withResolvers(),resume:Promise.withResolvers()};
    const updating=handlers.get('updateRemoteRelay')();
    await gate.started.promise;
    assert.equal((await mobile(initial.url)).status,200);
    assert.equal(await fs.readFile(file,'utf8'),saved);
    const duplicate=handlers.get('updateRemoteRelay')();
    assert.equal(duplicate,updating);
    gate.resume.resolve();
    const next=await updating;
    const oldKey=new URLSearchParams(new URL(initial.url).hash.slice(1)).get('key');
    assert.equal(created,3);
    assert.equal(verified.length,2);
    assert.notEqual(next.url,initial.url);
    assert.deepEqual(next.relay,{version:'2026.11.1',availableVersion:'2026.11.1',canUpdate:false});
    assert.equal((await mobile(next.url)).status,200);
    assert.equal((await mobile(next.url,oldKey)).status,401);
    assert.equal((await pairing.read()).lease.origin,new URL(next.url).origin);
    await assert.rejects(mobile(initial.url),/ECONNREFUSED/);
    assert.throws(()=>handlers.get('updateRemoteRelay')(),/이미 사용 중/);

    await service.shutdown();
    service=startApp();
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{clearInterval(interval);reject(Error('휴대폰 중계 재접속 시간 초과'));},3000);
      const interval=setInterval(()=>{if(service.state().url===next.url){clearInterval(interval);clearTimeout(timeout);resolve();}},15);
    });
    assert.deepEqual(service.state().relay,next.relay);
    assert.equal((await mobile(next.url)).status,200);
    assert.equal(created,3);

    brokers.get(new URL(next.url).origin).close();
    // Record remains intact on an unattended startup failure. An explicit
    // connection action is required to get a replacement Quick Tunnel address.
    await assert.rejects(pairing.open('test-account',null,()=>{},false),/기존 휴대폰 중계/);
    assert.equal((await pairing.read()).lease.origin,new URL(next.url).origin);
    assert.equal(created,3);
  }finally{
    fs.rename=rename;
    gate?.resume.resolve();
    await service.shutdown();for(const {close} of brokers.values())close();
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('중계 공개 검사 DNS 보조 경로는 원래 도메인 TLS를 검증하고 비공개 주소를 사용하지 않는다',async()=>{
  const host='flowrium-dns-fixture.trycloudflare.com';
  const url='https://'+host+'/relay-check/01234567-f012-4567-89af-123456789012';
  const token='d'.repeat(64),options={redirect:'error',signal:AbortSignal.timeout(2000)};
  const dnsUnavailable=new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}});
  const makeFetch=record=>async(target,input)=>{
    if(target.hostname===host)throw dnsUnavailable;
    assert.equal(String(target),'https://cloudflare-dns.com/dns-query?name='+host+'&type=A');
    assert.deepEqual(input.headers,{accept:'application/dns-json'});
    assert.equal(input.redirect,'error');
    return Response.json({Status:0,Answer:record});
  };
  const allow={type:1,name:host+'.',data:'104.16.0.11'};
  let attempted=0;
  const result=await fetchRelayProbe(url,options,makeFetch([{...allow,data:'127.0.0.1'},allow]),(target,input,accept)=>{
    attempted++;
    assert.equal(String(target),url);
    assert.equal(input.servername,host);
    assert.equal(input.rejectUnauthorized,true);
    assert.equal(input.signal,options.signal);
    input.lookup(host,{family:4},(error,address,family)=>{assert.equal(error,null);assert.equal(address,allow.data);assert.equal(family,4);});
    const response=Readable.from([Buffer.from(token)]);
    response.statusCode=200;response.headers={'content-length':'64'};
    accept(response);
    return new EventEmitter();
  });
  assert.equal(attempted,1);assert.equal(await result.text(),token);
  const rejected=await fetchRelayProbe(url,options,makeFetch([{...allow,data:'192.168.21.5'},{...allow,name:'another.trycloudflare.com.'}]),()=>assert.fail('사설·다른 주소 사용'));
  assert.equal(rejected.status,502);
  const tls=new TypeError('fetch failed',{cause:{code:'CERT_HAS_EXPIRED'}});
  await assert.rejects(fetchRelayProbe(url,options,async()=>{throw tls;},()=>assert.fail('TLS 실패를 우회함')),error=>error===tls);
  await assert.rejects(fetchRelayProbe(url+'?private=key',options,()=>assert.fail('쿼리가 있는 검증 주소 사용')),/올바르지 않습니다/);
});
