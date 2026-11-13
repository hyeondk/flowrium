const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');
const webpush = require('web-push');
const KINDS = Object.freeze(['decision','done','error','report','reminder','message']);
const labels = {decision:'확인할 결정이 있습니다.',done:'작업이 완료됐습니다.',error:'확인이 필요한 작업이 있습니다.',report:'새 보고서가 준비됐습니다.',reminder:'예약한 알림 시간입니다.',message:'새 업무 메시지가 있습니다.'};
const blocked = new net.BlockList();
for (const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
const global6 = new net.BlockList();global6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix] of [['2001:db8::',32],['2001::',32],['2001:2::',48],['2002::',16]]) blocked.addSubnet(address,prefix,'ipv6');
function publicAddress(address) {
  const family=net.isIP(address);
  return family===4 ? !blocked.check(address,'ipv4') : family===6 && global6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
function safeLookup(hostname,options,callback) {
  dns.lookup(hostname,{all:true,verbatim:true},(error,rows)=>{
    if(error)return callback(error);
    if(!rows.length||rows.some(r=>!publicAddress(r.address)))return callback(Error('알림 서버 주소를 확인하지 못했습니다.'));
    if(options?.all) callback(null,rows); else callback(null,rows[0].address,rows[0].family);
  });
}
function endpoint(value) {
  if(typeof value!=='string'||value.length>4096)throw Error('알림 구독 주소를 확인해 주세요.');
  let u;try{u=new URL(value)}catch{throw Error('알림 구독 주소를 확인해 주세요.')}
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
    !(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host)||/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(host))||u.pathname==='/'||u.pathname.length<2)
    throw Error('지원하는 브라우저 알림 서버 주소가 아닙니다.');
  return u.href;
}
function base64key(value,length) {
  if(typeof value!=='string'||! /^[A-Za-z0-9_-]+$/.test(value)||value.length>200)throw Error('알림 암호화 키 형식이 올바르지 않습니다.');
  const result=Buffer.from(value,'base64url');
  if(result.length!==length)throw Error('알림 암호화 키 길이를 확인해 주세요.');
  return value;
}
function subscription(value) {
  if(!value||typeof value!=='object')throw Error('알림 구독 정보를 확인해 주세요.');
  const p256dh=base64key(value.keys?.p256dh,65),auth=base64key(value.keys?.auth,16);
  try{crypto.ECDH.convertKey(Buffer.from(p256dh,'base64url'),'prime256v1',undefined,undefined,'uncompressed')}catch{throw Error('알림 공개 키를 확인해 주세요.')}
  return {endpoint:endpoint(value.endpoint),keys:{p256dh,auth},expirationTime:null};
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function eventKind(value) {
  const kind=String(value||'');
  if(/decision|approval|request|question/.test(kind))return 'decision';
  if(/fail|error/.test(kind))return 'error';
  if(/report/.test(kind))return 'report';
  if(/remind/.test(kind))return 'reminder';
  if(/done|complete/.test(kind))return 'done';
  return 'message';
}
class PushRuntime {
  constructor({directory,secretStorage,accountRevision=()=>0,isLocked=()=>false,getContext=()=>({enabled:false}),sendNotification,now=Date.now}) {
    this.file=path.join(directory,'web-push.encrypted');this.secretStorage=secretStorage;this.accountRevision=accountRevision;this.isLocked=isLocked;this.getContext=getContext;this.now=now;
    this.agent=new https.Agent({keepAlive:false,lookup:safeLookup});
    this.sender=sendNotification||((sub,payload,options)=>webpush.sendNotification(sub,payload,options));
    this.data={version:1,keys:null,devices:[],sent:[]};this.loaded=false;this.tail=Promise.resolve();this.closed=false;this.pending=new Set();this.generation=0;
  }
  available(){try{return !!this.secretStorage?.isEncryptionAvailable()}catch{return false}}
  current(){const c=this.getContext()||{};return {enabled:!!c.enabled,scopeId:typeof c.scopeId==='string'?c.scopeId:'',owner:String(this.accountRevision()),origin:c.origin,generation:this.generation};}
  check(c){const n=this.current();if(this.closed||this.isLocked()||!n.enabled||!n.scopeId||n.scopeId!==c.scopeId||n.owner!==c.owner||n.generation!==c.generation)throw Error('휴대폰 연결을 다시 확인해 주세요.');}
  serial(task){const next=this.tail.then(task);this.tail=next.catch(()=>{});return next;}
  async load(){
    if(this.loaded)return;
    if(!this.available())throw Error('이 컴퓨터에서 안전한 알림 키 저장소를 사용할 수 없습니다.');
    try{
      const info=await fs.lstat(this.file);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw Error('저장된 알림 키 파일을 확인해 주세요.');
      const text=this.secretStorage.decryptString(await fs.readFile(this.file));const d=JSON.parse(text);
      if(d.version!==1||!Array.isArray(d.devices)||!Array.isArray(d.sent)||d.devices.length>30)throw Error('저장된 알림 구독 형식을 확인해 주세요.');
      for(const device of d.devices){device.subscription=subscription(device.subscription);this.validateKinds(device.kinds);if(typeof device.id!=='string'||device.id!==digest(device.subscription.endpoint)||typeof device.owner!=='string'||typeof device.scopeId!=='string')throw Error('알림 기기 정보를 확인해 주세요.');}
      if(d.keys){base64key(d.keys.publicKey,65);base64key(d.keys.privateKey,32)}
      this.data=d;
    }catch(e){if(e.code!=='ENOENT')throw Error('저장된 알림 정보를 안전하게 열지 못했습니다.');}
    this.loaded=true;
  }
  async save(){
    const encrypted=this.secretStorage.encryptString(JSON.stringify(this.data)),tmp=this.file+'.'+crypto.randomUUID()+'.tmp';
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    try{await fs.writeFile(tmp,encrypted,{mode:0o600,flag:'wx'});await fs.rename(tmp,this.file)}finally{await fs.rm(tmp,{force:true})}
  }
  devices(c){return this.data.devices.filter(d=>d.scopeId===c.scopeId&&d.owner===c.owner);}
  async status(){return this.serial(async()=>{
    if(!this.available())return {available:false,enabled:false,kinds:KINDS,devices:[],message:'운영체제의 안전한 키 저장소가 필요합니다.'};
    await this.load();const c=this.current();
    return {available:true,enabled:c.enabled,kinds:KINDS,devices:this.devices(c).map(({id,label,kinds,createdAt,lastSentAt,lastError})=>({id,label,kinds,createdAt,lastSentAt,lastError}))};
  })}
  async action(input){
    const c=this.current();this.check(c);
    return this.serial(async()=>{
      this.check(c);await this.load();this.check(c);
      if(!input||typeof input!=='object')throw Error('알림 작업 형식을 확인해 주세요.');
      const action=input.action;
      if(action==='prepare'){
        if(!this.data.keys){this.data.keys=webpush.generateVAPIDKeys();await this.save();this.check(c)}
        return {publicKey:this.data.keys.publicKey,kinds:KINDS};
      }
      if(action==='subscribe'){
        if(!this.data.keys)throw Error('알림 등록을 먼저 준비해 주세요.');
        const sub=subscription(input.subscription),id=digest(sub.endpoint),name=String(input.label||'휴대폰').trim();
        if(!name||name.length>80)throw Error('기기 이름은 80자 이내로 입력하세요.');
        const kinds=this.validateKinds(input.kinds||KINDS);
        this.data.devices=this.data.devices.filter(d=>d.id!==id&&d.scopeId===c.scopeId&&d.owner===c.owner);
        if(this.data.devices.length>=30)throw Error('등록할 수 있는 알림 기기는 30개입니다.');
        this.data.devices.push({id,label:name,kinds,subscription:sub,scopeId:c.scopeId,owner:c.owner,createdAt:new Date(this.now()).toISOString()});
        await this.save();this.check(c);return {id};
      }
      if(!['unsubscribe','preferences','test'].includes(action))throw Error('지원하지 않는 알림 작업입니다.');
      const d=this.devices(c).find(d=>d.id===input.id);if(!d)throw Error('현재 연결에 등록한 기기를 찾을 수 없습니다.');
      if(action==='unsubscribe'){this.data.devices=this.data.devices.filter(x=>x!==d);await this.save();return {removed:true}}
      if(action==='preferences'){d.kinds=this.validateKinds(input.kinds);await this.save();return {saved:true}}
      const result=await this.send(d,{title:'Flowrium',body:'이 기기에서 알림을 받을 수 있습니다.',tag:'flowrium-test-'+crypto.randomUUID(),path:'/',test:true},c);
      return {sent:result};
    });
  }
  validateKinds(value){if(!Array.isArray(value)||value.some(k=>!KINDS.includes(k)))throw Error('알림 종류를 확인해 주세요.');return [...new Set(value)]}
  async send(d,payload,c){
    this.check(c);
    const task=Promise.resolve().then(()=>{this.check(c);return this.sender(d.subscription,JSON.stringify(payload),{vapidDetails:{subject:'https://hyeondk.github.io/flowrium/',...this.data.keys},agent:this.agent,timeout:10000,TTL:300,urgency:'normal'})});
    this.pending.add(task);
    try{
      await task;this.check(c);d.lastSentAt=new Date(this.now()).toISOString();delete d.lastError;await this.save();return true;
    }catch(e){
      if(!this.closed&&this.current().scopeId===c.scopeId&&this.current().owner===c.owner){
        if(e.statusCode===404||e.statusCode===410)this.data.devices=this.data.devices.filter(x=>x!==d);
        else d.lastError='알림 서버에서 발송을 확인하지 못했습니다.';
        await this.save();
      }
      return false;
    }finally{this.pending.delete(task)}
  }
  notify(event){
    const c=this.current();if(this.closed||this.isLocked()||!c.enabled||!c.scopeId||!event?.id)return Promise.resolve({sent:0,failed:0});
    return this.serial(async()=>{
      try{
        this.check(c);await this.load();this.check(c);const kind=eventKind(event.kind),id=digest(c.scopeId+'|'+c.owner+'|'+event.id);
        if(this.data.sent.includes(id))return {sent:0,failed:0};
        this.data.sent=[...this.data.sent,id].slice(-500);await this.save();this.check(c);
        let sent=0,failed=0;
        for(const d of this.devices(c).filter(d=>d.kinds.includes(kind))){this.check(c);if(await this.send(d,{title:'Flowrium',body:labels[kind],tag:'flowrium-'+id.slice(0,24),path:'/',kind},c))sent++;else failed++}
        return {sent,failed};
      }catch{return {sent:0,failed:0}}
    });
  }
  invalidate(){this.generation++;this.agent.destroy();if(!this.closed)this.agent=new https.Agent({keepAlive:false,lookup:safeLookup});}
  async shutdown(){this.closed=true;this.agent.destroy();await this.tail;await Promise.allSettled([...this.pending]);}
}
function registerWebPush(register,options){const runtime=new PushRuntime(options);register('webPushState',()=>runtime.status());register('webPushAction',input=>runtime.action(input));return runtime;}
module.exports={PushRuntime,registerWebPush,endpoint,subscription,publicAddress,safeLookup,KINDS};
