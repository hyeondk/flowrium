const fs=require('node:fs/promises');
const path=require('node:path');
const MarkdownIt=require('markdown-it');
const {chatFileLinkTarget}=require('./chat-file-links.js');
const {presentCitations}=require('./mobile/file-citations.js');
const {UUID}=require('./project-store.cjs');
const {artifactFile,projectRoot}=require('./workbench.cjs');
const {resolveAttachments,MAX_FILE}=require('./chat-attachments.cjs');
const {relativePath}=require('./path-boundary.cjs');
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
const markdown = new MarkdownIt();
const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = href => Boolean(chatFileLinkTarget(href)) || defaultValidateLink(href);

function linkedMarkdownFile(message,target) {
  return markdown.parse(message.text, {}).some(token => token.children?.some(child =>
    child.type === 'link_open' && chatFileLinkTarget(child.attrGet('href')) === target));
}

function fileParts(target) {
  const foreign = process.platform === 'win32' ? /^[/\\]/.test(target) : /^(?:[a-z]:[\\/]|\\)/i.test(target);
  if (foreign) throw Error('이 운영체제에서 열 수 있는 프로젝트 경로인지 확인해 주세요.');
  // Mac의 표준 /tmp와 /var 별칭으로 저장된 이전 링크도 실제 위치에 맞춘다.
  if (process.platform === 'darwin' && /^\/(?:tmp|var)\//.test(target)) target = '/private'+target;
  const base = path.parse(target).root;
  const parts = (base ? target.slice(base.length) : target.replace(/^\.\//,'')).split(/[\\/]/);
  const invalidPart = part => !part || part.startsWith('.') || /[:\x00-\x1f]/.test(part) ||
    (process.platform === 'win32' && (/[<>"|?*]|[. ]$/.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)));
  if (parts.some(invalidPart)) throw Error('이 링크의 경로에서 일반 파일을 찾을 수 없습니다.');
  return {base,parts};
}

async function revealableFile(root,parts) {
  const file = path.join(root,...parts);
  try {
    const stat = await fs.lstat(file);
    if (stat.isFile() && relativePath(file,await fs.realpath(file)) === '') return file;
  } catch (error) {
    if (['ENOENT','ENOTDIR'].includes(error.code)) throw Error('연결된 파일이 현재 위치에 없습니다.');
    if (['EACCES','EPERM'].includes(error.code)) throw Error('이 파일 위치에 접근할 수 없습니다.');
    throw error;
  }
  throw Error('이 링크의 경로에서 일반 파일을 찾을 수 없습니다.');
}

async function projectFile(root,target) {
  const {base,parts} = fileParts(target);
  if (!base) return revealableFile(root,parts);
  const relative = relativePath(root,path.join(base,...parts));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep))
    throw Error('현재 프로젝트 폴더에 있는 파일만 열 수 있습니다.');
  return revealableFile(root,relative.split(path.sep));
}

async function readChatCitation(store,sessionId,messageId,index,action,reveal) {
  const target = action==='reveal' ? chatFileLinkTarget(index) : null;
  if(!UUID.test(sessionId)||!UUID.test(messageId)||(!target&&(!Number.isSafeInteger(index)||index<0))||!['preview','download','reveal'].includes(action))throw Error('요청한 파일 참조를 확인해 주세요.');
  const session=store.session(sessionId);
  const message=session.messages.find(m=>m.id===messageId&&m.role==='assistant');
  if (target) {
    if (!message || !reveal || !linkedMarkdownFile(message,target)) throw Error('이 답변에 연결된 파일을 찾지 못했습니다.');
    const {base,parts} = fileParts(target);
    // 절대 경로는 사용자가 누른 링크의 위치만 데스크톱에서 표시한다.
    // 상대 경로와 파일 다운로드는 기존 프로젝트 경계를 사용한다.
    const root = base || await projectRoot(store.project(session.projectId));
    const file = await revealableFile(root,parts);
    await reveal(file);
    return {name:path.basename(file)};
  }
  const ref=message && presentCitations(message.text).references[index];
  if(!ref)throw Error('이 답변에 연결된 파일을 찾지 못했습니다.');
  const registered=message.attachments?.find(a=>ref.attachmentId===a.id);
  let file,stat;
  if(registered){
    const [row]=await resolveAttachments(store,session.projectId,[registered.id]);
    file=row.path;stat=await fs.lstat(file);
  }else{
    const root=await projectRoot(store.project(session.projectId));
    if(action==='reveal')file=await projectFile(root,ref.path);
    else {
      const relative=(path.isAbsolute(ref.path)?relativePath(root,ref.path):ref.path).split(path.sep).join('/');
      ({file,stat}=await artifactFile(root,relative,true));
    }
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
