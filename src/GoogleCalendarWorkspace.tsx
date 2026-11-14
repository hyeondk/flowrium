import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, List, LoaderCircle, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import type { GoogleCalendar, GoogleStatus, RemoteItem } from '../shared/integrations';
import { calendarDay, calendarEventOnDay, calendarMonthGrid, calendarMonthRange, calendarMonthShift } from '../shared/calendar-days';
import GoogleEventEditor from './GoogleEventEditor';
import './google-calendar-workspace.css';

type Props = { onOpenSettings?: () => void };
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
const displayTime = (value?: string) => {
  if (!value) return '';
  if (value.length === 10) return '하루 종일';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : value;
};

export default function GoogleCalendarWorkspace({ onOpenSettings }: Props) {
  const api = window.flowrium;
  const today = calendarDay(new Date());
  const [status, setStatus] = useState<GoogleStatus>();
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [mode, setMode] = useState<'month' | 'list'>('month');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<RemoteItem[]>([]);
  const [selected, setSelected] = useState<RemoteItem>();
  const [editor, setEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const statusRef = useRef<GoogleStatus | undefined>(undefined);
  const statusRequest = useRef(0), calendarRequest = useRef(0), eventRequest = useRef(0);

  const refreshStatus = useCallback(async () => {
    if (!api) return;
    const request = ++statusRequest.current;
    const value = await api.googleStatus();
    if (!alive.current || request !== statusRequest.current) return;
    const previous = statusRef.current;
    if (!value.connected || previous?.account !== value.account || previous?.connected !== value.connected) {
      calendarRequest.current++; eventRequest.current++;
      setCalendars([]); setCalendarId(''); setEvents([]); setSelected(undefined); setEditor(false);
    }
    statusRef.current = value;
    setStatus(value);
  }, [api]);

  useEffect(() => {
    alive.current = true;
    const check = () => { void refreshStatus().catch(value => { if (alive.current) setError(errorText(value)); }); };
    check();
    const interval = setInterval(check, 2000);
    window.addEventListener('focus', check);
    return () => { alive.current = false; statusRequest.current++; calendarRequest.current++; eventRequest.current++; clearInterval(interval); window.removeEventListener('focus', check); };
  }, [refreshStatus]);

  useEffect(() => {
    if (!api || !status?.connected) return;
    const request = ++calendarRequest.current, account = status.account;
    setLoadingCalendars(true); setError('');
    void api.googleCalendars().then(rows => {
      if (!alive.current || request !== calendarRequest.current || !statusRef.current?.connected || statusRef.current.account !== account) return;
      setCalendars(rows);
      setCalendarId(previous => rows.some(item => item.id === previous) ? previous : (rows.find(item => item.primary) || rows[0])?.id || '');
    }).catch(value => { if (alive.current && request === calendarRequest.current) setError(errorText(value)); })
      .finally(() => { if (alive.current && request === calendarRequest.current) setLoadingCalendars(false); });
  }, [api, status?.connected, status?.account]);

  useEffect(() => {
    if (!api || !status?.connected || !calendarId) return;
    const request = ++eventRequest.current, account = status.account;
    setReading(true); setError(''); setEvents([]); setSelected(undefined); setEditor(false);
    let period: { from: string; to: string };
    try { period = calendarMonthRange(month); }
    catch (value) { setError(errorText(value)); setReading(false); return; }
    void api.readGoogle({ kind: 'calendar', calendarId, query: search, ...period }).then(rows => {
      if (!alive.current || request !== eventRequest.current || !statusRef.current?.connected || statusRef.current.account !== account) return;
      setEvents(rows);
    }).catch(value => { if (alive.current && request === eventRequest.current) setError(errorText(value)); })
      .finally(() => { if (alive.current && request === eventRequest.current) setReading(false); });
  }, [api, status?.connected, status?.account, calendarId, month, search, refresh]);

  const grid = useMemo(() => { try { return calendarMonthGrid(month); } catch { return []; } }, [month]);
  const daily = useMemo(() => events.filter(event => calendarEventOnDay(event, day)), [events, day]);
  const visible = mode === 'month' ? daily : events;
  const selectedCalendar = calendars.find(item => item.id === calendarId);
  const writable = !!status?.calendarWrite && !!selectedCalendar?.writable;
  const editorCalendars = calendars.map(item => ({ ...item, writable: !!status?.calendarWrite && item.writable }));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function changeMonth(value: string) {
    if (!value) return;
    setMonth(value); setDay(value === today.slice(0, 7) ? today : value + '-01'); setNotice('');
  }
  async function perform(action: () => Promise<void>) {
    if (busy || !api) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (value) { if (alive.current) setError(errorText(value)); }
    finally { if (alive.current) setBusy(false); }
  }
  function openEditor(item?: RemoteItem) { setSelected(item); setEditor(true); setNotice(''); }

  if (!api) return <section className="google-calendar-workspace"><h1>Google 캘린더</h1><p>데스크톱 앱에서 Google 계정을 연결해 주세요.</p></section>;
  return <section className="google-calendar-workspace" aria-label="Google 일정 작업 공간">
    <header className="gcw-heading"><div><span className="gcw-eyebrow">내 일정</span><h1><CalendarDays size={26} />Google 캘린더</h1><p>계정을 연결하고 일정을 확인하거나 변경할 내용을 검토하세요.</p></div>
      <div className="gcw-actions">{onOpenSettings && <button type="button" className="button subtle" onClick={onOpenSettings}><Settings2 size={16} />외부 자료 설정</button>}<button type="button" className="button subtle" disabled={busy} onClick={() => void perform(async () => { await refreshStatus(); setRefresh(value => value + 1); })}><RefreshCw size={16} />연결과 일정 새로고침</button></div>
    </header>
    {error && <p role="alert" className="gcw-error">{error}</p>}
    {notice && <p role="status" className="gcw-notice">{notice}</p>}
    {!status && !error && <p role="status" className="gcw-loading"><LoaderCircle size={16} className="spin" />연결 상태를 확인하고 있습니다.</p>}
    {status && !status.connected && <section className="gcw-connect" aria-label="Google 첫 연결">
      <div><h2>{status.configured ? 'Google 계정으로 시작하세요' : '처음 연결하기'}</h2><p>{status.configured ? '브라우저에서 본인 계정과 요청 권한을 확인한 뒤 이 화면으로 돌아오세요.' : '현재 배포본에는 공용 Google 로그인 설정이 없습니다. 본인의 데스크톱 앱 클라이언트를 한 번 등록하면 계정으로 연결할 수 있습니다.'}</p></div>
      <ol className="gcw-steps"><li><strong>연결 정보 준비</strong><span>Google Cloud에서 본인 프로젝트의 Calendar / Drive / Gmail API와 동의 화면을 준비하고 데스크톱 앱 OAuth 클라이언트를 만듭니다.</span></li><li><strong>이 기기에 등록</strong><span>아래에 클라이언트 ID와 제공받은 보안 비밀을 입력합니다. 계정 비밀번호를 입력하는 칸이 아닙니다.</span></li><li><strong>계정으로 로그인</strong><span>브라우저에서 일정 / 메일 / 문서 권한을 확인합니다. 테스트 상태인 앱은 본인 계정을 테스트 사용자로 등록해야 할 수 있습니다.</span></li></ol>
      <details className="gcw-setup" open={!status.configured}><summary>Google 연결 정보 등록</summary><form onSubmit={event => { event.preventDefault(); void perform(async () => { await api.configureGoogle({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }); setClientId(''); setClientSecret(''); await refreshStatus(); setNotice('연결 정보를 저장했습니다. Google 계정으로 로그인하세요.'); }); }}>
        <label>클라이언트 ID<input aria-label="Google 클라이언트 ID" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={300} value={clientId} onChange={event => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" required /></label>
        <label>클라이언트 보안 비밀<input aria-label="Google 클라이언트 보안 비밀" type="password" autoComplete="off" maxLength={500} value={clientSecret} onChange={event => setClientSecret(event.target.value)} /></label>
        <button className="button secondary" disabled={busy || !clientId.trim() || status.authorizing}>연결 정보 저장</button>
      </form></details>
      <div className="gcw-actions"><button type="button" className="button primary" disabled={busy || !status.configured || status.authorizing} onClick={() => void perform(async () => { await api.connectGoogle(); await refreshStatus(); })}>{status.authorizing ? <LoaderCircle size={16} className="spin" /> : <ExternalLink size={16} />}{status.authorizing ? '브라우저에서 로그인을 마쳐 주세요' : 'Google 계정으로 로그인'}</button><button type="button" className="button subtle" disabled={busy} onClick={() => void perform(refreshStatus)}>로그인 완료 확인</button></div>
      <p className="gcw-help">로그인 창은 기본 브라우저에서 열립니다. 개인 계정이나 다른 앱의 연결 정보를 설치 파일에 넣지 않습니다.</p>
    </section>}
    {status?.connected && <>
      <div className="gcw-account"><div><span className="gcw-connected-dot" /><strong>Google 계정 연결됨</strong>{status.account && <span>{status.account}</span>}</div><button type="button" className="button subtle" onClick={() => void perform(() => api.openGoogleItem('https://calendar.google.com/calendar/u/0/r'))}><ExternalLink size={15} />Google 캘린더 열기</button></div>
      {!status.calendarWrite && <div className="gcw-permission"><p>현재 연결에서는 일정 조회만 가능합니다. 등록 / 수정 / 삭제를 하려면 일정 변경 권한으로 다시 연결하세요.</p><button type="button" className="button secondary" disabled={busy || status.authorizing} onClick={() => void perform(async () => { await api.connectGoogle(); await refreshStatus(); })}>일정 변경 권한으로 다시 연결</button></div>}
      <div className="gcw-toolbar"><label>캘린더<select aria-label="작업할 Google 캘린더" value={calendarId} disabled={loadingCalendars || busy} onChange={event => setCalendarId(event.target.value)}>{!calendars.length && <option value="">{loadingCalendars ? '불러오는 중…' : '연결한 캘린더 없음'}</option>}{calendars.map(item => <option key={item.id} value={item.id}>{item.title}{!item.writable ? ' (읽기 전용)' : ''}</option>)}</select></label>
        <form className="gcw-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}><label>일정 검색<div><Search size={16} /><input aria-label="Google 일정 검색" value={query} maxLength={1000} onChange={event => setQuery(event.target.value)} placeholder="일정 이름이나 내용" /><button className="button subtle" disabled={reading || !calendarId}>검색</button></div></label></form>
        <button type="button" className="button primary" disabled={!writable || busy} onClick={() => openEditor()}><Plus size={16} />새 일정</button>
      </div>
      <div className="gcw-month-toolbar"><div className="gcw-month-navigation"><button type="button" aria-label="이전 달" disabled={month === '1900-01'} onClick={() => changeMonth(calendarMonthShift(month, -1))}><ChevronLeft size={18} /></button><label><span className="visually-hidden">조회할 월</span><input aria-label="조회할 월" type="month" min="1900-01" max="2200-12" value={month} onChange={event => changeMonth(event.target.value)} /></label><button type="button" aria-label="다음 달" disabled={month === '2200-12'} onClick={() => changeMonth(calendarMonthShift(month, 1))}><ChevronRight size={18} /></button><button type="button" onClick={() => { changeMonth(today.slice(0, 7)); setDay(today); }}>오늘</button></div><div className="gcw-mode" role="group" aria-label="일정 표시 방식"><button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}><CalendarDays size={16} />월간</button><button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}><List size={16} />목록</button></div></div>
      <p className="gcw-range-note">이 기기의 시간대 ({timeZone}) 기준입니다. 한 번에 최대 100개 일정을 표시하며 검색으로 범위를 좁힐 수 있습니다.</p>
      <div className="gcw-content">
        {mode === 'month' && <section className="gcw-month" aria-label="월간 일정"><div className="gcw-weekdays" aria-hidden="true">{['일', '월', '화', '수', '목', '금', '토'].map(value => <span key={value}>{value}</span>)}</div><div className="gcw-days">{grid.map(cell => {
          const count = cell.currentMonth ? events.filter(event => calendarEventOnDay(event, cell.day)).length : 0;
          return <button type="button" key={cell.day} disabled={!cell.currentMonth} data-today={cell.day === today} data-other-month={!cell.currentMonth} aria-pressed={cell.day === day} aria-label={cell.day + (count ? ' 일정 ' + count + '개' : ' 일정 없음')} onClick={() => { setDay(cell.day); setSelected(undefined); setEditor(false); }}><span>{Number(cell.day.slice(-2))}</span>{count > 0 && <small>{count}개</small>}</button>;
        })}</div></section>}
        <section className="gcw-agenda" aria-label="일정 목록"><header><h2>{mode === 'month' ? day + ' 일정' : month + ' 전체 일정'}</h2><span>{reading ? '조회 중' : visible.length + '개'}</span></header>
          {reading ? <p className="gcw-empty" role="status"><LoaderCircle size={18} className="spin" />일정을 불러오고 있습니다.</p> : !visible.length ? <p className="gcw-empty">{search ? '검색 조건에 맞는 일정이 없습니다.' : '표시할 일정이 없습니다.'}</p> : <div className="gcw-events">{visible.map(event => <button type="button" className="gcw-event" data-selected={selected?.id === event.id} key={event.id} onClick={() => { setSelected(event); setEditor(false); }}><span className="gcw-event-dot" /><span><strong>{event.title}</strong><time>{displayTime(event.at)}{event.at?.length !== 10 && event.end ? ' ~ ' + displayTime(event.end) : ''}</time>{event.location && <small>{event.location}</small>}</span></button>)}</div>}
        </section>
      </div>
      {selected && !editor && <section className="gcw-detail" aria-label="선택한 일정 상세"><header><div><h2>{selected.title}</h2><p>{displayTime(selected.at)}{selected.at?.length !== 10 && selected.end ? ' ~ ' + displayTime(selected.end) : ''}</p></div><button type="button" aria-label="일정 상세 닫기" className="button subtle" onClick={() => setSelected(undefined)}><X size={17} /></button></header>{selected.location && <p>장소 / {selected.location}</p>}{selected.description && <p className="gcw-description">{selected.description}</p>}<div className="gcw-actions"><button type="button" className="button primary" disabled={!writable} onClick={() => setEditor(true)}>이 일정 수정 / 삭제</button>{selected.url && <button type="button" className="button subtle" onClick={() => void perform(() => api.openGoogleItem(selected.url!))}><ExternalLink size={15} />Google에서 보기</button>}</div></section>}
      {editor && <section className="gcw-editor"><header><h2>{selected ? '일정 변경' : '새 일정 등록'}</h2><button type="button" className="button subtle" aria-label="일정 편집 닫기" onClick={() => setEditor(false)}><X size={17} /></button></header><GoogleEventEditor key={calendarId + ':' + (selected?.id || 'new')} calendars={editorCalendars} calendarId={calendarId} item={selected} onSaved={message => { setNotice(message); setEditor(false); setSelected(undefined); setRefresh(value => value + 1); }} /></section>}
    </>}
  </section>;
}
