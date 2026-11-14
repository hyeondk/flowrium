const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto'),{fileURLToPath}=require('node:url');
const {pages,samePath}=require('./history.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
function stable(value){const h=hash(value).slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function at(value,fallback=new Date().toISOString()){const d=new Date(typeof value==='number'?value*(Math.abs(value)<1e12?1000:1):value);return Number.isFinite(d.getTime())?d.toISOString():fallback;}
function id(value){if(typeof value!=='string'||!value||value.length>300||/[\0\r\n]/.test(value))throw Error('대화 식별자를 확인해 주세요.');return value;}
function isSubagent(thread){return /subagent/i.test(JSON.stringify(thread.source||thread.sourceKind||''))||!!thread.parentThreadId;}
function active(thread){return thread.status?.type==='active'||thread.status==='active'||thread.status==='running';}
function unsupported(error){return error.rpcCode===-32601||/(?:does not support|unsupported).*(?:pagination|method)/i.test(error.rpcMessage||'');}
async function canonical(value){if(typeof value!=='string'||value.length>20000)throw Error('프로젝트 경로를 확인해 주세요.');const file=value.startsWith('file:')?fileURLToPath(value):value;if(!path.isAbsolute(file))throw Error('프로젝트의 절대 경로가 필요합니다.');const resolved=await fs.realpath(file);if(!(await fs.stat(resolved)).isDirectory())throw Error('프로젝트 폴더를 확인해 주세요.');return resolved;}
function validateThread(thread,threadId,cwd){if(!thread||thread.id!==threadId||!samePath(thread.cwd,cwd)||thread.ephemeral||isSubagent(thread))throw Error('선택한 프로젝트의 사용자 대화가 아닙니다. 원본은 변경하지 않았습니다.');return thread;}
async function readThread(client,threadId,cwd){return validateThread((await client.request('thread/read',{threadId,includeTurns:false})).thread,threadId,cwd);}
async function itemPages(client,threadId,turnId,options={}){
 const out=[],seen=new Set();let cursor,limit=25;
 for(;;){
  let result;
  try{result=await client.request('thread/items/list',{threadId,turnId,limit,sortDirection:'asc',...(cursor?{cursor}:{})});}
  catch(error){
   if(error.code!=='PROTOCOL_FRAME_TOO_LARGE')throw error;
   if(!options.recover)throw error;
   await options.recover();
   if(limit===1)throw Error('대화의 단일 항목이 128MB를 넘어 안전한 읽기 한도를 초과했습니다. 원본을 변경하거나 본문을 잘라 저장하지 않았습니다.');
   limit=Math.max(1,Math.floor(limit/2));continue;
  }
  if(!Array.isArray(result.data))throw Error('대화 항목의 페이지 형식을 확인하지 못했습니다.');
  out.push(...result.data);const next=result.nextCursor;
  if(next!=null&&typeof next!=='string')throw Error('대화 항목의 다음 페이지를 확인하지 못했습니다.');
  if(next&&seen.has(next))throw Error('대화 항목의 페이지가 반복되어 중단했습니다.');
  if(next)seen.add(next);cursor=next;
  if(!cursor)break;
 }
 return out;
}
async function snapshot(client,threadId,cwd,forcedActive=false,options={}){
 const thread=options.thread?validateThread(options.thread,threadId,cwd):await readThread(client,threadId,cwd);
 let turns;
 try{turns=await pages(client,'thread/turns/list',{threadId,limit:25,sortDirection:'asc',itemsView:'notLoaded'});}
 catch(error){if(!unsupported(error))throw error;const legacy=await client.request('thread/read',{threadId,includeTurns:true});if(!legacy.thread||legacy.thread.id!==threadId||!samePath(legacy.thread.cwd,cwd)||!Array.isArray(legacy.thread.turns))throw Error('전체 대화 본문을 읽지 못했습니다.');turns=legacy.thread.turns;}
 const records=[],messages=[],attachments=[],seen=new Set();let itemCount=0;
 for(const turn of turns){
  let entries;
  if(turn.itemsView&&turn.itemsView!=='full'||!Array.isArray(turn.items)||turn.itemsNextCursor){entries=await itemPages(client,threadId,turn.id,options);}
  else entries=turn.items.map(item=>({item}));
  records.push({...turn,items:entries});
  for(const [index,entry]of entries.entries()){
   const item=entry.item||entry;if(!item||typeof item!=='object')throw Error('대화 항목 형식을 확인하지 못했습니다.');const key=String(turn.id)+':'+(item.id||index);if(seen.has(key))continue;seen.add(key);itemCount++;
   let role,body='',images=[];
   if(item.type==='userMessage'){role='user';for(const part of item.content||[]){if(part.type==='text'&&typeof part.text==='string')body+=(body?'\n':'')+part.text;else if(['localImage','image','file','localFile'].includes(part.type)){images.push(part);attachments.push({key,part});}}}
   else if(['agentMessage','plan'].includes(item.type)){role='assistant';body=typeof item.text==='string'?item.text:'';}
   else if(item.type==='exitedReviewMode'){role='assistant';body=typeof item.review==='string'?item.review:'';}
   else if(item.type==='commandExecution'){role='system';body=['실행 도구 / 명령',item.command,item.aggregatedOutput].filter(v=>typeof v==='string'&&v).join('\n\n');}
   else if(item.type==='fileChange'){role='system';body='파일 변경 기록\n'+JSON.stringify(item.changes||item,null,2);}
   else if(/ToolCall$/.test(item.type||'')){role='system';body='도구 실행 기록\n'+JSON.stringify(item,null,2);}
   else continue;
   if(!body&&images.length)body='첨부 자료 '+images.length+'개';
   if(!body)continue;
   const stamp=at(role==='user'?(entry.startedAtMs??turn.startedAt):(entry.completedAtMs??turn.completedAt??turn.startedAt),at(thread.createdAt));
   // 프로젝트 기록의 메시지 크기 제한 안에서 여러 조각으로 보존하며 본문을 자르지 않습니다.
   for(let offset=0;offset<body.length;offset+=1_900_000){messages.push({id:stable('codex-message:'+threadId+':'+key+':'+offset),role,text:body.slice(offset,offset+1_900_000),createdAt:stamp,...(turn.id&&{turnId:String(turn.id)})});}
  }
 }
 const raw={format:'flowrium-codex-source',version:1,observedAt:new Date().toISOString(),thread,turns:records},data=Buffer.from(JSON.stringify(raw,null,2));
 if(data.length>512*1024*1024)throw Error('대화 원문이 512MB를 넘었습니다. 원본은 그대로 보존됩니다.');
 const sourceActive=forcedActive||active(thread)||turns.some(t=>t.status==='inProgress'||t.status==='in_progress');
 const lastComplete=[...turns].reverse().find(t=>['completed','interrupted','failed'].includes(t.status)||t.completedAt!=null);
 return{thread,messages,attachments,raw,data,sha256:hash(data),contentHash:hash(JSON.stringify({thread:{id:thread.id,cwd:thread.cwd,name:thread.name,createdAt:thread.createdAt,updatedAt:thread.updatedAt},turns:records})),items:itemCount,active:sourceActive,lastCompleteTurnId:lastComplete?.id,warnings:attachments.length?['첨부의 원래 정보와 파일 참조를 원문에 보존합니다. 로컬 이미지 원본은 확인 가능한 범위에서 추가로 보관합니다.']:[]};
}
module.exports={hash,stable,at,id,isSubagent,active,canonical,snapshot,readThread,itemPages};
