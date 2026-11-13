import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useState } from 'react';
import type { Project } from '../shared/types';
import type { RepoChange, RepositoryDefinition, RepositoryIdentity } from '../shared/repository';
export default function RepositoryFlowPanel({project}:{project:Project}){
  const api=window.flowrium;
  const [repos,setRepos]=useState<RepositoryDefinition[]>([]),[checked,setChecked]=useState<string[]>([]),[files,setFiles]=useState<Record<string,RepoChange[]>>({}),[picked,setPicked]=useState<Record<string,string[]>>({}),[message,setMessage]=useState(''),[base,setBase]=useState('main'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[through,setThrough]=useState('push'),[plan,setPlan]=useState<any>(),[history,setHistory]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[clean,setClean]=useState<any>(),[dropCommits,setDropCommits]=useState(false),[identity,setIdentity]=useState<RepositoryIdentity>();
  async function run(fn:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function refresh(){const rows=await api!.repositoryAction(project.id,{action:'repositories'});setRepos(rows);setHistory(await api!.repositoryFlow({action:'list',projectId:project.id}));}
  useEffect(()=>{void run(refresh);},[project.id]);
  return <details className="repo-batch"><summary>여러 저장소 통합 실행 / 안전한 정리</summary><p>선택한 저장소와 파일을 확인하고 실행 계획을 만든 뒤 적용합니다. 실패한 단계는 실행 기록에서 재개할 수 있습니다.</p>
    <button disabled={busy} onClick={()=>void run(refresh)}>연결과 실행 기록 새로고침</button>
    {repos.map(repo=><section key={repo.id}><label><AnimatedCheckbox checked={checked.includes(repo.id)} disabled={repo.hidden||busy} onChange={e=>{setChecked(v=>e.target.checked?[...v,repo.id]:v.filter(id=>id!==repo.id));if(e.target.checked)void run(async()=>{const list=await api!.repositoryAction(project.id,{action:'changes',repositoryId:repo.id});setFiles(v=>({...v,[repo.id]:list}));setPicked(v=>({...v,[repo.id]:[]}));});}}/>{repo.name} / {repo.path}{repo.hidden?' / 숨김':''}{repo.account?' / '+repo.account:''}</label>
      {checked.includes(repo.id)&&<div>{(files[repo.id]||[]).map(f=><label className="repo-file" key={f.file}><AnimatedCheckbox checked={picked[repo.id]?.includes(f.file)||false} onChange={e=>setPicked(v=>({...v,[repo.id]:e.target.checked?[...(v[repo.id]||[]),f.file]:(v[repo.id]||[]).filter(p=>p!==f.file)}))}/>{f.code} / {f.file}</label>)}
        <button disabled={busy} onClick={()=>void run(async()=>setIdentity(await api!.repositoryAction(project.id,{action:'identity',repositoryId:repo.id})))}>계정과 작성자 확인</button>
        <label><AnimatedCheckbox checked={dropCommits} onChange={e=>setDropCommits(e.target.checked)}/>확인한 미푸시 커밋도 백업 후 정리</label><button disabled={busy||!(picked[repo.id]?.length||dropCommits)} onClick={()=>void run(async()=>setClean(await api!.repositoryFlow({action:'planClean',projectId:project.id,repositoryId:repo.id,files:picked[repo.id]||[],dropCommits})))}>이 저장소 정리 미리보기</button>
      </div>}
    </section>)}
    {identity&&<aside><p>GitHub 계정 / {identity.account||'CLI 기본 계정'} / 작성자 {identity.name} / {identity.email}</p>{identity.warnings.map(w=><p key={w}>{w}</p>)}</aside>}
    <div className="pr-grid"><label>커밋 제목<input value={message} maxLength={240} onChange={e=>setMessage(e.target.value)}/></label><label>실행할 단계<select value={through} onChange={e=>setThrough(e.target.value)}><option value="commit">커밋까지</option><option value="push">푸시까지</option><option value="pr">변경 요청 생성까지</option><option value="merge">병합까지</option></select></label></div>
    {['pr','merge'].includes(through)&&<><label>대상 브랜치<input value={base} onChange={e=>setBase(e.target.value)}/></label><label>변경 요청 제목<input value={title} maxLength={240} onChange={e=>setTitle(e.target.value)}/></label><label>변경 요청 설명<textarea value={body} maxLength={10000} onChange={e=>setBody(e.target.value)}/></label></>}
    <button disabled={busy||!checked.length} onClick={()=>void run(async()=>{setPlan(await api!.repositoryFlow({action:'plan',projectId:project.id,rows:checked.map(repositoryId=>({repositoryId,files:picked[repositoryId]||[],message,base,title,body,through}))}));await refresh();})}>통합 실행 계획 만들기</button>
    {plan&&<section role="region" aria-label="저장소 실행 계획"><h3>실행 계획</h3>{plan.rows.map((r:any)=><p key={r.repositoryId}>{r.name} / 파일 {r.files.length}개 / {r.expected.branch} / {r.through} / 완료 단계 {r.completed.join(' / ')||'없음'}</p>)}
      {plan.error&&<p role="alert">{plan.error}</p>}{['planned','failed','running'].includes(plan.state)&&<button disabled={busy} onClick={()=>void run(async()=>{setPlan(await api!.repositoryFlow({action:plan.state!=='planned'?'resume':'execute',id:plan.id}));await refresh();})}>{plan.state==='failed'?'실패 지점부터 재개':plan.state==='running'?'중단된 실행 확인 후 재개':'확인한 계획 실행'}</button>}{plan.state==='done'&&<p role="status">계획한 저장소 작업이 완료됐습니다.</p>}
    </section>}
    {clean&&<section aria-label="저장소 정리 계획"><h3>정리 전 확인</h3><p>{clean.files.length}개 파일 / 미푸시 커밋 {clean.dropCommits?clean.commits.length:0}개</p><ul>{clean.files.map((f:string)=><li key={f}>{f}</li>)}</ul>{clean.dropCommits&&<pre>{clean.commits.join('\n')}</pre>}
      {clean.error&&<p role="alert">{clean.error}</p>}{clean.state==='planned'&&<button disabled={busy} onClick={()=>void run(async()=>{setClean(await api!.repositoryFlow({action:'clean',id:clean.id}));await refresh();})}>백업 후 선택 항목 정리</button>}{['done','failedClean'].includes(clean.state)&&<button disabled={busy} onClick={()=>void run(async()=>{setClean(await api!.repositoryFlow({action:'restoreClean',id:clean.id}));await refresh();})}>이 정리 작업 복원</button>}{clean.state==='restored'&&<p>원래 파일과 커밋을 복원했습니다.</p>}
    </section>}
    <h3>통합 실행 기록</h3>{history.filter(h=>!h.kind).map(h=><button key={h.id} disabled={busy} onClick={()=>setPlan(h)}>{new Date(h.createdAt).toLocaleString('ko-KR')} / {h.state==='done'?'완료':h.state==='failed'?'실패':h.state==='planned'?'계획':'실행 중'}</button>)}
    {error&&<p role="alert">{error}</p>}
  </details>;
}
