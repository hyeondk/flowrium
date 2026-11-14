const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const MAIL_SCRIPT=String.raw`ObjC.import('Foundation');
function run(){try{
const a=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding)));
const m=Application('com.apple.mail');if(!m.running())return JSON.stringify({ok:true,value:null});
let value;
if(a.action==='mails'){
const cond=[{dateReceived:{_greaterThan:new Date(a.since)}}];if(a.unread)cond.push({readStatus:false});if(a.query)cond.push({_or:[{subject:{_contains:a.query}},{sender:{_contains:a.query}}]});
const list=m.inbox.messages.whose(cond.length>1?{_and:cond}:cond[0]),ids=list.id(),titles=list.subject(),from=list.sender(),dates=list.dateReceived(),mids=list.messageId(),read=list.readStatus();
value=ids.map((id,i)=>({id:String(id),messageId:mids[i]||'',title:titles[i]||'',from:from[i]||'',at:dates[i].toISOString(),unread:!read[i]})).sort((x,y)=>y.at.localeCompare(x.at)).slice(0,a.limit);
}else if(a.action==='mail'){
const list=m.inbox.messages.whose({id:Number(a.id)});if(!list.length)throw Error('메일을 찾지 못했습니다.');const item=list[0];value={id:a.id,messageId:item.messageId()||'',title:item.subject()||'',from:item.sender()||'',at:item.dateReceived().toISOString(),body:String(item.content()||'').slice(0,200000)};
}else if(a.action==='send'){
const mail=m.OutgoingMessage({subject:a.subject,content:a.body,visible:false});m.outgoingMessages.push(mail);mail.toRecipients.push(m.ToRecipient({address:a.to}));value=m.send(mail);
}else if(a.action==='markRead'){const item=m.inbox.messages.whose({id:Number(a.id)})[0];item.readStatus=true;value=true;}else throw Error('지원하지 않는 메일 작업입니다.');
return JSON.stringify({ok:true,value});}catch(e){return JSON.stringify({ok:false,error:e.message});}}`;
function processJSON(command,args,input,{spawnImpl=spawn,timeout=110000}={}){
 return new Promise((resolve,reject)=>{
  const child=spawnImpl(command,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('메일 / 캘린더 응답 시간이 초과됐습니다.'));},timeout);timer.unref?.();
  child.on('error',error=>finish(error));child.stdout.on('data',part=>{stdout+=part;if(stdout.length>4*1024*1024){child.kill();finish(Error('자료가 허용 크기를 넘습니다.'));}});child.stderr.on('data',part=>{stderr=(stderr+part).slice(-5000);});
  child.on('close',code=>{if(code!==0){finish(Error(/-1743|not authorized|not authorised/i.test(stderr)?'메일 접근 권한이 필요합니다. 시스템 설정의 자동화를 확인해 주세요.':'메일 / 캘린더 실행을 마치지 못했습니다.'));return;}
   try{const result=JSON.parse(stdout);if(!result.ok)throw Error(String(result.error||'자료를 읽지 못했습니다.').slice(0,1000));finish(null,result.value);}catch(e){finish(e);}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
}
function registerMacPim(register,{directory,platform=process.platform,spawnImpl=spawn,accountRevision=()=>0,canRun=()=>true}={}){
 const file=path.join(directory,'native-pim.json'),tickets=new Map();let config,queue=Promise.resolve();
 async function read(){if(config)return config;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('기본 앱 연결 설정을 읽지 못했습니다.');config={enabled:false};}return config;}
 const status=async()=>({available:platform==='darwin',enabled:!!((await read()).enabled&&(await read()).owner===accountRevision())});
 async function allowed(){if(platform!=='darwin')throw Error('맥 기본 앱 연결은 Mac에서 사용할 수 있습니다.');if(!canRun()||!(await status()).enabled)throw Error('설정에서 맥 메일 / 캘린더 연결을 먼저 켜 주세요.');}
 async function native(input){await allowed();const owner=accountRevision();
  const helper=path.join(__dirname,'native','flowrium-pim').replace(/app\.asar([/\\])/,'app.asar.unpacked$1');
  const mail=['mails','mail','send','markRead'].includes(input.action);
  const value=await processJSON(mail?'/usr/bin/osascript':helper,mail?['-l','JavaScript','-e',MAIL_SCRIPT]:[],input,{spawnImpl});
  if(owner!==accountRevision()||!canRun()||!(await status()).enabled)throw Error('기본 앱 연결이나 계정이 바뀌었습니다.');return value;
 }
 register('macPimStatus',status);
 register('configureMacPim',async enabled=>{if(typeof enabled!=='boolean')throw Error('연결 설정을 확인해 주세요.');if(enabled&&platform!=='darwin')throw Error('Mac에서만 연결할 수 있습니다.');
  tickets.clear();const next={enabled,owner:accountRevision()};queue=queue.catch(()=>{}).then(async()=>{await fs.mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID();await fs.writeFile(temp,JSON.stringify(next),{mode:0o600});try{await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}config=next;});await queue;return status();});
 function field(value,max=1000){if(typeof value!=='string'||value.length>max||value.includes('\0'))throw Error('자료 조회 조건을 확인해 주세요.');return value;}
 register('macPim',async input=>{
  if(!input||!['calendars','events','mails','mail'].includes(input.action))throw Error('지원하는 기본 앱 작업을 선택해 주세요.');
  if(input.action==='calendars')return native({action:'calendars'});
  if(input.action==='mail'){if(!/^\d{1,20}$/.test(input.id))throw Error('메일 식별자를 확인해 주세요.');return native({action:'mail',id:input.id});}
  if(input.action==='mails')return native({action:'mails',query:field(input.query||''),since:Date.now()-Math.min(90,Math.max(1,input.days||7))*86400000,unread:!!input.unread,limit:Math.min(50,Math.max(1,input.limit||20))});
  const from=Date.parse(input.from||new Date().toISOString()),to=Date.parse(input.to||new Date(Date.now()+7*86400000).toISOString());
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>366*86400000)throw Error('일정 조회 기간을 확인해 주세요.');
  return native({action:'events',from,to,calendarId:field(input.calendarId||''),query:field(input.query||'')});
 });
 register('prepareMacEvent',async input=>{
  await allowed();if(!input||!['create','update','delete'].includes(input.action))throw Error('일정 변경 종류를 확인해 주세요.');
  const owner=accountRevision(),calendarId=field(input.calendarId||''),calendars=await native({action:'calendars'});
  const calendar=calendars.find(c=>c.id===calendarId||(c.primary&&(!calendarId||calendarId==='primary')));
  if(!calendar?.writable)throw Error('캘린더 쓰기 권한을 확인해 주세요.');
  const previous=input.action==='create'?undefined:await native({action:'event',eventId:field(input.eventId)});
  if(previous?.recurring)throw Error('반복 일정은 캘린더 앱에서 변경해 주세요.');
  if(previous&&input.etag&&input.etag!==previous.etag)throw Error('일정이 바뀌었습니다. 다시 검토해 주세요.');
  let event;
  if(input.action!=='delete'){
   const fields=require('./document-tools.cjs').eventFields(input,input.action==='update');
   const date=value=>value?.date?Date.parse(value.date+'T00:00:00'):Date.parse(value?.dateTime);
   const start=fields.start?date(fields.start):Date.parse(previous.at),end=fields.end?date(fields.end):Date.parse(previous.end);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error('일정 시작과 종료를 확인해 주세요.');
   event={summary:fields.summary??previous?.title,description:fields.description??previous?.description??'',location:fields.location??previous?.location??'',start,end,allDay:fields.start?!!fields.start.date:!!previous?.allDay};
  }
  if(owner!==accountRevision())throw Error('연결 계정이 바뀌었습니다.');
  for(const[id,t]of tickets)if(t.expiresAt<Date.now())tickets.delete(id);
  if(tickets.size>=100)throw Error('이전 일정 검토를 먼저 마쳐 주세요.');
  const id=randomUUID(),expiresAt=Date.now()+600000; tickets.set(id,{owner,input:{action:input.action,calendarId:calendar.id,eventId:previous?.id,etag:previous?.etag,...event},expiresAt});
  return{id,action:input.action,calendarId:calendar.id,calendarName:calendar.title,expiresAt,previous,event:event&&{title:event.summary,at:new Date(event.start).toISOString(),end:new Date(event.end).toISOString(),description:event.description,location:event.location}};
 });
 register('commitMacEvent',async id=>{await allowed();const ticket=tickets.get(id);if(!ticket||ticket.owner!==accountRevision()||ticket.expiresAt<Date.now())throw Error('일정 검토가 만료되거나 이미 처리됐습니다.');tickets.delete(id);return native(ticket.input);});
 return {status,invalidate:()=>tickets.clear(),readMails:input=>native({action:'mails',...input}),sendMail:input=>native({action:'send',...input}),markRead:id=>native({action:'markRead',id})};
}
module.exports={registerMacPim,processJSON,MAIL_SCRIPT};
