import {useEffect,useRef,useState} from 'react';
import {FileText,Image as ImageIcon,LoaderCircle,Paperclip,X} from 'lucide-react';
import type {ChatAttachment} from '../shared/types';
import {clearQueueAction, clearQueueExplanation, clearQueueQuestion, nativeQueueAction, nativeQueueExplanation, nativeQueueQuestion, queuedInputView} from '../electron/mobile/chat-input.js';
import {MotionOverlay} from './ui-motion';
import './chat-attachments.css';
function ImageAttachment({item,projectId,onRemove}:{item:ChatAttachment;projectId:string;onRemove?:(id:string)=>void}) {
 const [source,setSource]=useState<string>(),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let current=true;
  window.flowrium?.readChatAttachment(projectId,item.id).then(result=>{
    if(!current)return;
    setSource(result.dataUrl);
    setFailed(!result.dataUrl);
  }).catch(()=>{if(current)setFailed(true);});
  return ()=>{current=false;};
 },[projectId,item.id]);
 return <li className="chat-image-tile">
   {source?<img src={source} alt="첨부 사진" aria-label={item.name} draggable={false} onError={()=>{setFailed(true);setSource(undefined);}}/>:
    <span className="chat-image-placeholder" role="img" aria-label={item.name+(failed?' 미리보기를 열 수 없습니다':' 불러오는 중')}><ImageIcon size={18}/></span>}
   {onRemove&&<button type="button" className="chat-attachment-remove" aria-label={item.name+' 첨부 제거'} onClick={()=>onRemove(item.id)}><X size={12} aria-hidden="true"/></button>}
 </li>;
}
export function ChatAttachmentList({projectId,items,onRemove}:{projectId:string;items:ChatAttachment[];onRemove?:(id:string)=>void}) {
 const photos=items.filter(item=>item.type.startsWith('image/'));
 const files=items.filter(item=>!item.type.startsWith('image/'));
 return <>
  {photos.length>0&&<ul className="chat-attachment-list chat-image-strip" tabIndex={0} aria-label="첨부 사진">
   {photos.map(item=><ImageAttachment key={projectId+':'+item.id} item={item} projectId={projectId} onRemove={onRemove}/>)}
  </ul>}
  {files.length>0&&<ul className="chat-attachment-list chat-file-list" aria-label="첨부 파일">{files.map(item=><li key={item.id}>
    <FileText size={15} aria-hidden="true"/><span><strong>{item.name}</strong><small>{Math.ceil(item.size/1024).toLocaleString('ko-KR')} KB</small></span>
    {onRemove&&<button type="button" aria-label={item.name+' 첨부 제거'} onClick={()=>onRemove(item.id)}><X size={12} aria-hidden="true"/></button>}
  </li>)}</ul>}
 </>;
}
export function AttachmentComposer({projectId,items,onChange,disabled,report,children}:{projectId?:string;items:ChatAttachment[];onChange:(items:ChatAttachment[])=>void;disabled:boolean;report:(text:string)=>void;children:React.ReactNode|((control:React.ReactNode)=>React.ReactNode)}) {
 const picker=useRef<HTMLInputElement>(null),alive=useRef(true),currentItems=useRef(items),pending=useRef(Promise.resolve()),count=useRef(0);
 currentItems.current=items;
 const [uploading,setUploading]=useState(false),[drag,setDrag]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function upload(files:FileList|File[]) {
  if(!projectId||disabled)return;
  const values=Array.from(files);if(!values.length)return;
  count.current++;setUploading(true);
  const task=pending.current.catch(()=>{}).then(async()=>{
   if(!alive.current)return;
   if(values.length+currentItems.current.length>10)throw Error('한 번에 첨부할 수 있는 파일은 10개까지입니다.');
   const payload=await Promise.all(values.map(async f=>({name:f.name||'붙여넣은 이미지.png',type:f.type,bytes:new Uint8Array(await f.arrayBuffer())})));
   const added=await window.flowrium!.addChatAttachments(projectId,payload);
   if(alive.current){const next=[...currentItems.current,...added];currentItems.current=next;onChange(next);}
  });
  pending.current=task;
  try{await task;}catch(e){if(alive.current)report(e instanceof Error?e.message:'파일을 첨부하지 못했습니다.');}
  finally{count.current--;if(alive.current)setUploading(count.current>0);}
 }
 return <div className={'attachment-composer'+(drag?' dragging':'')} onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void upload(e.clipboardData.files);}}}
  onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();setDrag(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDrag(false);}}
  onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();setDrag(false);void upload(e.dataTransfer.files);}}}>
  {projectId&&items.length>0&&<ChatAttachmentList projectId={projectId} items={items} onRemove={id=>onChange(items.filter(a=>a.id!==id))}/>}
  <input ref={picker} type="file" multiple hidden aria-label="채팅에 첨부할 파일" onChange={e=>{if(e.currentTarget.files)void upload(e.currentTarget.files);e.currentTarget.value='';}}/>
  {typeof children==='function'?children(<button type="button" className="composer-attach" aria-label="파일 첨부" title="파일 첨부 (파일당 20MB, 붙여넣기와 끌어놓기 지원)" disabled={!projectId||disabled||uploading} onClick={()=>picker.current?.click()}>{uploading?<LoaderCircle size={18} className="spin"/>:<Paperclip size={18}/>}</button>):<>{children}<div className="attachment-controls">
   <button type="button" disabled={!projectId||disabled||uploading} onClick={()=>picker.current?.click()}>{uploading?'파일 보관 중':'파일 첨부'}</button><small>붙여넣기와 끌어놓기 지원 (파일당 20MB)</small>
  </div></>}
 </div>;
}
export function ChatQueuePanel({session,onCancel,onResume,onSendToCodex,onClear}:{session:import('../shared/types').Session;onCancel:(id:string)=>void;onResume:()=>void;onSendToCodex:(id:string)=>Promise<void>;onClear:(id:string)=>Promise<void>}) {
 const [selected,setSelected]=useState<{id:string;action:'send'|'clear'}>(),sending=useRef(false);
 const rows=session.queuedMessages||[],pending=rows.filter(q=>['queued','sending'].includes(q.status));
 const clearing=selected?.action==='clear';
 const confirmation=rows.find(q=>q.id===selected?.id&&(clearing?queuedInputView(q).canClear:q.id===pending[0]?.id&&queuedInputView(q).canSendToCodex));
 const question=clearing?clearQueueQuestion:nativeQueueQuestion;
 async function confirm() {
   if(!confirmation||sending.current)return;
   sending.current=true;
   setSelected(undefined);
   try {await (clearing?onClear(confirmation.id):onSendToCodex(confirmation.id));} finally {sending.current=false;}
 }
 if(!rows.length)return null;
 return <><details className="chat-queue-panel" open={pending.length>0}><summary>추가 지시 (대기 {pending.length}개)</summary>
  {pending.some(q=>q.error&&queuedInputView(q).canResume)&&<button onClick={onResume}>대기 지시 다시 시작</button>}
  {rows.slice().reverse().map(q=>{
    const view=queuedInputView(q);
    const canSend=view.canSendToCodex&&q.id===pending[0]?.id;
    return <div key={q.id}><strong>{view.status}</strong><p>{q.text}</p>
      {q.attachments.length>0&&<small>첨부 {q.attachments.length}개</small>}
      {view.hint&&<small>{view.hint}</small>}{q.error&&<p role="alert">{q.error}</p>}
      {(view.canCancel||view.canResume||canSend||view.canClear)&&<div className="queue-actions">
        {view.canCancel&&<button onClick={()=>onCancel(q.id)}>대기 취소</button>}
        {view.canResume&&<button onClick={onResume}>지금 전달 재개</button>}
        {canSend&&<button className="button primary" aria-haspopup="dialog" onClick={()=>setSelected({id:q.id,action:'send'})}>{nativeQueueAction}</button>}
        {view.canClear&&<button aria-haspopup="dialog" onClick={()=>setSelected({id:q.id,action:'clear'})}>{clearQueueAction}</button>}
      </div>}</div>;
  })}</details>
  <MotionOverlay open={Boolean(confirmation)} onClose={()=>setSelected(undefined)} label={question} className="queue-confirm">
    <h2>{question}</h2><p>{clearing?clearQueueExplanation:nativeQueueExplanation}</p>
    <div className="queue-actions"><button className="button subtle" onClick={()=>setSelected(undefined)}>취소</button>
    <button className="button primary" onClick={()=>void confirm()}>{clearing?clearQueueAction:nativeQueueAction}</button></div>
  </MotionOverlay></>;
}
