import { useEffect, useState } from 'react';
import type { Project } from '../shared/types';
import type { Artifact } from '../shared/workbench';
export default function ArtifactViewer({project,artifact,onChange}:{project:Project;artifact:Artifact;onChange():void}){
  const isHTML=/\.html?$/i.test(artifact.path),[revision,setRevision]=useState(''),[html,setHTML]=useState(''),[source,setSource]=useState(''),[editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false),[deleted,setDeleted]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[refresh,reload]=useState(0);
  const api=window.flowrium;
  useEffect(()=>{let alive=true;setError('');setHTML('');setRevision('');void api!.artifactAction(project.id,{action:isHTML?'preview':'info',path:artifact.path}).then(v=>{if(alive){setRevision(v.revision);setHTML(v.html||'');setSource(v.source||'');}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[project.id,artifact.path,refresh]);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  if(deleted)return <section aria-label="삭제한 산출물"><p>산출물을 보관함으로 옮겼습니다. 원본 백업은 유지됩니다.</p><button disabled={busy} onClick={()=>void run(async()=>{await api!.artifactAction(project.id,{action:'restore',id:deleted});setDeleted('');reload(v=>v+1);onChange();})}>삭제한 산출물 복원</button>{error&&<p role="alert">{error}</p>}</section>;
  return <section aria-label="산출물 미리보기와 관리" style={{margin:'16px 0',wordBreak:'keep-all'}}>
    {isHTML&&html&&!editing&&<iframe title="HTML 산출물 미리보기" sandbox="" srcDoc={html} referrerPolicy="no-referrer" style={{width:'100%',height:'65vh',background:'#fff',border:'1px solid #bec8d3',borderRadius:9}}/>}
    {isHTML&&editing&&<label>HTML 원문<textarea aria-label="산출물 HTML 원문" value={source} onChange={e=>setSource(e.target.value)} rows={20} style={{width:'100%',fontFamily:'monospace'}}/></label>}
    <div className="wb-tools">
      {isHTML&&<button disabled={busy||!revision} onClick={()=>setEditing(!editing)}>{editing?'미리보기로 돌아가기':'HTML 수정'}</button>}
      {isHTML&&editing&&<button disabled={busy||!revision} onClick={()=>void run(async()=>{const v=await api!.artifactAction(project.id,{action:'edit',path:artifact.path,revision,body:source});setRevision(v.revision);setEditing(false);reload(r=>r+1);setNotice('이전 원문을 보관하고 수정했습니다.');onChange();})}>원문 저장</button>}
      {isHTML&&(['pdf','pptx'] as const).map(format=><button key={format} disabled={busy||!revision} onClick={()=>void run(async()=>{const out=await api!.artifactAction(project.id,{action:'reexport',path:artifact.path,revision,format});setNotice('변환 완료 / '+out.path);onChange();})}>{format==='pdf'?'현재 HTML로 PDF 만들기':'현재 HTML로 발표자료 만들기'}</button>)}
      <button disabled={busy||!revision} onClick={()=>setConfirm(true)}>산출물 삭제</button>
    </div>
    {confirm&&<div role="alert"><p>선택한 산출물을 목록에서 지우고 복원 가능한 보관함으로 옮깁니다.</p><button disabled={busy} onClick={()=>void run(async()=>{const v=await api!.artifactAction(project.id,{action:'delete',path:artifact.path,revision});setDeleted(v.id);setConfirm(false);onChange();})}>선택한 산출물 삭제 확인</button><button onClick={()=>setConfirm(false)}>취소</button></div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
