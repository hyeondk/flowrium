const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {randomBytes,randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const DAY=86400000,MAX_SENT=20,BRIDGE='https://hyeondk.github.io/flowrium/connect/';
const email=value=>String(value||'').trim().toLowerCase();
const sender=value=>email(/<([^<>]+)>/.exec(String(value||''))?.[1]||value);
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&!/[\r\n]/.test(value);
const blank=()=>({restKey:'',clientSecret:'',tokens:null,ttlMinutes:15,autoKakao:false,lastAuto:0,lastScope:'',sent:[],last:null,mail:{enabled:false,provider:'mac',senders:[],phrase:'Flowrium 링크',enabledAt:0,handled:[]}});
function registerLinkDelivery(register,{directory,secretStorage,accountRevision=()=>0,canRun=()=>true,issueLink,getContext,ensureRemote,openExternal,mailProvider,fetchImpl=fetch,now=Date.now,callbackPort=42839,platform=process.platform}){
 const file=path.join(directory,'link-delivery.enc');let disk,queue=Promise.resolve(),auth,generation=0,busy=false,closed=false,lastPoll=0;
 async function load(){if(disk)return disk;try{disk=JSON.parse(secretStorage.decryptString(await fs.readFile(file)));if(disk.version!==1||!disk.owners||typeof disk.owners!=='object')throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('연결 주소 전달 설정을 읽지 못했습니다.');disk={version:1,owners:{}};}return disk;}
 async function config(){const value=structuredClone((await load()).owners[String(accountRevision())]||blank());if(value.mail.provider!=='mac')value.mail={...value.mail,enabled:false,provider:'mac'};return value;}
 const stamp=()=>({owner:accountRevision(),generation});
 function current(s){if(closed||!canRun()||s.owner!==accountRevision()||s.generation!==generation)throw Error('계정이나 연결 설정이 바뀌었습니다. 다시 확인해 주세요.');}
 async function save(value,s){current(s);queue=queue.catch(()=>{}).then(async()=>{current(s);const next=structuredClone(await load());next.owners[String(s.owner)]=value;
  if(!secretStorage.isEncryptionAvailable())throw Error('운영체제 보안 저장소를 사용할 수 없습니다.');await fs.mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID();
  await fs.writeFile(temp,secretStorage.encryptString(JSON.stringify(next)),{mode:0o600});try{current(s);await fs.rename(temp,file);disk=next;}finally{await fs.rm(temp,{force:true});}});await queue;}
 async function request(url,options={}){const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000),redirect:'error'});if(!response.ok)throw Error('연결 서비스가 요청을 처리하지 못했습니다. ('+response.status+')');return response;}
 const form=value=>new URLSearchParams(value);
 async function state(){const c=await config();return{configured:!!c.restKey,hasSecret:!!c.clientSecret,connected:!!c.tokens,authorizing:!!auth,redirectUri:'http://localhost:'+callbackPort+'/flowrium/kakao/callback',webDomain:'https://hyeondk.github.io',autoKakao:c.autoKakao,ttlMinutes:c.ttlMinutes,sentToday:c.sent.filter(t=>t>now()-DAY).length,dailyMax:MAX_SENT,last:c.last,
  mail:{enabled:c.mail.enabled,provider:c.mail.provider,senders:c.mail.senders,phrase:c.mail.phrase},nativeAvailable:platform==='darwin'};}
 function cancelAuth(){if(auth){clearTimeout(auth.timer);auth.server?.close();auth=null;}}
 register('linkDeliveryState',state);
 register('configureLinkDelivery',async input=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('연결 전달 설정을 확인해 주세요.');
  generation++;cancelAuth();const s=stamp(),c=await config();
  if(input.restKey){if(typeof input.restKey!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(input.restKey))throw Error('카카오 REST API 키를 확인해 주세요.');if(c.restKey!==input.restKey)c.tokens=null;c.restKey=input.restKey;}
  if(input.clientSecret){if(typeof input.clientSecret!=='string'||input.clientSecret.length>500||/[\r\n\0]/.test(input.clientSecret))throw Error('카카오 보안 비밀을 확인해 주세요.');if(c.clientSecret!==input.clientSecret)c.tokens=null;c.clientSecret=input.clientSecret;}
  if(input.ttlMinutes!==undefined){if(![5,15,60].includes(input.ttlMinutes))throw Error('연결 유효 시간을 확인해 주세요.');c.ttlMinutes=input.ttlMinutes;}
  if(input.autoKakao!==undefined){if(typeof input.autoKakao!=='boolean')throw Error('자동 전달 설정을 확인해 주세요.');c.autoKakao=input.autoKakao;}
  if(input.mail){const m=input.mail;if(typeof m.enabled!=='boolean'||m.provider!=='mac'||!Array.isArray(m.senders)||m.senders.length>5||m.senders.some(v=>!validEmail(v))||typeof m.phrase!=='string'||!m.phrase.trim()||m.phrase.length>80||/[\r\n\0]/.test(m.phrase))throw Error('허용 메일 주소와 요청 제목을 확인해 주세요.');
   if(m.enabled&&!m.senders.length)throw Error('답장할 메일 주소를 하나 이상 지정해 주세요.');
   if(m.enabled&&platform!=='darwin')throw Error('메일 요청 연결은 맥의 기본 메일 앱에서 사용할 수 있습니다.');
   c.mail={...c.mail,enabled:m.enabled,provider:m.provider,senders:[...new Set(m.senders.map(email))],phrase:m.phrase.trim(),enabledAt:m.enabled&&!c.mail.enabled?now():c.mail.enabledAt};}
  await save(c,s);return state();
 });
 register('connectKakao',async()=>{
  if(auth)throw Error('진행 중인 카카오 로그인을 먼저 마쳐 주세요.');const s=stamp(),c=await config();current(s);
  if(!c.restKey)throw Error('카카오 REST API 키를 먼저 저장해 주세요.');
  const nonce=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');let redirect;
  const attempt={};auth=attempt;
  const server=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://localhost');const got=u.searchParams.get('state')||'';
   if(req.method!=='GET'||u.pathname!=='/flowrium/kakao/callback'||!['localhost:'+server.address().port,'127.0.0.1:'+server.address().port].includes(req.headers.host)||got.length!==nonce.length||!timingSafeEqual(Buffer.from(got),Buffer.from(nonce))){res.writeHead(400).end('요청을 확인해 주세요.');return;}
   if(attempt.used){res.writeHead(409).end('이미 처리한 요청입니다.');return;}attempt.used=true;
   try{current(s);const code=u.searchParams.get('code');if(!code||code.length>3000)throw Error('카카오 로그인이 취소됐습니다.');
    const tokens=await(await request('https://kauth.kakao.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({grant_type:'authorization_code',client_id:c.restKey,client_secret:c.clientSecret,redirect_uri:redirect,code,code_verifier:verifier})})).json();
    if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string')throw Error('카카오 인증 정보를 확인하지 못했습니다.');
    c.tokens={access:tokens.access_token,refresh:tokens.refresh_token,expiresAt:now()+Number(tokens.expires_in||3600)*1000};await save(c,s);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'",'Referrer-Policy':'no-referrer'}).end('<html lang="ko"><meta charset="utf-8"><title>Flowrium</title><p>카카오 계정을 연결했습니다. Flowrium에서 연결 확인을 누르세요.</p></html>');
   }catch{res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end('계정 연결을 마치지 못했습니다. Flowrium 설정에서 다시 시도해 주세요.');}
   finally{if(auth===attempt){clearTimeout(attempt.timer);auth=null;}server.close();}
  });
  attempt.server=server;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(callbackPort,'127.0.0.1',resolve);});redirect='http://localhost:'+server.address().port+'/flowrium/kakao/callback';
   const timer=setTimeout(()=>{if(auth===attempt){auth=null;server.close();}},180000);timer.unref();Object.assign(attempt,{server,timer});current(s);
   const url='https://kauth.kakao.com/oauth/authorize?'+form({response_type:'code',client_id:c.restKey,redirect_uri:redirect,scope:'talk_message',state:nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});await openExternal(url);
  }catch(error){clearTimeout(attempt.timer);if(auth===attempt)auth=null;server.close();throw Error(error.code==='EADDRINUSE'?'로그인 연결 포트가 사용 중입니다. 다른 로그인 창을 마친 뒤 다시 연결해 주세요.':error.message);}
 });
 register('disconnectKakao',async()=>{generation++;cancelAuth();const s=stamp(),c=await config(),tokens=c.tokens;c.tokens=null;c.autoKakao=false;await save(c,s);
  if(tokens)await request('https://kapi.kakao.com/v1/user/unlink',{method:'POST',headers:{Authorization:'Bearer '+tokens.access}}).catch(()=>{});return state();});
 async function quota(c,s){c.sent=c.sent.filter(t=>t>now()-DAY);if(c.sent.length>=MAX_SENT)throw Error('연결 주소는 하루 '+MAX_SENT+'번까지 전달합니다.');c.sent.push(now());await save(c,s);}
 async function link(c,s){if(!getContext().enabled)await ensureRemote();current(s);const value=await issueLink({ttlMinutes:c.ttlMinutes});current(s);if(!value?.url||!value.url.startsWith('https://')||!new URL(value.url).hash.startsWith('#handoff='))throw Error('일회용 연결 주소를 준비하지 못했습니다.');return value;}
 async function refresh(c,s){if(!c.tokens)throw Error('카카오 계정을 먼저 연결해 주세요.');if(c.tokens.expiresAt>now()+60000)return;
  const t=await(await request('https://kauth.kakao.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({grant_type:'refresh_token',client_id:c.restKey,client_secret:c.clientSecret,refresh_token:c.tokens.refresh})})).json();current(s);
  if(typeof t.access_token!=='string')throw Error('카카오 로그인을 다시 연결해 주세요.');c.tokens={access:t.access_token,refresh:t.refresh_token||c.tokens.refresh,expiresAt:now()+Number(t.expires_in||3600)*1000};await save(c,s);
 }
 async function sendKakao(auto=false){if(busy)throw Error('연결 주소를 전달 중입니다.');busy=true;const s=stamp();try{
  current(s);const c=await config();await refresh(c,s);const value=await link(c,s);await quota(c,s);current(s);
  const button=BRIDGE+'#u='+encodeURIComponent(value.url),text='Flowrium 연결 주소입니다.\n'+c.ttlMinutes+'분 안에 한 번 열 수 있습니다.';
  await request('https://kapi.kakao.com/v2/api/talk/memo/default/send',{method:'POST',headers:{Authorization:'Bearer '+c.tokens.access,'Content-Type':'application/x-www-form-urlencoded'},body:form({template_object:JSON.stringify({object_type:'text',text,link:{web_url:button,mobile_web_url:button},button_title:'Flowrium 열기'})})});
  current(s);c.last={at:now(),channel:'kakao',ok:true};if(auto){c.lastAuto=now();c.lastScope=value.scopeId;}await save(c,s);return state();
 }finally{busy=false;}}
 register('sendKakaoLink',()=>sendKakao(false));
 async function answerMail(c,s,to){if(!c.mail.enabled||!c.mail.senders.includes(email(to)))throw Error('미리 허용한 메일 주소만 사용할 수 있습니다.');const value=await link(c,s);await quota(c,s);current(s);
  await mailProvider(c.mail.provider).send({to:email(to),subject:'Flowrium 연결 주소',body:'Flowrium 일회용 연결 주소입니다.\n\n'+value.url+'\n\n'+c.ttlMinutes+'분 안에 한 번 열 수 있습니다. 데스크톱 연결을 종료하면 접근도 끝납니다.'});
  current(s);c.last={at:now(),channel:'mail',to:email(to),ok:true};await save(c,s);}
 register('sendLinkMail',async to=>{if(busy)throw Error('전달 중인 요청을 먼저 마쳐 주세요.');busy=true;try{const s=stamp(),c=await config();await answerMail(c,s,to);return state();}finally{busy=false;}});
 async function tick(force=false){if(closed||busy||!canRun())return;busy=true;const s=stamp();try{
  const c=await config(),context=getContext();
  if(c.autoKakao&&c.tokens&&context.enabled&&context.scopeId!==c.lastScope&&now()-c.lastAuto>=600000){busy=false;await sendKakao(true);return;}
  if(!c.mail.enabled||(!force&&now()-lastPoll<60000))return;lastPoll=now();
  const mails=await mailProvider(c.mail.provider).search({phrase:c.mail.phrase});current(s);
  for(const m of (mails||[]).slice(0,20)){
   const to=sender(m.from),at=Date.parse(m.at||m.date),key=m.messageId||m.id;
   if(!key||c.mail.handled.includes(key)||!c.mail.senders.includes(to)||!String(m.title||m.subject||'').toLowerCase().includes(c.mail.phrase.toLowerCase())||!Number.isFinite(at)||at<Math.max(c.mail.enabledAt,now()-3600000))continue;
   c.mail.handled=[...c.mail.handled,key].slice(-500);await save(c,s);await answerMail(c,s,to);
  }
 }catch(error){if(canRun()&&s.owner===accountRevision()&&s.generation===generation){const c=await config();c.last={at:now(),channel:'mail',ok:false,error:String(error.message).slice(0,500)};await save(c,s).catch(()=>{});}if(force)throw error;
 }finally{busy=false;}}
 register('checkLinkMail',async()=>{await tick(true);return state();});
 const timer=setInterval(()=>void tick(),20000);timer.unref();
 return{tick,state,isBusy:()=>busy,invalidate(){generation++;cancelAuth();},async shutdown(){closed=true;clearInterval(timer);cancelAuth();await queue;}};
}
module.exports={registerLinkDelivery,validEmail,sender,BRIDGE};
