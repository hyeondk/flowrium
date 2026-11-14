import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, RefreshCw, Shuffle } from 'lucide-react';
import type { Project } from '../shared/types';
import type { ProjectPortRole, ProjectPortValues, ProjectPortsAPI, ProjectPortsInput, ProjectPortsState } from '../shared/project-ports';
import { AnimatedSwitch, Toast } from './ui-motion';
import './project-ports.css';

const roles: ProjectPortRole[] = ['web', 'admin', 'api', 'db', 'aux'];
const labels = { web: '웹', admin: '관리자', api: 'API', db: '데이터베이스', aux: '보조 서버' };
const bases = { web: 2000, admin: 2100, api: 3000, db: 4000, aux: 4100 };
const automatic = (number: number) => Object.fromEntries(roles.map(role => [role, String(bases[role] + number)])) as Record<ProjectPortRole, string>;
const errorText = (error: unknown) => error instanceof Error ? error.message : '포트 설정을 처리하지 못했습니다.';
function parseReservations(text: string) {
  const values = new Set<number>();
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
    if (!match) throw Error('예약 포트는 숫자 또는 5000-5010 형식의 범위로 입력하세요.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (first < 1024 || last > 65535 || first > last || last - first > 4095) throw Error('예약 포트는 1024~65535 범위에서 최대 4096개까지 지정하세요.');
    for (let value = first; value <= last; value++) { values.add(value); if (values.size > 4096) throw Error('예약 포트는 최대 4096개까지 지정하세요.'); }
  }
  return [...values].sort((a, b) => a - b);
}

export default function ProjectPorts({ project }: { project: Project }) {
  const api = window.flowrium as (typeof window.flowrium & ProjectPortsAPI) | undefined;
  const [data, setData] = useState<ProjectPortsState>();
  const [formNumber, setFormNumber] = useState('1');
  const [mode, setMode] = useState<'automatic' | 'custom'>('automatic');
  const [ports, setPorts] = useState<Record<ProjectPortRole, string>>(automatic(1));
  const [reserved, setReserved] = useState('');
  const [allowListening, setAllowListening] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(false), writing = useRef(false), currentProject = useRef(project.id);
  currentProject.current = project.id;
  const receive = useCallback((value: ProjectPortsState, reset = true) => {
    if (!alive.current || value.projectId !== currentProject.current) return;
    setData(value);
    if (reset) {
      setFormNumber(String(value.number || 1)); setMode(value.mode); setPorts(value.ports ? Object.fromEntries(roles.map(role => [role, String(value.ports![role])])) as Record<ProjectPortRole, string> : automatic(1));
      setReserved(value.reservations.ports.join(', ')); setAllowListening(false);
    }
  }, []);
  const load = useCallback(async () => {
    if (!api?.readProjectPorts) return;
    setBusy(true); setError('');
    try { receive(await api.readProjectPorts(project.id)); }
    catch (error) { if (alive.current && project.id === currentProject.current) setError(errorText(error)); }
    finally { if (alive.current && project.id === currentProject.current) setBusy(false); }
  }, [project.id, receive]);
  useEffect(() => { alive.current = true; setData(undefined); setNotice(''); void load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3600); return () => clearTimeout(timer); }, [notice]);
  async function action(input: ProjectPortsInput) {
    if (!api || writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try { const result = await api.projectPortsAction(project.id, input); receive(result, input.action !== 'check'); if (alive.current && project.id === currentProject.current && input.action !== 'check') setNotice('포트 설정을 저장했습니다.'); }
    catch (error) { if (alive.current && project.id === currentProject.current) setError(errorText(error)); }
    finally { writing.current = false; if (alive.current && project.id === currentProject.current) setBusy(false); }
  }
  async function copy(value: string) {
    try { if (api?.copyText) await api.copyText(value); else await navigator.clipboard.writeText(value); if (alive.current) setNotice('클립보드에 복사했습니다.'); }
    catch (error) { if (alive.current) setError(errorText(error)); }
  }
  function save() {
    try {
      if (!data) return;
      const number = Number(formNumber);
      if (!/^\d{1,2}$/.test(formNumber) || number < 1 || number > 99) throw Error('프로젝트 번호는 1~99 사이의 정수로 입력하세요.');
      const values = Object.fromEntries(roles.map(role => [role, Number(ports[role])])) as ProjectPortValues;
      if (roles.some(role => !/^\d{4,5}$/.test(ports[role]) || values[role] < 1024 || values[role] > 65535)) throw Error('서비스 포트는 1024~65535 사이의 정수로 입력하세요.');
      void action({ action: 'save', revision: data.revision, number, ports: values, allowListening });
    } catch (error) { setError(errorText(error)); }
  }
  const dirty = data?.enabled && (Number(formNumber) !== data.number || roles.some(role => Number(ports[role]) !== data.ports?.[role]));
  return <section className="project-ports" aria-label="자동 포트표">
    <header className="pp-heading ui-title-stagger"><div><h2>자동 포트표</h2><p>프로젝트 번호로 서비스 주소를 나누고 실제 사용 여부를 확인합니다.</p></div><div className="pp-actions"><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : undefined}/>새로고침</button></div></header>
    {data && <label className="pp-toggle"><span><strong>프로젝트 포트 배정</strong><small>끄면 배정을 해제하며 다른 프로젝트가 번호를 사용할 수 있습니다.</small></span><AnimatedSwitch aria-label="프로젝트 포트 배정" checked={data.enabled} disabled={busy} onChange={event => void action({ action: event.target.checked ? 'allocate' : 'release', revision: data.revision })}/></label>}
    {!api?.readProjectPorts && <p className="pp-caption">데스크톱 앱에서 자동 포트표를 사용할 수 있습니다.</p>}
    {!data && busy && <p className="pp-loading"><LoaderCircle size={17} className="spin"/>사용 가능한 프로젝트 번호와 포트를 확인하고 있습니다.</p>}
    {error && <div className="pp-error" role="alert"><p>{error}</p><div className="pp-actions"><button type="button" disabled={busy} onClick={() => void load()}>설정 다시 읽기</button></div></div>}
    {data && <>
      {data.enabled && <>
        <div className="pp-current"><span>프로젝트 번호 <strong>{String(data.number).padStart(2, '0')}</strong></span><span>{data.mode === 'automatic' ? '번호 기준 자동 배정' : '직접 지정한 포트'}</span><time>{new Date(data.checkedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 확인</time></div>
        <div className="pp-table-scroll"><table className="pp-table"><thead><tr><th>서비스</th><th>포트</th><th>사용 여부</th><th><span className="pp-sr-only">주소 복사</span></th></tr></thead><tbody>{roles.map(role => {
          const check = data.checks.find(row => row.role === role), value = data.ports![role], address = ['web', 'admin', 'api'].includes(role) ? `http://localhost:${value}` : `localhost:${value}`;
          return <tr key={role}><th scope="row">{labels[role]}<small>{role}</small></th><td><code>{value}</code></td><td><span className="pp-state" data-state={check?.status}>{check?.status === 'free' ? '사용 가능' : check?.status === 'listening' ? '사용 중' : '확인 불가'}</span><small>{check?.families.map(f => `${f.family} ${f.status === 'free' ? '가능' : f.status === 'listening' ? '사용 중' : f.status === 'unsupported' ? '비활성' : '미확인'}`).join(', ')}</small></td><td><button type="button" aria-label={labels[role] + ' 주소 복사'} onClick={() => void copy(address)}><Copy size={14}/>주소 복사</button></td></tr>;
        })}</tbody></table></div>
        <p className="pp-caption">사용 여부는 검사 시점의 결과입니다. 실제 서비스 실행 전 다시 확인하세요. 실행 중인 서버를 종료하거나 설정 파일을 바꾸지 않습니다.</p>
        {data.conflicts.length > 0 && <div className="pp-error" role="alert"><strong>겹치는 배정이 있습니다.</strong>{data.conflicts.map((row, index) => <p key={index}>{row.kind === 'number' ? `${row.projectName} 프로젝트와 번호가 같습니다.` : row.kind === 'reserved' ? `${labels[row.role!]} ${row.port}번은 외부 예약 포트입니다.` : `${labels[row.role!]} ${row.port}번은 ${row.projectName}에도 배정되어 있습니다.`}</p>)}</div>}
        {data.warnings.map(text => <p className="pp-caption" key={text}>{text}</p>)}
        <div className="pp-actions"><button type="button" disabled={busy} onClick={() => void action({ action: 'check' })}><RefreshCw size={15}/>실제 사용 여부 검사</button><button type="button" disabled={busy} onClick={() => void copy(roles.map(role => `PORT_${role.toUpperCase()}=${data.ports![role]}`).join('\n'))}><Copy size={15}/>환경변수 복사</button><button type="button" className="pp-primary" disabled={busy} onClick={() => void action({ action: 'reallocate', revision: data.revision })}><Shuffle size={15}/>다음 빈 번호로 재배정</button></div>
        <details className="pp-editor"><summary>번호와 포트 직접 설정</summary><div className="pp-fields"><label>프로젝트 번호<input inputMode="numeric" aria-label="프로젝트 번호" maxLength={2} value={formNumber} onChange={event => { setFormNumber(event.target.value); if (mode === 'automatic' && /^\d{1,2}$/.test(event.target.value)) setPorts(automatic(Number(event.target.value))); }}/></label><label>입력 방식<select value={mode} aria-label="포트 입력 방식" onChange={event => { const next = event.target.value as typeof mode; setMode(next); if (next === 'automatic') setPorts(automatic(Number(formNumber) || 1)); }}><option value="automatic">번호에 맞춰 계산</option><option value="custom">서비스별 직접 입력</option></select></label></div><div className="pp-fields pp-port-fields">{roles.map(role => <label key={role}>{labels[role]}<input inputMode="numeric" maxLength={5} aria-label={labels[role] + ' 포트'} readOnly={mode === 'automatic'} value={ports[role]} onChange={event => setPorts(old => ({ ...old, [role]: event.target.value }))}/></label>)}</div><label className="pp-toggle"><span><strong>이미 실행 중인 서버 포트 사용</strong><small>내 서버의 주소가 맞을 때 사용합니다. 다른 프로젝트의 배정이나 예약 포트는 덮어쓰지 않습니다.</small></span><AnimatedSwitch checked={allowListening} disabled={busy} onChange={event => setAllowListening(event.target.checked)} aria-label="이미 실행 중인 서버 포트 사용"/></label><div className="pp-actions"><button type="button" className="pp-primary" disabled={busy || !dirty} onClick={save}>포트 설정 저장</button></div></details>
      </>}
      {!data.enabled && <p className="pp-caption">이 프로젝트의 포트 배정이 해제됐습니다. 스위치를 켜면 사용 가능한 번호를 다시 배정합니다.</p>}
      <details className="pp-editor"><summary>전체 프로젝트 포트표</summary><div className="pp-table-scroll"><table className="pp-table pp-all"><thead><tr><th>프로젝트</th><th>번호</th>{roles.map(role => <th key={role}>{labels[role]}</th>)}</tr></thead><tbody>{data.projects.map(row => <tr key={row.projectId} data-current={row.projectId === project.id}><th scope="row">{row.name}</th><td>{row.number ? String(row.number).padStart(2, '0') : '미배정'}</td>{roles.map(role => <td key={role}><code>{row.ports?.[role] || '—'}</code></td>)}</tr>)}</tbody></table></div></details>
      <details className="pp-editor"><summary>자동 배정에서 제외할 외부 예약 포트</summary><p className="pp-caption">다른 도구에 사용할 포트를 숫자 또는 범위로 입력하세요. 예: 5000, 6000-6010. 프로젝트에 이미 배정된 포트는 여기서 예약하지 않습니다.</p><label>외부 예약 포트<textarea rows={3} maxLength={24000} aria-label="외부 예약 포트" value={reserved} onChange={event => setReserved(event.target.value)}/></label><div className="pp-actions"><button type="button" disabled={busy} onClick={() => { try { void action({ action: 'reservations', revision: data.reservations.revision, ports: parseReservations(reserved) }); } catch (error) { setError(errorText(error)); } }}>예약 포트 저장</button></div></details>
    </>}
    <Toast message={notice} onClose={() => setNotice('')}/>
  </section>;
}
