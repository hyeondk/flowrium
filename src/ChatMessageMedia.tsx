import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {chatClock} from '../electron/mobile/chat-clock.js';
import type {Message} from '../shared/types';
import MessageContent from './MessageContent';

export function findLatestMessage(messages:Message[]|undefined,match:(message:Message)=>boolean) {
  if (!messages) return;
  for (let index=messages.length-1;index>=0;index--) {
    const message=messages[index];
    if(match(message))return message;
  }
}

export function ChatMessageTime({createdAt}:{createdAt:string}) {
  const clock=chatClock(createdAt);
  return clock && <time className="message-time" dateTime={createdAt}>
    <span className="message-date">{clock.date}</span><span>{clock.time}</span>
  </time>;
}

const graphemes=new Intl.Segmenter('ko',{granularity:'grapheme'});
const tickMs=28;

function revealEnd(text:string,start:number) {
  const remaining=text.length-start;
  if(remaining>100_000)return text.length;
  const index=Math.min(remaining-1,Math.max(1,Math.ceil(remaining/(remaining>1200?3:7)))-1);
  const segment=graphemes.segment(text.slice(start)).containing(index);
  return segment?start+segment.index+segment.segment.length:text.length;
}

export function TypingMessageContent({text,sessionId,messageId}:{text:string;sessionId:string;messageId:string}) {
  const [visible,setVisible]=useState('');
  const revealed=useRef('');
  const fullText=useRef('');
  const timer=useRef<number|undefined>(undefined);
  useLayoutEffect(()=>{
    fullText.current=text;
    if (!text.startsWith(revealed.current) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.clearTimeout(timer.current);
      timer.current=undefined;
      revealed.current=text;
      setVisible(text);
      return;
    }
    const advance=()=>{
      timer.current=undefined;
      const target=fullText.current;
      revealed.current=target.slice(0,revealEnd(target,revealed.current.length));
      setVisible(revealed.current);
      if(revealed.current.length<target.length)timer.current=window.setTimeout(advance,tickMs);
    };
    if(timer.current===undefined&&revealed.current.length<text.length)advance();
  },[text]);
  useEffect(()=>()=>{window.clearTimeout(timer.current);timer.current=undefined;},[]);
  return <div className="chat-message-typing">
    <MessageContent role="assistant" text={visible} sessionId={sessionId} messageId={messageId} streaming/>
  </div>;
}
