import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Archive,ClipboardList,Coffee,FileText,Folder,LayoutDashboard,LockKeyhole,LogOut,Music2,MessagesSquare,Pin,PinOff,Plus,Settings2,SquareTerminal,type LucideIcon} from 'lucide-react';
import type {Project} from '../shared/types';
import './workspace-sidebar.css';
export type SideDestination='dashboard'|'kickoff'|'archive'|'outputs'|'weekly'|'pause'|'terminal'|'music'|'workflow';
type Props={current:string;mobileOpen:boolean;projects:Project[];selected?:string;counts:Record<string,{running:number;waiting:number;decision:number}>;onGo(view:SideDestination):void;onProject(p:Project):void;onSettings():void;onLock():void;onLogout():void;account?:string};
function MenuRow({label,icon:Icon,active,onClick,extraClass=''}:{label:string;icon:LucideIcon;active?:boolean;onClick():void;extraClass?:string}){return <button type="button" title={label} aria-label={label} aria-current={active?'page':undefined} onClick={onClick} className={'side-row '+extraClass}><Icon size={20} strokeWidth={1.7}/><span>{label}</span></button>}
function MenuGroup({label,children}:{label:string;children:ReactNode}){return <section className="side-group" aria-label={label}><h2>{label}</h2>{children}</section>}
export default function WorkspaceSidebar({current,mobileOpen,projects,selected,counts,onGo,onProject,onSettings,onLock,onLogout,account}:Props){
 const [narrow,setNarrow]=useState(()=>innerWidth<=760);
 useEffect(()=>{const query=matchMedia('(max-width:760px)'),update=()=>setNarrow(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const [hovered,setHovered]=useState(false),[keyboardFocus,setKeyboardFocus]=useState(false),[pinned,setPinned]=useState(()=>{try{return localStorage.getItem('flowrium.navigation.pinned')==='true'}catch{return false}}),keyboard=useRef(false);
 useEffect(()=>{try{localStorage.setItem('flowrium.navigation.pinned',String(pinned))}catch{}},[pinned]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Tab')keyboard.current=true},pointer=()=>{keyboard.current=false;setKeyboardFocus(false)};document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',pointer,true);return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',pointer,true)}},[]);
 const leaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(leaveTimer.current),[]);
 const expanded=mobileOpen||pinned||hovered||keyboardFocus;
 const row=(key:SideDestination,label:string,icon:LucideIcon)=><MenuRow label={label} icon={icon} active={current===key} onClick={()=>onGo(key)}/>;
 return <aside aria-label="작업 공간 탐색" aria-hidden={narrow&&!mobileOpen?true:undefined} inert={narrow&&!mobileOpen} data-expanded={expanded} data-pinned={pinned} className={'sidebar workspace-side'+(mobileOpen?' is-open':'')} onPointerEnter={e=>{clearTimeout(leaveTimer.current);if(e.pointerType!=='touch')setHovered(true)}} onPointerLeave={()=>{clearTimeout(leaveTimer.current);leaveTimer.current=setTimeout(()=>setHovered(false),240)}} onFocusCapture={()=>{if(keyboard.current)setKeyboardFocus(true)}} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setKeyboardFocus(false)}}>
  <div className="sidebar-surface">
   <div className="side-brand-row"><button className="side-brand" onClick={()=>onGo('dashboard')} aria-label="Flowrium 홈"><img src="./flowrium.png" width="32" height="32" alt=""/><span>Flowrium</span></button><button type="button" className="side-collapse" aria-label={pinned?'메뉴 자동 접기':'메뉴 고정'} title={pinned?'마우스를 벗어나면 접기':'메뉴 펼친 상태로 고정'} aria-pressed={pinned} onClick={()=>setPinned(!pinned)}>{pinned?<PinOff size={16}/>:<Pin size={16}/>}</button></div>
   <nav aria-label="주 메뉴">{row('dashboard','대시보드',LayoutDashboard)}
    <section className="side-projects" aria-label="프로젝트"><div className="side-project-head"><h2>프로젝트</h2><button title="프로젝트 추가" aria-label="프로젝트 추가" aria-current={current==='kickoff'?'page':undefined} onClick={()=>onGo('kickoff')}><Plus size={18}/></button></div>
     <div className="side-project-list">{projects.map(p=>{const n=counts[p.id],state=n?.decision?'decision':n?.running?'running':n?.waiting?'waiting':null,label=state?{decision:'결정',running:'작업중',waiting:'대기'}[state]:'';return <button className="side-row side-project" key={p.id} title={p.name+(state?' / '+label:'')} aria-label={p.name} aria-current={p.id===selected?'page':undefined} onClick={()=>onProject(p)}><Folder size={20} strokeWidth={1.7}/><span>{p.name}</span>{state&&<small className="side-state" data-state={state}>{label} {n[state]}</small>}</button>})}{!projects.length&&<p>프로젝트를 연결해 주세요.</p>}</div>
    </section>
    <MenuGroup label="보관">{row('outputs','산출물',FileText)}{row('archive','완료',Archive)}</MenuGroup>
    <MenuGroup label="도구">{row('workflow','업무 연결 / 비서',MessagesSquare)}{row('weekly','주간업무보고',ClipboardList)}{row('pause','업무 마감',Coffee)}{row('terminal','터미널',SquareTerminal)}{row('music','뮤직',Music2)}<MenuRow label="설정" icon={Settings2} onClick={onSettings} extraClass="settings-button"/><MenuRow label="잠금" icon={LockKeyhole} onClick={onLock}/><MenuRow label="로그아웃" icon={LogOut} onClick={onLogout}/></MenuGroup>
   </nav><div className="side-account" title={account||'계정 연결 필요'}><i data-connected={Boolean(account)}/><span>{account||'계정 연결 필요'}</span></div>
  </div>
 </aside>
}
