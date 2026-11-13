import { AnimatedCheckbox } from './ui-motion';
import { useState } from 'react';
import type { ProjectChange, ProjectDetails, ProjectSchedule } from '../shared/project-details';
import './portfolio-tools.css';
const day=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function periodKey(date:string,period:'week'|'month'){if(period==='month')return date.slice(0,7);const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);return day(d);}
export default function AdvancedGoals({data,onChange}:{data:ProjectDetails;onChange(d:ProjectDetails):void}){
  const [period,setPeriod]=useState<'week'|'month'>('week'),[date,setDate]=useState(day(new Date())),[text,setText]=useState(''),[parent,setParent]=useState(''),[target,setTarget]=useState(''),[due,setDue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [schedule,setSchedule]=useState<ProjectSchedule[]>(data.schedule||[]),[weekday,setWeekday]=useState(1),[time,setTime]=useState('09:00'),[scheduleText,setScheduleText]=useState('');
  const key=periodKey(date,period),shown=(data.periodGoals||[]).filter(g=>g.period===period&&g.key===key);
  async function update(change:ProjectChange){if(busy)return;setBusy(true);setError('');try{const next=await window.flowrium!.updateProjectDetails(data.projectId,data.revision,change);onChange(next);if(change.action==='goal-add'){setText('');setTarget('');setDue('');}}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <section className="pf-panel advanced-goals" aria-label="기간 목표와 반복 일정"><header className="pf-section-header"><h2>기간별 목표</h2><div className="pf-actions"><select aria-label="목표 기간" value={period} onChange={e=>setPeriod(e.target.value as 'week'|'month')}><option value="week">주간</option><option value="month">월간</option></select><input type="date" aria-label="목표 기준일" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></div></header>
    {shown.map(g=><div className="ag-row" key={g.id}><label><AnimatedCheckbox checked={g.done} disabled={busy} onChange={e=>void update({action:'goal-check',id:g.id,done:e.target.checked})}/><span>{g.text}{g.parent&&<small> / 월간 목표 {data.periodGoals?.find(p=>p.id===g.parent)?.text}</small>}{g.due&&<small> / 기한 {g.due}</small>}{g.carriedTo&&<small> / 다음 주로 이월함</small>}</span></label>
      {g.target!==undefined&&<label>진척<input aria-label={g.text+' 진척'} inputMode="decimal" defaultValue={String(g.current||0)} disabled={busy} onBlur={e=>{const value=Number(e.target.value);if(Number.isFinite(value)&&value>=0&&value!==g.current)void update({action:'goal-progress',id:g.id,current:value});}}/><span>/ {g.target}</span></label>}
      {period==='week'&&!g.carriedTo&&<button disabled={busy} onClick={()=>{const next=new Date(g.key+'T12:00:00');next.setDate(next.getDate()+7);void update({action:'goal-carry',id:g.id,key:day(next)});}}>다음 주로 이월</button>}
      <button disabled={busy} onClick={()=>void update({action:'goal-remove',id:g.id})}>삭제</button>
    </div>)}
    <form onSubmit={e=>{e.preventDefault();const number=target.trim()?Number(target):undefined;if(number!==undefined&&(!Number.isFinite(number)||number<=0)){setError('수치 목표는 0보다 큰 숫자로 입력해 주세요.');return;}void update({action:'goal-add',period,key,text,...(parent&&period==='week'?{parent}:{}),...(number!==undefined?{target:number}:{}),...(due?{due}:{})});}}>
      <label>기간 목표<input aria-label="기간 목표" required maxLength={500} value={text} onChange={e=>setText(e.target.value)} placeholder="이 기간에 달성할 목표"/></label>
      <div className="ag-grid">{period==='week'&&<label>연결할 월간 목표<select value={parent} onChange={e=>setParent(e.target.value)}><option value="">연결하지 않음</option>{data.periodGoals?.filter(g=>g.period==='month').map(g=><option value={g.id} key={g.id}>{g.key} / {g.text}</option>)}</select></label>}
      <label>수치 목표 선택 사항<input aria-label="수치 목표" inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)} placeholder="예: 10"/></label><label>목표 기한<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></div><button disabled={busy||!text.trim()}>목표 추가</button>
    </form>
    <section className="ag-schedule" aria-label="반복 일정"><h3>반복 일정</h3><p>지정한 요일과 시각의 알림을 개인 비서가 확인할 수 있도록 저장합니다.</p>{schedule.map((s,i)=><div key={s.id} className="ag-row"><span>{['일','월','화','수','목','금','토'][s.day]}요일 / {s.time} / {s.text}</span><button disabled={busy} onClick={()=>setSchedule(v=>v.filter((_,n)=>n!==i))}>일정 제외</button></div>)}
      <div className="ag-grid"><label>요일<select value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>{['일','월','화','수','목','금','토'].map((s,i)=><option value={i} key={s}>{s}요일</option>)}</select></label><label>시각<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div><label>알릴 내용<input value={scheduleText} maxLength={500} onChange={e=>setScheduleText(e.target.value)}/></label>
      <button disabled={busy||!scheduleText.trim()} onClick={()=>{setSchedule(v=>[...v,{id:crypto.randomUUID(),day:weekday,time,text:scheduleText.trim()}]);setScheduleText('');}}>일정 추가</button><button disabled={busy} onClick={()=>void update({action:'schedule',entries:schedule})}>반복 일정 저장</button>
    </section>{error&&<p role="alert" className="pf-error">{error}</p>}
  </section>;
}
