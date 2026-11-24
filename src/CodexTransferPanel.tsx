import {useEffect,useRef,useState} from 'react';
import {ArrowRight,FileText,FolderSync,Link2,LoaderCircle,RefreshCw} from 'lucide-react';
import { CloseButton, AnimatedCheckbox } from './ui-motion';
import type {Session} from '../shared/types';
import type {CodexTransferEntry,CodexTransferMode,CodexTransferPlan,CodexTransferResult} from '../shared/codex-transfer';
import './codex-transfer.css';
const describe=(error:unknown)=>(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,'');
type Selection = {projectKeys:string[];threadIds:string[]};
const emptySelection:Selection = {projectKeys:[],threadIds:[]};

function allAvailable(plan:CodexTransferPlan):Selection {
 const entries = plan.entries.filter(entry=>!entry.error);
 const eligible = new Set(entries.map(entry=>entry.projectKey));
 return {
  projectKeys:plan.projects.filter(project=>!project.threads||eligible.has(project.key)).map(project=>project.key),
  threadIds:entries.map(entry=>entry.threadId),
 };
}

export default function CodexTransferPanel({onChanged,onOpen}:{onChanged():Promise<unknown>;onOpen(sessionId:string):void}){
 const api = window.flowrium, alive = useRef(true), pending = useRef(false);
 const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
 const [plan,setPlan] = useState<CodexTransferPlan>();
 const [selection,setSelection] = useState<Selection>(emptySelection);
 const [mode,setMode] = useState<CodexTransferMode>('linked');
 const [receipts,setReceipts] = useState<CodexTransferResult[]>([]), [original,setOriginal] = useState('');
 useEffect(()=>{
  let active = true;
  alive.current=true;
  api?.codexTransferAction({action:'receipts'}).then(value=>{
   if(active&&Array.isArray(value)&&!pending.current)setReceipts(value);
  }).catch(()=>{});
  return()=>{active=false;alive.current=false;};
 },[api]);
 async function run(action:()=>Promise<void>){
  if(!api||pending.current)return;
  pending.current=true;
  setBusy(true);setError('');setNotice('');
  try{await action();}
  catch(e){if(alive.current)setError(describe(e));}
  finally{pending.current=false;if(alive.current)setBusy(false);}
 }
 async function preview(){
  const value=await api!.codexTransferAction({action:'preview'});
  if(!value||Array.isArray(value)||!('projects' in value)||!('createdAt' in value))throw Error('불러올 항목의 미리보기를 확인하지 못했습니다.');
  if(alive.current){setPlan(value);setSelection(allAvailable(value));setOriginal('');}
 }
 async function apply(){
  if(!plan)return;
  const value=await api!.codexTransferAction({action:'apply',planId:plan.id,...selection,mode,retryAttachments:true});
  if(!value||Array.isArray(value)||!('imported' in value))throw Error('불러오기 결과를 확인하지 못했습니다.');
  if(!alive.current)return;
  await onChanged();
  if(!alive.current)return;
  setReceipts(previous=>[value,...previous.filter(row=>row.id!==value.id)]);
  setNotice(`프로젝트 ${value.projects??0}개 / 대화 ${mode==='linked'?'연결':'복사'} ${value.imported}개 / 갱신 ${value.updated}개 / 제외 ${value.skipped}개 / 확인 필요 ${value.failed}개`+
   (value.attachments?`. 첨부 ${value.attachments.copied}개 복사 / 기록 사본 ${value.attachments.recovered}개 복구 / 원문 참조 ${value.attachments.missing}개 보관`:''));
  setPlan(undefined);
 }
 const byProject=new Map<string,CodexTransferEntry[]>();
 for(const entry of plan?.entries||[]){
  let entries=byProject.get(entry.projectKey);
  if(!entries){entries=[];byProject.set(entry.projectKey,entries);}
  entries.push(entry);
 }
 const selectedProjects=new Set(selection.projectKeys), selectedThreads=new Set(selection.threadIds);
 function selectProject(key:string,entries:CodexTransferEntry[],checked:boolean){
  const members=new Set(entries.filter(entry=>!entry.error).map(entry=>entry.threadId));
  setSelection(previous=>({
   projectKeys:checked?[...new Set([...previous.projectKeys,key])]:previous.projectKeys.filter(id=>id!==key),
   threadIds:checked?[...new Set([...previous.threadIds,...members])]:previous.threadIds.filter(id=>!members.has(id)),
  }));
 }
 function selectThread(entry:CodexTransferEntry,checked:boolean){
  setSelection(previous=>({
   projectKeys:checked?[...new Set([...previous.projectKeys,entry.projectKey])]:previous.projectKeys,
   threadIds:checked?[...new Set([...previous.threadIds,entry.threadId])]:previous.threadIds.filter(id=>id!==entry.threadId),
  }));
 }
 return <section className="settings-section codex-transfer-panel" aria-label="Codex 대화와 프로젝트 불러오기">
  <header><div>
   <h3><FolderSync size={17} aria-hidden="true"/>Codex 대화와 프로젝트 불러오기</h3>
   <p>이 기기의 ChatGPT 데스크톱에서 Codex로 작업한 대화와 프로젝트를 가져옵니다.</p>
  </div></header>
  <label className="field-label">가져오는 방법
   <select className="text-input" aria-label="Codex 대화 가져오는 방법" value={mode} disabled={busy} onChange={event=>setMode(event.target.value as CodexTransferMode)}>
    <option value="linked">같은 대화로 연결 (양쪽에서 이어가기)</option><option value="copy">독립 사본 만들기 (별개로 작업)</option>
   </select>
  </label>
  <div className="settings-buttons">
   <button type="button" className="button secondary" disabled={busy} onClick={()=>void run(preview)}>
    {busy?<LoaderCircle size={15} className="spin" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>}불러올 대화와 프로젝트 찾기
   </button>
  </div>
  {plan&&<div className="codex-transfer-preview">
   {plan.projects.length===0?<p role="status">이 기기에서 불러올 Codex 대화나 프로젝트를 찾지 못했습니다.</p>:<>
    <header>
     <div><strong>프로젝트 {plan.projects.length}개 / 대화 {plan.entries.length}개</strong>
      <p>불러올 프로젝트와 대화를 선택하세요. 프로젝트만 먼저 등록할 수도 있습니다.</p></div>
     <div className="settings-buttons">
      <button type="button" className="button subtle" disabled={busy} onClick={()=>setSelection(allAvailable(plan))}>전체 선택</button>
      <button type="button" className="button subtle" disabled={busy} onClick={()=>setSelection(emptySelection)}>선택 해제</button>
     </div>
    </header>
    <div className="codex-transfer-projects">
     {plan.projects.map(project=>{
      const entries=byProject.get(project.key)||[];
      return <section key={project.key} className="codex-transfer-project" aria-label={project.name}>
       <label className="codex-transfer-entry codex-transfer-project-name">
        <AnimatedCheckbox aria-label={`프로젝트 ${project.name}`} checked={selectedProjects.has(project.key)} disabled={busy} onChange={event=>selectProject(project.key,entries,event.target.checked)}/>
        <span><strong>{project.name}</strong><small>{entries.length?`대화 ${entries.length}개`:'폴더 등록'}</small></span>
       </label>
       {entries.map(entry=><label key={entry.threadId} className="codex-transfer-entry codex-transfer-thread">
        <AnimatedCheckbox aria-label={`대화 ${entry.title}`} checked={selectedThreads.has(entry.threadId)} disabled={busy||!!entry.error} onChange={event=>selectThread(entry,event.target.checked)}/>
        <span><strong>{entry.title}</strong>
         <small>메시지 {entry.messages}개 / 첨부 {entry.attachments}개{entry.active?' / 원래 앱에서 작업 중':''}{entry.imported?' / 이미 연결됨':''}</small>
         {entry.error&&<small className="codex-transfer-error">{entry.error}</small>}
         {entry.warnings.map((warning,index)=><small key={index}>{warning}</small>)}
        </span>
       </label>)}
      </section>;
     })}
    </div>
    {plan.warnings.map((warning,index)=><p key={index} className="field-hint">{warning}</p>)}
   </>}
   <div className="settings-buttons">
    <CloseButton disabled={busy} aria-label="불러오기 미리보기 닫기" onClick={()=>setPlan(undefined)}/>
    {plan.projects.length>0&&<button type="button" className="button primary" disabled={busy||!selection.projectKeys.length} onClick={()=>void run(apply)}>
     {busy?<LoaderCircle size={15} className="spin" aria-hidden="true"/>:<ArrowRight size={15} aria-hidden="true"/>}선택한 항목 불러오기
    </button>}
   </div>
  </div>}
  {error&&<p role="alert" className="codex-transfer-error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!!receipts.length&&<details><summary>대화 연결 기록 {receipts.length}건</summary><div className="codex-transfer-receipts">{receipts.map(receipt=><article key={receipt.id}>
   <strong>{new Date(receipt.at).toLocaleString('ko-KR')} ({receipt.mode==='linked'?'대화 연결':'독립 사본'})</strong>
   <p>{receipt.projects!==undefined?`프로젝트 ${receipt.projects}개 / `:''}대화 {receipt.mode==='linked'?'연결':'복사'} {receipt.imported}개 / 갱신 {receipt.updated}개 / 확인 필요 {receipt.failed}개</p>
   {receipt.attachments&&<p>첨부 {receipt.attachments.copied}개 복사 / 기록 사본 {receipt.attachments.recovered}개 복구 / 원문 참조 {receipt.attachments.missing}개 보관</p>}
   {receipt.warnings.map((warning,index)=><p key={index} className="field-hint">{warning}</p>)}
   {receipt.entries.map((entry,index)=><div className="codex-transfer-result" key={entry.threadId}>
    <span>대화 {index+1} / {entry.error||({imported:'연결 완료',updated:'갱신 완료',skipped:'이미 보관됨',failed:'확인 필요'}[entry.status])}</span>
    {entry.sessionId&&<div className="settings-buttons">
     <button type="button" className="button subtle" onClick={()=>onOpen(entry.sessionId!)}>대화 열기</button>
     <button type="button" className="button subtle" disabled={busy} onClick={()=>void run(async()=>{
      const value=await api!.codexTransferAction({action:'readOriginal',receiptId:receipt.id,threadId:entry.threadId});
      if(value&&!Array.isArray(value)&&'text'in value&&alive.current)setOriginal(value.text);
     })}><FileText size={14} aria-hidden="true"/>보관 원문</button>
    </div>}
   </div>)}
  </article>)}</div></details>}
  {original&&<details open><summary>이 기기에 보관한 원문</summary><pre className="codex-transfer-original">{original}</pre><div className="settings-buttons"><CloseButton onClick={()=>setOriginal('')}>원문 닫기</CloseButton></div></details>}
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
