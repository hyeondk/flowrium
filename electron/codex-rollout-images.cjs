const { samePath: sameFilesystemPath } = require('./path-boundary.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const {constants}=require('node:fs');
const {fileURLToPath}=require('node:url');
const {createHash}=require('node:crypto');
const {MAX_FILE}=require('./chat-attachments.cjs');
const {samePath}=require('./history.cjs');
const MAX_SOURCE=2*1024*1024*1024,MAX_LINE=128*1024*1024,MAX_RECOVERED=512*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const attachmentKey=entry=>hash(entry.key+'\0'+JSON.stringify(entry.part));
const normalized=text=>text.replace(/\r\n/g,'\n').trim();
function signature(data){
 if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR')return{type:'image/png',extension:'.png'};
 if(data.length>=4&&data[0]===255&&data[1]===216&&data[2]===255)return{type:'image/jpeg',extension:'.jpg'};
 if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return{type:'image/webp',extension:'.webp'};
 if(data.length>=13&&['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)))return{type:'image/gif',extension:'.gif'};
}
function decode(value){
 if(typeof value!=='string'||value.length>Math.ceil(MAX_FILE*4/3)+100)throw Error('보관 이미지의 크기와 형식을 확인하지 못했습니다.');
 const match=/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/\r\n]*={0,2})$/.exec(value);
 if(!match)throw Error('보관 이미지가 지원하는 인라인 형식이 아닙니다.');
 const encoded=match[2].replace(/[\r\n]/g,'');if(!encoded.length||encoded.length%4)throw Error('보관 이미지의 인코딩이 올바르지 않습니다.');
 const data=Buffer.from(encoded,'base64'),format=signature(data),declared=match[1]==='image/jpg'?'image/jpeg':match[1];
 if(!data.length||data.length>MAX_FILE||!format||format.type!==declared)throw Error('보관 이미지의 실제 파일 형식을 확인하지 못했습니다.');
 return{data,...format,sha256:hash(data),provenance:'saved-conversation-image'};
}
function targets(data){
 const desired=new Set((data.attachments||[]).map(attachmentKey)),out=[];
 for(const turn of data.raw?.turns||[])for(const [index,entry]of (turn.items||[]).entries()){
  const item=entry.item||entry;if(item?.type!=='userMessage')continue;
  const parts=item.content||[],images=parts.filter(part=>['localImage','image'].includes(part.type));if(!images.length)continue;
  const rows=images.map((part,imageIndex)=>({entry:{key:String(turn.id)+':'+(item.id||index),part},imageIndex})).filter(row=>row.entry.part.type==='localImage'&&typeof row.entry.part.path==='string');
  if(!rows.length)continue;
  out.push({text:normalized(parts.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n')),paths:rows.map(row=>row.entry.part.path),imageCount:images.length,rows:rows.filter(row=>desired.has(attachmentKey(row.entry)))});
 }
 return out.filter(target=>target.rows.length);
}
function pathIndex(text,file,offset=0){
 for(;;){const at=text.indexOf(file,offset);if(at<0)return -1;const before=at?text[at-1]:'',after=text[at+file.length]||'';
  if((!before||/[\s`"'(\[<:=]/.test(before))&&(!after||/[\s`"')\]>;,]/.test(after)))return at;
  offset=at+Math.max(1,file.length);
 }
}
function pathsInOrder(text,files){let offset=0;for(const file of files){const at=pathIndex(text,file,offset);if(at<0)return false;offset=at+file.length;}return true;}

function* userMessages(value){
 const pending=[{value,depth:0}];let nodes=0;
 while(pending.length){const {value:next,depth}=pending.pop();if(!next||typeof next!=='object')continue;if(++nodes>2_000_000||depth>96)throw Error('보관 대화의 중첩 구조가 읽기 범위를 초과했습니다.');
  if(!Array.isArray(next)&&next.role==='user'&&Array.isArray(next.content))yield next;
  const children=Array.isArray(next)?next:Object.values(next);for(let index=children.length-1;index>=0;index--)if(children[index]&&typeof children[index]==='object')pending.push({value:children[index],depth:depth+1});
 }
}
async function* lines(stream,guard){
 let chunks=[],bytes=0;
 for await(const chunk of stream){guard();let start=0;for(let index=0;index<chunk.length;index++)if(chunk[index]===10){const piece=chunk.subarray(start,index);chunks.push(piece);bytes+=piece.length;if(bytes>MAX_LINE)throw Error('보관 대화의 한 줄이 128MB를 넘었습니다.');yield{data:Buffer.concat(chunks,bytes),complete:true};chunks=[];bytes=0;start=index+1;}
  if(start<chunk.length){const piece=chunk.subarray(start);chunks.push(piece);bytes+=piece.length;if(bytes>MAX_LINE)throw Error('보관 대화의 한 줄이 128MB를 넘었습니다.');}
 }
 if(bytes)yield{data:Buffer.concat(chunks,bytes),complete:false};
}
async function recoverSavedImages(data,options={}){
 const guard=options.guard||(()=>{}),warn=options.onWarning||(()=>{}),wanted=targets(data),result=new Map();guard();if(!wanted.length)return result;
 const candidates=new Map(),conflicts=new Set(),decoded=new Map(),seenPaths=new Map();let recoveredBytes=0,totalRead=0;
 function collect(record,local,ambiguous){
  for(const message of userMessages(record)){
   const parts=message.content,urls=parts.filter(part=>part?.type==='input_image').map(part=>part.image_url);if(!urls.length)continue;
   const text=normalized(parts.filter(part=>part?.type==='input_text'&&typeof part.text==='string').map(part=>part.text).join('\n'));
   const matching=wanted.filter(target=>target.imageCount===urls.length&&(!target.text||text.includes(target.text))&&pathsInOrder(text,target.paths));if(!matching.length)continue;
   let images;try{images=urls.map(url=>{const key=hash(typeof url==='string'?url:'');if(decoded.has(key))return decoded.get(key);const image=decode(url);if(recoveredBytes+image.data.length>MAX_RECOVERED)throw Error('복구 이미지의 합계가 512MB 읽기 범위를 넘었습니다.');recoveredBytes+=image.data.length;decoded.set(key,image);return image;});}catch(error){warn(error.message);continue;}
   for(const target of matching)for(const row of target.rows){const key=attachmentKey(row.entry),image=images[row.imageIndex],prior=local.get(key);if(prior&&prior.sha256!==image.sha256)ambiguous.add(key);else local.set(key,image);}
  }
 }
 async function visit(thread,depth=0,endByte){
  guard();if(depth>=8){warn('이전 대화 기록의 연결이 8단계를 넘어 해당 경로는 확인하지 않았습니다.');return;}
  const source=thread.path;if(typeof source!=='string')return;
  let file;try{file=source.startsWith('file:')?fileURLToPath(source):source;}catch{throw Error('보관 대화 경로를 확인하지 못했습니다.');}
  if(!path.isAbsolute(file)||!/^rollout-.*\.jsonl$/.test(path.basename(file)))throw Error('공식 대화의 원본 기록 경로를 확인해 주세요.');
  const stat=await fs.lstat(file),length=endByte??stat.size;
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('보관 대화는 링크가 아닌 일반 파일이어야 합니다.');
  if(!Number.isSafeInteger(length)||length<1||length>stat.size||length>MAX_SOURCE)throw Error('보관 대화의 2GB 읽기 범위를 확인해 주세요.');
  const real=await fs.realpath(file);if(!sameFilesystemPath(real,path.resolve(file)))throw Error('보관 대화 경로가 다른 위치를 가리킵니다.');
  const pathKey=process.platform==='win32'?real.toLowerCase():real;if((seenPaths.get(pathKey)||0)>=length){warn('이미 확인한 원본 파일의 범위는 중복해서 읽지 않았습니다.');return;}if(totalRead+length>MAX_SOURCE)throw Error('보관 대화의 합계가 2GB 읽기 범위를 넘었습니다.');seenPaths.set(pathKey,length);totalRead+=length;guard();
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0)),local=new Map(),ambiguous=new Set();let sourceConfirmed=false,stream,base;
  try{
   const opened=await handle.stat();if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('보관 대화가 읽기 전에 변경됐습니다.');
   stream=handle.createReadStream({start:0,end:length-1,autoClose:false,highWaterMark:64*1024});
   for await(const line of lines(stream,guard)){
    let record;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(line.data).replace(/^\uFEFF/,'').trim();if(!text)continue;record=JSON.parse(text);}catch(error){if(!line.complete){warn('기록 중인 마지막 줄은 제외하고 읽기 시작 시점까지 확인했습니다.');break;}throw Error('보관 대화의 기록 형식을 확인하지 못했습니다.');}
    if(!sourceConfirmed){if(record.type!=='session_meta'||record.payload?.id!==thread.id||!samePath(record.payload?.cwd,data.thread.cwd)||!samePath(thread.cwd,data.thread.cwd))throw Error('보관 대화의 식별자나 프로젝트가 일치하지 않습니다.');sourceConfirmed=true;base=record.payload.history_base;continue;}
    collect(record,local,ambiguous);
   }
   guard();const after=await handle.stat();if(after.dev!==opened.dev||after.ino!==opened.ino||after.size<opened.size||(after.size===opened.size&&after.mtimeMs!==opened.mtimeMs))throw Error('보관 대화가 읽는 중 변경됐습니다.');if(!sourceConfirmed)throw Error('보관 대화 식별 정보를 찾지 못했습니다.');
   if(after.size>opened.size)warn('조회 중 새 기록이 추가되어 읽기 시작 시점의 이미지 사본만 확인했습니다.');
  }finally{stream?.destroy();await handle.close();}
  for(const [key,image]of local){const prior=candidates.get(key);if(prior&&prior.sha256!==image.sha256)conflicts.add(key);else candidates.set(key,image);}for(const key of ambiguous)conflicts.add(key);
  if(base){
   if(typeof base.thread_id!=='string'||!base.thread_id||!Number.isSafeInteger(base.end_byte_offset)||base.end_byte_offset<1||!Number.isSafeInteger(base.end_ordinal_exclusive)||base.end_ordinal_exclusive<0){warn('이전 대화 기록 참조의 범위를 확인하지 못했습니다.');return;}
   if(!options.resolveHistoryBase){warn('명시된 이전 대화 기록은 확인 연결이 없어 추가로 읽지 않았습니다.');return;}
   try{guard();const parent=await options.resolveHistoryBase(base.thread_id);guard();if(!parent||![base.thread_id,data.thread.id].includes(parent.id)||!samePath(parent.cwd,data.thread.cwd))throw Error('이전 대화 식별자가 일치하지 않습니다.');await visit(parent,depth+1,base.end_byte_offset);}
   catch(error){guard();warn('명시된 이전 대화 기록을 안전하게 확인하지 못해 현재 기록의 일치 결과만 유지했습니다.');}
  }
 }
 await visit(data.thread);guard();for(const [key,image]of candidates)if(!conflicts.has(key))result.set(key,image);if(conflicts.size)warn('같은 첨부의 서로 다른 이미지 후보가 있어 해당 복구를 보류했습니다.');return result;
}
module.exports={recoverSavedImages,attachmentKey,decode};
