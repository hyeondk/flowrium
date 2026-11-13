import { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Terminal, X } from 'lucide-react';
import type { VoiceServerConfig, VoiceServerId, VoiceServerPreview, VoiceServersState } from '../shared/voice-server';
import { AnimatedSwitch, MotionOverlay } from './ui-motion';
import './voice-server.css';

type Draft = { command: string; args: string; cwd: string; endpoint: string; healthPath: string; startupTimeoutMs: string };
const labels = { recognition: '음성 인식 서버', synthesis: '음성 읽기 서버' };
const phases = { stopped: '꺼짐', starting: '시작 중', running: '실행 중', stopping: '종료 중', failed: '확인 필요', external: '다른 프로그램에서 실행 중' };
function draft(config: VoiceServerConfig): Draft { return { command: config.command, args: config.args.join('\n'), cwd: config.cwd, endpoint: config.endpoint, healthPath: config.healthPath, startupTimeoutMs: String(config.startupTimeoutMs / 1000) }; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function VoiceServerPanel({ onConnect }: { onConnect?: (id: VoiceServerId, endpoint: string) => Promise<void> }) {
  const [state, setState] = useState<VoiceServersState | null>(null), [notice, setNotice] = useState('');
  const alive = useRef(true);
  async function refresh() { try { const next = await window.flowrium!.voiceServersState(); if (alive.current) setState(next); } catch (error) { if (alive.current) setNotice(message(error)); } }
  useEffect(() => { alive.current = true; void refresh(); const timer = window.setInterval(() => void refresh(), 1500); return () => { alive.current = false; window.clearInterval(timer); }; }, []);
  return <section className="voice-server-panel" aria-label="로컬 음성 서버 관리">
    <div className="voice-server-heading"><div><h3>로컬 음성 서버 관리</h3><p>이 기기에 준비한 서버를 연결하고 실행 상태를 관리합니다.</p></div><button type="button" className="button secondary" onClick={() => void refresh()}><RefreshCw size={14}/>새로고침</button></div>
    <p className="voice-server-description">모델과 실행 파일은 직접 준비해 주세요. 설정을 저장하거나 앱을 다시 열어도 서버를 자동 실행하지 않습니다. 잠금 / 로그아웃 / 앱 종료 시 이 앱에서 시작한 서버를 종료합니다.</p>
    {state ? state.servers.map(server => <ServerCard key={server.config.id} config={server.config} run={server.run} revision={state.revision} onState={setState} onConnect={onConnect}/>) : <p role="status">서버 설정을 불러오는 중입니다.</p>}
    {notice && <p role="status" className="voice-server-notice">{notice}</p>}
  </section>;
}

function ServerCard({ config, run, revision, onState, onConnect }: { config: VoiceServerConfig; run: VoiceServersState['servers'][number]['run']; revision: number; onState(value: VoiceServersState): void; onConnect?: (id: VoiceServerId, endpoint: string) => Promise<void> }) {
  const [form, setForm] = useState(() => draft(config)), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [replaceEnvironment, setReplaceEnvironment] = useState(false), [environment, setEnvironment] = useState<{ name: string; value: string }[]>([]);
  const [preview, setPreview] = useState<VoiceServerPreview | null>(null), [intent, setIntent] = useState<'start' | 'restart'>('start');
  const previous = useRef(JSON.stringify(config));
  useEffect(() => { const next = JSON.stringify(config); if (next !== previous.current) { previous.current = next; setForm(draft(config)); setReplaceEnvironment(false); setEnvironment([]); } }, [config]);
  const dirty = JSON.stringify(form) !== JSON.stringify(draft(config)) || replaceEnvironment;
  const active = run.phase === 'running' || run.phase === 'starting' || run.phase === 'stopping';
  const editable = !busy && !active;
  const id = config.id, title = labels[id];
  function change(name: keyof Draft, value: string) { setForm(previous => ({ ...previous, [name]: value })); }
  async function perform(action: () => Promise<unknown>, success = '') { if (busy) return; setBusy(true); setNotice(''); try { await action(); if (success) setNotice(success); } catch (error) { setNotice(message(error)); } finally { setBusy(false); } }
  async function selectPath(kind: 'directory' | 'executable') { await perform(async () => { const path = await window.flowrium!.chooseVoiceServerPath(kind); if (path) change(kind === 'directory' ? 'cwd' : 'command', path); }); }
  async function save() { await perform(async () => {
    const seconds = Number(form.startupTimeoutMs); if (!/^\d+$/.test(form.startupTimeoutMs) || seconds < 3 || seconds > 300) throw Error('시작 대기 시간은 3초부터 300초까지 입력해 주세요.');
    const variables: Record<string, string> = Object.create(null);
    if (replaceEnvironment) for (const row of environment) { if (!row.name.trim()) throw Error('환경변수 이름을 입력하거나 빈 행을 지워 주세요.'); if (Object.hasOwn(variables, row.name.trim())) throw Error('환경변수 이름이 중복되었습니다.'); variables[row.name.trim()] = row.value; }
    const args = form.args === '' ? [] : form.args.split('\n');
    onState(await window.flowrium!.configureVoiceServer({ id, revision, config: { command: form.command, args, cwd: form.cwd, endpoint: form.endpoint, healthPath: form.healthPath, startupTimeoutMs: seconds * 1000 }, ...(replaceEnvironment ? { environment: variables } : {}) }));
    setReplaceEnvironment(false); setEnvironment([]);
  }, '서버 설정을 저장했습니다. 실행 스위치를 켜면 실행 내용을 확인합니다.'); }
  async function prepare(action: 'start' | 'restart') { await perform(async () => { setIntent(action); setPreview(await window.flowrium!.previewVoiceServer(id)); }); }
  async function action(action: 'stop' | 'probe' | 'clearLogs') { await perform(async () => onState(await window.flowrium!.voiceServerAction({ id, action }))); }
  async function launch() { if (!preview) return; const plan = preview; setPreview(null); await perform(async () => onState(await window.flowrium!.voiceServerAction({ id, action: intent, token: plan.token }))); }
  return <article className="voice-server-card" data-server={id} aria-label={title}>
    <header className="voice-server-heading"><div><h4><Terminal size={17}/>{title}</h4><span className="voice-server-phase" data-phase={run.phase}>{phases[run.phase]}{run.pid ? ` / 프로세스 ${run.pid}` : ''}</span></div><label className="voice-server-power"><span>서버 실행</span><AnimatedSwitch aria-label={`${title} 실행`} checked={active} disabled={busy || run.phase === 'stopping' || (!active && (dirty || !config.command || !config.cwd || run.phase === 'external'))} onChange={event => { if (event.target.checked) void prepare('start'); else void action('stop'); }}/></label></header>
    <p className="voice-server-run-message" role="status">{run.message}</p>
    <div className="voice-server-fields"><label>실행 파일<div className="voice-server-path"><input aria-label={`${title} 실행 파일`} value={form.command} disabled={!editable} placeholder="실행 파일의 전체 경로" onChange={event => change('command', event.target.value)}/><button type="button" className="button secondary" disabled={!editable} onClick={() => void selectPath('executable')}><FolderOpen size={14}/>찾기</button></div></label>
      <label>작업 폴더<div className="voice-server-path"><input aria-label={`${title} 작업 폴더`} value={form.cwd} disabled={!editable} placeholder="서버가 설치된 폴더" onChange={event => change('cwd', event.target.value)}/><button type="button" className="button secondary" disabled={!editable} onClick={() => void selectPath('directory')}><FolderOpen size={14}/>찾기</button></div></label>
      <label>실행 인자 / 한 줄에 하나씩<textarea aria-label={`${title} 실행 인자`} rows={3} value={form.args} disabled={!editable} placeholder={'서버 스크립트 경로\n--port\n9890'} onChange={event => change('args', event.target.value)}/></label>
      <div className="voice-server-grid"><label>서버 주소<input aria-label={`${title} 주소`} value={form.endpoint} disabled={!editable} placeholder="http://127.0.0.1:9890" onChange={event => change('endpoint', event.target.value)}/></label><label>준비 확인 경로 / 선택<input aria-label={`${title} 준비 확인 경로`} value={form.healthPath} disabled={!editable} placeholder="비우면 포트 연결만 확인" onChange={event => change('healthPath', event.target.value)}/></label><label>시작 대기 시간 / 초<input aria-label={`${title} 시작 대기 시간`} type="text" inputMode="numeric" value={form.startupTimeoutMs} disabled={!editable} onChange={event => change('startupTimeoutMs', event.target.value)}/></label></div>
    </div>
    <div className="voice-server-environment"><label className="voice-server-power"><span>환경변수 새로 저장</span><AnimatedSwitch aria-label={`${title} 환경변수 새로 저장`} checked={replaceEnvironment} disabled={!editable} onChange={event => { setReplaceEnvironment(event.target.checked); setEnvironment([]); }}/></label><p>{config.environmentNames.length ? `저장된 이름: ${config.environmentNames.join(' / ')}` : '저장된 환경변수가 없습니다.'} 값은 보안 저장하며 화면이나 로그에 다시 표시하지 않습니다.</p>
      {replaceEnvironment && <><p>새 목록으로 교체합니다. 아무 항목 없이 저장하면 기존 환경변수를 지웁니다.</p>{environment.map((row, index) => <div className="voice-server-env-row" key={index}><input aria-label={`${title} 환경변수 ${index + 1} 이름`} autoComplete="off" placeholder="환경변수 이름" value={row.name} disabled={!editable} onChange={event => setEnvironment(rows => rows.map((item, at) => at === index ? { ...item, name: event.target.value } : item))}/><input aria-label={`${title} 환경변수 ${index + 1} 값`} type="password" autoComplete="new-password" placeholder="값" value={row.value} disabled={!editable} onChange={event => setEnvironment(rows => rows.map((item, at) => at === index ? { ...item, value: event.target.value } : item))}/><button type="button" className="button subtle" aria-label={`${title} 환경변수 ${index + 1} 삭제`} disabled={!editable} onClick={() => setEnvironment(rows => rows.filter((_, at) => at !== index))}><X size={14}/></button></div>)}<div className="voice-server-actions"><button type="button" className="button secondary" disabled={!editable || environment.length >= 40} onClick={() => setEnvironment(rows => [...rows, { name: '', value: '' }])}>환경변수 추가</button></div></>}
    </div>
    <div className="voice-server-actions"><button type="button" className="button secondary" disabled={busy || active} onClick={() => void action('probe')}>연결 확인</button>{run.phase === 'failed' && <button type="button" className="button secondary" disabled={busy} onClick={() => void action('stop')}>종료 다시 확인</button>}{run.phase === 'running' && <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => void prepare('restart')}>다시 시작</button>}{onConnect && <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => void perform(() => onConnect(id, config.endpoint), '이 주소를 음성 연결에 적용했습니다.')}>이 주소로 음성 연결</button>}<button type="button" className="button primary" disabled={!editable || !dirty} onClick={() => void save()}>서버 설정 저장</button></div>
    {dirty && <p className="voice-server-hint">변경한 설정을 먼저 저장해 주세요. 실행 중에는 서버를 끈 뒤 설정을 바꿀 수 있습니다.</p>}
    {notice && <p className="voice-server-notice" role="status">{notice}</p>}
    <details className="voice-server-logs"><summary>실행 로그 / {run.logs.length}개</summary><div className="voice-server-actions"><button type="button" className="button subtle" disabled={busy || !run.logs.length} onClick={() => void action('clearLogs')}>로그 지우기</button></div><pre aria-label={`${title} 실행 로그`}>{run.logs.length ? run.logs.map(row => `${new Date(row.at).toLocaleTimeString('ko-KR')} / ${row.stream === 'stderr' ? '오류' : row.stream === 'stdout' ? '출력' : '상태'} / ${row.text}`).join('\n') : '아직 실행 로그가 없습니다.'}</pre></details>
    <MotionOverlay open={Boolean(preview)} onClose={() => setPreview(null)} label="음성 서버 실행 확인" className="voice-server-preview">{preview && <><h2>음성 서버 실행 확인</h2><p>{preview.notice}</p><dl><dt>실행 파일</dt><dd>{preview.command}</dd><dt>인자 / 각 줄이 하나의 인자</dt><dd><pre>{preview.args.length ? preview.args.map((value, index) => `${index + 1}: ${value}`).join('\n') : '없음'}</pre></dd><dt>작업 폴더</dt><dd>{preview.cwd}</dd><dt>서버 주소</dt><dd>{preview.endpoint}</dd><dt>준비 확인</dt><dd>{preview.healthPath ? `${preview.healthPath}의 성공 응답` : '포트 연결만 확인 / 모델 준비 여부는 음성 사용 시 확인'}</dd><dt>환경변수 이름</dt><dd>{preview.environmentNames.join(' / ') || '없음'}</dd></dl><div className="voice-server-actions"><button type="button" className="button secondary" onClick={() => setPreview(null)}>취소</button><button type="button" className="button primary" disabled={busy} onClick={() => void launch()}>{intent === 'restart' ? '종료 후 다시 시작' : '서버 시작'}</button></div></>}</MotionOverlay>
  </article>;
}
