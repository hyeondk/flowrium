import {useState} from 'react';
import {ChevronRight, CircleHelp, FilePenLine, History, MessageCircle} from 'lucide-react';
import type {PortfolioCard} from '../shared/portfolio';
import type {ComposerDraft} from '../shared/security';
import type {Session} from '../shared/types';
import type {WorkflowState} from '../shared/workflow';
import {findLatestMessage} from './ChatMessageMedia';
import {messagePreview, safeLogPreview} from './message-content';

type Props = {
  cards: PortfolioCard[];
  sessions: Session[];
  drafts: Record<string, ComposerDraft>;
  decisionSessionIds: ReadonlySet<string>;
  workClose?: WorkflowState['workClose'];
  onOpen(session: Session): void;
};

const statuses = {
  pause: {label:'마감 기록', icon:History, priority:-1},
  decision: {label:'결정 필요', icon:CircleHelp, priority:0},
  draft: {label:'미전송 초안', icon:FilePenLine, priority:1},
  reply: {label:'최근 답변', icon:MessageCircle, priority:2},
};

type ResumeRow = {
  session: Session;
  project: string;
  status: keyof typeof statuses;
  time: number;
  reply?: string;
  detail?: string;
};
const closeStatuses = {running:'작성 중',completed:'작성 완료',failed:'작성 실패',interrupted:'작업 중단'};

function replyPreview(reply: string) {
  const text = safeLogPreview(messagePreview(reply,'assistant',500));
  if (text.length <= 100) return text;
  const boundary = text.lastIndexOf(' ',100);
  return `${text.slice(0,boundary > 0 ? boundary : 100)}…`;
}

export default function DashboardResume({cards,sessions,drafts,decisionSessionIds,workClose,onOpen}: Props) {
  const [reading,setReading]=useState(false);
  const [memo,setMemo]=useState<{batchId:string;text:string;failed?:boolean}>();
  const projects = new Map(cards.filter(card=>!card.details?.archivedAt).map(card=>[
    card.project.id, card.details?.kickoff?.name || card.project.name,
  ]));
  const recent = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows: ResumeRow[] = [];
  const closedSessions = new Map(workClose?.sessions.map(row=>[row.sessionId,row]));

  for (const session of sessions) {
    const project = projects.get(session.projectId);
    if (!project || session.scope || session.personalAssistant || session.generalAssistant) continue;
    const draft = drafts[`session:${session.id}`];
    const time = Date.parse(session.updatedAt) || 0;
    const closed = closedSessions.get(session.id);
    if (closed && workClose) {
      rows.push({session,project,status:'pause',time,detail:`${workClose.reason} / ${closeStatuses[closed.status]}`});
    } else if (decisionSessionIds.has(session.id)) {
      rows.push({session,project,status:'decision',time});
    } else if (draft && (/\S/.test(draft.text) || draft.attachments?.length)) {
      rows.push({session,project,status:'draft',time});
    } else {
      const latest = findLatestMessage(session.messages,message=>message.role!=='system' && !message.sourceOnly);
      const sentAt = latest ? Date.parse(latest.createdAt) : 0;
      if (latest?.role==='assistant' && sentAt>=recent) {
        rows.push({session,project,status:'reply',time:sentAt,reply:latest.text});
      }
    }
  }

  rows.sort((left,right)=>statuses[left.status].priority-statuses[right.status].priority || right.time-left.time);
  const shownRows = [...rows.filter(row=>row.status==='pause'),...rows.filter(row=>row.status!=='pause').slice(0,5)];
  const visibleMemo = workClose && memo?.batchId===workClose.id ? memo : undefined;
  async function toggleMemo(){
    if(visibleMemo){setMemo(undefined);return;}
    if(!window.flowrium||!workClose||reading)return;
    const batchId=workClose.id;
    setReading(true);
    try{
      const saved=await window.flowrium.workflowAction({action:'readWorkClose',batchId});
      if(saved)setMemo({batchId,text:saved.memo||'저장한 복귀 메모가 없습니다.'});
    }catch{setMemo({batchId,text:'복귀 메모를 읽지 못했습니다. 다시 확인해 주세요.',failed:true});}
    finally{setReading(false);}
  }

  return <section className="dashboard-work-resume" aria-label="이어갈 대화">
    <header className="dashboard-work-resume-header">
      <h2>이어갈 대화</h2>
      {workClose&&<button type="button" className="dashboard-work-button" aria-expanded={Boolean(visibleMemo)} disabled={reading} onClick={()=>void toggleMemo()}>
        <FilePenLine size={14} aria-hidden="true"/>{visibleMemo?'복귀 메모 닫기':'복귀 메모 보기'}
      </button>}
    </header>
    {visibleMemo&&<p className="dashboard-work-resume-memo" role={visibleMemo.failed?'alert':'status'}>{visibleMemo.text}</p>}
    {rows.length ? <ul className="dashboard-work-resume-list">
      {shownRows.map(({session,project,status,reply,detail})=>{
        const {label,icon:Icon} = statuses[status];
        return <li key={session.id}>
          <button type="button" className="dashboard-work-resume-row" data-status={status} onClick={()=>onOpen(session)}>
            <span className="dashboard-work-resume-text">
              <strong>{session.title}</strong>
              <span className="dashboard-work-resume-project">{project}</span>
              {detail && <span className="dashboard-work-resume-preview">{detail}</span>}
              {reply && <span className="dashboard-work-resume-preview">{replyPreview(reply)}</span>}
            </span>
            <span className="dashboard-work-resume-status"><Icon size={14} aria-hidden="true"/>{label}</span>
            <ChevronRight size={16} aria-hidden="true"/>
          </button>
        </li>;
      })}
    </ul> : <p className="dashboard-work-resume-empty">{projects.size ? '결정할 질문, 미전송 초안, 최근 7일 답변이 없습니다.' : '프로젝트를 연결하면 이어갈 대화를 볼 수 있습니다.'}</p>}
  </section>;
}
