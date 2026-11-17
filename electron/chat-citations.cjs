const fs=require('node:fs/promises');
const path=require('node:path');
const {presentCitations}=require('./mobile/file-citations.js');
const {UUID}=require('./project-store.cjs');
const {artifactFile,projectRoot}=require('./workbench.cjs');
const {resolveAttachments,MAX_FILE}=require('./chat-attachments.cjs');
const {relativePath}=require('./path-boundary.cjs');
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
async function readChatCitation(store,sessionId,messageId,index,action,reveal) {
  if(!UUID.test(sessionId)||!UUID.test(messageId)||!Number.isSafeInteger(index)||index<0||!['preview','download','reveal'].includes(action))throw Error('요청한 파일 참조를 확인해 주세요.');
  const session=store.session(sessionId);
  const message=session.messages.find(m=>m.id===messageId&&m.role==='assistant');
  const ref=message && presentCitations(message.text).references[index];
  if(!ref)throw Error('이 답변에 연결된 파일을 찾지 못했습니다.');
  const registered=message.attachments?.find(a=>ref.attachmentId===a.id);
  let file,stat;
  if(registered){
    const [row]=await resolveAttachments(store,session.projectId,[registered.id]);
    file=row.path;stat=await fs.lstat(file);
  }else{
    const root=await projectRoot(store.project(session.projectId));
    const relative=(path.isAbsolute(ref.path)?relativePath(root,ref.path):ref.path).split(path.sep).join('/');
    ({file,stat}=await artifactFile(root,relative,true));
  }
  if(action==='reveal') {
    if(!reveal)throw Error('이 기기에서 파일 위치를 열 수 없습니다.');
    await reveal(file);return {name:path.basename(file)};
  }
  const type=imageTypes[path.extname(file).toLowerCase()]||'application/octet-stream';
  if(action==='preview' && !type.startsWith('image/'))throw Error('이 파일은 내려받아 열 수 있습니다.');
  if(stat.size>MAX_FILE)throw Error('파일이 큽니다. 컴퓨터에서 파일 위치를 열어 주세요.');
  const handle=await fs.open(file,'r');
  try{
    const current=await handle.stat();
    if(!current.isFile()||current.dev!==stat.dev||current.ino!==stat.ino||current.size!==stat.size)throw Error('파일이 바뀌었습니다. 다시 열어 주세요.');
    const bytes=Buffer.alloc(current.size);
    let offset=0;
    while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw Error('파일을 끝까지 읽지 못했습니다.');offset+=bytesRead;}
    return {name:path.basename(file),dataUrl:'data:'+type+';base64,'+bytes.toString('base64')};
  }finally{await handle.close();}
}
module.exports={readChatCitation};
