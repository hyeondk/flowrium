const fs=require('node:fs/promises'),path=require('node:path'),constants=require('node:fs').constants;
const {fileURLToPath}=require('node:url');
const {addAttachments,resolveAttachments,MAX_FILE}=require('./chat-attachments.cjs');
const {projectDirectory,createJSON,readJSON}=require('./project-store.cjs');
const {hash,stable}=require('./codex-transfer-data.cjs');
function imageType(data){if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{type:'image/png',extension:'.png'};if(data[0]===255&&data[1]===216&&data[2]===255)return{type:'image/jpeg',extension:'.jpg'};if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return{type:'image/webp',extension:'.webp'};if(['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)))return{type:'image/gif',extension:'.gif'};}
async function image(part){
 const value=part.url||part.imageUrl||part.image_url;let data;
 if(typeof value==='string'&&value.startsWith('data:')){const match=/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);if(!match||match[1].length>Math.ceil(MAX_FILE*4/3)+10)throw Error('이미지 원본의 크기나 형식을 확인하지 못했습니다.');data=Buffer.from(match[1],'base64');}
 else if(part.type==='localImage'&&typeof part.path==='string'){
  const file=part.path.startsWith('file:')?fileURLToPath(part.path):part.path;if(!path.isAbsolute(file))throw Error('상대 이미지 경로는 원문 참조로 보관했습니다.');const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>MAX_FILE)throw Error('이미지 파일을 안전하게 읽을 수 없습니다.');const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const opened=await handle.stat();if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw Error('이미지 원본이 읽는 중 바뀌었습니다.');data=await handle.readFile();}finally{await handle.close();}
 }else throw Error('원격 이미지나 파일 참조는 원문에 보관했습니다. 자동 다운로드하지 않습니다.');
 const format=imageType(data);if(!format||!data.length||data.length>MAX_FILE)throw Error('지원하는 이미지 바이트가 아닙니다. 원문 참조는 보존했습니다.');return{data,...format};
}
async function materialize(store,project,data,guard){
 const groups=new Map(),warnings=[];let copied=0,missing=0;
 const root=path.join(project.path,'.flowrium','codex-source',hash(data.thread.id));await projectDirectory(path.dirname(root));await projectDirectory(root);const cache=path.join(root,'attachments');await projectDirectory(cache);
 for(const entry of data.attachments){guard();const key=hash(entry.key+'\0'+JSON.stringify(entry.part)),file=path.join(cache,key+'.json');let attachment;
  try{let saved;try{saved=await readJSON(file);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(saved){if(saved.version!==1||saved.key!==key)throw Error('보관한 첨부 정보가 변경됐습니다.');const [resolved]=await resolveAttachments(store,project.id,[saved.attachment.id]);const {path:_,image:__,dataUrl:___,...record}=resolved;attachment=record;}
   else{const bytes=await image(entry.part);guard();const [record]=await addAttachments(store,project.id,[{name:'Codex-첨부-'+key.slice(0,12)+bytes.extension,type:bytes.type,bytes:bytes.data}]);guard();await createJSON(file,{version:1,key,attachment:record});attachment=record;copied++;}
   const messageId=stable('codex-message:'+data.thread.id+':'+entry.key+':0'),rows=groups.get(messageId)||[];if(!rows.some(row=>row.id===attachment.id))rows.push(attachment);groups.set(messageId,rows);
  }catch(error){missing++;warnings.push('첨부 원문 참조 보존 / '+String(error.message));}
 }
 const messages=[];for(const message of data.messages){const files=groups.get(message.id)||[];messages.push({...message,...(files.length?{attachments:files.slice(0,10)}:{})});for(let offset=10;offset<files.length;offset+=10)messages.push({...message,id:stable(message.id+':추가첨부:'+offset),text:'이 요청의 추가 첨부 자료',attachments:files.slice(offset,offset+10)});}
 return{messages,warnings,copied,missing};
}
module.exports={materialize,image};
