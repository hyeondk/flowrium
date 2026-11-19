import {isImeKey} from './ime';
import {useProjectGrip,type MoveProject} from './ProjectOrder';
import {useEffect,useId,useRef,useState,type ReactNode,type MouseEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {ArrowLeft,Bell,ChevronRight,Folder,Globe2,Maximize2,MoreHorizontal,SquarePen,MessageCircle,MessagesSquare,PanelRight,PanelRightClose,Plus,Search,ShieldCheck,X} from 'lucide-react';
import type {FlowriumEvent,Project,Session} from '../shared/types';
import type {WorkflowProposal} from '../shared/workflow';
import {executionLabels,sessionExecution,type ExecutionActivity,type ExecutionState} from '../shared/execution-state';
import {MotionPresence} from './ui-motion';
import {ExecutionBadge,type ExecutionCounts} from './ExecutionStatus';
import './dock-layout-modes.css';
import ChoicePicker from './ChoicePicker';
import ProjectCategoryLabel from './ProjectCategoryLabel';
import {messagePreview} from './message-content';
import {useDockResize} from './DockResizeHandle';
type Scope='home'|'integrated'|'general'|'project'|'all'|'assistant';
type Props={revealQuestion?:boolean;projectNavigation?:{id:string;nonce:number};open:boolean;chatActive:boolean;expanded:boolean;onExpand():void;onClose():void;onLeaveChat():void;projects:Project[];categories?:Record<string,string>;onProjectMove:MoveProject;sessions:Session[];projectId?:string;sessionId?:string;activities:Record<string,ExecutionActivity>;requests:FlowriumEvent[];proposals:WorkflowProposal[];counts:ExecutionCounts;filter:ExecutionState|'all';onFilter(state:ExecutionState|'all'):void;onOpen(s:Session):void;onProject(p:Project):void;onCreate(scope:'project'|'integrated'|'general',projectId?:string):void;onCreateProject():void;onDecisions():void;attentionCount?:number;dotsEligible:boolean;onAssistant():void;assistantContent?:ReactNode;assistantNavigation?:number;onSessionMenu?(event:MouseEvent,session:Session):void;onProjectMenu?(event:MouseEvent,project:Project):void;busy?:boolean;children:ReactNode};
type PanelLayout='docked'|'overlay';
const layoutKey='flowrium.dock.presentation.v1';
function storedLayout(){try{const value=JSON.parse(localStorage.getItem(layoutKey)||'null');if(value&&['docked','overlay'].includes(value.layout)&&typeof value.minimized==='boolean')return {layout:value.layout as PanelLayout,minimized:value.minimized};}catch{}return {layout:'docked' as PanelLayout,minimized:false};}
const scopeLabels={home:'대화',integrated:'통합 채팅',general:'일반 대화',project:'프로젝트 대화',all:'전체 대화',assistant:'개인 비서'};
const preview=(session:Session)=>{const message=session.messages.filter(m=>m.role!=='system').at(-1);return message?messagePreview(message.text,message.role):'첫 메시지를 작성해 보세요.';};
const time=(value:string)=>new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric'}).format(new Date(value));
export default function ConversationDock(props:Props){
 const {projects,sessions,chatActive,sessionId,requests,proposals,activities}=props;
 const grip=useProjectGrip(projects,props.onProjectMove);
 const [scope,setScope]=useState<Scope>('home'),[query,setQuery]=useState(''),[selectedProject,setSelectedProject]=useState(props.projectId||'');
 const [preference]=useState(storedLayout),[layout,setLayout]=useState<PanelLayout>(preference.layout),[minimized,setMinimized]=useState(preference.minimized),[modeMenu,setModeMenu]=useState(false),[storageError,setStorageError]=useState('');
 const modeButton=useRef<HTMLButtonElement>(null),modeRoot=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null),menuId=useId();
 const panel=useRef<HTMLElement>(null),selected=sessions.find(s=>s.id===sessionId);
 const resize=useDockResize(panel,layout==='overlay',props.open);
 useEffect(()=>{if(props.assistantNavigation){setScope('assistant');setQuery('')}},[props.assistantNavigation]);
 const dotsOpen=scope==='assistant'&&!chatActive&&props.dotsEligible;
 const isMinimized=minimized&&chatActive&&!props.revealQuestion;
 useEffect(()=>{if(props.revealQuestion)setMinimized(false)},[props.revealQuestion]);
 useEffect(()=>{if(scope==='assistant'&&!chatActive&&!props.dotsEligible)setScope('home')},[scope,chatActive,props.dotsEligible]);
 useEffect(()=>{if(props.projectNavigation){setSelectedProject(props.projectNavigation.id);setScope('project');setQuery('')}},[props.projectNavigation]);
 useEffect(()=>{if(!chatActive&&props.projectId)setSelectedProject(props.projectId)},[props.projectId,chatActive]);
 useEffect(()=>{if(chatActive&&selected){setScope(selected.generalAssistant?'assistant':selected.scope||'project');if(!selected.scope)setSelectedProject(selected.projectId)}},[chatActive,sessionId,selected?.scope,selected?.generalAssistant]);
 useEffect(()=>{if(props.filter!=='all')setScope('all')},[props.filter]);
 useEffect(()=>{if(!props.open)return;const key=(e:KeyboardEvent)=>{if(isImeKey(e))return;if(e.key==='Escape'&&!modeMenu&&!document.querySelector('dialog[open],[role=dialog],.modal-backdrop')){props.onClose();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[props.open,props.onClose,modeMenu]);
 useEffect(()=>{try{localStorage.setItem(layoutKey,JSON.stringify({layout,minimized}));setStorageError('')}catch{setStorageError('이 기기에서 보기 설정을 보관하지 못했습니다.')}},[layout,minimized]);
 useEffect(()=>{if(!props.open)setModeMenu(false)},[props.open]);
 useEffect(()=>{if(!modeMenu)return;menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!modeRoot.current?.contains(event.target))setModeMenu(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[modeMenu]);
 function selectLayout(value:PanelLayout|'composer'){if(value==='composer'){if(!chatActive)return;setMinimized(true);}else{setLayout(value);setMinimized(false)}setModeMenu(false);modeButton.current?.focus();}
 function menuKey(event:ReactKeyboardEvent<HTMLDivElement>){if(isImeKey(event.nativeEvent))return;const items=[...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled),[role="menuitem"]:not(:disabled)')||[])],index=items.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setModeMenu(false);modeButton.current?.focus();}else if(event.key==='Tab')setModeMenu(false);}
 const latest=[...sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const visible=latest.filter(s=>(scope==='all'||scope==='home'||(scope==='project'?!s.scope&&(!selectedProject||s.projectId===selectedProject):s.scope===scope))&&(!query||s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&(props.filter==='all'||sessionExecution(s,activities[s.id],requests,proposals)===props.filter));
 function group(value:Scope){setScope(value);setQuery('');props.onLeaveChat();props.onFilter('all')}
 const count=(value:'integrated'|'general')=>sessions.filter(s=>s.scope===value).length;
 return <MotionPresence open={props.open} durationMs={280}>{phase=><>
  <button className="dock-mobile-scrim" aria-label="대화함 닫기" data-phase={phase} onClick={props.onClose}/>
  <aside ref={resize.bindPanel} className="conversation-dock" style={resize.style} data-resizing={resize.resizing} aria-label="통합 / 프로젝트 / 일반 대화" data-chat-active={chatActive} data-layout-mode={layout} data-minimized={isMinimized} data-expanded={props.expanded} data-phase={phase} aria-hidden={phase==='exit'} inert={phase==='exit'}>
   {resize.separator}<span className="project-order-readout" role="status">{grip.announcement}</span>
   <header className="dock-heading"><div><div><h2>{isMinimized?(selected?.title||'대화 입력창'):'대화'}</h2></div></div><div className="dock-heading-actions">{!dotsOpen&&<button className="dock-icon" aria-label="새 대화 시작" title="새 대화" disabled={props.busy||((scope==='project'||scope==='home'||scope==='all')&&!selectedProject)} onClick={()=>props.onCreate(scope==='integrated'?'integrated':scope==='general'||scope==='assistant'?'general':'project',selectedProject)}><SquarePen size={17}/></button>}{(chatActive||scope==='assistant'||isMinimized)&&<button className="dock-icon dock-layout-toggle" aria-label={isMinimized?'대화 패널 다시 펼치기':props.expanded?'대화 패널 좁히기':'대화 패널 넓히기'} title={isMinimized?'대화 패널 다시 펼치기':props.expanded?'대화 패널 좁히기':'대화 패널 넓히기'} onClick={()=>{resize.reset();if(isMinimized)setMinimized(false);else props.onExpand()}}>{isMinimized||!props.expanded?<Maximize2 size={18}/>:<PanelRight size={18}/>}</button>}
    <div className="dock-mode-picker" ref={modeRoot}><button ref={modeButton} className="dock-icon" aria-label="대화 패널 보기 방식" aria-haspopup="menu" aria-expanded={modeMenu} aria-controls={modeMenu?menuId:undefined} onClick={()=>setModeMenu(value=>!value)}><MoreHorizontal size={18}/></button>{modeMenu&&<div ref={menu} id={menuId} role="menu" aria-label="대화 패널 보기" className="flow-context-menu dock-panel-menu" onKeyDown={menuKey}>{([['docked','대시보드 옆에 고정'],['overlay','겹쳐 보기'],['composer','입력창만 보기']] as const).map(([value,label])=><button type="button" key={value} role="menuitemradio" aria-checked={value==='composer'?isMinimized:!isMinimized&&layout===value} tabIndex={-1} disabled={value==='composer'&&!chatActive} aria-describedby={value==='composer'&&!chatActive?menuId+'-help':undefined} onClick={()=>selectLayout(value)}><span>{label}</span><i aria-hidden="true">{(value==='composer'?isMinimized:!isMinimized&&layout===value)?'✓':''}</i></button>)}{!chatActive&&<p id={menuId+'-help'} className="dock-mode-help">Flowrium 대화를 연 뒤 사용할 수 있습니다.</p>}</div>}</div>
    <button className="dock-icon" aria-label="대화함 접기" onClick={props.onClose}><PanelRightClose size={18}/></button></div></header>
   <div className="dock-scope-tabs" aria-label="대화 종류">{([['integrated','통합'],['project','프로젝트'],['general','일반'],['assistant','개인 비서']] as const).map(([key,label])=><button key={key} aria-label={key==='assistant'?'개인 비서 보기':undefined} aria-pressed={scope===key} title={key==='integrated'?'전체 프로젝트의 대화와 알림':label+' 대화'} onClick={()=>key==='assistant'?props.onAssistant():group(key)}>{label}{key==='integrated'&&Boolean(props.attentionCount)&&<small>{props.attentionCount}</small>}</button>)}</div>
   <div className="dock-navigation-row">
    {(scope !== 'home' || chatActive) && <button
      type="button" className="dock-back"
      aria-label={chatActive ? '대화 목록으로' : '대화 홈으로'}
      title={chatActive ? '대화 목록으로' : '대화 홈으로'}
      onClick={() => chatActive ? props.onLeaveChat() : group('home')}>
      <ArrowLeft size={14} aria-hidden="true"/>Back
    </button>}
   <div className="dock-status-tabs" aria-label="대화 진행 상태">{(['running','waiting','decision'] as const).map(state=><button key={state} data-state={state} title={executionLabels[state]+' '+props.counts[state]} aria-label={executionLabels[state]+' 상태 '+props.counts[state]+'개'} aria-pressed={props.filter===state} onClick={()=>{props.onLeaveChat();props.onFilter(props.filter===state?'all':state)}}><i/><span>{executionLabels[state]}</span><strong>{props.counts[state]}</strong></button>)}</div>
   </div>
   {scope==='integrated'&&!chatActive
     ? <button className="dock-decisions dock-notifications" data-pending={props.counts.decision>0} aria-label="프로젝트 알림 열기" aria-haspopup="dialog" onClick={props.onDecisions}>
         <Bell size={16}/><span>프로젝트 알림</span>
         {props.counts.decision>0&&<small>결정 {props.counts.decision}건</small>}
         {Boolean(props.attentionCount)&&<small>읽지 않음 {props.attentionCount}건</small>}
         <ChevronRight size={15}/>
       </button>
     : props.counts.decision>0&&<button className="dock-decisions" onClick={props.onDecisions}><ShieldCheck size={16}/><span>확인할 결정 {props.counts.decision}건</span><ChevronRight size={15}/></button>}
   <div className="dock-body">{dotsOpen&&<div className="dock-page dock-dots">{props.assistantContent}</div>}
    <MotionPresence open={!chatActive&&!dotsOpen&&!isMinimized} durationMs={220}>{innerPhase=><div className="dock-page dock-browser" data-phase={innerPhase} inert={innerPhase==='exit'}>
     {scope==='home'&&props.filter==='all'?<>
      <p className="dock-intro">대화의 범위를 고르고 이어서 시작하세요.</p>
      {(['integrated','general'] as const).map(value=><section className="dock-scope-card" key={value} data-scope={value}><button className="dock-scope-open" onClick={()=>group(value)}><span className="dock-scope-icon">{value==='integrated'?<Globe2 size={20}/>:<MessageCircle size={20}/>}</span><span><strong>{scopeLabels[value]}</strong><small>{value==='integrated'?'전체 프로젝트의 현황과 다음 업무':'프로젝트와 별개로 나누는 이야기'}</small></span><ChevronRight size={16}/></button><footer><span>{count(value)?count(value)+'개 대화':'아직 대화가 없습니다'}</span><button disabled={props.busy} className="dock-new-text" aria-label={'새 '+(value==='integrated'?'통합':'일반')+' 대화'} onClick={()=>props.onCreate(value)}><Plus size={14}/>새 대화</button></footer></section>)}
      <details className="dock-project-picker"><summary>프로젝트 대화 <ChevronRight size={15}/></summary>
      {projects.length?projects.map(p=><button {...grip.props(p.id)} title={p.name+' (길게 눌러 순서 변경)'} className="dock-project-row" onContextMenu={e=>props.onProjectMenu?.(e,p)} key={p.id} onClick={()=>{setSelectedProject(p.id);group('project');props.onProject(p)}}><span className="dock-project-copy"><span className="dock-project-name"><ProjectCategoryLabel category={props.categories?.[p.id]}/><strong>{p.name}</strong></span><small>{sessions.filter(s=>!s.scope&&s.projectId===p.id).length}개 대화</small></span><ChevronRight size={15}/></button>):<div className="dock-empty"><Folder size={24}/><p>프로젝트를 연결하면<br/>대화를 이곳에서 이어갑니다.</p></div>}
      </details>
     </>:<>
      {scope==='project'&&<div className="dock-project-select"><span>프로젝트</span><ChoicePicker label="대화함 프로젝트 선택" value={selectedProject} onChange={setSelectedProject} options={[{value:"",label:"프로젝트 선택"},...projects.map(p=>({value:p.id,label:p.name,leading:<ProjectCategoryLabel category={props.categories?.[p.id]}/>}))]}/></div>}
      <div className="dock-search"><Search size={16}/><input aria-label="대화함 검색" placeholder="대화 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="dock-icon" aria-label="대화 검색 지우기" onClick={()=>setQuery('')}><X size={14}/></button>}</div>
      {props.filter!=='all'&&<div className="dock-filter-caption"><span>{executionLabels[props.filter]} 상태의 대화</span><button onClick={()=>props.onFilter('all')}>필터 해제</button></div>}
      <div className="dock-session-list" aria-label="대화 목록">{visible.map(s=><button className="dock-session" onContextMenu={e=>props.onSessionMenu?.(e,s)} data-selected={s.id===sessionId} key={s.id} onClick={()=>props.onOpen(s)}><div><MessagesSquare size={16}/><strong>{s.title}</strong><time>{time(s.updatedAt)}</time></div><p>{preview(s)}</p><footer><span className="dock-session-project">{!s.scope&&<ProjectCategoryLabel category={props.categories?.[s.projectId]}/>}<span>{s.scope?scopeLabels[s.scope]:projects.find(p=>p.id===s.projectId)?.name||'프로젝트'}</span></span><ExecutionBadge state={sessionExecution(s,activities[s.id],requests,proposals)}/></footer></button>)}{!visible.length&&<div className="dock-empty"><MessagesSquare size={26}/><p>{props.filter==='all'?'아직 대화가 없습니다.':'해당 상태의 대화가 없습니다.'}</p></div>}</div>
      {scope!=='all'&&<button className="dock-primary dock-new-conversation" disabled={props.busy||(scope==='project'&&!selectedProject)} onClick={()=>props.onCreate(scope==='home'||scope==='assistant'?'project':scope,selectedProject)}><Plus size={17}/>새 {scope==='general'?'일반 ':scope==='integrated'?'통합 ':''}대화</button>}
     </>}
    </div>}</MotionPresence>
    <MotionPresence open={chatActive} durationMs={220}>{innerPhase=><div className="dock-page dock-chat" data-phase={innerPhase} inert={innerPhase==='exit'}>{props.children}</div>}</MotionPresence>
   </div>{storageError&&<p className="dock-storage-error" role="status">{storageError}</p>}<footer className="dock-footer"><span className="dock-footer-dot"/>프로젝트와 개인 대화를 따로 보관합니다.</footer>
  </aside></> }</MotionPresence>
}
