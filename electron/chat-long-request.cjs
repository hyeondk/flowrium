const {sourceRecord,filePage} = require('./chat-request-source.cjs');
const projectInlineLimit = 32_000;
function sourceLabel(source) {
  return '긴 요청 원문 (' + (source.size / 1048576).toLocaleString('ko-KR',{maximumFractionDigits:2}) + 'MB)';
}
async function readRequestSource(store,sessionId,messageId,offset=0) {
  const session=store.session(sessionId), message=session.messages.find(row=>row.id===messageId);
  if(message?.role!=='user' || !message.requestSource)throw Error('대화의 긴 요청 원문을 찾을 수 없습니다.');
  const file=await sourceRecord(store,session.projectId,message.requestSource.id,offset==='full');
  const check=()=>{
    if(file.sha256!==message.requestSource.sha256 || store.session(sessionId)!==session)throw Error('원문 또는 연결 계정이 바뀌었습니다.');
  };
  check();
  if(offset==='full')return {text:file.bytes.toString('utf8'),next:null};
  if(!Number.isSafeInteger(offset)||offset<0||offset>=file.index.characters)throw Error('원문 위치를 확인해 주세요.');
  const pages=file.index.pages;
  let low=0,high=pages.length;
  while(low+1<high){
    const mid=Math.floor((low+high)/2);
    if(pages[mid].character<=offset)low=mid;else high=mid;
  }
  const full=await filePage(file,low);
  check();
  const position=offset-pages[low].character;
  if(position>0 && /[\uDC00-\uDFFF]/.test(full[position]))throw Error('원문 글자의 시작 위치를 확인해 주세요.');
  return {text:full.slice(position),next:pages[low+1]?.character??null};
}

function retainsRequest(original, incoming) {
  return original?.role === 'user' && incoming?.role === 'user' && original.requestSource &&
    incoming.text?.includes('요청 원문 식별자 ' + original.requestSource.sha256);
}
module.exports = {retainsRequest, projectInlineLimit, sourceRecord, sourceLabel,readRequestSource};
