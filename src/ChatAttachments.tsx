import {useEffect,useRef,useState} from 'react';
import type {ChatAttachment} from '../shared/types';
import './chat-attachments.css';
export function ChatAttachmentList({projectId,items,onRemove}:{projectId:string;items:ChatAttachment[];onRemove?:(id:string)=>void}) {
 const [images,setImages]=useState<Record<string,string>>({});
 useEffect(()=>{let live=true;setImages({});for(const a of items)if(a.type.startsWith('image/'))window.flowrium?.readChatAttachment(projectId,a.id).then(v=>{if(live&&v.dataUrl)setImages(old=>({...old,[a.id]:v.dataUrl!}));}).catch(()=>{});return()=>{live=false;};},[projectId,items.map(a=>a.id).join(',')]);
 return <ul className="chat-attachment-list" aria-label="첨부 파일">{items.map(a=><li key={a.id}>
  {images[a.id]&&<img src={images[a.id]} alt={a.name}/>}
  <span><strong>{a.name}</strong><small>{Math.ceil(a.size/1024).toLocaleString('ko-KR')} KB</small></span>
  {onRemove&&<button type="button" aria-label={a.name+' 첨부 제거'} onClick={()=>onRemove(a.id)}>제거</button>}
 </li>)}</ul>;
}
export function AttachmentComposer({projectId,items,onChange,disabled,report,children}:{projectId?:string;items:ChatAttachment[];onChange:(items:ChatAttachment[])=>void;disabled:boolean;report:(text:string)=>void;children:React.ReactNode}) {
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
  {children}
  <div className="attachment-controls"><input ref={picker} type="file" multiple hidden aria-label="채팅에 첨부할 파일" onChange={e=>{if(e.currentTarget.files)void upload(e.currentTarget.files);e.currentTarget.value='';}}/>
   <button type="button" disabled={!projectId||disabled||uploading} onClick={()=>picker.current?.click()}>{uploading?'파일 보관 중':'파일 첨부'}</button><small>이미지 붙여넣기 / 파일 끌어놓기 / 파일당 20MB</small>
  </div>
 </div>;
}
export function ChatQueuePanel({session,onCancel,onResume}:{session:import('../shared/types').Session;onCancel:(id:string)=>void;onResume:()=>void}) {
 const rows=session.queuedMessages||[],pending=rows.filter(q=>['queued','sending'].includes(q.status));
 if(!rows.length)return null;
 return <details className="chat-queue-panel" open={pending.length>0}><summary>추가 지시 / 대기 {pending.length}개</summary>
  {pending.some(q=>q.error)&&<button onClick={onResume}>대기 지시 다시 시작</button>}
  {rows.slice().reverse().map(q=><div key={q.id}><span>{q.status==='queued'?'대기 중':q.status==='sending'?'전달 중':q.status==='sent'?'전달함':'취소함'}</span><p>{q.text}</p>{q.attachments.length>0&&<small>첨부 {q.attachments.length}개</small>}{q.error&&<p role="alert">{q.error}</p>}{q.status==='queued'&&<><button onClick={()=>onCancel(q.id)}>대기 취소</button><button onClick={onResume}>지금 전달 재개</button></>}</div>)}
 </details>;
}
