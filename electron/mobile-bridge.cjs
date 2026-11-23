// The broker holds no account, chat or phone credential. A replacement desktop
// connects outward to its authenticated loopback socket before it receives HTTP.
const http = require('node:http');
const net = require('node:net');
const {randomBytes,createHmac,timingSafeEqual} = require('node:crypto');
const {spawn} = require('node:child_process');
const local = '127.0.0.1';
const random = () => randomBytes(24).toString('hex');
const proof = (secret, message) => createHmac('sha256',secret).update(message).digest('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && a.length===64 && b.length===64 &&
  /^[\da-f]{64}$/.test(a) && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const listen = server => new Promise((resolve,reject)=>server.once('error',reject).listen(0,local,()=>resolve(server.address().port)));
function signedRequest(lease, path, method='GET') {
  const nonce=Date.now()+'-'+random();
  const req=http.request({host:local,port:lease.port,path,method,agent:false,
    headers:{'x-flowrium-nonce':nonce,'x-flowrium-proof':proof(lease.secret,method+' '+path+' '+nonce)}});
  const valid=res=>equal(res.headers['x-flowrium-proof'],proof(lease.secret,'broker '+method+' '+path+' '+nonce));
  return {req,valid};
}
function connectDesktop(lease, server, onClose){
  const control=signedRequest(lease,'/listen');
  let closed=false,stream;
  const sockets=new Set();
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>control.req.destroy(Error('휴대폰 연결 응답이 지연됐습니다.')),3500);
    control.req.on('error',err=>{clearTimeout(timeout);reject(err);});
    control.req.once('response',res=>{
      clearTimeout(timeout);
      if (res.statusCode!==200 || !control.valid(res)) {res.destroy();reject(Error('로컬 휴대폰 연결을 확인하지 못했습니다.'));return;}
      stream=res;
      let buffer='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{
        buffer+=chunk;
        if(buffer.length>8192){res.destroy();return;}
        let i;
        while((i=buffer.indexOf('\n'))>=0){
          const id=buffer.slice(0,i);buffer=buffer.slice(i+1);
          if (!/^[a-f\d]{48}$/.test(id) || closed)continue;
          const channel=signedRequest(lease,'/accept/'+id,'CONNECT');
          channel.req.setTimeout(5000,()=>channel.req.destroy());
          channel.req.on('error',()=>{});
          channel.req.once('connect',(reply,socket,head)=>{
            channel.req.setTimeout(0);
            if(closed || !channel.valid(reply) || reply.statusCode!==200 || !server.listening){socket.destroy();return;}
            sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
            if(head.length)socket.unshift(head);
            server.emit('connection',socket);socket.resume();
          });
          channel.req.end();
        }
      });
      res.once('close',()=>{if(!closed)onClose();});
      res.on('error',()=>{});
      resolve();
    });
    control.req.end();
  });
  return {ready,isOpen:()=>Boolean(!closed&&stream&&!stream.destroyed),
    close(){closed=true;control.req.destroy();stream?.destroy();for(const s of sockets)s.destroy();}};
}
async function stopBroker(lease){
  const {req,valid}=signedRequest(lease,'/stop','POST');
  return new Promise(resolve=>{
    req.setTimeout(1500,()=>req.destroy());req.on('error',()=>resolve(false));
    req.on('response',res=>{const ok=res.statusCode===200 && valid(res);res.resume();resolve(ok);});req.end();
  });
}

async function runBroker(options, notify, createTunnel) {
  const {secret}=options;
  let desktop,child,closed=false,idle,origin='',output='';
  const pending=new Map(),live=new Set(),seen=new Map();
  const proxy=net.createServer(socket=>{
    socket.on('error',()=>{});
    if(!desktop || pending.size>=64 || live.size>=128){socket.end('HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    const id=random();
    const timer=setTimeout(()=>socket.destroy(),7000);timer.unref();
    socket.once('close',()=>{clearTimeout(timer);pending.delete(id);});pending.set(id,{socket,timer});
    desktop.write(id+'\n');
  });
  function authorize(req){
    const nonce=req.headers['x-flowrium-nonce'];
    if(typeof nonce!=='string'||!/^\d{13}-[\da-f]{48}$/.test(nonce) || Math.abs(Date.now()-Number(nonce.slice(0,13)))>15000 || seen.has(nonce))return false;
    if(!equal(req.headers['x-flowrium-proof'],proof(secret,req.method+' '+req.url+' '+nonce)))return false;
    const now=Date.now();
    for(const [key,expiry] of seen){if(expiry>=now)break;seen.delete(key);}
    seen.set(nonce,now+30000);
    return proof(secret,'broker '+req.method+' '+req.url+' '+nonce);
  }
  const control=http.createServer((req,res)=>{
    const signature=authorize(req);
    if(!signature){res.writeHead(403).end();return;}
    if(req.method==='GET' && req.url==='/listen'){
      desktop?.destroy();clearTimeout(idle);desktop=res;
      res.writeHead(200,{'x-flowrium-proof':signature,'content-type':'text/plain','cache-control':'no-store'});res.flushHeaders();
      res.on('close',()=>{if(desktop===res){desktop=null;for(const c of live)c.destroy();for(const p of pending.values())p.socket.destroy();scheduleClose();}});return;
    }
    if(req.method==='POST' && req.url==='/stop'){res.once('finish',stop);res.writeHead(200,{'x-flowrium-proof':signature}).end();return;}
    res.writeHead(404).end();
  });
  control.on('connect',(req,target,head)=>{
    target.on('error',()=>{});
    const signature=authorize(req);
    const id=/^\/accept\/([\da-f]{48})$/.exec(req.url)?.[1];
    const entry=id && pending.get(id);
    if(!signature || !entry || !desktop || head.length){target.destroy();return;}
    clearTimeout(entry.timer);pending.delete(id);const client=entry.socket;
    target.write('HTTP/1.1 200 Connection Established\r\nx-flowrium-proof: '+signature+'\r\n\r\n');
    live.add(client);client.once('close',()=>{live.delete(client);target.destroy();});target.once('close',()=>client.destroy());
    client.pipe(target);target.pipe(client);
  });
  function scheduleClose(){clearTimeout(idle);if(!closed)idle=setTimeout(stop,24*60*60*1000);}
  function stop(){if(closed)return;closed=true;clearTimeout(idle);desktop?.destroy();for(const s of live)s.destroy();for(const p of pending.values())p.socket.destroy();control.closeAllConnections();control.close();proxy.close();child?.kill();}
  try {
    const proxyPort=await listen(proxy),port=await listen(control);
    child=createTunnel(proxyPort);
    const timer=setTimeout(()=>{notify({error:'휴대폰 HTTPS 연결 시간이 초과됐습니다.'});stop();},35000);
    function report(chunk){
      if(origin)return;output=(output+chunk).slice(-16000);
      const url=output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
      if(!url || !output.includes('Registered tunnel connection'))return;
      clearTimeout(timer);origin=url[0];output='';scheduleClose();notify({port,origin});
    }
    child.stdout.on('data',report);child.stderr.on('data',report);
    child.once('error',()=>{clearTimeout(timer);notify({error:'휴대폰 HTTPS 연결을 시작하지 못했습니다.'});stop();});
    child.once('exit',()=>{clearTimeout(timer);if(!origin)notify({error:'휴대폰 HTTPS 연결이 종료됐습니다.'});stop();});
    return stop;
  }catch(err){stop();throw err;}
}
function startProcess(){
  const startup=setTimeout(()=>process.exit(1),10000);
  process.once('message',async config=>{
    clearTimeout(startup);
    try {
      const stop=await runBroker(config, data=>{if(process.connected) process.send(data,()=>{if(process.connected)process.disconnect();});},
        port=>spawn(config.command,['tunnel','--url','http://'+local+':'+port,'--no-autoupdate'],{stdio:['ignore','pipe','pipe'],windowsHide:true}));
      process.once('SIGTERM',stop);process.once('SIGINT',stop);
    }catch{if(process.connected)process.send({error:'휴대폰 연결을 준비하지 못했습니다.'},()=>process.exit(1));}
  });
}
module.exports={connectDesktop,stopBroker,runBroker};
