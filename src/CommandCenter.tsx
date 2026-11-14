import { useEffect, useRef, useState } from 'react';
import { MotionOverlay } from './ui-motion';
import {Search} from 'lucide-react';
import type { Project, Session } from '../shared/types';
import type { PortfolioPreferences } from '../shared/portfolio';
export default function CommandCenter({projects,sessions,onProject,onSession,onView,onNew}:{projects:Project[];sessions:Session[];onProject(p:Project):void;onSession(s:Session):void;onView(v:string):void;onNew():void}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[prefs,setPrefs]=useState<PortfolioPreferences>(),[editing,setEditing]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null),latest=useRef({onProject,onSession,onView,onNew});latest.current={onProject,onSession,onView,onNew};
  useEffect(()=>{window.flowrium?.portfolioAction({action:'read'}).then(setPrefs).catch(()=>{});},[]);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{
    if(!e.metaKey&&!e.ctrlKey)return;
    const combo='mod+'+(e.shiftKey?'shift+':'')+(e.code.startsWith('Digit')?e.code.slice(5):e.key.toLowerCase());
    const action=Object.entries(prefs?.shortcuts||{search:'mod+k'}).find(([,key])=>key===combo)?.[0];if(!action)return;
    e.preventDefault();e.stopImmediatePropagation();if(action==='search'){setOpen(v=>!v);setQuery('');setActive(0);return;}
    if(action==='newChat')latest.current.onNew();else latest.current.onView(({dashboard:'dashboard',history:'history',settings:'settings'} as Record<string,string>)[action]);
  };document.addEventListener('keydown',handler,true);return()=>document.removeEventListener('keydown',handler,true);},[prefs]);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  const pages=[['dashboard','대시보드'],['calendar','일정'],['archive','완료'],['outputs','산출물'],['music','뮤직'],['settings','설정'],['kickoff','프로젝트 추가']];
  const items=[...projects.map(p=>({id:'p'+p.id,label:p.name,kind:'프로젝트',run:()=>onProject(p)})),...sessions.map(s=>({id:'s'+s.id,label:s.title,kind:'대화',run:()=>onSession(s)})),...pages.map(([id,label])=>({id, label,kind:'화면',run:()=>onView(id)}))].filter(i=>(i.label+i.kind).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,60);
  const pick=(index:number)=>{items[index]?.run();setOpen(false);};
  return <><button className="command-trigger" aria-label="프로젝트와 화면 찾기" onClick={()=>{setOpen(true);setActive(0);}}><Search size={17}/><span>프로젝트와 대화 찾기</span><kbd>{/Mac/.test(navigator.platform)?'⌘':'Ctrl'} K</kbd></button><MotionOverlay open={open} onClose={()=>setOpen(false)} label="프로젝트와 화면 찾기" className="command-scrim" initialFocus="input[aria-label='전체 검색어']">
      <header style={{display:'flex',justifyContent:'space-between'}}><h2>프로젝트와 대화 찾기</h2><button onClick={()=>setOpen(false)}>닫기</button></header>
      <input ref={input} aria-label="전체 검색어" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='ArrowDown'){e.preventDefault();setActive(v=>(v+1)%Math.max(items.length,1));}if(e.key==='ArrowUp'){e.preventDefault();setActive(v=>(v+items.length-1)%Math.max(items.length,1));}if(e.key==='Enter'){e.preventDefault();pick(active);}}} style={{width:'100%',padding:12}}/>
      <div role="listbox" aria-label="검색 결과">{items.map((i,n)=><button role="option" aria-selected={n===active} key={i.id} onClick={()=>pick(n)} style={{display:'flex',justifyContent:'space-between',gap:10,width:'100%',padding:12,background:n===active?'#bdcfdd':'transparent',border:0,color:'inherit'}}><span>{i.label}</span><small>{i.kind}</small></button>)}</div>
      <button onClick={()=>setEditing(!editing)}>단축키 설정</button>{editing&&prefs&&<section><p>예: mod+k (맥에서는 Command, Windows에서는 Ctrl)</p>{Object.entries(prefs.shortcuts).map(([name,key])=><label key={name} style={{display:'flex',justifyContent:'space-between',gap:12,margin:'10px 0'}}>{{search:'전체 검색',dashboard:'대시보드',newChat:'새 대화',history:'작업 기록',settings:'설정'}[name]||name}<input aria-label={name+' 단축키'} value={key} onChange={e=>setPrefs(v=>v&&({...v,shortcuts:{...v.shortcuts,[name]:e.target.value.toLowerCase()}}))}/></label>)}<button onClick={()=>void window.flowrium!.portfolioAction({action:'save',revision:prefs.revision,shortcuts:prefs.shortcuts}).then(v=>{setPrefs(v);setError('저장했습니다.');}).catch(e=>setError(e.message))}>단축키 저장</button>{error&&<p role="status">{error}</p>}</section>}
  </MotionOverlay></>;
}
