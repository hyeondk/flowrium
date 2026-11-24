import { ArrowLeft, ArrowRight, ClipboardList, FolderOpen, Send } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PortfolioCard } from '../shared/portfolio';
import type { Session } from '../shared/types';
import ChoicePicker from './ChoicePicker';
import { AnimatedCheckbox } from './ui-motion';

const projectLimit = 3;
const statusLabels = {
  ready: '검토 가능',
  pending: '순서 대기',
  sending: '전송 중',
  queued: '대화에서 전송 대기',
  sent: '전송됨',
  failed: '전송 실패',
  cancelled: '전송 취소',
} as const;

type ReviewStatus = Exclude<keyof typeof statusLabels, 'cancelled'>;

interface PreparedRow {
  projectId: string;
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  submissionId: string;
  commonText: string;
  text: string;
  selected: boolean;
  started?: boolean;
  status: ReviewStatus;
  queueId?: string;
  error?: string;
}

interface Props {
  cards: PortfolioCard[];
  sessions: Session[];
  onSend(session: Session, text: string, submissionId: string): Promise<void | { queued?: boolean; queueId?: string }>;
}

export default function DashboardBatch({ cards, sessions, onSend }: Props) {
  const commonId = useId();
  const [common, setCommon] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<PreparedRow[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const instruction = useRef<HTMLTextAreaElement>(null);

  const availableSessions = new Map<string, Session[]>();
  for (const session of sessions) {
    if (session.scope || session.personalAssistant || session.generalAssistant || session.workflow?.status === 'done') continue;
    const group = availableSessions.get(session.projectId);
    if (group) group.push(session);
    else availableSessions.set(session.projectId, [session]);
  }
  const targets = cards.flatMap(({ project, details }) => {
    const choices = availableSessions.get(project.id);
    if (project.conversationScope || details?.archivedAt || ['중단', '완료'].includes(details?.kickoff?.phase ?? '') || !choices?.length) return [];
    return [{ id: project.id, name: details?.kickoff?.name || project.name, choices }];
  });
  const targetsById = new Map(targets.map(target => [target.id, target]));
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const dispatch = useRef({ targetsById, onSend });
  useLayoutEffect(() => { dispatch.current = { targetsById, onSend }; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (reviewing) reviewHeading.current?.focus({ preventScroll: true });
  }, [reviewing]);

  const pickedTargets = targets.filter(target => Object.hasOwn(selection, target.id));
  const pickedCount = pickedTargets.length;
  const canReview = !!common.trim() && pickedCount > 0 && pickedTargets.every(target => target.choices.some(session => session.id === selection[target.id]));
  const attempted = rows.some(row => row.started);
  const selectedRows = rows.filter(row => row.status === 'ready' && row.selected && row.text.trim() &&
    targetsById.get(row.projectId)?.choices.some(session => session.id === row.sessionId));

  function pickProject(id: string, checked: boolean) {
    const target = targetsById.get(id);
    if (!target) return;
    setSelection(current => {
      const next = Object.fromEntries(Object.entries(current).filter(([projectId]) => targetsById.has(projectId)));
      if (checked && Object.keys(next).length < projectLimit) next[id] = target.choices.length === 1 ? target.choices[0].id : '';
      if (!checked) delete next[id];
      return next;
    });
  }

  function prepare() {
    if (!canReview || attempted || sending.current) return;
    setRows(pickedTargets.flatMap(target => {
      const session = target.choices.find(choice => choice.id === selection[target.id]);
      if (!session) return [];
      const prior = rows.find(row => row.projectId === target.id && row.sessionId === session.id);
      return [{
        projectId: target.id, projectName: target.name, sessionId: session.id, sessionTitle: session.title,
        submissionId: prior?.submissionId ?? crypto.randomUUID(),
        commonText: common, text: prior && prior.text !== prior.commonText ? prior.text : common,
        selected: prior?.selected ?? false, status: 'ready' as const,
      }];
    }));
    setReviewing(true);
  }

  function updateRow(sessionId: string, change: Partial<PreparedRow>) {
    setRows(previous => previous.map(row => row.sessionId === sessionId ? { ...row, ...change } : row));
  }

  async function sendPicked() {
    if (sending.current || !selectedRows.length) return;
    sending.current = true;
    setBusy(true);
    const selected = new Set(selectedRows.map(row => row.sessionId));
    setRows(previous => previous.map(row => selected.has(row.sessionId) ? { ...row, started: true, status: 'pending' } : row));
    try {
      for (const row of selectedRows) {
        if (!mounted.current) break;
        const current = dispatch.current;
        const session = current.targetsById.get(row.projectId)?.choices.find(choice => choice.id === row.sessionId);
        if (!session) {
          updateRow(row.sessionId, { status: 'failed', error: '대화가 바뀌었습니다. 전송 대상을 다시 확인해 주세요.' });
          continue;
        }
        updateRow(row.sessionId, { status: 'sending' });
        try {
          const result = await current.onSend(session, row.text, row.submissionId);
          if (mounted.current) updateRow(row.sessionId, {
            status: result?.queued ? 'queued' : 'sent', queueId: result?.queued ? result.queueId ?? row.submissionId : undefined,
          });
        } catch (error) {
          if (mounted.current) updateRow(row.sessionId, {
            status: 'failed', error: error instanceof Error && error.message ? error.message : '대화에 지시를 보내지 못했습니다.',
          });
        }
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function startNew() {
    if (sending.current) return;
    setCommon('');
    setSelection({});
    setRows([]);
    setReviewing(false);
  }

  function rowStatus(row: PreparedRow): keyof typeof statusLabels {
    if (row.status !== 'queued' || !row.queueId) return row.status;
    const session = sessionsById.get(row.sessionId);
    if (session?.messages.some(message => message.id === row.queueId && message.role === 'user')) return 'sent';
    const queued = session?.queuedMessages?.find(message => message.id === row.queueId);
    if (queued?.status === 'sent' || queued?.status === 'cancelled' || queued?.status === 'sending') return queued.status;
    return row.status;
  }

  return <section className="dashboard-work-batch" aria-label="프로젝트 일괄 지시">
    <header className="dashboard-work-heading">
      <h2><ClipboardList size={18} aria-hidden="true" /> 프로젝트 일괄 지시</h2>
      <p>공통 지시를 작성하고 프로젝트별로 검토한 초안을 기존 대화에 보냅니다.</p>
    </header>
    {!reviewing && !targets.length ? <div className="dashboard-work-empty">
      <FolderOpen size={22} aria-hidden="true" />
      <p>보낼 수 있는 프로젝트 대화가 없습니다. 진행할 프로젝트를 열고 대화를 시작해 주세요.</p>
    </div> : reviewing ? <section className="dashboard-work-section" aria-busy={busy}>
      <h3 ref={reviewHeading} tabIndex={-1}>프로젝트별 초안 검토</h3>
      <p>내용을 필요한 만큼 편집하고 보낼 초안을 선택하세요.</p>
      <div className="dashboard-work-review-list">
        {rows.map(row => {
          const target = targetsById.get(row.projectId);
          const session = target?.choices.find(choice => choice.id === row.sessionId);
          const projectName = target?.name ?? row.projectName;
          const sessionTitle = session?.title ?? row.sessionTitle;
          const status = rowStatus(row);
          const editable = !busy && status === 'ready' && !!session;
          const draftId = `${commonId}-${row.sessionId}`;
          return <article className="dashboard-work-review-row" key={row.sessionId}>
            <header className="dashboard-work-row-heading">
              <label>
                <AnimatedCheckbox checked={row.selected} disabled={!editable} aria-label={`${projectName} 초안 선택`}
                  onChange={event => updateRow(row.sessionId, { selected: event.target.checked })} />
                <span><strong>{projectName}</strong><small>{sessionTitle}</small></span>
              </label>
              <span className="dashboard-work-status" data-status={status} aria-live="polite">
                {status === 'ready' && row.started ? '재전송 준비' : statusLabels[status]}
              </span>
            </header>
            <label htmlFor={draftId} className="dashboard-work-field">
              <span>{projectName}에 보낼 내용</span>
              <textarea id={draftId} rows={2} value={row.text} readOnly={!editable || row.started}
                onChange={event => updateRow(row.sessionId, { text: event.target.value })} />
            </label>
            {row.error && <p className="dashboard-work-error" role="alert">{row.error}</p>}
            {status === 'failed' && session && <div className="dashboard-work-row-actions">
              <button type="button" disabled={busy} onClick={() => updateRow(row.sessionId, { status: 'ready', selected: true, error: undefined })}>
                재전송 선택
              </button>
            </div>}
            {!row.error && status === 'ready' && !session && <p className="dashboard-work-error">전송할 대화를 다시 선택해 주세요.</p>}
          </article>;
        })}
      </div>
      <footer className="dashboard-work-footer">
        <div className="dashboard-work-row-actions">
          {!attempted && <button type="button" onClick={() => { setReviewing(false); requestAnimationFrame(() => instruction.current?.focus()); }}>
            <ArrowLeft size={15} aria-hidden="true" /> 대상과 공통 지시 수정
          </button>}
          {attempted && <button type="button" onClick={startNew} disabled={busy}>새 묶음 작성</button>}
        </div>
        <button type="button" className="dashboard-work-primary" onClick={() => void sendPicked()} disabled={busy || !selectedRows.length}>
          <Send size={15} aria-hidden="true" /> {selectedRows.length ? `선택한 ${selectedRows.length}개 초안 전송` : '선택한 초안 전송'}
        </button>
      </footer>
    </section> : <form className="dashboard-work-section" onSubmit={event => { event.preventDefault(); prepare(); }}>
      <label className="dashboard-work-field" htmlFor={commonId}>
        <span>공통 지시</span>
        <textarea id={commonId} ref={instruction} rows={2} value={common} onChange={event => setCommon(event.target.value)}
          placeholder="이번 주 남은 과업과 먼저 확인할 결정을 알려줘." />
      </label>
      <fieldset className="dashboard-work-list">
        <legend>대상 프로젝트</legend>
        <p>최대 {projectLimit}개를 고르고 각 프로젝트에서 보낼 대화를 선택하세요.</p>
        {targets.map(target => {
          const chosen = Object.hasOwn(selection, target.id);
          const currentChoice = target.choices.some(session => session.id === selection[target.id]) ? selection[target.id] : '';
          return <div className="dashboard-work-target" key={target.id}>
            <label>
              <AnimatedCheckbox checked={chosen} disabled={!chosen && pickedCount >= projectLimit}
                onChange={event => pickProject(target.id, event.target.checked)} />
              <span>{target.name}</span>
            </label>
            {chosen && <ChoicePicker label={`${target.name} 대화 선택`} value={currentChoice} placeholder="대화 선택"
              options={target.choices.map(session => ({ value: session.id, label: session.title }))}
              onChange={value => setSelection(previous => ({ ...previous, [target.id]: value }))} />}
          </div>;
        })}
      </fieldset>
      <footer className="dashboard-work-footer">
        <span role="status">프로젝트 {pickedCount}개 선택</span>
        <button type="submit" className="dashboard-work-primary" disabled={!canReview}>초안 검토 <ArrowRight size={15} aria-hidden="true" /></button>
      </footer>
    </form>}
  </section>;
}
