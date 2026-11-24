import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ClipboardCheck, FileText, FolderOpen, ListTodo, MessageCircleQuestion, Target } from 'lucide-react';
import type { PortfolioCard } from '../shared/portfolio';
import type { Session } from '../shared/types';
import { statusLabels, type WorkOverview } from '../shared/workbench';
import ChoicePicker from './ChoicePicker';

type Props = {
  cards: PortfolioCard[];
  sessions: Session[];
  decisionSessionIds: ReadonlySet<string>;
  onDraft(projectId: string, text: string, session?: Session): Promise<void>;
  onProject(projectId: string): void;
};
type Row = { id: string; title: string; detail?: string };

function displayName(card: PortfolioCard) {
  return card.details?.kickoff?.name || card.project.name;
}

function ReviewCard({ title, icon, rows, empty, pending = false, children }: {
  title: string; icon: ReactNode; rows: Row[]; empty: string; pending?: boolean; children?: ReactNode;
}) {
  const visible = rows.slice(0, 5);
  return <section className="dashboard-work-card">
    <header>
      <h3>{icon}{title}</h3>
      {!pending && rows.length > 0 && <span className="dashboard-work-count">{rows.length}</span>}
    </header>
    {visible.length > 0
      ? <ul className="dashboard-work-list">
          {visible.map(row => <li key={row.id}><strong>{row.title}</strong>{row.detail && <small>{row.detail}</small>}</li>)}
        </ul>
      : <p className="dashboard-work-empty" role={pending ? 'status' : undefined}>{empty}</p>}
    {rows.length > visible.length && <small className="dashboard-work-more">외 {rows.length - visible.length}건</small>}
    {children}
  </section>;
}

export default function DashboardReview({ cards, sessions, decisionSessionIds, onDraft, onProject }: Props) {
  const projects = cards.filter(card =>
    !card.details?.archivedAt && !['중단', '완료'].includes(card.details?.kickoff?.phase || ''));
  const [chosenId, setChosenId] = useState('');
  const [workbench, setWorkbench] = useState<{ projectId: string; result?: WorkOverview }>();
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const selected = projects.find(card => card.project.id === chosenId) || projects[0];
  const selectedId = selected?.project.id;
  const projectChats = sessions.filter(session => session.projectId === selectedId && !session.scope &&
    !session.personalAssistant && !session.generalAssistant);
  const latestUpdate = projectChats.reduce((latest, session) => session.updatedAt > latest ? session.updatedAt : latest, '');

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    async function readArtifacts(projectId: string) {
      try {
        const result = await window.flowrium?.readWorkbench(projectId);
        if (current) setWorkbench({ projectId, result });
      } catch {
        if (current) setWorkbench({ projectId });
      }
    }
    void readArtifacts(selectedId);
    return () => { current = false; };
  }, [selectedId, latestUpdate]);

  if (!selected) return <section className="dashboard-work-review">
    <header className="dashboard-work-header"><h2><ClipboardCheck size={20} aria-hidden />프로젝트 검토</h2></header>
    <p className="dashboard-work-empty">진행 중인 프로젝트가 없습니다.</p>
  </section>;

  const details = selected.details;
  const goal = details?.goal || details?.kickoff?.goal;
  const goals: Row[] = (details?.periodGoals || []).filter(row => !row.done && !row.carriedTo).map(row => ({
    id: row.id, title: row.text,
    detail: [row.period === 'week' ? '주간 목표' : '월간 목표',
      row.target !== undefined ? (row.current === undefined ? `목표 ${row.target}` : `${row.current} / ${row.target}`) : '',
      row.due || ''].filter(Boolean).join(' / '),
  }));
  if (goal) goals.unshift({ id: 'project-goal', title: goal, detail: details?.dueDate || details?.kickoff?.dueDate });
  const tasks: Row[] = (details?.checklist || []).filter(row => !row.done).map(row => ({
    id: row.id, title: row.text, detail: '프로젝트 할 일',
  }));
  const decisions: Row[] = projectChats.filter(session => decisionSessionIds.has(session.id)).map(session => ({
    id: session.id, title: session.title,
  }));
  const activeWork = projectChats.filter(session => session.workflow && session.workflow.status !== 'done');
  for (const session of activeWork) {
    const workflow = session.workflow!;
    const remaining = workflow.checklist.filter(item => !item.done);
    if (remaining.length) tasks.push(...remaining.map(item => ({
      id: `${session.id}-${item.id}`, title: item.text, detail: session.title,
    })));
    else tasks.push({ id: session.id, title: session.title, detail: statusLabels[workflow.status] });
  }

  const artifactResult = workbench?.projectId === selectedId ? workbench : undefined;
  const overview = artifactResult?.result;
  const artifacts: Row[] = (overview?.artifacts || []).map(artifact => {
    const parts=artifact.path.split('/'), filename=parts.at(-1) || artifact.path;
    const generated=/^\d{4}-\d{2}-\d{2}-[\da-f-]{36}\.([a-z]+)$/i.exec(filename);
    const title=generated ? parts.at(-2)?.replace(/--[\da-f-]{36}$/i,'') : undefined;
    return {id:artifact.path,title:title || filename,detail:[artifact.modifiedAt.slice(0,10),generated?.[1].toUpperCase()].filter(Boolean).join(' / ')};
  });
  const storedSessions = new Set(overview?.artifacts.map(artifact => artifact.sessionId).filter(Boolean));
  const withoutArtifacts = overview && !overview.truncated
    ? projectChats.filter(session => session.workflow?.status === 'done' && !storedSessions.has(session.id))
    : [];
  const artifactNotice = !artifactResult ? '산출물을 확인하고 있습니다.'
    : !overview ? '산출물 목록을 읽지 못했습니다.'
    : overview.truncated ? '검색 한도 내에서 산출물을 찾지 못했습니다.' : '저장된 산출물이 없습니다.';
  const cover = (rows: Row[]) => rows.slice(0, 20).map(({ title, detail }) => detail ? { title, detail } : { title });

  async function openDraft() {
    if (drafting || !selectedId || !selected) return;
    setDrafting(true);
    setDraftError('');
    try {
      const facts = {
        프로젝트: displayName(selected),
        '기록 상태': details ? '프로젝트 정보 확인됨' : '프로젝트 정보를 읽지 못함',
        기한: details?.dueDate || details?.kickoff?.dueDate || undefined,
        목표: cover(goals),
        '미완료 업무': cover(tasks),
        '결정이 필요한 대화': cover(decisions),
        '산출물 목록 상태': !overview ? '확인하지 못함' : overview.truncated ? '검색 한도로 일부만 확인함' : '확인함',
        '저장된 산출물': overview?.artifacts.slice(0, 20).map(file => file.path),
        '연결된 산출물을 찾지 못한 완료 업무': overview && !overview.truncated
          ? withoutArtifacts.slice(0, 20).map(session => session.title) : undefined,
      };
      const instruction = '아래 기록을 바탕으로 프로젝트를 검토해줘. 목표와 미완료 업무를 대조하고, 필요한 결정과 저장된 산출물을 정리해줘. 기록에 없는 항목은 미확인으로 표시해줘.';
      await onDraft(selectedId, instruction + '\n\n' + JSON.stringify(facts, null, 2));
    } catch {
      setDraftError('검토 초안을 열지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setDrafting(false);
    }
  }

  return <section className="dashboard-work-review" aria-label="프로젝트 검토">
    <header className="dashboard-work-header">
      <h2><ClipboardCheck size={20} aria-hidden />프로젝트 검토</h2>
      <ChoicePicker label="검토할 프로젝트" value={selected.project.id} disabled={drafting}
        options={projects.map(card => ({ value: card.project.id, label: displayName(card) }))}
        onChange={value => { setChosenId(value); setDraftError(''); }}/>
    </header>
    <div className="dashboard-work-grid">
      <ReviewCard title="목표와 기한" icon={<Target size={17} aria-hidden />} rows={goals}
        empty={details ? '등록된 목표가 없습니다.' : '프로젝트 정보를 읽지 못했습니다.'}/>
      <ReviewCard title="미완료 업무" icon={<ListTodo size={17} aria-hidden />} rows={tasks}
        empty={details ? '미완료 업무가 없습니다.' : '확인된 미완료 업무가 없습니다.'}/>
      <ReviewCard title="필요한 결정" icon={<MessageCircleQuestion size={17} aria-hidden />} rows={decisions}
        empty="결정이 필요한 대화가 없습니다."/>
      <ReviewCard title="저장된 산출물" icon={<FileText size={17} aria-hidden />} rows={artifacts}
        empty={artifactNotice} pending={!artifactResult}>
        {withoutArtifacts.length > 0 && <div className="dashboard-work-missing">
          <strong>연결된 산출물을 찾지 못한 완료 업무 {withoutArtifacts.length}건</strong>
          <p>{withoutArtifacts.slice(0, 2).map(session => session.title).join(' / ')}
            {withoutArtifacts.length > 2 && ` 외 ${withoutArtifacts.length - 2}건`}</p>
        </div>}
        {overview?.truncated && artifacts.length > 0 && <p className="dashboard-work-missing">검색 한도 내 산출물입니다.</p>}
      </ReviewCard>
    </div>
    <div className="dashboard-work-actions">
      <button type="button" className="dashboard-work-open" onClick={() => onProject(selected.project.id)}>
        <FolderOpen size={16} aria-hidden />프로젝트 열기
      </button>
      <button type="button" className="dashboard-work-draft" onClick={() => void openDraft()} disabled={drafting || !artifactResult}>
        <ClipboardCheck size={16} aria-hidden />검토 초안 작성<ArrowRight size={15} aria-hidden />
      </button>
    </div>
    {draftError && <p className="dashboard-work-error" role="alert">{draftError}</p>}
  </section>;
}
