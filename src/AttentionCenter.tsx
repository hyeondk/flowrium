import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Bell,Check,CheckCheck,ChevronRight,MessageSquareText,Trash2,X} from 'lucide-react';
import type {WorkflowNotification,WorkflowState} from '../shared/workflow';
import type {FlowriumEvent,Session} from '../shared/types';
import {visibleProposals} from '../shared/execution-state';
import {AnimatedCheckbox,MotionOverlay,toastLifetime,usePresence} from './ui-motion';
import DecisionRequestPanel from './DecisionRequestPanel';
import './chat-continuation.css';
import './notification-design.css';

type NoticeProps = {noticeId:string;title:string;summary?:string;onExpire():void;onOpen():void;action:string;tone:'question'|'success'|'error'};
export function FlowNotice(props: NoticeProps | {noticeId?:undefined}){
 const current=props.noticeId===undefined?undefined:props;
 const latest=useRef(current);
 if(current)latest.current=current;
 const {present,phase}=usePresence(Boolean(current));
 useEffect(()=>{
  if(!current)return;
  const timer=window.setTimeout(()=>latest.current?.onExpire(),toastLifetime);
  return()=>window.clearTimeout(timer);
 },[current?.noticeId]);
 if(!present||!latest.current)return null;
 const {title,summary,onOpen,action,tone}=latest.current;
 const Icon=tone==='question'?MessageSquareText:tone==='success'?Check:Bell;
 return <aside className="flow-question-notice" data-tone={tone} data-phase={phase} data-motion="toast" aria-label={title} inert={phase==='exit'}>
  <header><span className="flow-notice-symbol"><Icon size={16}/></span><strong role={tone==='error'?'alert':'status'}>{title}</strong></header>
  {summary&&<div className="flow-notice-summary"><p>{summary}</p></div>}
  <button type="button" className="flow-notice-action" onClick={onOpen}>{action}<ArrowRight size={14}/></button>
 </aside>;
}
export function answerNoticeTitle(notification:WorkflowNotification,title=notification.title){
 const subject=title?`‘${title}’ 대화`:'대화';
 return notification.kind==='done'
  ? subject+'의 답변이 완료됐습니다.'
  : subject+(notification.body.startsWith('결과 / 작업이 중지되었습니다.')?'의 작업이 중지됐습니다.':'의 작업을 완료하지 못했습니다.');
}
export function noticePreview(notification:WorkflowNotification){
 const clean=(notification.preview || notification.body)
  .replace(/:codex-file-citation\{[^}]*\}/g,'')
  .replace(/<send_user_message_question_reply>[\s\S]*?(?:<\/send_user_message_question_reply>|$)/g,'')
  .replace(/^`{3}[\s\S]*?(?:`{3}|$)/gm,'');
 const lines=clean.split(/\r?\n/).map(text=>text.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|(?:결과|검증|남은 사항)\s*\/\s*)/u,'').trim());
 const line=lines.find(text=>text && !/^(?:예상 소요 시간|소요 시간|검증 내용은 대화|후속 작업은 대화|:::|~{3})/u.test(text))
  || (notification.kind==='done'?'대화에서 답변을 확인해 주세요.':'');
 const compact=line.replace(/\s+/gu,' ');
 const characters=Array.from(compact);
 if(characters.length<=70)return compact;
 const head=characters.slice(0,69).join(''),boundary=head.lastIndexOf(' ');
 return (boundary>39?head.slice(0,boundary):head)+'…';
}

export default function AttentionCenter({open,onClose,data,sessions,requests,onOpen,onQuestion,onDecisions,onUpdate,onRefresh}:{open:boolean;onClose():void;data?:WorkflowState;sessions:Session[];requests:FlowriumEvent[];onOpen(s:Session):void;onQuestion?:(event:FlowriumEvent)=>void;onDecisions():void;onUpdate():void;onRefresh():Promise<void>}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[unreadOnly,setUnreadOnly]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 const [deleted,setDeleted]=useState<string[]>([]);
 const notifications=(data?.notifications||[]).filter(n=>!deleted.includes(n.id));
 const unread=notifications.filter(n=>!n.readAt);
 const visible=unreadOnly?unread:notifications;
 const checkedIds=visible.filter(n=>selected.includes(n.id)).map(n=>n.id);
 const decisions=visibleProposals(data?.proposals||[]);
 useEffect(()=>{if(!open){setSelected([]);setError('');}},[open]);
 useEffect(()=>{
  if(data)setDeleted(previous=>{
   const retained=previous.filter(id=>data.notifications.some(n=>n.id===id));
   return retained.length===previous.length?previous:retained;
  });
 },[data]);
 async function change(action:'read'|'deleteNotifications',ids:string[]){
  if(busy||!ids.length||!window.flowrium)return;
  setBusy(true);setError('');
  try {
   await window.flowrium.workflowAction({action,ids});
   if(action==='deleteNotifications'){
    setDeleted(previous=>[...previous,...ids]);
    setSelected(previous=>previous.filter(id=>!ids.includes(id)));
   }
   await onRefresh();
  }catch{setError(action==='read'?'읽음 상태를 저장하지 못했습니다.':'알림을 삭제하거나 목록을 갱신하지 못했습니다.');}
  finally{setBusy(false);}
 }
 function openRequest(event:FlowriumEvent){
  if(event.type==='input'&&onQuestion){onClose();onQuestion(event);return;}
  const session=sessions.find(s=>s.id===event.sessionId);
  if(session){onOpen(session);onClose();}
 }
 return <MotionOverlay open={open} onClose={onClose} label="알림" className="attention-popup">
  <header className="utility-popup-heading"><div><Bell size={19}/><h2>알림</h2><span>{unread.length>0?`읽지 않음 ${unread.length}건`:'모두 확인했습니다'}</span></div><button className="icon-button" aria-label="알림 닫기" onClick={onClose}><X size={18}/></button></header>
  {requests.length>0&&<div className="attention-decision-cards" aria-label="지금 응답할 요청">{requests.map(event=><DecisionRequestPanel key={event.requestId} event={event} title={sessions.find(s=>s.id===event.sessionId)?.title} onResolved={()=>void onRefresh().catch(()=>{})} onOpen={()=>openRequest(event)}/>)}</div>}
  <div className="attention-toolbar">
   <button aria-pressed={unreadOnly} onClick={()=>{setUnreadOnly(!unreadOnly);setSelected([]);}}>{unreadOnly?'전체 알림 보기':'읽지 않은 알림'}</button>
   <div className="attention-toolbar-actions">
    <button disabled={busy||!visible.length} onClick={()=>setSelected(checkedIds.length===visible.length?[]:visible.map(n=>n.id))}>{visible.length>0&&checkedIds.length===visible.length?'선택 해제':'모두 선택'}</button>
    <button disabled={busy||!checkedIds.length} onClick={()=>void change('deleteNotifications',checkedIds)}><Trash2 size={15}/>선택 삭제{checkedIds.length>0?` (${checkedIds.length})`:''}</button>
    <button disabled={busy||!unread.length} onClick={()=>void change('read',unread.map(n=>n.id))}><CheckCheck size={15}/>모두 읽음</button>
   </div>
  </div>
  {error&&<p className="attention-error" role="alert">{error}</p>}
  <div className="attention-list">
   {(requests.length>0||decisions.length>0)&&<button className="attention-decision" onClick={()=>{onClose();onDecisions();}}><span><strong>확인이 필요한 결정</strong><small>프로젝트 요청과 추가 질문 {requests.length+decisions.length}건</small></span><ChevronRight size={18}/></button>}
   {visible.map(n=>{
    const session=sessions.find(s=>s.id===n.sessionId),answer=n.kind==='done'||n.kind==='error';
    const title=answer?answerNoticeTitle(n,session?.title):n.title,summary=noticePreview(n);
    return <article className="attention-item" key={n.id} data-notification-id={n.id} data-unread={!n.readAt}>
     <AnimatedCheckbox aria-label={title+' 선택'} checked={selected.includes(n.id)} disabled={busy} onChange={e=>setSelected(old=>e.target.checked?[...old,n.id]:old.filter(id=>id!==n.id))}/>
     <div className="attention-item-content">
      <strong>{title}</strong>
      {summary&&<p>{summary}</p>}
      <div className="attention-item-meta"><time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString('ko-KR')}</time>
       {session&&<button className="attention-open-label" onClick={()=>{if(!n.readAt)void change('read',[n.id]);onOpen(session);onClose();}}>대화에서 자세히 보기 <ChevronRight size={13}/></button>}
       {n.kind==='update'&&<button className="attention-open-label" onClick={()=>{if(!n.readAt)void change('read',[n.id]);onClose();onUpdate();}}>업데이트 열기 <ChevronRight size={13}/></button>}
      </div>
     </div>
     <div className="attention-row-actions">
      {!n.readAt&&<button disabled={busy} onClick={()=>void change('read',[n.id])}>읽음</button>}
      <button disabled={busy} className="attention-remove" aria-label={title+' 알림 삭제'} onClick={()=>void change('deleteNotifications',[n.id])}><Trash2 size={15}/>삭제</button>
     </div>
    </article>;
   })}
   {unreadOnly&&notifications.length>0&&!unread.length&&<div className="attention-empty"><CheckCheck size={28}/><p>읽지 않은 알림이 없습니다.</p></div>}
   {!notifications.length&&!requests.length&&!decisions.length&&<div className="attention-empty"><Bell size={28}/><p>아직 도착한 알림이 없습니다.</p></div>}
  </div>
 </MotionOverlay>;
}
