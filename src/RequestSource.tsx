import {useState} from 'react';

export function RequestSource({sessionId,messageId}:{sessionId:string;messageId:string}) {
  const [page,setPage]=useState<{text:string;next:number|null}>();
  const [offsets,setOffsets]=useState([0]);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  async function load(next:number[]) {
    if(pending || !window.flowrium)return;
    setError('');setPending(true);
    try {
      const value=await window.flowrium.readRequestSource(sessionId,messageId,next.at(-1)!);
      setOffsets(next);setPage(value);
    } catch(e){setError(e instanceof Error?e.message:'원문을 읽지 못했습니다.');}
    finally{setPending(false);}
  }
  return <details onToggle={event=>{if(event.currentTarget.open && !page)void load([0]);}}>
    <summary>요청 원문 읽기</summary>
    {error && <p role="alert">{error}</p>}
    {page && <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{page.text}</p>}
    <div className="actions">
      {offsets.length>1 && <button disabled={pending} onClick={()=>void load(offsets.slice(0,-1))}>이전 부분</button>}
      {page?.next!=null && <button disabled={pending} onClick={()=>void load([...offsets,page.next!])}>다음 부분</button>}
    </div>
  </details>;
}
