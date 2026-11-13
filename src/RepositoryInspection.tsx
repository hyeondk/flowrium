import {useEffect,useState} from 'react';
import type {ActivitySection, LocalRepository, RepositoryActivity, RepositoryItem, RepositoryKind} from '../shared/repository';
import './repository-inspection.css';

const titles:Record<ActivitySection,string>={pulls:'열린 변경 요청',merged:'최근 병합',issues:'열린 이슈',runs:'자동 실행',deployments:'배포 환경'};
const korean:Record<string,string>={OPEN:'열림',MERGED:'병합됨',CLOSED:'닫힘',APPROVED:'승인',REVIEW_REQUIRED:'검토 대기',
  CHANGES_REQUESTED:'수정 요청',SUCCESS:'성공',success:'성공',FAILURE:'실패',failure:'실패',error:'오류',PENDING:'대기',
  pending:'대기',IN_PROGRESS:'진행 중',in_progress:'진행 중',queued:'대기',CANCELLED:'취소됨',cancelled:'취소됨',inactive:'비활성'};
function stateLabel(v:string){return korean[v]||v;}

export default function RepositoryInspection({id,repositoryId}:{id:string;repositoryId?:string}) {
  const api=window.flowrium;
  const [local,setLocal]=useState<LocalRepository>();
  const [activity,setActivity]=useState<RepositoryActivity>();
  const [detail,setDetail]=useState<{kind:'pull'|'issue';item:RepositoryItem}>();
  const [address,setAddress]=useState(''),[edit,setEdit]=useState(false),[confirm,setConfirm]=useState(false);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
  async function readLocal(){ setLocal(await api!.repositoryAction(id,{repositoryId,action:'repoLocal'})); }
  useEffect(()=>{
    let active=true;
    api?.repositoryAction(id,{repositoryId,action:'repoLocal'}).then(v=>{if(active)setLocal(v);}).catch(e=>{if(active)setStatus(e.message);});
    return ()=>{active=false;};
  },[id,api,repositoryId]);
  async function run(fn:()=>Promise<void>){
    if (busy||!api) return;
    setBusy(true);setStatus('');
    try{await fn();}catch(error){setStatus(error instanceof Error?error.message:'저장소를 조회하지 못했습니다.');}
    finally{setBusy(false);}
  }
  function open(kind:RepositoryKind,number?:number) {
    void run(async()=>{await api!.repositoryAction(id,{repositoryId,action:'repoOpen',kind,number});});
  }
  function connect(){
    if(!local)return;
    void run(async()=>{
      setStatus(await api!.repositoryAction(id,{repositoryId,action:'repoConnect',repository:address.trim(),connectionKey:local.connectionKey}));
      setConfirm(false); setEdit(false); setActivity(undefined); setDetail(undefined); await readLocal();
    });
  }
  return <section className="repo-inspection" aria-label="저장소 현황">
    <header><h2>저장소 현황</h2><button disabled={busy} onClick={()=>void run(readLocal)}>현재 브랜치 새로고침</button></header>
    {local&&<>
      <p>{local.branch||'분리된 커밋'}{local.upstream&&' / '+local.upstream}
      {local.ahead!==null&&' / 마지막 가져오기 기준 푸시 대기 '+local.ahead+'개 / 뒤처짐 '+local.behind+'개'}</p>
      {local.commits.length>0&&<details><summary>최근 커밋 {local.commits.length}개</summary><ul>{local.commits.map(c=>
        <li key={c.hash}><code>{c.hash}</code> {c.subject} <small>{c.author} / {c.date.slice(0,10)}</small></li>)}</ul></details>}
      <div className="repo-read-actions">{local.repository&&<button disabled={busy} onClick={()=>open('repo')}>{local.repository} 열기</button>}
        <button disabled={busy} onClick={()=>{setAddress(local.repository);setConfirm(false);setEdit(!edit);}}>
          {local.hasOrigin?'원격 연결 편집':'GitHub 저장소 연결'}</button>
        {local.repository&&<button disabled={busy} onClick={()=>void run(async()=>{
          setActivity(await api!.repositoryAction(id,{repositoryId,action:'repoActivity'}));setDetail(undefined);
        })}>GitHub 현황 조회</button>}</div>
      {edit&&<div><label>GitHub 소유자/저장소<input maxLength={140} value={address} onChange={e=>{setAddress(e.target.value);setConfirm(false);}}/></label>
        {confirm?<div><p>{local.hasOrigin?'기존 원격 연결을 변경합니다.':'원격 저장소를 연결합니다.'} / {address}</p>
          <button disabled={busy} onClick={connect}>확인하고 연결</button><button onClick={()=>setConfirm(false)}>취소</button></div>
          :<button disabled={busy||!address.trim()} onClick={()=>setConfirm(true)}>연결 검토</button>}</div>}
    </>}
    {activity&&Object.entries(titles).map(([field,title])=>{
      const section=field as ActivitySection, group=activity[section];
      return <details key={field} open={field==='pulls'}><summary>{title} {group.error?'조회 실패':group.rows.length+'개'}</summary>
        {group.error?<p>{group.error}</p>:<ul>{group.rows.map(row=><li key={row.number}>
          <span>{row.title}</span><small>{stateLabel(row.state)}{row.isDraft?' / 초안':''}{row.reviewDecision?' / '+stateLabel(row.reviewDecision):''}{row.branch?' / '+row.branch:''}</small>
          {['pulls','merged','issues'].includes(section)&&<button disabled={busy} aria-label={'#'+row.number+' 상세 보기'} onClick={()=>void run(async()=>{
            const kind=section==='issues'?'issue':'pull';
            setDetail({kind,item:await api!.repositoryAction(id,{repositoryId,action:kind==='issue'?'repoIssue':'repoPull',number:row.number})});
          })}>상세 보기</button>}
          {section==='runs'&&<button disabled={busy} onClick={()=>open('run',row.number)}>실행 내역 열기</button>}</li>)}</ul>}
      </details>;
    })}
    {detail&&<section aria-label="선택한 항목 상세"><header><h3>#{detail.item.number} {detail.item.title}</h3>
      <button disabled={busy} onClick={()=>open(detail.kind,detail.item.number)}>GitHub에서 열기</button><button onClick={()=>setDetail(undefined)}>상세 닫기</button></header>
      {detail.item.body&&<p className="repo-description">{detail.item.body}</p>}
      {detail.item.labels.length>0&&<p>레이블 / {detail.item.labels.join(' / ')}</p>}
      {detail.item.assignees.length>0&&<p>담당자 / {detail.item.assignees.join(' / ')}</p>}
      {detail.item.review&&<p>{stateLabel(detail.item.review)}</p>}
      {detail.item.files.length>0&&<ul aria-label="변경된 파일">{detail.item.files.map(f=><li key={f.name}>{f.name} / +{f.added} / −{f.deleted}</li>)}</ul>}
      {detail.item.checks.length>0&&<ul aria-label="자동 검사">{detail.item.checks.map((c,i)=><li key={i}>{c.name} / {stateLabel(c.state)}</li>)}</ul>}
    </section>}
    {status&&<p role="status">{status}</p>}
  </section>;
}
