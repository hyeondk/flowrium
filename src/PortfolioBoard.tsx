import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useRef, useState } from 'react';
import type { PortfolioCard, PortfolioInsights, PortfolioPreferences } from '../shared/portfolio';
import type { Project } from '../shared/types';
import './portfolio-tools.css';

export default function PortfolioBoard({cards,onOpen,onChange,onImported}:{cards:PortfolioCard[];onOpen(p:Project):void;onChange(id?:string,archived?:boolean):void;onImported?(p:Project):void}) {
  const api=window.flowrium;
  const [prefs,setPrefs]=useState<PortfolioPreferences>(),[insights,setInsights]=useState<PortfolioInsights>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'list'|'board'>('list'),[preview,setPreview]=useState<{token:string;cards:{index:number;name:string;existingId:string|null;willReplace:boolean}[]}>(),[selected,setSelected]=useState<number[]>([]),[overwrite,setOverwrite]=useState(false);
  const picker=useRef<HTMLInputElement>(null);
  useEffect(()=>{let alive=true;api?.portfolioAction({action:'read'}).then(v=>{if(alive)setPrefs(v);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[api]);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function drop(id:string,column:string,before?:string){await run(async()=>{
    const card=cards.find(c=>c.project.id===id);if(!card?.details)return;
    await api!.updateProjectDetails(id,card.details.revision,{action:'phase',phase:column,name:card.details.kickoff?.name||card.project.name});
    const latest=await api!.portfolioAction({action:'read'}),order=[...latest.order,...cards.map(c=>c.project.id).filter(i=>!latest.order.includes(i))].filter(i=>i!==id);
    const at=before?order.indexOf(before):-1;order.splice(at<0?order.length:at,0,id);
    setPrefs(await api!.portfolioAction({action:'save',revision:latest.revision,order}));onChange(id,column==='완료');
  });}
  async function exportCards(){await run(async()=>{const value=await api!.portfolioAction({action:'export'});const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));try{const a=document.createElement('a');a.href=url;a.download='Flowrium-project-cards.json';a.click();}finally{URL.revokeObjectURL(url);}});}
  const sorted=[...cards].sort((a,b)=>{const index=(id:string)=>{const i=prefs?.order.indexOf(id)??-1;return i<0?100000:i;};return index(a.project.id)-index(b.project.id);});
  return <section className="portfolio-tools" aria-label="프로젝트 보드 도구">
    <div className="pt-actions"><button aria-pressed={mode==='board'} onClick={()=>setMode(mode==='board'?'list':'board')}>{mode==='board'?'카드 목록':'상태별 보드'}</button>
      <button disabled={busy} onClick={()=>void exportCards()}>프로젝트 카드 내보내기</button><button disabled={busy} onClick={()=>picker.current?.click()}>프로젝트 카드 가져오기</button>
      <button disabled={busy} onClick={()=>void run(async()=>setInsights(await api!.portfolioAction({action:'insights'})))}>커밋과 변경 요청 집계</button>
      <input ref={picker} type="file" hidden accept=".json,application/json" aria-label="가져올 프로젝트 카드" onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>2*1024*1024)throw Error('카드 파일은 2MB까지 가능합니다.');const v=await api!.portfolioAction({action:'previewImport',text:await file.text()});setPreview(v);setSelected(v.cards.map(c=>c.index));setOverwrite(false);});e.currentTarget.value='';}}/>
    </div>
    {error&&<p role="alert">{error}</p>}
    {preview&&<section className="pt-import" aria-label="카드 가져오기 미리보기"><h3>가져올 프로젝트를 확인하세요</h3><p>새 프로젝트마다 연결할 폴더를 선택합니다. 기존 상세 정보는 덮어쓰기 전에 백업합니다.</p>
      {preview.cards.map(c=><label key={c.index}><AnimatedCheckbox checked={selected.includes(c.index)} onChange={e=>setSelected(v=>e.target.checked?[...v,c.index]:v.filter(i=>i!==c.index))}/>{c.name} ({c.willReplace?'기존 카드 교체':'폴더 연결'})</label>)}
      <label><AnimatedCheckbox checked={overwrite} onChange={e=>setOverwrite(e.target.checked)}/>선택한 기존 카드의 상세 정보를 교체합니다.</label>
      <div className="pt-import-actions"><button disabled={busy||!selected.length} onClick={()=>void run(async()=>{const r=await api!.portfolioAction({action:'applyImport',token:preview.token,selected,overwrite});setPreview(undefined);setError(r.skipped.length?'연결하지 않은 프로젝트: '+r.skipped.join(', '):'');onChange();const last=r.projects.at(-1);if(last)onImported?.(last);})}>선택한 카드 가져오기</button><button onClick={()=>setPreview(undefined)}>취소</button></div>
    </section>}
    {mode==='board'&&prefs&&<div className="pt-board" aria-label="상태별 프로젝트 보드">{prefs.columns.map((column,index)=><section className="pt-column" key={column} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';}} onDrop={e=>{e.preventDefault();void drop(e.dataTransfer.getData('application/x-flowrium-project'),column);}}>
      <header><h3>{column}</h3><button aria-label={column+' 칸 앞으로'} disabled={busy||index===0} onClick={()=>void run(async()=>{const next=[...prefs.columns];[next[index-1],next[index]]=[next[index],next[index-1]];setPrefs(await api!.portfolioAction({action:'save',revision:prefs.revision,columns:next}));})}>←</button></header>
      {sorted.filter(c=>(c.details?.archivedAt?'완료':c.details?.kickoff?.phase||'진행')===column).map(c=><article draggable={!busy} className="pt-project" key={c.project.id} onDragStart={e=>e.dataTransfer.setData('application/x-flowrium-project',c.project.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();e.stopPropagation();void drop(e.dataTransfer.getData('application/x-flowrium-project'),column,c.project.id);}}>
        <button onClick={()=>onOpen(c.project)}><strong>{c.details?.kickoff?.name||c.project.name}</strong><span>{c.details?.goal||'목표 미지정'}</span></button>
        <select aria-label={(c.details?.kickoff?.name||c.project.name)+' 진행 단계'} value={column} disabled={busy} onChange={e=>void drop(c.project.id,e.target.value)}>{prefs.columns.map(s=><option key={s}>{s}</option>)}</select>
      </article>)}
    </section>)}</div>}
    {insights&&<section aria-label="저장소 통합 지표"><div className="pt-metrics"><strong>최근 7일 커밋 {insights.commits7}개</strong><strong>변경한 저장소 {insights.dirtyRepositories}개</strong><strong>열린 변경 요청 {insights.openPulls}개</strong></div>
      <h3>최근 14일 프로젝트별 커밋</h3>{insights.projects.map(p=><div key={p.projectId} className="pt-chart"><strong>{p.name}</strong><div className="pt-bars">{p.days.map(d=><div key={d.day} title={d.day+' ('+d.count+'개)'}><span style={{height:Math.max(2,Math.min(100,d.count*8))+'px'}}/><small>{d.day.slice(8)}</small></div>)}</div>{p.errors.length>0&&<p>{p.errors.join(', ')}</p>}</div>)}
      <small>{new Date(insights.at).toLocaleString('ko-KR')} 기록 (조회할 수 없는 저장소는 집계에서 제외)</small>
    </section>}
  </section>;
}
