import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ClipboardList, Coffee, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { AnimatedCheckbox } from './ui-motion';
import type { Project, Session, Model, Effort } from '../shared/types';
import { workKinds, type WorkInput } from '../shared/workbench';
import { effortLabels, effortOptions } from '../shared/model-options';
import { errorText, localDay } from './ProjectPortfolio';
import './portfolio-reports.css';

type Props = {
  kind: 'weekly' | 'pause'; projects: Project[]; sessions: Session[];
  onOpen(session: Session): void;
  onStart(session: Session, request: string, options?: { model?: string; effort?: Effort }): Promise<void>;
  onCreateProject(): void; onClose?(): void; authenticated: boolean;
};
export default function PortfolioReports({ kind, projects, sessions, onOpen, onStart, onCreateProject, onClose, authenticated }: Props) {
  const weekly = kind === 'weekly', title = workKinds[kind].label, today = new Date(), week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const friday = new Date(week); friday.setDate(week.getDate() + 4);
  const recent = new Set(sessions.filter(s => Date.now() - Date.parse(s.updatedAt) <= 12 * 60 * 60 * 1000).map(s => s.projectId));
  const [tab, setTab] = useState<'create' | 'history'>('create');
  const [picked, setPicked] = useState<string[]>(() => weekly ? [] : projects.filter(p => recent.has(p.id)).slice(0, 64).map(p => p.id));
  const [destination, setDestination] = useState('');
  const [from, setFrom] = useState(localDay(week.toISOString())), [to, setTo] = useState(localDay(friday.toISOString())), [period, setPeriod] = useState('this');
  const [name, setName] = useState(title + ' / ' + localDay(today.toISOString())), [brief, setBrief] = useState(''), [audience, setAudience] = useState(''), [reason, setReason] = useState('퇴근');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState<Session[]>([]), [success, setSuccess] = useState(false);
  const [models, setModels] = useState<Model[]>([]), [model, setModel] = useState(''), [effort, setEffort] = useState<Effort | ''>('');
  const [modelError, setModelError] = useState(''), [modelLoading, setModelLoading] = useState(true), [accountReady, setAccountReady] = useState(false);
  const alive = useRef(false), submitting = useRef(false), pending = useRef(new Map<string, Session>());
  const selectedModel = models.find(m => m.id === model) || (!model ? models.find(m => m.isDefault) : undefined);
  const efforts = effortOptions(selectedModel);
  const loadModels = useCallback(async () => {
    if (!window.flowrium) { setModelLoading(false); setModelError('데스크톱 앱에서 ChatGPT 계정을 연결하세요.'); return; }
    setModelLoading(true); setModelError('');
    try {
      const result = await window.flowrium.connect(); if (!alive.current) return;
      setModels(result.models); setAccountReady(result.status.authenticated);
      setModelError(result.status.authenticated ? '' : 'ChatGPT 계정을 연결한 뒤 AI 작성을 시작하세요.');
      setModel(current => result.models.some(m => m.id === current) ? current : '');
    } catch (error) { if (alive.current) { setAccountReady(false); setModelError(errorText(error)); } }
    finally { if (alive.current) setModelLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void loadModels(); return () => { alive.current = false; }; }, [loadModels]);
  useEffect(() => { setEffort(value => value && !efforts.some(row => row.reasoningEffort === value) ? '' : value); }, [model, models]);
  const past = sessions.filter(s => s.workflow?.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const targets = projects.filter(p => picked.includes(p.id)), output = targets.find(p => p.id === destination) || targets[0];
  function choosePeriod(value: string) {
    setPeriod(value); if (value === 'custom') return;
    const start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (value === 'last' ? 7 : 0));
    const end = new Date(start); end.setDate(start.getDate() + 4); setFrom(localDay(start.toISOString())); setTo(localDay(end.toISOString()));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!window.flowrium || submitting.current || success || !output || !targets.length) return;
    if (!authenticated || !accountReady) { setError('ChatGPT 계정을 연결한 뒤 AI 작성을 시작하세요.'); return; }
    if (model && !models.some(row => row.id === model)) { setError('현재 계정에서 사용할 수 있는 모델을 다시 선택하세요.'); return; }
    if (effort && !efforts.some(row => row.reasoningEffort === effort)) { setError('선택한 모델의 추론 강도를 다시 선택하세요.'); return; }
    submitting.current = true; setBusy(true); setError('');
    const finished = new Set(created.map(s => s.projectId)), newEntries: Session[] = [], issues: string[] = [];
    for (const project of weekly ? [output] : targets) {
      if (finished.has(project.id)) continue;
      const seed: WorkInput = {
        projectId: project.id, kind, title: name.trim(), role: workKinds[kind].role,
        brief: weekly ? brief : [reason, brief].filter(Boolean).join(' / '), audience, from: weekly ? from : '', to: weekly ? to : '',
        ...(model && { model }), ...(effort && { effort }), ...(weekly && { reportProjects: targets.map(item => item.id) }),
      };
      try {
        const record = pending.current.get(project.id) || await window.flowrium.startWork(seed); pending.current.set(project.id, record);
        await onStart(record, [name, seed.brief, '선택한 프로젝트 기록을 바탕으로 ' + title + ' 업무를 실행해 주세요.'].filter(Boolean).join('\n\n'), { model: model || undefined, effort: effort || undefined });
        pending.current.delete(project.id); newEntries.push(record);
      } catch (error) { issues.push(project.name + ' / ' + errorText(error)); }
    }
    if (alive.current) {
      setCreated(current => [...current, ...newEntries]); setError(issues.join('\n'));
      const all = [...created, ...newEntries];
      if (all.length === (weekly ? 1 : targets.length)) { setSuccess(true); if (weekly && !issues.length) onOpen(all[0]); }
      setBusy(false);
    }
    submitting.current = false;
  }
  const canStart = authenticated && accountReady && !modelLoading && !busy && !success && targets.length > 0 && name.trim();
  const close = <button type="button" className="report-close" aria-label={title + ' 닫기'} onClick={onClose} disabled={busy}><X size={18}/></button>;
  return <div className="portfolio-report-dialog" aria-busy={busy}>
    <header className="report-dialog-heading"><div className="ui-title-stagger"><h1>{title}</h1><p>전체 프로젝트 / ChatGPT AI 작성</p></div>{onClose && close}</header>
    <nav className="report-dialog-tabs" aria-label={title + ' 화면'}><button type="button" aria-current={tab === 'create' ? 'page' : undefined} onClick={() => setTab('create')}>{weekly ? '새로 쓰기' : 'AI 마감 기록'}</button><button type="button" aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>{weekly ? '작성된 보고' : '이전 마감 기록'}</button></nav>
    {tab === 'history' ? <><div className="report-dialog-body report-history">{past.map(session => <button key={session.id} className="report-history-row" onClick={() => onOpen(session)}><BookOpen size={17}/><span><strong>{session.title}</strong><small>{projects.find(p => p.id === session.projectId)?.name || '보관한 프로젝트'}</small></span><time>{localDay(session.updatedAt)}</time><ArrowRight size={15}/></button>)}{!past.length && <p className="report-empty">아직 작성한 기록이 없습니다.</p>}</div><footer className="report-dialog-footer"><div className="report-actions">{onClose && <button type="button" onClick={onClose}>닫기</button>}</div></footer></> : !projects.length ? <><div className="report-dialog-body report-empty"><h2>프로젝트를 먼저 추가하세요</h2><p>보고와 마감 기록은 선택한 프로젝트 폴더에 저장합니다.</p></div><footer className="report-dialog-footer"><div className="report-actions">{onClose && <button type="button" onClick={onClose}>취소</button>}<button type="button" className="report-primary" onClick={onCreateProject}>프로젝트 추가</button></div></footer></> : <form className="report-dialog-form" onSubmit={submit}>
      <div className="report-dialog-body"><p className="report-intro">{weekly ? 'ChatGPT가 완료 업무 / 커밋 / 변경 요청을 확인해 실제 한 일로 보고서를 작성합니다.' : 'ChatGPT가 최근 업무와 저장소 상태를 확인해 중단 지점과 복귀 순서를 프로젝트별로 작성합니다.'}</p>
        <fieldset disabled={busy || success || created.length > 0 || pending.current.size > 0}>
          <legend>{weekly ? '보고할 프로젝트' : '마감할 프로젝트'} / {targets.length}개 선택</legend>
          <div className="report-actions report-project-actions"><button type="button" disabled={created.length > 0 || pending.current.size > 0} onClick={() => setPicked(projects.slice(0, 64).map(p => p.id))}>전체 선택</button>{!weekly && <button type="button" disabled={created.length > 0 || pending.current.size > 0} onClick={() => setPicked(projects.filter(p => recent.has(p.id)).slice(0, 64).map(p => p.id))}>최근 12시간 작업 선택</button>}<button type="button" disabled={!picked.length || created.length > 0 || pending.current.size > 0} onClick={() => setPicked([])}>선택 해제</button></div>
          <div className="report-targets">{projects.map(project => <label key={project.id}><AnimatedCheckbox checked={picked.includes(project.id)} disabled={created.length > 0 || pending.current.size > 0 || (!picked.includes(project.id) && picked.length >= 64)} onChange={event => setPicked(current => event.target.checked ? [...current, project.id] : current.filter(id => id !== project.id))}/><span>{project.name}</span></label>)}</div>
          {weekly && targets.length > 1 && <label>보고서를 저장할 프로젝트<select value={output.id} onChange={event => setDestination(event.target.value)}>{targets.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          {weekly ? <div className="report-field"><span>기간</span><div className="report-segments" role="group" aria-label="보고 기간 선택">{[['this', '이번 주'], ['last', '지난 주'], ['custom', '직접 정하기']].map(([value, text]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => choosePeriod(value)}>{text}</button>)}</div>{period === 'custom' && <div className="report-grid"><label>조회 시작일<input type="date" required value={from} max={to} onChange={event => setFrom(event.target.value)}/></label><label>조회 종료일<input type="date" required value={to} min={from} onChange={event => setTo(event.target.value)}/></label></div>}</div> : <div className="report-field"><span>마감 사유</span><div className="report-segments" role="group" aria-label="마감 사유">{['점심', '퇴근', '회의', '기타'].map(value => <button type="button" key={value} aria-pressed={reason === value} onClick={() => setReason(value)}>{value}</button>)}</div></div>}
          <label>{weekly ? '덧붙일 말 선택 사항' : '복귀할 때 참고할 메모 선택 사항'}<textarea maxLength={11500} rows={2} placeholder={weekly ? '보고서에 반영할 요청을 입력하세요.' : '돌아와서 꼭 기억해야 할 내용을 입력하세요.'} value={brief} onChange={event => setBrief(event.target.value)}/></label>
          <div className="report-grid report-model-fields"><label>사용할 ChatGPT 모델<select aria-label="보고서 AI 모델" value={model} disabled={modelLoading} onChange={event => { setModel(event.target.value); setEffort(''); }}><option value="">계정 기본 모델</option>{models.map(item => <option key={item.id} value={item.id}>{item.displayName || item.id}</option>)}</select></label><label>추론 강도<select aria-label="보고서 AI 추론 강도" value={effort} disabled={modelLoading} onChange={event => setEffort(event.target.value as Effort | '')}><option value="">계정 기본 강도</option>{efforts.map(row => <option key={row.reasoningEffort} value={row.reasoningEffort}>{effortLabels[row.reasoningEffort]}</option>)}</select></label></div>
          {modelLoading && <p className="report-model-status" role="status"><LoaderCircle className="spin" size={15}/>계정에서 사용 가능한 모델을 확인하고 있습니다.</p>}
          {modelError && <div className="report-model-status" role="status"><p>{modelError}</p><button type="button" onClick={() => void loadModels()}><RefreshCw size={14}/>연결 다시 확인</button></div>}
          <details className="report-more"><summary>제목과 {weekly ? '보고 형식' : '인계 대상'} 설정</summary><label>{weekly ? '보고서 제목' : '마감 기록 제목'}<input required maxLength={160} value={name} onChange={event => setName(event.target.value)}/></label><label>{weekly ? '보고 대상 또는 형식' : '인계받는 사람'}<input maxLength={500} value={audience} onChange={event => setAudience(event.target.value)}/></label></details>
        </fieldset>
        {error && <p role="alert" className="report-error">{error}{(created.length > 0 || pending.current.size > 0) && <span> 시작한 대화는 유지하고 실패한 프로젝트만 다시 시도합니다.</span>}</p>}
        {created.length > 0 && <section className="report-results"><h2><Check size={16}/>{success ? 'AI 작업을 시작했습니다' : '시작한 AI 대화'}</h2>{created.map(session => <button type="button" key={session.id} className="report-history-row" onClick={() => onOpen(session)}><span>{projects.find(project => project.id === session.projectId)?.name} / {session.title}</span><ArrowRight size={15}/></button>)}</section>}
      </div>
      <footer className="report-dialog-footer"><p>시작하면 오른쪽 대화함에서 AI 작업을 이어갑니다.</p><div className="report-actions">{onClose && <button type="button" disabled={busy} onClick={onClose}>{success ? '닫기' : '취소'}</button>}<button type="submit" className="report-primary" disabled={!canStart}>{busy ? <LoaderCircle size={16} className="spin"/> : weekly ? <ClipboardList size={16}/> : <Coffee size={16}/>} {busy ? '처리 중…' : success ? '시작 완료' : created.length || pending.current.size ? '실패한 프로젝트 다시 시작' : weekly ? 'ChatGPT로 보고서 작성' : 'ChatGPT로 업무 마감 작성'}</button></div></footer>
    </form>}
  </div>;
}
