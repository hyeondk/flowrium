import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useState } from 'react';
import type { StorageReport } from '../shared/system-tools';
import './system-tools.css';

const size = (n: number) => (n / 1024 / 1024).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + 'MB';

export default function StoragePanel() {
  const api = window.flowrium;
  const [report, setReport] = useState<StorageReport>();
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState(['sessions', 'teams', 'attachments', 'driveCache']);
  const [plan, setPlan] = useState<any>();
  const [backups, setBackups] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function read() {
    setReport(await api!.storageAction({ action: 'report' }));
    setBackups(await api!.storageAction({ action: 'backups' }));
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(read); }, []);

  return <section className="storage-panel" aria-label="저장 공간 관리">
    <header className="system-section-heading">
      <div><h3>저장 공간 관리</h3><p>자료의 크기를 확인하고 오래된 기록을 백업해 보관합니다.</p></div>
      <button disabled={busy} onClick={() => void run(read)}>용량 다시 확인</button>
    </header>
    {report && <>
      <dl className="storage-summary" aria-label="저장 공간 현황">
        <div><dt>프로젝트 기록</dt><dd>{size(report.total)}</dd></div>
        <div><dt>대화</dt><dd>{report.sessionCount}개</dd></div>
        <div><dt>복구용 보관 기록</dt><dd>{size(report.backupBytes)}</dd></div>
      </dl>
      {report.warnings.map(w => <p className="system-notice" role="status" key={w}>정리 검토: {w}</p>)}
      <div className="storage-table-scroll" role="region" aria-label="프로젝트별 저장 용량" tabIndex={0}>
        <table><thead><tr><th>프로젝트</th><th>대화</th><th>팀 기록</th><th>첨부</th><th>Drive 사본</th><th>기타 보존 자료</th></tr></thead>
          <tbody>{report.projects.map(p => <tr key={p.projectId}><th>{p.name}</th><td>{size(p.sessions)}</td><td>{size(p.teams)}</td><td>{size(p.attachments)}</td><td>{size(p.driveCache)}</td><td>{size(p.other)}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
    <section className="storage-selection">
      <h4>정리할 기록 선택</h4>
      <p>실행 중인 업무와 사용 중인 첨부는 보호합니다. 선택한 오래된 기록은 압축 백업을 만든 뒤 목록과 원래 위치에서 보관 정리합니다. 인증 정보와 모델, 원본 산출물은 정리하지 않습니다.</p>
      <label className="system-field">마지막 활동 기준<select aria-label="저장 공간 정리 기간" value={days} onChange={e => setDays(Number(e.target.value))}>{[3, 7, 30].map(n => <option value={n} key={n}>{n}일 이전</option>)}</select></label>
      <fieldset disabled={busy} className="storage-kinds"><legend>정리할 자료 종류</legend>
        {[['sessions', '오래된 대화'], ['teams', '완료하거나 중단한 팀 기록'], ['attachments', '사용하지 않는 첨부'], ['driveCache', '오래된 Drive 임시 사본']].map(([id, label]) => <label key={id}><AnimatedCheckbox checked={kinds.includes(id)} onChange={e => setKinds(v => e.target.checked ? [...v, id] : v.filter(k => k !== id))} /><span>{label}</span></label>)}
      </fieldset>
      <div className="system-actions"><button className="button secondary" disabled={busy || !kinds.length} onClick={() => void run(async () => setPlan(await api!.storageAction({ action: 'plan', days, kinds })))}>정리할 기록 미리보기</button></div>
    </section>
    {plan && <section className="storage-plan" aria-label="저장 공간 정리 계획">
      <h4>선택한 정리 계획</h4><p>대화 {plan.sessions.length}개와 팀 기록 {plan.teams.length}개, 파일 {plan.files.length}개를 보관합니다. (원본 {size(plan.bytes)})</p>
      <ul>{plan.sessions.map((s: any) => <li key={s.id}>{s.title}</li>)}</ul>
      <details><summary>보관할 파일 목록</summary><ul>{plan.files.map((f: any) => <li key={f.projectId + f.path}>{f.path} ({size(f.size)})</li>)}</ul></details>
      <div className="system-actions">
        <button className="button subtle" onClick={() => setPlan(undefined)}>취소</button>
        <button className="button primary" disabled={busy || !plan.files.length && !plan.sessions.length} onClick={() => void run(async () => {
          const value = await api!.storageAction({ action: 'apply', id: plan.id });
          setNotice('보관 정리 완료 (대화 ' + value.sessions + '개, 파일 ' + value.files + '개)');
          setPlan(undefined); await read();
        })}>압축 백업 후 이 계획 적용</button>
      </div>
    </section>}
    <section className="storage-backups"><h4>복구용 보관 기록</h4>
      {!backups.length && <p>아직 보관한 기록이 없습니다.</p>}
      {backups.map(b => <div className="storage-backup-row" key={b.id}><span>{new Date(b.at).toLocaleString('ko-KR')}<small>대화 {b.sessions}개와 파일 {b.files}개</small></span><button disabled={busy || b.restored} onClick={() => void run(async () => { await api!.storageAction({ action: 'restore', id: b.id }); setNotice('보관 기록을 복원했습니다.'); await read(); })}>{b.restored ? '복원됨' : '이 보관 기록 복원'}</button></div>)}
    </section>
    {notice && <p className="system-notice" role="status">{notice}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
