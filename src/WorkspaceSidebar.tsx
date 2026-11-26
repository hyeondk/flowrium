import {useProjectGrip,type MoveProject} from './ProjectOrder';
import {useEffect,useRef,useState,type ReactNode,type MouseEvent} from 'react';
import {Archive,BookOpenText,ClipboardList,Coffee,FileText,Folder,Folders,LayoutDashboard,LockKeyhole,LogIn,LogOut,MessagesSquare,Pin,PinOff,Plus,Settings2,SquareTerminal,Trash2,type LucideIcon} from 'lucide-react';
import type {Project} from '../shared/types';
import './workspace-sidebar.css';
import SidebarUsage from './SidebarUsage';
import {CloseButton} from './ui-motion';
import type {AccountUsage} from './account-usage';
import {executionLabels} from '../shared/execution-state';
export type SideDestination='dashboard'|'kickoff'|'archive'|'outputs'|'weekly'|'pause'|'terminal'|'workflow'|'dictionary';
type Props={categories:Record<string,string>;current:string;mobileOpen:boolean;projects:Project[];onProjectMove:MoveProject;selected?:string;counts:Record<string,{running:number;waiting:number;decision:number;total:number}>;onGo(view:SideDestination):void;onClose():void;onProject(p:Project):void;onSettings():void;onTrash():void;onLock():void;onLogout():void;onLogin():void;accountLinked:boolean;accountUsage:AccountUsage;onProjectMenu?(event:MouseEvent,project:Project):void};
function MenuRow({label,icon:Icon,active,onClick,extraClass=''}:{label:string;icon:LucideIcon;active?:boolean;onClick():void;extraClass?:string}){return <button type="button" title={label} aria-label={label} aria-current={active?'page':undefined} onClick={onClick} className={'side-row '+extraClass}><Icon size={20} strokeWidth={1.7}/><span>{label}</span></button>}
function MenuGroup({label,children}:{label:string;children:ReactNode}){return <section className={'side-group '+(label==='도구'?'side-tools':'side-storage')} aria-label={label}><h2>{label}</h2>{children}</section>}
export default function WorkspaceSidebar({categories,current,mobileOpen,projects,selected,counts,onGo,onProject,onSettings,onLock,onLogin,onLogout,accountLinked,accountUsage,onProjectMenu,onTrash,onProjectMove,onClose}:Props){
 const grip=useProjectGrip(projects,onProjectMove);
 const [narrow,setNarrow]=useState(()=>innerWidth<=760);
 useEffect(()=>{const query=matchMedia('(max-width:760px)'),update=()=>setNarrow(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const [hovered,setHovered]=useState(false),[keyboardFocus,setKeyboardFocus]=useState(false),[pinned,setPinned]=useState(()=>{try{const saved=localStorage.getItem('flowrium.navigation.pinned');return saved===null?innerWidth>=1100:saved==='true'}catch{return false}}),keyboard=useRef(false);
 useEffect(()=>{try{localStorage.setItem('flowrium.navigation.pinned',String(pinned))}catch{}},[pinned]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Tab')keyboard.current=true},pointer=()=>{keyboard.current=false;setKeyboardFocus(false)};document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',pointer,true);return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',pointer,true)}},[]);
 const leaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(leaveTimer.current),[]);
 const expanded=mobileOpen||pinned||hovered||keyboardFocus||grip.engaged;
 const row=(key:SideDestination,label:string,icon:LucideIcon)=><MenuRow label={label} icon={icon} active={current===key} extraClass={key==='dashboard'?'side-dashboard':''} onClick={()=>onGo(key)}/>;
 return <aside aria-label="작업 공간 탐색" aria-hidden={narrow&&!mobileOpen?true:undefined} inert={narrow&&!mobileOpen} data-expanded={expanded} data-pinned={pinned} className={'sidebar workspace-side'+(mobileOpen?' is-open':'')} onPointerEnter={e=>{clearTimeout(leaveTimer.current);if(e.pointerType!=='touch')setHovered(true)}} onPointerLeave={()=>{clearTimeout(leaveTimer.current);leaveTimer.current=setTimeout(()=>setHovered(false),240)}} onFocusCapture={()=>{if(keyboard.current)setKeyboardFocus(true)}} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setKeyboardFocus(false)}}>
  <div className="sidebar-surface"><div className="sidebar-content">
   <div className="side-brand-row"><button className="side-brand" onClick={()=>onGo('dashboard')} aria-label="Flowrium 홈"><img src="./flowrium.png" width="32" height="32" alt=""/><span>Flowrium</span></button>{narrow&&mobileOpen?<CloseButton aria-label="메뉴 닫기" onClick={onClose}/>:<button type="button" className="side-collapse" aria-label={pinned?'메뉴 자동 접기':'메뉴 고정'} title={pinned?'마우스를 벗어나면 접기':'메뉴 펼친 상태로 고정'} aria-pressed={pinned} onClick={()=>setPinned(!pinned)}>{pinned?<PinOff size={16}/>:<Pin size={16}/>}</button>}</div>
   <nav aria-label="주 메뉴">{row('dashboard','대시보드',LayoutDashboard)}
    <section className="side-projects" aria-label="프로젝트"><div className="side-project-head"><Folders className="side-project-section-icon" size={18} strokeWidth={1.7} aria-hidden="true"/><h2>프로젝트</h2><button type="button" className="side-project-add" title="프로젝트 추가" aria-label="프로젝트 추가" aria-hidden={!expanded} tabIndex={expanded?0:-1} aria-current={current==='kickoff'?'page':undefined} onClick={()=>{setHovered(false);onGo('kickoff');}}><Plus size={18}/></button></div>
     <div className="side-project-list project-order-list">{projects.map(p=>{
      const n=counts[p.id],total=n?.total||0;
      const states=(['running','waiting','decision'] as const).filter(state=>(n?.[state]||0)>0);
      const primary=states.includes('decision')?'decision':states.includes('running')?'running':'waiting';
      const status=states.map(state=>executionLabels[state]+' '+n[state]+'건').join(' / ');
      const description=[categories[p.id],'대화 '+total+'개',status].filter(Boolean).join(' / ');
      return <button {...grip.props(p.id)} className="side-row side-project" data-status-count={states.length} key={p.id} title={p.name+' / '+description} aria-label={p.name} aria-description={description} aria-current={p.id===selected?'page':undefined} onContextMenu={e=>onProjectMenu?.(e,p)} onClick={()=>onProject(p)}><span className="side-project-icon"><Folder size={20} strokeWidth={1.7}/>{states.length>0&&<span className="side-project-markers" role="img" aria-label={status} title={status}><span className="side-project-marker" data-state={primary} aria-hidden="true"><i/><span>{executionLabels[primary]}</span></span></span>}</span><span className="side-project-label"><strong>{p.name}</strong><small className="side-project-count" aria-label={'대화 '+total+'개'}>{total}</small></span></button>
     })}{!projects.length&&<p>프로젝트를 연결해 주세요.</p>}</div>
     <span className="project-order-readout" role="status">{grip.announcement}</span>
    </section>
    <div className="side-lower-nav">
     <MenuGroup label="보관">{row('outputs','산출물',FileText)}{row('archive','완료한 업무',Archive)}<MenuRow label="휴지통" icon={Trash2} onClick={onTrash}/></MenuGroup>
     <MenuGroup label="도구">{row('workflow','업무 센터',MessagesSquare)}{row('weekly','주간업무보고',ClipboardList)}{row('pause','업무 마감',Coffee)}{row('dictionary','사전',BookOpenText)}{row('terminal','터미널',SquareTerminal)}</MenuGroup>
    </div>
   </nav>
   <div className="side-foot"><SidebarUsage usage={accountUsage} expanded={expanded}/><div className="side-account-actions"><MenuRow label="설정" icon={Settings2} onClick={onSettings} extraClass="settings-button"/><MenuRow label="잠금" icon={LockKeyhole} onClick={onLock}/><MenuRow label={accountLinked?"로그아웃":"로그인"} icon={accountLinked?LogOut:LogIn} onClick={accountLinked?onLogout:onLogin}/></div><div className="side-account" title="제작자 hyeondk"><span className="side-copyright-icon">©</span><span><span className="side-copyright-year">2026 </span>hyeondk</span></div></div>
  </div></div>
 </aside>
}
