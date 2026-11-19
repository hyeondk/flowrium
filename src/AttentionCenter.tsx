import {useState} from 'react';
import {ArrowRight,Bell,Check,CheckCheck,ChevronRight,MessageSquareText,X} from 'lucide-react';
import type {WorkflowNotification,WorkflowState} from '../shared/workflow';
import type {Session,FlowriumEvent} from '../shared/types';
import {visibleProposals} from '../shared/execution-state';
import {MotionOverlay} from './ui-motion';
import DecisionRequestPanel from './DecisionRequestPanel';
import './chat-continuation.css';
import './notification-design.css';

type NoticeProps = {title:string;lines:string[];onClose():void;onOpen():void;action:string;tone:'question'|'success'|'error'};
export function FlowNotice({title,lines,onClose,onOpen,action,tone}:NoticeProps){
 const Icon=tone==='question'?MessageSquareText:tone==='success'?Check:Bell;
 return <aside className="flow-question-notice" data-tone={tone} aria-label={title}>
  <header><span className="flow-notice-symbol"><Icon size={16}/></span><strong role="status">{title}</strong><button type="button" aria-label="알림 닫기" onClick={onClose}><X size={15}/></button></header>
  <div className="flow-notice-summary">{lines.slice(0,3).map((line,index)=><p key={index}>{line}</p>)}</div>
  <button type="button" className="flow-notice-action" onClick={onOpen}>{action}<ArrowRight size={14}/></button>
 </aside>;
}
export function answerNoticeTitle(notification:WorkflowNotification,title=notification.title){
 const subject=title?`‘${title}’ 대화`:'대화';
 return notification.kind==='done'
  ? subject+'의 답변이 완료됐습니다.'
  : subject+(notification.body.startsWith('결과 / 작업이 중지되었습니다.')?'의 작업이 중지됐습니다.':'의 작업을 완료하지 못했습니다.');
}
function previewLines(body:string){
 return body.replace(/:codex-file-citation\{[^}]*\}/g,'').replace(/<send_user_message_question_reply>[\s\S]*?(?:<\/send_user_message_question_reply>|$)/g,'')
  .split(/\r?\n/).map(line=>line.trim()).filter(Boolean).slice(0,3).map(line=>{
   if(line.length<=100)return line;
   const clipped=line.slice(0,98),boundary=clipped.lastIndexOf(' ');
   return clipped.slice(0,boundary>60?boundary:98)+'…';
  });
}
export default function AttentionCenter({open,onClose,onShow,data,sessions,requests,onOpen,onQuestion,onDecisions,onRefresh}:{open:boolean;onClose():void;onShow?:()=>void;data?:WorkflowState;sessions:Session[];requests:FlowriumEvent[];onOpen(s:Session):void;onQuestion?:(event:FlowriumEvent)=>void;onDecisions():void;onRefresh():Promise<void>}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[unreadOnly,setUnreadOnly]=useState(false);
 const unread=data?.notifications.filter(n=>!n.readAt)||[],decisions=visibleProposals(data?.proposals||[]);
 async function read(ids:string[]){setBusy(true);try{await window.flowrium?.workflowAction({action:'read',ids});await onRefresh()}catch{setError('읽음 상태를 저장하지 못했습니다.')}finally{setBusy(false)}}
 function openRequest(event:FlowriumEvent){
  if(event.type==='input'&&onQuestion){onClose();onQuestion(event);return;}
  const session=sessions.find(s=>s.id===event.sessionId);if(session){onOpen(session);onClose();}
 }
 return <MotionOverlay open={open} onClose={onClose} label="알림" className="attention-popup"><header className="utility-popup-heading"><div><Bell size={19}/><h2>알림</h2><span>{unread.length>0?`읽지 않음 ${unread.length}건`:'모두 확인했습니다'}</span></div><button className="icon-button" aria-label="알림 닫기" onClick={onClose}><X size={18}/></button></header>
 {requests.length>0&&<div className="attention-decision-cards" aria-label="지금 응답할 요청">{requests.map(event=><DecisionRequestPanel key={event.requestId} event={event} title={sessions.find(s=>s.id===event.sessionId)?.title} onResolved={()=>void onRefresh().catch(()=>{})} onOpen={()=>openRequest(event)}/>)}</div>}
 <div className="attention-toolbar"><button aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(!unreadOnly)}>{unreadOnly?'전체 알림 보기':'읽지 않은 알림'}</button><button disabled={busy||!unread.length} onClick={()=>void read(unread.map(n=>n.id))}><CheckCheck size={15}/>모두 읽음</button></div>
 <div className="attention-list">{(requests.length>0||decisions.length>0)&&<button className="attention-decision" onClick={()=>{onClose();onDecisions()}}><span><strong>확인이 필요한 결정</strong><small>프로젝트 요청과 추가 질문 {requests.length+decisions.length}건</small></span><ChevronRight size={18}/></button>}
 {(data?.notifications||[]).filter(n=>!unreadOnly||!n.readAt).map(n=>{
  const session=sessions.find(s=>s.id===n.sessionId),answer=n.kind==='done'||n.kind==='error';
  return <article className="attention-item" key={n.id} data-unread={!n.readAt}><button onClick={()=>{void read([n.id]);if(session){onOpen(session);onClose()}}}><i/><span><strong>{answer?answerNoticeTitle(n,session?.title):n.title}</strong>{!answer&&<small>{session?.title||n.group}</small>}<span className="attention-preview">{previewLines(n.body).map((line,index)=><p key={index}>{line}</p>)}</span><time>{new Date(n.createdAt).toLocaleString('ko-KR')}</time>{session&&<span className="attention-open-label">대화에서 자세히 보기 <ChevronRight size={13}/></span>}</span></button>{!n.readAt&&<button className="attention-read" disabled={busy} onClick={()=>void read([n.id])}>읽음</button>}</article>;
 })}
 {unreadOnly&&Boolean(data?.notifications.length)&&!unread.length&&<div className="attention-empty"><CheckCheck size={28}/><p>읽지 않은 알림이 없습니다.</p></div>}
 {!data?.notifications.length&&!requests.length&&!decisions.length&&<div className="attention-empty"><Bell size={28}/><p>아직 도착한 알림이 없습니다.</p><small>프로젝트별 진행 결과와 검토 요청을 이곳에서 모아 봅니다.</small></div>}{error&&<p role="alert">{error}</p>}</div></MotionOverlay>;
}
