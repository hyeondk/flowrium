import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ChevronRight,Folder,Globe2,MessageCircle,MessagesSquare,PanelRightClose,Plus,Search,ShieldCheck,X} from 'lucide-react';
import type {FlowriumEvent,Project,Session} from '../shared/types';
import type {WorkflowProposal} from '../shared/workflow';
import {executionLabels,sessionExecution,type ExecutionState} from '../shared/execution-state';
import {MotionPresence} from './ui-motion';
import {ExecutionBadge,type ExecutionCounts} from './ExecutionStatus';
type Scope='home'|'integrated'|'general'|'project'|'all';
type Props={projectNavigation?:{id:string;nonce:number};open:boolean;chatActive:boolean;onClose():void;onLeaveChat():void;projects:Project[];sessions:Session[];projectId?:string;sessionId?:string;activities:Record<string,unknown>;requests:FlowriumEvent[];proposals:WorkflowProposal[];counts:ExecutionCounts;filter:ExecutionState|'all';onFilter(state:ExecutionState|'all'):void;onOpen(s:Session):void;onProject(p:Project):void;onCreate(scope:'project'|'integrated'|'general',projectId?:string):void;onCreateProject():void;onDecisions():void;busy?:boolean;children:ReactNode};
const scopeLabels={home:'대화',integrated:'통합 채팅',general:'일반 대화',project:'프로젝트 대화',all:'전체 대화'};
const time=(value:string)=>new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric'}).format(new Date(value));
export default function ConversationDock(props:Props){
 const {projects,sessions,chatActive,sessionId,requests,proposals,activities}=props;
 const [scope,setScope]=useState<Scope>('home'),[query,setQuery]=useState(''),[selectedProject,setSelectedProject]=useState(props.projectId||'');
 const panel=useRef<HTMLElement>(null),selected=sessions.find(s=>s.id===sessionId);
 useEffect(()=>{if(props.projectNavigation){setSelectedProject(props.projectNavigation.id);setScope('project');setQuery('')}},[props.projectNavigation]);
 useEffect(()=>{if(props.projectId)setSelectedProject(props.projectId)},[props.projectId]);
 useEffect(()=>{if(chatActive&&selected){setScope(selected.scope||'project');if(!selected.scope)setSelectedProject(selected.projectId)}},[chatActive,sessionId,selected?.scope]);
 useEffect(()=>{if(props.filter!=='all')setScope('all')},[props.filter]);
 useEffect(()=>{if(!props.open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('dialog[open],[role=dialog],.modal-backdrop')){props.onClose();}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[props.open,props.onClose]);
 const latest=[...sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const visible=latest.filter(s=>(scope==='all'||scope==='home'||(scope==='project'?!s.scope&&(!selectedProject||s.projectId===selectedProject):s.scope===scope))&&(!query||s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))&&(props.filter==='all'||sessionExecution(s,activities[s.id],requests,proposals)===props.filter));
 function group(value:Scope){setScope(value);setQuery('');props.onLeaveChat();props.onFilter('all')}
 const count=(value:'integrated'|'general')=>sessions.filter(s=>s.scope===value).length;
 return <MotionPresence open={props.open} durationMs={280}>{phase=><>
  <button className="dock-mobile-scrim" aria-label="대화함 닫기" data-phase={phase} onClick={props.onClose}/>
  <aside ref={panel} className="conversation-dock" aria-label="통합 / 프로젝트 / 일반 대화" data-phase={phase} aria-hidden={phase==='exit'} inert={phase==='exit'}>
   <header className="dock-heading"><div>{(scope!=='home'||chatActive)&&<button className="dock-icon" aria-label={chatActive?'대화 목록으로':'대화 홈으로'} onClick={()=>chatActive?props.onLeaveChat():group('home')}><ArrowLeft size={18}/></button>}<div><span className="dock-eyebrow">내 대화 공간</span><h2>{scopeLabels[scope]}</h2></div></div><div><button className="dock-icon" aria-label="대화함 접기" onClick={props.onClose}><PanelRightClose size={18}/></button></div></header>
   <div className="dock-status-tabs" aria-label="대화 진행 상태">{(['running','waiting','decision'] as const).map(state=><button key={state} data-state={state} aria-pressed={props.filter===state} onClick={()=>{props.onLeaveChat();props.onFilter(props.filter===state?'all':state)}}><i/>{executionLabels[state]}<strong>{props.counts[state]}</strong></button>)}</div>
   {props.counts.decision>0&&<button className="dock-decisions" onClick={props.onDecisions}><ShieldCheck size={16}/><span>확인할 결정 {props.counts.decision}건</span><ChevronRight size={15}/></button>}
   <div className="dock-body">
    <MotionPresence open={!chatActive} durationMs={220}>{innerPhase=><div className="dock-page dock-browser" data-phase={innerPhase} inert={innerPhase==='exit'}>
     {scope==='home'&&props.filter==='all'?<>
      <p className="dock-intro">대화의 범위를 고르고 이어서 시작하세요.</p>
      {(['integrated','general'] as const).map(value=><section className="dock-scope-card" key={value} data-scope={value}><button className="dock-scope-open" onClick={()=>group(value)}><span className="dock-scope-icon">{value==='integrated'?<Globe2 size={20}/>:<MessageCircle size={20}/>}</span><span><strong>{scopeLabels[value]}</strong><small>{value==='integrated'?'전체 프로젝트의 현황과 다음 업무':'프로젝트와 별개로 나누는 이야기'}</small></span><ChevronRight size={16}/></button><footer><span>{count(value)?count(value)+'개 대화':'아직 대화가 없습니다'}</span><button disabled={props.busy} className="dock-new-text" aria-label={'새 '+(value==='integrated'?'통합':'일반')+' 대화'} onClick={()=>props.onCreate(value)}><Plus size={14}/>새 대화</button></footer></section>)}
      <div className="dock-section-title"><h3>프로젝트 대화</h3><button className="dock-icon" aria-label="대화할 프로젝트 추가" onClick={props.onCreateProject}><Plus size={17}/></button></div>
      {projects.length?projects.map(p=><button className="dock-project-row" key={p.id} onClick={()=>{setSelectedProject(p.id);group('project');props.onProject(p)}}><Folder size={18}/><span><strong>{p.name}</strong><small>{sessions.filter(s=>!s.scope&&s.projectId===p.id).length}개 대화</small></span><ChevronRight size={15}/></button>):<div className="dock-empty"><Folder size={24}/><p>프로젝트를 연결하면<br/>대화를 이곳에서 이어갑니다.</p><button className="dock-primary" onClick={props.onCreateProject}>프로젝트 추가</button></div>}
     </>:<>
      {scope==='project'&&<label className="dock-project-select">프로젝트<select aria-label="대화함 프로젝트 선택" value={selectedProject} onChange={e=>setSelectedProject(e.target.value)}><option value="">프로젝트 선택</option>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
      <div className="dock-search"><Search size={16}/><input aria-label="대화함 검색" placeholder="대화 검색" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="dock-icon" aria-label="대화 검색 지우기" onClick={()=>setQuery('')}><X size={14}/></button>}</div>
      {props.filter!=='all'&&<div className="dock-filter-caption"><span>{executionLabels[props.filter]} 상태의 대화</span><button onClick={()=>props.onFilter('all')}>필터 해제</button></div>}
      <div className="dock-session-list" aria-label="대화 목록">{visible.map(s=><button className="dock-session" data-selected={s.id===sessionId} key={s.id} onClick={()=>props.onOpen(s)}><div><MessagesSquare size={16}/><strong>{s.title}</strong><time>{time(s.updatedAt)}</time></div><p>{s.messages.filter(m=>m.role!=='system').at(-1)?.text.slice(0,90)||'첫 메시지를 작성해 보세요.'}</p><footer><span>{s.scope?scopeLabels[s.scope]:projects.find(p=>p.id===s.projectId)?.name||'프로젝트'}</span><ExecutionBadge state={sessionExecution(s,activities[s.id],requests,proposals)}/></footer></button>)}{!visible.length&&<div className="dock-empty"><MessagesSquare size={26}/><p>{props.filter==='all'?'아직 대화가 없습니다.':'해당 상태의 대화가 없습니다.'}</p></div>}</div>
      {scope!=='all'&&<button className="dock-primary dock-new-conversation" disabled={props.busy||(scope==='project'&&!selectedProject)} onClick={()=>props.onCreate(scope==='home'?'project':scope,selectedProject)}><Plus size={17}/>새 {scope==='general'?'일반 ':scope==='integrated'?'통합 ':''}대화</button>}
     </>}
    </div>}</MotionPresence>
    <MotionPresence open={chatActive} durationMs={220}>{innerPhase=><div className="dock-page dock-chat" data-phase={innerPhase} inert={innerPhase==='exit'}>{props.children}</div>}</MotionPresence>
   </div><footer className="dock-footer"><span className="dock-footer-dot"/>프로젝트와 개인 대화를 따로 보관합니다.</footer>
  </aside></> }</MotionPresence>
}
