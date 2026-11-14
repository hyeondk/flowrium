import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Link, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../shared/types';
import type { ProjectDetails, ProjectShortcut } from '../shared/project-details';
import './project-shortcuts.css';

const names = { operation: '운영 주소', local: '로컬 폴더', drive: 'Drive 폴더' };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export default function ProjectShortcuts({ project, data, editable = false, onChange, onManage }: {
  project: Project; data: ProjectDetails; editable?: boolean;
  onChange(data: ProjectDetails): void; onManage?(): void;
}) {
  const [rows, setRows] = useState<ProjectShortcut[]>(data.shortcuts || []);
  const [kind, setKind] = useState<'operation' | 'drive'>('operation');
  const [label, setLabel] = useState(''), [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { setRows(data.shortcuts || []); }, [project.id, data.revision]);
  useEffect(() => { setError(''); setNotice(''); }, [project.id]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  async function save(values: ProjectShortcut[]) {
    onChange(await window.flowrium!.projectShortcutAction(project.id, { action: 'save', revision: data.revision, shortcuts: values }));
    setNotice('프로젝트 바로가기를 저장했습니다.');
  }
  async function choose(replace?: ProjectShortcut) {
    const selected = await window.flowrium!.projectShortcutAction(project.id, { action: 'chooseLocal' });
    if (selected) await save(replace ? rows.map(row => row.id === replace.id ? { ...selected, label: replace.label } : row) : [...rows, selected]);
  }
  return <section className="pf-panel project-shortcuts" aria-label={editable ? '프로젝트 바로가기 설정' : '프로젝트 바로가기'}>
    <div className="pf-section-header"><h2>프로젝트 바로가기</h2>{!editable && onManage && <button onClick={onManage}>바로가기 관리</button>}</div>
    <p className="pf-muted">프로젝트에 쓰는 운영 주소와 폴더를 한곳에서 엽니다.</p>
    {!rows.length && <p className="pf-empty">아직 저장한 바로가기가 없습니다.</p>}
    <div className="project-shortcut-list">{rows.map((row, index) => <article key={row.id}>
      <div className="project-shortcut-summary">{row.kind === 'local' ? <FolderOpen size={17}/> : row.kind === 'drive' ? <Link size={17}/> : <ExternalLink size={17}/>}
        {editable ? <label><span className="sr-only">바로가기 이름 {index + 1}</span><input aria-label={'바로가기 이름 ' + (index + 1)} maxLength={100} value={row.label} disabled={busy} onChange={event => setRows(values => values.map(item => item.id === row.id ? { ...item, label: event.target.value } : item))}/></label> : <strong>{row.label}</strong>}
        <span className="project-shortcut-kind">{names[row.kind]}</span>
      </div>
      <p className="project-shortcut-target">{row.kind === 'local' && row.localMode === 'relative' ? '프로젝트 기준 / ' : ''}{row.target}</p>
      {row.disabled && <p className="pf-muted">다른 기기에서 가져온 외부 폴더입니다. 이 기기의 폴더를 다시 선택해 주세요.</p>}
      <div className="pf-actions">{editable && row.kind === 'local' && <button disabled={busy} onClick={() => void run(() => choose(row))}>폴더 다시 선택</button>}
        <button disabled={busy || row.disabled} onClick={() => void run(async () => { await window.flowrium!.projectShortcutAction(project.id, { action: 'open', id: row.id }); })}>{row.kind === 'local' ? '폴더 열기' : '주소 열기'}</button>
        {editable && <button disabled={busy} aria-label={row.label + ' 바로가기 제거'} onClick={() => void run(() => save(rows.filter(item => item.id !== row.id)))}><Trash2 size={14}/>제거</button>}
      </div>
    </article>)}</div>
    {editable && <><div className="pf-actions"><button disabled={busy || rows.length >= 32} onClick={() => void run(() => choose())}><FolderOpen size={15}/>로컬 폴더 선택</button><button className="primary" disabled={busy || rows.some(row => !row.label.trim())} onClick={() => void run(() => save(rows))}>바로가기 이름 저장</button></div>
      <form className="project-shortcut-form" onSubmit={event => { event.preventDefault(); void run(async () => { await save([...rows, { id: crypto.randomUUID(), kind, label: label.trim(), target: target.trim() }]); setLabel(''); setTarget(''); }); }}>
        <h3>주소 추가</h3><label>종류<select aria-label="바로가기 종류" disabled={busy} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="operation">운영 주소</option><option value="drive">Drive 폴더</option></select></label>
        <label>이름<input aria-label="새 바로가기 이름" disabled={busy} value={label} maxLength={100} onChange={event => setLabel(event.target.value)}/></label>
        <label>{kind === 'drive' ? 'Drive 폴더 주소' : '운영 주소'}<input aria-label="새 바로가기 주소" type="url" required disabled={busy} value={target} maxLength={4096} placeholder={kind === 'drive' ? 'https://drive.google.com/drive/folders/…' : 'https://…'} onChange={event => setTarget(event.target.value)}/></label>
        <button className="primary" disabled={busy || rows.length >= 32 || !label.trim() || !target.trim()}><Plus size={15}/>주소 추가</button>
      </form><p className="pf-muted">내부 폴더는 프로젝트와 함께 이동합니다. 외부 폴더는 이관 후 다시 선택해야 합니다. 바로가기를 제거해도 실제 폴더와 자료는 남습니다.</p></>}
    {error && <p role="alert" className="pf-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
