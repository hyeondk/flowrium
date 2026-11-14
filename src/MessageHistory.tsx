import {useEffect,useLayoutEffect,useRef,useState,type MutableRefObject,type ReactNode,type RefObject} from 'react';
import {ArrowDown,History} from 'lucide-react';
import type {Message} from '../shared/types';
import './message-history.css';
const PAGE=100;
type Anchor={id?:string;y:number;top:number;height:number};
type Props={messages:Message[];scrollRef:RefObject<HTMLDivElement|null>;stickToBottom:MutableRefObject<boolean>;renderMessage(message:Message):ReactNode};
/** 표시 범위만 줄이며 원래 Session과 모델의 실행 문맥은 변경하지 않습니다. */
export default function MessageHistory({messages,scrollRef,stickToBottom,renderMessage}:Props){
 const [start,setStart]=useState(()=>Math.max(0,messages.length-PAGE));
 const content=useRef<HTMLDivElement>(null),controls=useRef<HTMLDivElement>(null),pending=useRef<Anchor|'bottom'|undefined>(undefined);
 const first=Math.min(start,Math.max(0,messages.length-PAGE));
 const latest=()=>{const el=scrollRef.current;if(el)el.scrollTop=el.scrollHeight;};
 useLayoutEffect(()=>{
  const el=scrollRef.current;if(!el)return;
  const anchor=pending.current;pending.current=undefined;
  if(anchor&&anchor!=='bottom'){
   const node=anchor.id?[...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(row=>row.dataset.messageId===anchor.id):undefined;
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
 function previous(){
  const el=scrollRef.current;if(!el||!first)return;
  const edge=Math.max(el.getBoundingClientRect().top,controls.current?.getBoundingClientRect().bottom||0);
  const node=[...el.querySelectorAll<HTMLElement>('[data-message-id]')].find(row=>row.getBoundingClientRect().bottom>edge+1);
  pending.current={id:node?.dataset.messageId,y:node?.getBoundingClientRect().top||0,top:el.scrollTop,height:el.scrollHeight};
  stickToBottom.current=false;setStart(Math.max(0,first-PAGE));
 }
 function recent(){
  stickToBottom.current=true;pending.current='bottom';const next=Math.max(0,messages.length-PAGE);
  if(next===start){pending.current=undefined;latest();}else setStart(next);
 }
 return <>
  {messages.length>PAGE&&<div className="message-history-controls" ref={controls} role="region" aria-label="대화 표시 범위">
   <p role="status">대화 {messages.length.toLocaleString('ko-KR')}개 (이전 {first.toLocaleString('ko-KR')}개)</p>
   <div>{first>0&&<button type="button" className="button subtle" onClick={previous}><History size={14}/>이전 메시지 {Math.min(PAGE,first)}개 더 보기</button>}<button type="button" className="button subtle" onClick={recent}><ArrowDown size={14}/>최근 메시지로</button></div>
  </div>}
  <div className="message-history-items" ref={content} onClickCapture={event=>{
   const target=event.target instanceof Element?event.target:undefined;
   if(target?.closest('[data-message-details]')&&target.closest('summary,[data-message-detail-control]'))stickToBottom.current=false;
  }}>{messages.slice(first).map(renderMessage)}</div>
 </>;
}
