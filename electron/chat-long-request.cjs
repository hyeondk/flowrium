const path = require('node:path');
const {storeRequestSource,resolveAttachments} = require('./chat-attachments.cjs');

// Large prompts in project chats are read from disk in ranges, using the turn's existing
// sandbox. General and integrated chats never receive access to a project directory here.
const projectInlineLimit = 32_000;

async function sourceRecord(store, projectId, id, includeBytes=false) {
  const [file]=await resolveAttachments(store,projectId,[id],includeBytes);
  if(file.name!=='request.txt' || file.type!=='text/plain')throw Error('요청 원문 파일을 확인해 주세요.');
  return file;
}
function sourceLabel(source) {
  return '긴 요청 원문 (' + (source.size / 1048576).toLocaleString('ko-KR',{maximumFractionDigits:2}) + 'MB)';
}
async function prepareRequest(store, session, text, cwd, savedSource) {
  if (session.scope || (!savedSource && text.length <= projectInlineLimit)) return {text};
  const project = store.project(session.projectId);
  const source = savedSource || await storeRequestSource(store,session.projectId,text);
  const absolute = path.join(project.path,'.flowrium','attachments',source.id,source.name);
  const relative = path.relative(cwd || project.path,absolute);
  if (path.isAbsolute(relative)) throw Error('긴 요청 원문을 읽으려면 프로젝트와 같은 드라이브의 작업 폴더를 선택해 주세요.');
  return {
    source,
    text: [
      '긴 요청의 전체 원문이 현재 기기의 프로젝트에 저장되어 있습니다.',
      '요청 원문 식별자 ' + source.sha256,
      '현재 작업 폴더 기준 경로 ' + relative.split(path.sep).join('/'),
      '전체 크기 ' + source.size + '바이트 (UTF-8)',
      '이 파일의 내용이 사용자가 보낸 작업 요청입니다. 현재 권한 안에서 로컬 파일을 범위별로 나누어 읽어 주세요. 긴 한 줄이나 여러 바이트 문자가 있더라도 내용을 빠뜨리지 말고 필요한 구간을 순서대로 확인해 주세요. 원문 파일이나 경로를 외부 서비스에 업로드하지 마세요. 읽을 수 없는 경우 그 사실을 알려 주세요.'
    ].join('\n')
  };
}

async function readRequestSource(store,sessionId,messageId,offset=0) {
  const session=store.session(sessionId), message=session.messages.find(row=>row.id===messageId);
  if(message?.role!=='user' || !message.requestSource)throw Error('대화의 긴 요청 원문을 찾을 수 없습니다.');
  const file=await sourceRecord(store,session.projectId,message.requestSource.id,true);
  if(file.sha256!==message.requestSource.sha256 || store.session(sessionId)!==session)throw Error('원문 또는 연결 계정이 바뀌었습니다.');
  const full=file.bytes.toString('utf8');
  if(offset==='full')return {text:full,next:null};
  if(!Number.isSafeInteger(offset)||offset<0||offset>=full.length)throw Error('원문 위치를 확인해 주세요.');
  let end=Math.min(full.length,offset+16384);
  if(end<full.length && full.charCodeAt(end)>=0xDC00 && full.charCodeAt(end)<=0xDFFF)end--;
  return {text:full.slice(offset,end),next:end<full.length?end:null};
}

function retainsRequest(original, incoming) {
  return original?.role === 'user' && incoming?.role === 'user' && original.requestSource &&
    incoming.text?.includes('요청 원문 식별자 ' + original.requestSource.sha256);
}
module.exports = {prepareRequest, retainsRequest, projectInlineLimit, sourceRecord, sourceLabel,readRequestSource};
