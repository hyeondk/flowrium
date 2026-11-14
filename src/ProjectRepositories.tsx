import { AnimatedSwitch } from './ui-motion';
import { useEffect, useState } from 'react';
import type { Project } from '../shared/types';
import type { ProjectDetails, ProjectRepository, ProjectService } from '../shared/project-details';
import './portfolio-tools.css';
import ProjectPorts from './ProjectPorts';
export default function ProjectRepositories({project,data,onChange}:{project:Project;data:ProjectDetails;onChange(d:ProjectDetails):void}){
  const initial=()=>data.repositories?.length?structuredClone(data.repositories):[{id:crypto.randomUUID(),name:project.name,path:'.',github:data.kickoff?.repository?.replace('https://github.com/','')||'',account:'',base:'main'}];
  const [accounts,setAccounts]=useState<string[]>([]);
  useEffect(()=>{window.flowrium?.repositoryAction(project.id,{action:"accounts"}).then(rows=>setAccounts(rows.map(r=>r.login))).catch(()=>{});},[project.id]);
  const [services,setServices]=useState<ProjectService[]>(data.services||[]);
  const [repos,setRepos]=useState<ProjectRepository[]>(initial),[cwd,setCwd]=useState(data.chatCwd||'.'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setRepos(initial());setCwd(data.chatCwd||'.');setServices(data.services||[]);},[data.revision]);
  function change(index:number,key:keyof ProjectRepository,value:string|boolean){setRepos(v=>v.map((r,i)=>i===index?{...r,[key]:value}:r));}
  async function save(){if(busy)return;setBusy(true);setError('');try{onChange(await window.flowrium!.updateProjectDetails(project.id,data.revision,{action:'repositories',repositories:repos,chatCwd:cwd,services}));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <><section className="pf-panel project-repositories" aria-label="프로젝트 저장소 연결"><h2>여러 저장소와 대화 폴더</h2><p>프로젝트 안의 폴더를 각각 연결합니다. 최상위 폴더는 마침표 하나로 입력하세요.</p><label>대화 작업 폴더<input aria-label="대화 작업 폴더" value={cwd} maxLength={1200} onChange={e=>setCwd(e.target.value)}/></label>
    {repos.map((r,i)=><article key={r.id}><div className="pr-grid"><label>저장소 이름<input aria-label={'저장소 이름 '+(i+1)} value={r.name} maxLength={100} onChange={e=>change(i,'name',e.target.value)}/></label><label>프로젝트 기준 폴더<input aria-label={'저장소 폴더 '+(i+1)} value={r.path} maxLength={1200} onChange={e=>change(i,'path',e.target.value)}/></label><label>GitHub 소유자/저장소<input value={r.github} maxLength={150} onChange={e=>change(i,'github',e.target.value)}/></label><label>사용할 GitHub 계정 선택 사항<select value={r.account} onChange={e=>change(i,"account",e.target.value)}><option value="">CLI 기본 계정</option>{r.account&&!accounts.includes(r.account)&&<option value={r.account}>{r.account}</option>}{accounts.map(a=><option key={a}>{a}</option>)}</select></label><label>통합 기준 브랜치<input value={r.base} maxLength={200} onChange={e=>change(i,'base',e.target.value)}/></label></div>
      <label><AnimatedSwitch checked={!!r.hidden} onChange={e=>change(i,'hidden',e.target.checked)}/>일반 저장소 목록에서 숨기기</label><button disabled={busy} onClick={()=>setRepos(v=>v.filter((_,n)=>n!==i))}>연결 목록에서 제외</button>
    </article>)}
    <section aria-label="사용자 프로젝트 서비스"><h3>프로젝트 서비스</h3>{services.map((s,i)=><article key={s.id}><div className="pr-grid"><label>서비스 이름<input value={s.name} maxLength={100} onChange={e=>setServices(v=>v.map((x,n)=>n===i?{...x,name:e.target.value}:x))}/></label><label>프로젝트 기준 실행 폴더<input value={s.cwd} maxLength={1200} onChange={e=>setServices(v=>v.map((x,n)=>n===i?{...x,cwd:e.target.value}:x))}/></label></div><label>실행 명령<input value={s.command} maxLength={2000} onChange={e=>setServices(v=>v.map((x,n)=>n===i?{...x,command:e.target.value}:x))}/></label><button disabled={busy} onClick={()=>setServices(v=>v.filter((_,n)=>n!==i))}>서비스 제외</button></article>)}<button disabled={busy||services.length>=32} onClick={()=>setServices(v=>[...v,{id:crypto.randomUUID(),name:'새 서비스',cwd:'.',command:''}])}>프로젝트 서비스 추가</button></section>
    <div className="pr-actions"><button disabled={busy||repos.length>=32} onClick={()=>setRepos(v=>[...v,{id:crypto.randomUUID(),name:'새 저장소',path:'',github:'',account:'',base:'main'}])}>저장소 연결 추가</button><button className="primary" disabled={busy} onClick={()=>void save()}>저장소와 대화 폴더 저장</button></div>{error&&<p role="alert" className="pf-error">{error}</p>}
  </section><ProjectPorts project={project}/></>;
}
