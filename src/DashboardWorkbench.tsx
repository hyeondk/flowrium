import {useEffect,useId,useMemo,useState} from 'react';
import {ArrowRight,ChevronDown,ClipboardCheck,History,Layers,ListTodo,MessageSquare} from 'lucide-react';
import type {PortfolioCard} from '../shared/portfolio';
import type {ProjectDetails} from '../shared/project-details';
import type {ComposerDraft} from '../shared/security';
import type {Session} from '../shared/types';
import type {WorkflowState} from '../shared/workflow';
import {latestFollowupAnswer,originalAnswerFollowups} from './answer-followup';
import ChoicePicker from './ChoicePicker';
import DashboardBatch from './DashboardBatch';
import DashboardResume from './DashboardResume';
import DashboardReview from './DashboardReview';
import './dashboard-workbench.css';

export type DashboardWorkContext = {
  accountRevision:number;
  drafts:Record<string,ComposerDraft>;
  decisionSessionIds:ReadonlySet<string>;
  workClose?:WorkflowState['workClose'];
  revealResume:boolean;
  onResumeRevealed():void;
  onDraft(projectId:string,text:string,session?:Session):Promise<void>;
  onSend(session:Session,text:string,submissionId:string):Promise<void|{queued?:boolean;queueId?:string}>;
};
type Props = DashboardWorkContext & {
  cards:PortfolioCard[];
  sessions:Session[];
  onOpen(session:Session):void;
  onProject(projectId:string):void;
  onDetails(value:ProjectDetails):void;
};
const tools = [
  {id:'followup',title:'답변에서 할 일',Icon:ListTodo},
  {id:'batch',title:'작업 묶음',Icon:Layers},
  {id:'resume',title:'업무 재개',Icon:History},
  {id:'review',title:'완료 전 점검',Icon:ClipboardCheck},
] as const;
type Tool = typeof tools[number]['id'];

function DashboardFollowup({cards,sessions,onDraft,onDetails}:Pick<Props,'cards'|'sessions'|'onDraft'|'onDetails'>) {
  const [projectId,setProjectId]=useState('');
  const [sessionId,setSessionId]=useState('');
  const [editing,setEditing]=useState<{key:string;text:string}>();
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState<{key:string;text:string;error?:boolean}>();
  const projects=cards.filter(card=>!card.details?.archivedAt);
  const project=projects.find(card=>card.project.id===projectId) || projects[0];
  const choices=useMemo(()=>{
    if(!project) return [];
    return sessions.filter(session=>session.projectId===project.project.id && session.workflow?.status!=='done'
      && !session.compacting && !session.queuedMessages?.some(item=>item.status==='queued'||item.status==='sending'))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
      .slice(0,20).flatMap(session=>{
        const suggestion=originalAnswerFollowups(session)[0];
        const answer=latestFollowupAnswer(session);
        return suggestion && answer ? [{session,suggestion,answerId:answer.id}] : [];
      });
  },[project,sessions]);
  const choice=choices.find(item=>item.session.id===sessionId) || choices[0];
  const key=choice ? choice.session.id+':'+choice.answerId : '';
  const text=(editing?.key===key ? editing.text : choice?.suggestion.prompt)||'';
  const available=Boolean(project && choice && text.trim() && !busy && window.flowrium);
  async function act(save:boolean){
    const api=window.flowrium;
    if(!api||!project||!choice||!available)return;
    const targetId=project.project.id, content=text.trim();
    setBusy(true);
    setFeedback(undefined);
    try{
      if(save){
        const before=await api.readProjectDetails(targetId);
        if(before.archivedAt)throw new Error('완료한 프로젝트에는 할 일을 추가할 수 없습니다.');
        const normalized=content.normalize('NFC');
        if(before.checklist.some(item=>item.text.trim().normalize('NFC')===normalized)){
          setFeedback({key,text:'같은 할 일이 이미 저장돼 있습니다.'});
          return;
        }
        const changed=await api.updateProjectDetails(targetId,before.revision,{action:'add',text:content});
        onDetails(changed);
      }else await onDraft(targetId,content,choice.session);
      setFeedback({key,text:save?'프로젝트 할 일에 저장했습니다.':'원래 대화에 초안을 열었습니다.'});
    }catch(error){setFeedback({key,text:error instanceof Error?error.message:'작업을 반영하지 못했습니다.',error:true});}
    finally{setBusy(false);}
  }
  return <section className="dashboard-work-section dashboard-work-followup" aria-label="답변에서 할 일 만들기">
    <div className="dashboard-work-heading">
      <h3>답변에서 할 일 만들기</h3>
      <p>최근 답변에서 이어갈 일을 골라 할 일로 저장하거나 대화 초안으로 엽니다.</p>
    </div>
    {project ? <>
      <div className="dashboard-work-controls">
        <ChoicePicker label="할 일을 저장할 프로젝트" value={project.project.id} disabled={busy}
          options={projects.map(card=>({value:card.project.id,label:card.details?.kickoff?.name||card.project.name}))} onChange={setProjectId}/>
        {choices.length>1&&<ChoicePicker label="추천이 나온 대화" value={choice.session.id} disabled={busy}
          options={choices.map(item=>({value:item.session.id,label:item.session.title}))} onChange={setSessionId}/>}
      </div>
      {choice ? <>
        <label className="dashboard-work-field">
          <span><MessageSquare size={13} aria-hidden="true"/>{choice.session.title}</span>
          <textarea aria-label="프로젝트 할 일 초안" rows={2} maxLength={500} disabled={busy} value={text}
            onChange={event=>{setEditing({key,text:event.target.value});setFeedback(undefined);}}/>
        </label>
        <div className="dashboard-work-footer">
          <button type="button" className="dashboard-work-button" disabled={!available} onClick={()=>void act(false)}>대화 초안 열기 <ArrowRight size={14} aria-hidden="true"/></button>
          <button type="button" className="dashboard-work-button dashboard-work-primary" disabled={!available} onClick={()=>void act(true)}><ListTodo size={14} aria-hidden="true"/>할 일로 저장</button>
        </div>
        {feedback?.key===key&&<p role={feedback.error?'alert':'status'} className={feedback.error?'dashboard-work-error':'dashboard-work-status'}>{feedback.text}</p>}
      </> : <p className="dashboard-work-empty">이 프로젝트의 최근 답변에 이어갈 일이 아직 없습니다.</p>}
    </> : <p className="dashboard-work-empty">프로젝트를 연결하면 답변에서 찾은 일을 여기에 표시합니다.</p>}
  </section>;
}

export default function DashboardWorkbench(props:Props) {
  const [active,setActive]=useState<Tool>();
  const [visited,setVisited]=useState<Tool[]>([]);
  const id=useId();
  useEffect(()=>{
    if(!props.revealResume)return;
    setVisited(previous=>previous.includes('resume')?previous:[...previous,'resume']);
    setActive('resume');
    props.onResumeRevealed();
  },[props.revealResume,props.onResumeRevealed]);
  function choose(tool:Tool){
    setVisited(previous=>previous.includes(tool)?previous:[...previous,tool]);
    setActive(previous=>previous===tool?undefined:tool);
  }
  return <section className="dashboard-workbench" aria-label="대시보드 작업 도구">
    <div className="dashboard-work-toolbar" role="group" aria-label="프로젝트 빠른 작업">
      {tools.map(({id:tool,title,Icon})=><button type="button" key={tool} className="dashboard-work-tool"
        aria-expanded={active===tool} aria-controls={visited.includes(tool)?id+'-'+tool:undefined} onClick={()=>choose(tool)}>
        <Icon size={15} aria-hidden="true"/><span>{title}</span><ChevronDown size={13} aria-hidden="true"/>
      </button>)}
    </div>
    {visited.map(tool=><div className="dashboard-work-body" id={id+'-'+tool} key={tool} hidden={active!==tool}>
      {tool==='followup' ? <DashboardFollowup {...props}/> : tool==='batch' ? <DashboardBatch {...props}/> :
        tool==='resume' ? <DashboardResume {...props}/> : <DashboardReview {...props}/>}
    </div>)}
  </section>;
}
