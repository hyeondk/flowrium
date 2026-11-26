import {useMemo,useState,type ReactNode} from 'react';
import {CheckCheck,CircleAlert,ChevronDown,Copy,FileText,TerminalSquare} from 'lucide-react';
import ReactMarkdown, {defaultUrlTransform,type Components} from 'react-markdown';
import type {Processor} from 'unified';
import type {Extension} from 'micromark-util-types';
import remarkGfm from 'remark-gfm';
import {messageContent,safeLogPreview} from './message-content';
import './message-content.css';
import ChatCitation from './ChatCitation';
import {presentCitations} from '../electron/mobile/file-citations.js';
import {chatFileLinkTarget} from '../electron/chat-file-links.js';

type Props={sessionId?:string;messageId?:string;text:string;role:'user'|'assistant'|'system';streaming?:boolean;hasLaterRequest?:boolean;retryAction?:ReactNode};
function failureTitle(text:string,previous:boolean){
 if(text.startsWith('답변은 보존했지만'))return previous?'이전 요청의 산출물 저장 실패':'산출물 저장 실패';
 return previous?'이전 요청 실패':'요청 실패';
}
function preserveTildes(this:Processor) {
 const data=this.data() as {micromarkExtensions?: Extension[]};
 (data.micromarkExtensions ||= []).push({disable:{null:['strikethrough']}});
}
type FileLinkSource={sessionId:string;messageId:string};
const markdownComponents: Components = {
  table: ({node: _, ...props}) =>
    <div className="message-table-wrap" role="region" aria-label="답변 표" tabIndex={0}><table {...props}/></div>,
};
function MarkdownFileLink({sessionId,messageId,href,children}:FileLinkSource&{href:string;children:ReactNode}) {
 const [error,setError]=useState(false);
 async function reveal(){
  try{await window.flowrium!.readChatCitation(sessionId,messageId,href,'reveal');setError(false);}
  catch{setError(true);}
 }
 return <><a href="#파일-위치" title="파일 위치 열기" onClick={event=>{event.preventDefault();void reveal();}}>{children}</a>
  {error&&<span className="message-file-link-error" role="status">파일 위치를 열 수 없습니다. 프로젝트 폴더에서 파일을 확인해 주세요.</span>}</>;
}
function Markdown({text,sessionId,messageId}:{text:string;sessionId?:string;messageId?:string}){
 const enableFiles=Boolean(window.flowrium&&sessionId&&messageId);
 const components=useMemo<Components>(()=>({
  ...markdownComponents,
  a:({node:_,href,children,...props})=>enableFiles&&sessionId&&messageId&&href&&chatFileLinkTarget(href)
   ? <MarkdownFileLink sessionId={sessionId} messageId={messageId} href={href}>{children}</MarkdownFileLink>
   : <a {...props} href={href} target={href?.startsWith('#')?undefined:'_blank'} rel="noopener noreferrer">{children}</a>,
 }),[enableFiles,sessionId,messageId]);
 return <div className="markdown message-prose">
  <ReactMarkdown remarkPlugins={[remarkGfm, preserveTildes]} remarkRehypeOptions={{footnoteLabel:'각주',footnoteBackLabel:'본문의 각주로 돌아가기'}} components={components}
    urlTransform={(url,key,element)=>enableFiles&&key==='href'&&element.tagName==='a'&&chatFileLinkTarget(url)?url:defaultUrlTransform(url)}>
    {text}
  </ReactMarkdown>
 </div>;
}
function LogDetails({raw,title,failed=false,pending=false,requestFailure,children}:{raw:string;title:string;failed?:boolean;pending?:boolean;requestFailure?:'previous'|'failed';children?:ReactNode}){
 const [open,setOpen]=useState(false),[original,setOriginal]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 const preview=useMemo(()=>open&&!original?safeLogPreview(raw):'',[raw,open,original]);
 async function copy(){
  try{if(window.flowrium)await window.flowrium.copyText(raw);else await navigator.clipboard.writeText(raw);setCopied(true);setCopyError('');}
  catch{setCopyError('원문을 복사하지 못했습니다. 내용을 선택해 복사하세요.');}
 }
 return <details open={open} className={`message-detail${failed?' message-detail-failed':''}`} data-request-failure={requestFailure} data-message-details onToggle={event=>{setOpen(event.currentTarget.open);if(!event.currentTarget.open){setOriginal(false);setCopied(false);setCopyError('');}}}>
  <summary onClick={event=>{event.preventDefault();setOpen(value=>!value);setOriginal(false);setCopied(false);setCopyError('');}}>
   {requestFailure?<CircleAlert size={14} aria-hidden="true"/>:<TerminalSquare size={14} aria-hidden="true"/>}
   <span>{title}</span>
   {failed&&!requestFailure&&<span className="message-detail-state">확인 필요</span>}
   {pending&&<span className="message-detail-state">수신 중</span>}
   {!requestFailure&&<small>{raw.length.toLocaleString('ko-KR')}자</small>}
   <ChevronDown className="message-detail-chevron" size={14} aria-hidden="true"/>
  </summary>
  {open&&<div className="message-detail-body">
   <p className="message-detail-hint">요약에서는 민감값을 가립니다. 원문은 요청할 때 그대로 표시합니다.</p>
   <div className="message-detail-actions">
    <button type="button" className="button subtle" data-message-detail-control onClick={()=>setOriginal(value=>!value)}>{original?'요약으로 접기':'원문 보기'}</button>
    <button type="button" className="button subtle" data-message-detail-control onClick={()=>void copy()}><Copy size={12} aria-hidden="true"/>{copied?'원문 복사 완료':'원문 복사'}</button>
    {children}
   </div>
   {copyError&&<p role="status">{copyError}</p>}
   {original?<div className="message-detail-text" role="region" aria-label="작업 원문" data-message-original="true" tabIndex={0}>{raw}</div>:
    <pre className="message-detail-text"><code>{preview}</code></pre>}
  </div>}
 </details>;
}
export default function MessageContent({text,role,sessionId,messageId,streaming=false,hasLaterRequest=false,retryAction}:Props){
 const citations=useMemo(()=>presentCitations(text,role,streaming),[text,role,streaming]);
 const blocks=useMemo(()=>messageContent(citations.text,role,streaming),[citations.text,role,streaming]);
 const linkSession=role==='assistant'?sessionId:undefined;
 return <div className="message-content">
  {blocks.map((block,index)=>block.kind==='markdown'?<Markdown key={index} text={block.text} sessionId={linkSession} messageId={messageId}/>:
   block.kind==='question-reply'?<section key={index} className="message-question-reply" aria-label="보낸 질문 답변">
    <div className="message-question-reply-label"><CheckCheck size={14} aria-hidden="true"/>응답 보냄</div>
    <dl>{block.answers.map((row,i)=><div key={i}><dt>{row.question}</dt><dd>{row.answer}</dd></div>)}</dl>
   </section>:
   block.kind==='literal'?<pre key={index} className="message-literal"><code>{block.raw}</code></pre>:
   block.kind==='writing'?<section className="message-writing" aria-label="작성 내용" key={index}>
    <div className="message-writing-label"><FileText size={13} aria-hidden="true"/>작성 내용</div>
    <Markdown text={block.text} sessionId={linkSession} messageId={messageId}/>
    <LogDetails raw={block.raw} title="작성 서식 원문"/>
   </section>:role==='system'&&block.failed
    ?<LogDetails key={index} raw={block.raw} title={failureTitle(block.raw,hasLaterRequest)} failed requestFailure={hasLaterRequest?'previous':'failed'}>{retryAction}</LogDetails>
    :<LogDetails key={index} raw={block.raw} title={role==='system'?'작업 상태':'도구 실행 결과'} failed={block.failed} pending={block.pending}/>) }
  {sessionId&&messageId&&citations.groups.map(group=><ChatCitation key={group.key} group={group} sessionId={sessionId} messageId={messageId}/>)}
 </div>;
}
