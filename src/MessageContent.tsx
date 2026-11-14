import {useMemo,useState} from 'react';
import {ChevronDown,Copy,FileText,TerminalSquare} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {messageContent,safeLogPreview} from './message-content';
import './message-content.css';

type Props={text:string;role:'user'|'assistant'|'system';streaming?:boolean};
function Markdown({text}:{text:string}){
 return <div className="markdown message-prose"><ReactMarkdown components={{a:({node:_,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>}}>{text}</ReactMarkdown></div>;
}
function LogDetails({raw,title,failed=false,pending=false}:{raw:string;title:string;failed?:boolean;pending?:boolean}){
 const [open,setOpen]=useState(false),[original,setOriginal]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 const preview=useMemo(()=>open&&!original?safeLogPreview(raw):'',[raw,open,original]);
 async function copy(){
  try{if(window.flowrium)await window.flowrium.copyText(raw);else await navigator.clipboard.writeText(raw);setCopied(true);setCopyError('');}
  catch{setCopyError('원문을 복사하지 못했습니다. 내용을 선택해 복사하세요.');}
 }
 return <details open={open} className={`message-detail${failed?' message-detail-failed':''}`} data-message-details onToggle={event=>{setOpen(event.currentTarget.open);if(!event.currentTarget.open){setOriginal(false);setCopied(false);setCopyError('');}}}>
  <summary onClick={event=>{event.preventDefault();setOpen(value=>!value);setOriginal(false);setCopied(false);setCopyError('');}}><TerminalSquare size={14} aria-hidden="true"/><span>{title}</span>{failed&&<span className="message-detail-state">확인 필요</span>}{pending&&<span className="message-detail-state">수신 중</span>}<small>{raw.length.toLocaleString('ko-KR')}자</small><ChevronDown className="message-detail-chevron" size={14} aria-hidden="true"/></summary>
  {open&&<div className="message-detail-body">
   <p className="message-detail-hint">요약에서는 민감값을 가립니다. 원문은 요청할 때 그대로 표시합니다.</p>
   <div className="message-detail-actions">
    <button type="button" className="button subtle" data-message-detail-control onClick={()=>setOriginal(value=>!value)}>{original?'요약으로 접기':'원문 보기'}</button>
    <button type="button" className="button subtle" data-message-detail-control onClick={()=>void copy()}><Copy size={12} aria-hidden="true"/>{copied?'원문 복사 완료':'원문 복사'}</button>
   </div>
   {copyError&&<p role="status">{copyError}</p>}
   <pre className="message-detail-text" data-message-original={original?'true':undefined}><code>{original?raw:preview}</code></pre>
  </div>}
 </details>;
}
export default function MessageContent({text,role,streaming=false}:Props){
 const blocks=useMemo(()=>messageContent(text,role,streaming),[text,role,streaming]);
 return <div className="message-content">
  {blocks.map((block,index)=>block.kind==='markdown'?<Markdown key={index} text={block.text}/>:
   block.kind==='literal'?<pre key={index} className="message-literal"><code>{block.raw}</code></pre>:
   block.kind==='writing'?<section className="message-writing" aria-label="작성 내용" key={index}>
    <div className="message-writing-label"><FileText size={13} aria-hidden="true"/>작성 내용</div>
    <Markdown text={block.text}/>
    <LogDetails raw={block.raw} title="작성 서식 원문"/>
   </section>:<LogDetails key={index} raw={block.raw} title={role==='system'?'작업 상태':'도구 실행 결과'} failed={block.failed} pending={block.pending}/>) }
 </div>;
}
