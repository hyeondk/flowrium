const {resolveAttachments} = require('./chat-attachments.cjs');
const projectInlineLimit = 32_000;

async function sourceRecord(store, projectId, id, includeBytes=false) {
  const [file]=await resolveAttachments(store,projectId,[id],includeBytes);
  if(file.name!=='request.txt' || file.type!=='text/plain')throw Error('요청 원문 파일을 확인해 주세요.');
  return file;
}
function sourceLabel(source) {
  return '긴 요청 원문 (' + (source.size / 1048576).toLocaleString('ko-KR',{maximumFractionDigits:2}) + 'MB)';
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
module.exports = {retainsRequest, projectInlineLimit, sourceRecord, sourceLabel,readRequestSource};
