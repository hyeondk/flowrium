const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const webpush=require('web-push');
const {PushRuntime,endpoint,publicAddress}=require('../electron/web-push.cjs');
function secureStorage(){const key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString:text=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body])},decryptString:buffer=>{const decipher=crypto.createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(12,28));return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString()}}}
function sub(name='device'){const key=crypto.createECDH('prime256v1');key.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+name,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}}}
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-push-test-')),storage=secureStorage();let owner=0,scope='scope-a',locked=false,failure;
const sent=[],runtime=new PushRuntime({directory,secretStorage:storage,accountRevision:()=>owner,isLocked:()=>locked,getContext:()=>({enabled:true,scopeId:scope,origin:'https://test.trycloudflare.com'}),sendNotification:async(subscription,payload,options)=>{const details=webpush.generateRequestDetails(subscription,payload,options);assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.notEqual(details.body?.toString(),payload);if(failure)throw failure;sent.push(JSON.parse(payload))}});
t.after(async()=>{await runtime.shutdown();await fs.rm(directory,{recursive:true,force:true})});return {directory,storage,runtime,sent,setOwner:v=>owner=v,setScope:v=>scope=v,setLocked:v=>locked=v,fail:v=>failure=v};}
test('브라우저 알림은 공식 HTTPS 서버와 공개 DNS 주소만 허용한다',()=>{
for(const url of ['http://fcm.googleapis.com/fcm/send/a','https://127.0.0.1/push','https://fcm.googleapis.com.evil.example/push','https://user@fcm.googleapis.com/push','https://web.push.apple.com:8443/push','https://web.push.apple.com/'])assert.throws(()=>endpoint(url));
assert.equal(endpoint('https://web.push.apple.com/push/a'),'https://web.push.apple.com/push/a');
for(const ip of ['127.0.0.1','10.0.0.1','169.254.1.1','172.17.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','2002:a00::1'])assert.equal(publicAddress(ip),false,ip);
for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip);
});
test('VAPID 키와 구독을 암호화 저장하고 일반 문구만 중복 없이 발송한다',async t=>{
const f=await fixture(t),prepared=await f.runtime.action({action:'prepare'}),subscription=sub();assert.equal(Buffer.from(prepared.publicKey,'base64url').length,65);
const {id}=await f.runtime.action({action:'subscribe',subscription,label:'시험 휴대폰',kinds:['done','decision']});
const disk=await fs.readFile(path.join(f.directory,'web-push.encrypted'));for(const secret of [prepared.publicKey,subscription.endpoint,subscription.keys.auth,'시험 휴대폰'])assert.equal(disk.includes(Buffer.from(secret)),false);
assert.deepEqual(await f.runtime.notify({id:'n1',kind:'done',title:'비밀 프로젝트 제목',body:'개인 작업 원문',url:'/#key=secret'}),{sent:1,failed:0});
assert.deepEqual(await f.runtime.notify({id:'n1',kind:'done'}),{sent:0,failed:0});assert.equal(f.sent.length,1);assert.equal(JSON.stringify(f.sent).includes('secret'),false);assert.equal(JSON.stringify(f.sent).includes('개인'),false);
await f.runtime.action({action:'preferences',id,kinds:['decision']});await f.runtime.notify({id:'n2',kind:'done'});assert.equal(f.sent.length,1);
assert.deepEqual(await f.runtime.action({action:'test',id}),{sent:true});await f.runtime.action({action:'unsubscribe',id});assert.equal((await f.runtime.status()).devices.length,0);
});
test('계정 변경 / 연결 키 교체 / 잠금은 이전 기기와 대기 알림을 차단한다',async t=>{
const f=await fixture(t);await f.runtime.action({action:'prepare'});const {id}=await f.runtime.action({action:'subscribe',subscription:sub(),label:'기기',kinds:['done']});
f.setLocked(true);assert.deepEqual(await f.runtime.notify({id:'locked',kind:'done'}),{sent:0,failed:0});await assert.rejects(f.runtime.action({action:'test',id}));f.setLocked(false);
f.setOwner(1);await f.runtime.notify({id:'owner',kind:'done'});assert.equal((await f.runtime.status()).devices.length,0);await assert.rejects(f.runtime.action({action:'test',id}));f.setOwner(0);f.setScope('scope-b');await f.runtime.notify({id:'scope',kind:'done'});assert.equal(f.sent.length,0);
f.setScope('scope-a');const pending=f.runtime.notify({id:'queued',kind:'done'});f.runtime.invalidate();await pending;assert.equal(f.sent.length,0);
});
test('만료된 기기는 제거하고 운영체제 암호화 불가 시 구독을 저장하지 않는다',async t=>{
const f=await fixture(t);await f.runtime.action({action:'prepare'});const {id}=await f.runtime.action({action:'subscribe',subscription:sub(),label:'기기',kinds:['done']});f.fail(Object.assign(Error('gone'),{statusCode:410}));assert.deepEqual(await f.runtime.action({action:'test',id}),{sent:false});assert.equal((await f.runtime.status()).devices.length,0);
const denied=new PushRuntime({directory:f.directory,secretStorage:{isEncryptionAvailable:()=>false},getContext:()=>({enabled:true,scopeId:'active'})});assert.equal((await denied.status()).available,false);await assert.rejects(denied.action({action:'prepare'}));await denied.shutdown();
});
test('서비스워커는 원문과 연결 키를 표시하거나 저장하지 않고 기존 창을 연다',async()=>{
const vm=require('node:vm'),events={},shown=[];let pending,focused=0,posted;
const client={url:'https://mobile.example/',focus:async()=>focused++,postMessage:value=>posted=value};
const self={location:{origin:'https://mobile.example'},addEventListener:(name,fn)=>events[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{matchAll:async()=>[client]}};
vm.runInNewContext(await fs.readFile(path.join(__dirname,'../electron/mobile/sw.js'),'utf8'),{self,URL});
events.push({data:{json:()=>({kind:'done',title:'비밀 제목',body:'원문',path:'/#key=secret',tag:'/#key=secret'})},waitUntil:task=>pending=task});await pending;
assert.equal(shown[0].title,'Flowrium');assert.equal(shown[0].body,'작업이 완료됐습니다.');assert.equal(JSON.stringify(shown).includes('secret'),false);
events.notificationclick({notification:{close:()=>{}},waitUntil:task=>pending=task});await pending;assert.equal(focused,1);assert.equal(posted.type,'flowrium:notification');
});
