import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import type {FlowriumEvent} from '../shared/types';
import InputRequestPanel from './InputRequestPanel';
export default function DecisionRequestPanel({event,title,onOpen,onResolved}:{event:FlowriumEvent;title?:string;onOpen?:()=>void;onResolved?:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[resolved,setResolved]=useState(false),sending=useRef(false);
 if(event.type==='input')return <InputRequestPanel event={event} title={title} onOpen={onOpen} onResolved={onResolved}/>;
 async function decide(decision:'accept'|'decline'){
  if(!event.requestId||sending.current||resolved)return;sending.current=true;setBusy(true);setError('');
  try{await window.flowrium!.approval({requestId:event.requestId,decision});setResolved(true);onResolved?.();}
  catch(error){setError(error instanceof Error?error.message:'응답을 전달하지 못했습니다.');}
  finally{sending.current=false;setBusy(false);}
 }
 return <section className="approval-card decision-request" aria-label="실행 승인 요청" role="region"><div className="approval-title"><ShieldCheck size={17}/><strong>{title||'진행하려면 확인이 필요합니다'}</strong></div><p>{event.text||'이번 요청에 필요한 실행 권한을 확인해 주세요.'}</p>
  {event.details&&<details><summary>실행 내용과 권한 확인</summary><pre>{event.details}</pre></details>}
  {error&&<p role="alert">{error}</p>}{resolved?<p role="status">응답을 전달했습니다.</p>:<div className="decision-response-actions"><button className="button secondary" disabled={busy} onClick={()=>void decide('decline')}>거절</button><button className="button primary" disabled={busy} onClick={()=>void decide('accept')}>이번 작업 승인</button>{onOpen&&<button className="button subtle" onClick={onOpen}>대화 열기</button>}</div>}
 </section>;
}
