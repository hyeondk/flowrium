// Keep data requests below the tunnel limit. Browser digests cover one slice
// at a time so the largest temporary byte array is one chunk.
const digest=async data=>new Uint8Array(await crypto.subtle.digest('SHA-256',data));
const hex=data=>Array.from(data,byte=>byte.toString(16).padStart(2,'0')).join('');
const endpoint=(sessionId,id)=>'/api/mobile/request-upload?'+new URLSearchParams({sessionId,id});

export function discardUpload(sessionId,id,key) {
  if(!key||!id)return;
  void fetch(endpoint(sessionId,id),{method:'DELETE',headers:{Authorization:'Bearer '+key},credentials:'omit',referrerPolicy:'no-referrer',keepalive:true}).catch(()=>{});
}

export async function uploadText({blob,sessionId,id,key,guard,signal,onProgress}) {
  const base=endpoint(sessionId,id);
  async function request(action,body,checksum,offset){
    const part=action==='part';
    const headers={Authorization:'Bearer '+key,'Content-Type':part?'application/octet-stream':'application/json'};
    if(part)headers['x-content-sha256']=checksum;
    const url=base+'&action='+action+(part?'&offset='+offset:'');
    for(let attempt=0;attempt<2;attempt++){
      guard();
      let response;
      try{
        const timeout=AbortSignal.timeout(120000);
        response=await fetch(url,{method:part?'PUT':'POST',headers,body:part?body:JSON.stringify(body),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any?AbortSignal.any([timeout,signal]):timeout});
      }catch(error){
        guard();
        if(!attempt&&navigator.onLine)continue;
        throw Error('원문 전송이 멈췄습니다. 연결 후 같은 요청을 다시 보내면 이어서 전송합니다.');
      }
      if(response.status>=500 && !attempt)continue;
      const value=await response.json();guard();
      if(!response.ok){
        const error=Error(value.error||'원문을 전송하지 못했습니다. 작성한 요청에서 다시 시도해 주세요.');
        if(response.status===401)error.gate='expired';else if(value.locked)error.gate='locked';
        throw error;
      }
      return value;
    }
  }
  const start=await request('begin',{size:blob.size});
  if(start.chunkBytes!==1024*1024 || !Number.isSafeInteger(start.offset)||start.offset<0||start.offset>blob.size||
    (start.offset!==blob.size&&start.offset%start.chunkBytes) || !/^[a-f0-9]{64}$/.test(start.chain))
    throw Error('원문을 이어 보낼 위치가 올바르지 않습니다.');
  let chain=new Uint8Array(32);
  const verifyPrefix=()=>{if(hex(chain)!==start.chain)throw Error('작성한 원문과 저장된 조각이 다릅니다. 연결을 확인해 주세요.');};
  if(start.offset===0)verifyPrefix();
  for(let offset=0;offset<blob.size;offset+=start.chunkBytes){
    guard();
    const end=Math.min(blob.size,offset+start.chunkBytes);
    const slice=blob.slice(offset,end),sum=await digest(await slice.arrayBuffer());
    const link=new Uint8Array(64);link.set(chain);link.set(sum,32);chain=await digest(link);
    if(end===start.offset)verifyPrefix();
    if(offset>=start.offset){
      const result=await request('part',slice,hex(sum),offset);
      if(result.offset!==end)throw Error('저장된 원문 길이가 다릅니다. 다시 보내 주세요.');
    }
    onProgress(end,blob.size);
  }
  const record=await request('finish',{chain:hex(chain)});
  if(record.size!==blob.size || !/^[a-f0-9]{64}$/.test(record.sha256) || typeof record.id!=='string')
    throw Error('원문 저장 결과를 확인할 수 없습니다. 작성한 요청을 다시 보내 주세요.');
  return record.id;
}
