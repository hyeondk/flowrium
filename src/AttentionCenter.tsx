import {useEffect,useState} from 'react';
import {Bell,CheckCheck,ChevronRight,X} from 'lucide-react';
import type {WorkflowState} from '../shared/workflow';
import type {Session,FlowriumEvent} from '../shared/types';
import {visibleProposals} from '../shared/execution-state';
import {MotionOverlay,ModalPortal} from './ui-motion';
import DecisionRequestPanel from './DecisionRequestPanel';
import './chat-continuation.css';
export default function AttentionCenter({open,onClose,onShow,data,sessions,requests,onOpen,onDecisions,onRefresh}:{open:boolean;onClose():void;onShow?:()=>void;data?:WorkflowState;sessions:Session[];requests:FlowriumEvent[];onOpen(s:Session):void;onDecisions():void;onRefresh():Promise<void>}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[unreadOnly,setUnreadOnly]=useState(false),[quickOpen,setQuickOpen]=useState(false);
 const [arrivalVisible,setArrivalVisible]=useState(false),arrivalKey=requests.map(request=>request.requestId||'').sort().join('|');
 useEffect(()=>{setArrivalVisible(Boolean(arrivalKey));if(!arrivalKey)return;const timer=setTimeout(()=>setArrivalVisible(false),8000);return()=>clearTimeout(timer)},[arrivalKey]);
 const shown=open||quickOpen,close=()=>{setQuickOpen(false);onClose()};
 const unread=data?.notifications.filter(n=>!n.readAt)||[],decisions=visibleProposals(data?.proposals||[]);
 async function read(ids:string[]){setBusy(true);try{await window.flowrium?.workflowAction({action:'read',ids});await onRefresh()}catch{setError('읽음 상태를 저장하지 못했습니다.')}finally{setBusy(false)}}
 return <>{requests.length>0&&arrivalVisible&&!shown&&<ModalPortal><aside className="decision-arrival" role="status" aria-live="polite"><Bell size={17}/><span>답변이나 실행 확인이 필요한 요청 {requests.length}건이 도착했습니다.</span><button className="button primary" onClick={()=>onShow?onShow():setQuickOpen(true)}>응답하기</button><button className="decision-arrival-close" aria-label="결정 알림 닫기" onClick={()=>setArrivalVisible(false)}><X size={14}/></button></aside></ModalPortal>}
 <MotionOverlay open={shown} onClose={close} label="알림" className="attention-popup"><header className="utility-popup-heading"><div><Bell size={19}/><h2>알림</h2><span>{unread.length>0?`읽지 않음 ${unread.length}건`:'모두 확인했습니다'}</span></div><button className="icon-button" aria-label="알림 닫기" onClick={close}><X size={18}/></button></header>
 {requests.length>0&&<div className="attention-decision-cards" aria-label="지금 응답할 요청">{requests.map(event=><DecisionRequestPanel key={event.requestId} event={event} title={sessions.find(s=>s.id===event.sessionId)?.title} onResolved={()=>void onRefresh().catch(()=>{})} onOpen={()=>{const session=sessions.find(s=>s.id===event.sessionId);if(session){onOpen(session);close()}}}/>)}</div>}
 <div className="attention-toolbar"><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(!unreadOnly)}>{unreadOnly?'전체 알림 보기':'읽지 않은 알림'}</button><button disabled={busy||!unread.length} onClick={()=>void read(unread.map(n=>n.id))}><CheckCheck size={15}/>모두 읽음</button></div>
 <div className="attention-list">{(requests.length>0||decisions.length>0)&&<button className="attention-decision" onClick={()=>{close();onDecisions()}}><span><strong>확인이 필요한 결정</strong><small>프로젝트 요청과 추가 질문 {requests.length+decisions.length}건</small></span><ChevronRight size={18}/></button>}
 {(data?.notifications||[]).filter(n=>!unreadOnly||!n.readAt).map(n=>{const session=sessions.find(s=>s.id===n.sessionId);return <article className="attention-item" key={n.id} data-unread={!n.readAt}><button onClick={()=>{void read([n.id]);if(session){onOpen(session);close()}}}><i/><span><strong>{n.title}</strong><small>{session?.title||n.group}</small><p>{n.body}</p><time>{new Date(n.createdAt).toLocaleString('ko-KR')}</time></span>{session&&<ChevronRight size={16}/>}</button>{!n.readAt&&<button className="attention-read" disabled={busy} onClick={()=>void read([n.id])}>읽음</button>}</article>})}
 {!data?.notifications.length&&!requests.length&&!decisions.length&&<div className="attention-empty"><Bell size={28}/><p>아직 도착한 알림이 없습니다.</p><small>프로젝트별 진행 결과와 검토 요청을 이곳에서 모아 봅니다.</small></div>}{error&&<p role="alert">{error}</p>}</div></MotionOverlay></>
}
