import {useEffect,useLayoutEffect,useMemo,useRef,useState,type MutableRefObject,type ReactNode,type RefObject} from 'react';
import {ArrowDown} from 'lucide-react';
import type {Message} from '../shared/types';
import {attachmentDisplayText} from '../electron/mobile/attachment-text.js';
import {historyRows,TurnProgress} from './TurnProgress';
import './message-history.css';
const PAGE=100;
const PRELOAD_DISTANCE=80;
type Anchor={id?:string;y:number;top:number;height:number;first:number};
type Props={messages:Message[];running:boolean;checking?:boolean;scrollRef:RefObject<HTMLDivElement|null>;stickToBottom:MutableRefObject<boolean>;renderMessage(message:Message,hasLaterRequest:boolean,failedRequest?:Message):ReactNode};
/** 표시 범위만 줄이며 원래 Session과 모델의 실행 문맥은 변경하지 않습니다. */
export default function MessageHistory({messages,running,checking,scrollRef,stickToBottom,renderMessage}:Props){
 const [start,setStart]=useState(()=>Math.max(0,messages.length-PAGE));
 const content=useRef<HTMLDivElement>(null),controls=useRef<HTMLDivElement>(null),pending=useRef<Anchor|'bottom'|undefined>(undefined);
 const first=Math.min(start,Math.max(0,messages.length-PAGE));
 const rows=useMemo(()=>historyRows(messages,first),[messages,first]);
 const {lastRequestAt,failedRequests,currentTurn}=useMemo(()=>{
  let lastRequestAt=0, currentTurn:string|undefined;
  const failedRequests=new Map<string,Message>();
  for(let i=0;i<messages.length;i++){
   const message=messages[i];
   if(message.role==='user'){
    currentTurn=message.turnId;
    const at=Date.parse(message.createdAt);
    if(at>lastRequestAt)lastRequestAt=at;
   }else if(message.role==='system'&&message.text.startsWith('작업을 완료하지 못했습니다')){
    const previous=messages[i-1];
    if(previous?.role==='user'&&!previous.delegated&&(!previous.sourceOnly||previous.requestSource)&&
        (!message.turnId||!previous.turnId||previous.turnId===message.turnId)&&
        Date.parse(previous.createdAt)<=Date.parse(message.createdAt)&&
        (previous.attachments?.length||attachmentDisplayText(previous.text)===previous.text)&&
        (previous.text.trim()||previous.attachments?.length)){
     failedRequests.set(message.id,previous);
    }
   }
  }
  return {lastRequestAt,failedRequests,currentTurn};
 },[messages]);
 const latest=()=>{const el=scrollRef.current;if(el)el.scrollTop=el.scrollHeight;};
 useLayoutEffect(()=>{
  const el=scrollRef.current;if(!el)return;
  const anchor=pending.current;
  if(anchor&&anchor!=='bottom'&&anchor.first===first)return;
  pending.current=undefined;
  if(anchor&&anchor!=='bottom'){
   const node=anchor.id?el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`):undefined;
   el.scrollTop=node?el.scrollTop+node.getBoundingClientRect().top-anchor.y:anchor.top+el.scrollHeight-anchor.height;
  }else if(anchor==='bottom'||stickToBottom.current)latest();
 },[first,messages]);
 useEffect(()=>{
  const el=scrollRef.current;if(!el)return;
  stickToBottom.current=true;latest();
  // 접힌 대화함이 열리거나 첨부의 높이가 정해져도 기존 하단 따라가기를 유지합니다.
  const resize=new ResizeObserver(()=>{if(stickToBottom.current&&!pending.current)latest();});
  resize.observe(el);if(content.current)resize.observe(content.current);
  return()=>resize.disconnect();
 },[scrollRef,stickToBottom]);
 useEffect(()=>{
  const el=scrollRef.current;
  if(!el||!first)return;
  let previousTop=el.scrollTop;
  const loadPrevious=()=>{
   if(pending.current==='bottom')return;
   const edge=Math.max(el.getBoundingClientRect().top,controls.current?.getBoundingClientRect().bottom||0);
   const node=Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find(row=>row.getBoundingClientRect().bottom>edge+1);
   const loading=Boolean(pending.current);
   pending.current={id:node?.dataset.messageId,y:node?.getBoundingClientRect().top||0,top:el.scrollTop,height:el.scrollHeight,first};
   stickToBottom.current=false;
   if(!loading)setStart(Math.max(0,first-PAGE));
  };
  const onScroll=()=>{
   const top=el.scrollTop;
   if(top<previousTop&&top<=PRELOAD_DISTANCE)loadPrevious();
   previousTop=top;
  };
  const onWheel=(event:WheelEvent)=>{
   // 연속된 도구 기록이 한 행에 묶이면 페이지를 추가해도 스크롤 높이가 늘지 않을 수 있다.
   if(event.deltaY<0&&el.scrollTop<=1&&!pending.current)loadPrevious();
  };
  el.addEventListener('scroll',onScroll,{passive:true});
  el.addEventListener('wheel',onWheel,{passive:true});
  if(el.scrollHeight<=el.clientHeight+1)loadPrevious();
  return()=>{
   el.removeEventListener('scroll',onScroll);
   el.removeEventListener('wheel',onWheel);
  };
 },[first,scrollRef,stickToBottom]);
 function recent(){
  stickToBottom.current=true;pending.current='bottom';const next=Math.max(0,messages.length-PAGE);
  if(next===start){pending.current=undefined;latest();}else setStart(next);
 }
 return <>
  {messages.length>PAGE&&<div className="message-history-controls" ref={controls} role="region" aria-label="대화 표시 범위">
   <p role="status">대화 {messages.length.toLocaleString('ko-KR')}개 (이전 {first.toLocaleString('ko-KR')}개)</p>
   <div><button type="button" className="button subtle" onClick={recent}><ArrowDown size={14}/>최근 메시지로</button></div>
  </div>}
  <div className="message-history-items" ref={content} onClickCapture={event=>{
   const target=event.target instanceof Element?event.target:undefined;
   if(target?.closest('.turn-progress-trigger,.work-timeline-original summary') || target?.closest('[data-message-details]')&&target.closest('summary,[data-message-detail-control]'))stickToBottom.current=false;
  }}>{rows.map(row=>{
    if('message' in row)return renderMessage(row.message,row.message.role==='system'&&Date.parse(row.message.createdAt)<lastRequestAt,failedRequests.get(row.message.id));
    const current=Boolean(currentTurn && currentTurn===row.progress.turnId);
    return <TurnProgress active={running&&current} checking={Boolean(checking)&&current} key={'work:'+row.progress.key} progress={row.progress}/>;
  })}</div>
 </>;
}
