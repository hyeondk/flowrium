import {useState} from 'react';
import {Bell,CheckCheck,ChevronRight,X} from 'lucide-react';
import type {WorkflowState} from '../shared/workflow';
import type {Session,FlowriumEvent} from '../shared/types';
import {visibleProposals} from '../shared/execution-state';
import {MotionOverlay} from './ui-motion';
export default function AttentionCenter({open,onClose,data,sessions,requests,onOpen,onDecisions,onRefresh}:{open:boolean;onClose():void;data?:WorkflowState;sessions:Session[];requests:FlowriumEvent[];onOpen(s:Session):void;onDecisions():void;onRefresh():Promise<void>}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[unreadOnly,setUnreadOnly]=useState(false);
 const unread=data?.notifications.filter(n=>!n.readAt)||[],decisions=visibleProposals(data?.proposals||[]);
 async function read(ids:string[]){setBusy(true);try{await window.flowrium?.workflowAction({action:'read',ids});await onRefresh()}catch{setError('읽음 상태를 저장하지 못했습니다.')}finally{setBusy(false)}}
 return <MotionOverlay open={open} onClose={onClose} label="알림" className="attention-popup"><header className="utility-popup-heading"><div><Bell size={19}/><h2>알림</h2><span>{unread.length>0?`읽지 않음 ${unread.length}건`:'모두 확인했습니다'}</span></div><button className="icon-button" aria-label="알림 닫기" onClick={onClose}><X size={18}/></button></header>
 <div className="attention-toolbar"><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(!unreadOnly)}>{unreadOnly?'전체 알림 보기':'읽지 않은 알림'}</button><button disabled={busy||!unread.length} onClick={()=>void read(unread.map(n=>n.id))}><CheckCheck size={15}/>모두 읽음</button></div>
 <div className="attention-list">{(requests.length>0||decisions.length>0)&&<button className="attention-decision" onClick={()=>{onClose();onDecisions()}}><span><strong>확인이 필요한 결정</strong><small>프로젝트 요청과 추가 질문 {requests.length+decisions.length}건</small></span><ChevronRight size={18}/></button>}
 {(data?.notifications||[]).filter(n=>!unreadOnly||!n.readAt).map(n=>{const session=sessions.find(s=>s.id===n.sessionId);return <article className="attention-item" key={n.id} data-unread={!n.readAt}><button onClick={()=>{void read([n.id]);if(session){onOpen(session);onClose()}}}><i/><span><strong>{n.title}</strong><small>{session?.title||n.group}</small><p>{n.body}</p><time>{new Date(n.createdAt).toLocaleString('ko-KR')}</time></span>{session&&<ChevronRight size={16}/>}</button>{!n.readAt&&<button className="attention-read" disabled={busy} onClick={()=>void read([n.id])}>읽음</button>}</article>})}
 {!data?.notifications.length&&!requests.length&&!decisions.length&&<div className="attention-empty"><Bell size={28}/><p>아직 도착한 알림이 없습니다.</p><small>프로젝트별 진행 결과와 검토 요청을 이곳에서 모아 봅니다.</small></div>}{error&&<p role="alert">{error}</p>}</div></MotionOverlay>
}
