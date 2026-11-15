import {useEffect,useRef,useState} from 'react';
import {ArrowRight,FileText,FolderSync,Link2,LoaderCircle,RefreshCw} from 'lucide-react';
import {AnimatedCheckbox} from './ui-motion';
import type {Session} from '../shared/types';
import type {CodexTransferMode,CodexTransferPlan,CodexTransferResult} from '../shared/codex-transfer';
import './codex-transfer.css';
const describe=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,'');
export default function CodexTransferPanel({onChanged,onOpen}:{onChanged():Promise<void>;onOpen(sessionId:string):void}){
 const api=window.flowrium,alive=useRef(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [plan,setPlan]=useState<CodexTransferPlan>(),[selected,setSelected]=useState<string[]>([]),[mode,setMode]=useState<CodexTransferMode>('linked'),[receipts,setReceipts]=useState<CodexTransferResult[]>([]),[original,setOriginal]=useState('');
 useEffect(()=>{alive.current=true;api?.codexTransferAction({action:'receipts'}).then(value=>{if(alive.current&&Array.isArray(value))setReceipts(value);}).catch(()=>{});return()=>{alive.current=false;};},[api]);
 async function run(action:()=>Promise<void>){if(!api||busy)return;setBusy(true);setError('');setNotice('');try{await action();}catch(e){if(alive.current)setError(describe(e));}finally{if(alive.current)setBusy(false);}}
 async function preview(){const value=await api!.codexTransferAction({action:'preview'});if(!value||Array.isArray(value)||!('projects' in value))throw Error('대화 미리보기 응답을 확인하지 못했습니다.');if(alive.current){setPlan(value);setSelected(value.entries.filter(entry=>!entry.error).map(entry=>entry.threadId));setOriginal('');}}
 async function apply(){if(!plan)return;const value=await api!.codexTransferAction({action:'apply',planId:plan.id,threadIds:selected,mode,retryAttachments:true});if(!value||Array.isArray(value)||!('imported' in value))throw Error('대화 연결 결과를 확인하지 못했습니다.');if(alive.current)await onChanged();if(alive.current){setReceipts(previous=>[value,...previous.filter(row=>row.id!==value.id)]);setNotice(`연결 ${value.imported}개, 갱신 ${value.updated}개 (제외 ${value.skipped}개, 확인 필요 ${value.failed}개)${value.attachments?`. 첨부 ${value.attachments.copied}개 복사, 기록 사본 ${value.attachments.recovered}개 복구 (참조 ${value.attachments.missing}개 보관)`:''}`);setPlan(undefined);}}
 return <section className="settings-section codex-transfer-panel" aria-label="Codex 프로젝트 대화 연결"><header><div><h3><FolderSync size={17}/>프로젝트 대화 연결</h3><p>이 기기의 Codex 프로젝트 대화를 Flowrium에서 이어갑니다.</p></div></header>
  <div className="codex-transfer-note"><strong>원래 대화는 삭제하거나 이동하지 않습니다.</strong><p>같은 대화로 연결하면 양쪽에서 추가한 대화를 다시 불러와 이어 쓸 수 있습니다. 한 앱에서 작업을 마치면 Flowrium이 열린 대화의 새 기록을 자동으로 확인합니다. 원문 사본은 이 기기에만 보관하며 공개 설치본에는 포함하지 않습니다.</p></div>
  <label className="field-label">가져오는 방법<select aria-label="Codex 대화 가져오는 방법" value={mode} disabled={busy} onChange={event=>setMode(event.target.value as CodexTransferMode)}><option value="linked">같은 대화로 연결 (양쪽에서 이어가기)</option><option value="copy">독립 사본 만들기 (별개로 작업)</option></select></label>
  <div className="settings-buttons"><button type="button" className="button secondary" disabled={busy} onClick={()=>void run(preview)}>{busy?<LoaderCircle size={15} className="spin"/>:<RefreshCw size={15}/>}Codex 대화 찾기</button></div>
  {plan&&<div className="codex-transfer-preview"><header><div><strong>프로젝트 {plan.projects.length}개 (대화 {plan.entries.length}개)</strong><p>연결할 대화를 선택하세요. 이미 연결한 대화는 중복 생성하지 않고 부족한 첨부를 다시 확인합니다.</p></div><div className="settings-buttons"><button type="button" className="button subtle" disabled={busy} onClick={()=>setSelected(plan.entries.filter(entry=>!entry.error).map(entry=>entry.threadId))}>전체 선택</button><button type="button" className="button subtle" disabled={busy} onClick={()=>setSelected([])}>선택 해제</button></div></header>
   <div className="codex-transfer-entries">{plan.entries.map(entry=><label key={entry.threadId} className="codex-transfer-entry"><AnimatedCheckbox checked={selected.includes(entry.threadId)} disabled={busy||!!entry.error} onChange={event=>setSelected(previous=>event.target.checked?[...previous,entry.threadId]:previous.filter(id=>id!==entry.threadId))}/><span><strong>{entry.title}</strong><small>{entry.projectName} (메시지 {entry.messages}개, 첨부 {entry.attachments}개){entry.active?' (원래 앱에서 작업 중)':''}{entry.imported?' (이미 연결됨)':''}</small>{entry.error&&<small className="codex-transfer-error">{entry.error}</small>}{entry.warnings.map((warning,index)=><small key={index}>{warning}</small>)}</span></label>)}</div>
   {plan.warnings.map((warning,index)=><p key={index} className="field-hint">{warning}</p>)}
   <div className="settings-buttons"><button type="button" className="button subtle" disabled={busy} onClick={()=>setPlan(undefined)}>닫기</button><button type="button" className="button primary" disabled={busy||!selected.length} onClick={()=>void run(apply)}>{busy?<LoaderCircle size={15} className="spin"/>:<ArrowRight size={15}/>}선택한 대화 {mode==='linked'?'연결':'복사'}</button></div>
  </div>}
  {error&&<p role="alert" className="codex-transfer-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!!receipts.length&&<details><summary>대화 연결 기록 {receipts.length}건</summary><div className="codex-transfer-receipts">{receipts.map(receipt=><article key={receipt.id}><strong>{new Date(receipt.at).toLocaleString('ko-KR')} ({receipt.mode==='linked'?'대화 연결':'독립 사본'})</strong><p>연결 {receipt.imported}개, 갱신 {receipt.updated}개 (확인 필요 {receipt.failed}개)</p>{receipt.attachments&&<p>첨부 {receipt.attachments.copied}개 복사, 기록 사본 {receipt.attachments.recovered}개 복구 (원문 참조 {receipt.attachments.missing}개 보관)</p>}{receipt.warnings.map((warning,index)=><p key={index} className="field-hint">{warning}</p>)}{receipt.entries.map((entry,index)=><div className="codex-transfer-result" key={entry.threadId}><span>대화 {index+1}: {entry.error||({imported:'연결 완료',updated:'갱신 완료',skipped:'이미 보관됨',failed:'확인 필요'}[entry.status])}</span>{entry.sessionId&&<div className="settings-buttons"><button type="button" className="button subtle" onClick={()=>onOpen(entry.sessionId!)}>대화 열기</button><button type="button" className="button subtle" disabled={busy} onClick={()=>void run(async()=>{const value=await api!.codexTransferAction({action:'readOriginal',receiptId:receipt.id,threadId:entry.threadId});if(value&&!Array.isArray(value)&&'text'in value&&alive.current)setOriginal(value.text);})}><FileText size={14}/>보관 원문</button></div>}</div>)}</article>)}</div></details>}
  {original&&<details open><summary>이 기기에 보관한 원문</summary><pre className="codex-transfer-original">{original}</pre><div className="settings-buttons"><button type="button" className="button subtle" onClick={()=>setOriginal('')}>원문 닫기</button></div></details>}
 </section>;
}
export function CodexLinkBar({session,running}:{session:Session;running:boolean}) {
 const native = !!session.threadId && session.desktopThread?.threadId === session.threadId;
 const linked = session.codexLink?.mode === 'linked' || native;
 const [status,setStatus] = useState<'current'|'active'|'deferred'>('current');
 const [error,setError] = useState(''), [busy,setBusy] = useState(false);
 const pending = useRef(false), mounted = useRef(false);
 const current = useRef({sessionId:session.id,linked,running});
 current.current = {sessionId:session.id,linked,running};
 useEffect(() => { mounted.current=true; return () => { mounted.current=false; }; }, []);

 async function refresh(manual=false) {
   const {sessionId,linked,running} = current.current;
   if (!linked || running || pending.current || !window.flowrium || document.hidden) return;
   pending.current=true;
   if (manual) setBusy(true);
   try {
     const result = await window.flowrium.codexTransferAction({action:'sync',sessionId,force:manual});
     if (!mounted.current || current.current.sessionId!==sessionId) return;
     if ('sync' in result) setStatus(result.sync);
     setError('');
   } catch (failure) {
     if (mounted.current && current.current.sessionId===sessionId) setError(describe(failure));
   } finally {
     pending.current=false;
     if (mounted.current && manual) setBusy(false);
   }
 }

 useEffect(() => {
   if (!linked || running) return;
   const check=()=>{void refresh();};
   check();
   const timer=window.setInterval(check,5000);
   window.addEventListener('focus',check);
   document.addEventListener('visibilitychange',check);
   return () => { clearInterval(timer); window.removeEventListener('focus',check); document.removeEventListener('visibilitychange',check); };
 }, [linked,running,session.id]);

 async function openDesktop() {
   const id=session.id;
   setBusy(true);
   try { await window.flowrium?.codexTransferAction({action:'openDesktop',sessionId:id}); }
   catch (e) { if(mounted.current && current.current.sessionId===id)setError(describe(e)); }
   finally { if(mounted.current)setBusy(false); }
 }

 if (!linked && !session.codexLink) return null;
 const label=!linked?'독립 사본':error?'연결 상태 확인':status==='active'?'다른 앱에서 작업 중':'대화 자동 동기화';
 return <div className="codex-link-bar" role="region" aria-label="연결한 Codex 대화">
   <details className="codex-link-details"><summary><Link2 size={14}/>{label}</summary>
     <p>{!linked?'원래 대화와 별개로 진행하는 사본입니다.':status==='active'?'Codex가 저장한 요청과 답변을 자동으로 표시합니다. 작업이 끝나면 전체 대화를 다시 맞춥니다.':'이 기기의 ChatGPT 데스크톱에서 같은 Codex 대화를 이어갈 수 있습니다.'}</p>
     {linked && <button className="button subtle" disabled={busy||running} onClick={()=>void openDesktop()}>데스크톱에서 이 대화 이어가기<ArrowRight size={13}/></button>}
     {error && <p role="status" className="codex-transfer-error">{error}</p>}
   </details>
   {linked && <button type="button" className="button subtle" aria-label="대화 새로고침" title="대화 새로고침" disabled={busy||running} onClick={()=>void refresh(true)}>{busy?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>}</button>}
 </div>;
}
