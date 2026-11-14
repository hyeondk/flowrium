import {useEffect,useRef,useState} from 'react';
import {ArrowRight,LoaderCircle,Sparkles} from 'lucide-react';
import type {Session} from '../shared/types';
import type {FollowupSuggestions} from '../shared/chat-continuation';
import {awaitsContinuation} from '../shared/execution-state';
import './chat-continuation.css';
export default function ChatContinuation({session,running,authenticated,busy,onChoose,onContinue}:{session:Session;running:boolean;authenticated:boolean;busy:boolean;onChoose(prompt:string):void;onContinue(messageId:string):Promise<void>}){
 const last=session.messages.at(-1),messageId=last?.role==='assistant'?last.id:'',waiting=awaitsContinuation(session);
 const [result,setResult]=useState<FollowupSuggestions>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[chosen,setChosen]=useState<string[]>([]),[continuing,setContinuing]=useState(false);
 const generation=useRef(0),flight=useRef(false),continueFlight=useRef(false);
 useEffect(()=>{generation.current++;setResult(undefined);setChosen([]);setError('');setLoading(false);setContinuing(false);flight.current=false;continueFlight.current=false;return()=>{generation.current++}},[session.id,messageId]);
 async function recommend(){
  if(!messageId||flight.current||busy||running)return;const current=generation.current;flight.current=true;setLoading(true);setError('');
  try{const value=await window.flowrium!.workflowAction({action:'followupSuggestions',sessionId:session.id,messageId}) as FollowupSuggestions;if(current===generation.current){if(value.source!=='model'||value.messageId!==messageId||!Array.isArray(value.suggestions))throw Error('후속 추천 결과를 확인하지 못했습니다.');setResult(value);setChosen([]);}}
  catch(error){if(current===generation.current)setError(error instanceof Error?error.message:'다음 작업을 추천받지 못했습니다.');}
  finally{if(current===generation.current){flight.current=false;setLoading(false);}}
 }
 async function proceed(){if(continueFlight.current||busy||running||!messageId)return;continueFlight.current=true;setContinuing(true);setError('');const current=generation.current;try{await onContinue(messageId);}catch(error){if(current===generation.current)setError(error instanceof Error?error.message:'진행 요청을 보내지 못했습니다.');}finally{continueFlight.current=false;if(current===generation.current)setContinuing(false);}}
 if(!messageId||running||session.compacting||session.queuedMessages?.some(row=>row.status==='queued'||row.status==='sending')||session.workflow?.status==='done')return null;
 return <section className="chat-continuation" aria-label="다음 작업"><div className="chat-continuation-actions">{waiting&&<><span>다음 진행을 기다리고 있습니다.</span><button className="button primary" disabled={busy||continuing||!authenticated} onClick={()=>void proceed()}>{continuing?<LoaderCircle size={14} className="spin"/>:<ArrowRight size={14}/>}진행하기</button></>}
  <button className="button subtle" disabled={busy||loading||!authenticated} onClick={()=>void recommend()}>{loading?<LoaderCircle size={14} className="spin"/>:<Sparkles size={14}/>}다음 작업 추천받기</button></div>
  {loading&&<p role="status">연결한 ChatGPT 계정으로 대화에 맞는 다음 작업을 검토하고 있습니다.</p>}
  {result&&<><p className="chat-continuation-help">선택한 추천은 입력창에 추가됩니다. 내용을 수정한 뒤 직접 보내세요.</p>{result.suggestions.length?result.suggestions.map(row=><button className="followup-suggestion" key={row.prompt} disabled={busy||chosen.includes(row.prompt)} onClick={()=>{setChosen(old=>[...old,row.prompt]);onChoose(row.prompt)}}><strong>{row.title}</strong><span>{row.reason}</span><small>{chosen.includes(row.prompt)?'입력창에 추가됨':'입력창에 추가'}</small></button>):<p>현재 대화에서 추가로 추천할 작업을 찾지 못했습니다.</p>}</>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
