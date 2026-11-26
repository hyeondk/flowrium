import {useEffect,useState} from 'react';
import type {GoogleCalendar,GoogleConnectionState,RemoteItem} from '../shared/integrations';

type Kind = 'mails' | 'events';
type Message = RemoteItem & {body:string};
type Action = 'configure' | 'connect' | 'cancel' | 'disconnect' | 'console';
const dateLabel = (value?:string) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR') : '';
};

export default function GoogleConnectionPanel() {
  const api = window.flowrium;
  const [status,setStatus] = useState<GoogleConnectionState>();
  const [kind,setKind] = useState<Kind>('mails');
  const [calendars,setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarId,setCalendarId] = useState('primary');
  const [query,setQuery] = useState('');
  const [items,setItems] = useState<RemoteItem[]>();
  const [message,setMessage] = useState<Message>();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(()=>{
    if (!api || typeof api.readGoogleConnection !== 'function') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await api!.readGoogleConnection();
        if (!active) return;
        setStatus(next);
        if (next.phase === 'pending') timer = setTimeout(()=>void refresh(),950);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
    void refresh();
    return ()=>{active=false;clearTimeout(timer);};
  },[api,status?.phase]);

  async function perform(operation:()=>Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }

  async function change(action:Action) {
    const next = await api!.googleConnectionAction({action});
    setStatus(next);
    if (action==='configure'||action==='disconnect'||action==='connect') {
      setItems(undefined);
      setMessage(undefined);
      setCalendarId('primary');
      setCalendars([]);
      setQuery('');
    }
  }

  async function refreshRows(which:Kind, calendar:string, phrase:string) {
    setMessage(undefined);
    setItems(undefined);
    if (which === 'events' && !calendars.length) setCalendars(await api!.readGoogleData({action:'calendars'}));
    setItems(await api!.readGoogleData({action:which,calendarId:calendar,query:phrase}));
  }

  function switchTo(which:Kind) {
    if (kind !== which) setQuery('');
    setKind(which);
    void perform(()=>refreshRows(which,calendarId,kind===which?query:''));
  }

  if (typeof api?.readGoogleConnection !== 'function') return null;
  const connected = status?.phase === 'connected', pending = status?.phase === 'pending';
  return <section className="settings-section integration-panel google-connection-panel" aria-labelledby="google-connection-title">
    <h3 id="google-connection-title">Google 메일과 캘린더</h3>
    <p>Mac과 Windows에서 Google 계정으로 받은 메일과 일정을 읽습니다.</p>
    {!status && !error && <p role="status">Google 연결 상태를 확인하고 있습니다.</p>}
    {status?.phase === 'unconfigured' && <>
      <p>이 기기에 사용할 Google 데스크톱 앱 OAuth 파일을 선택해 주세요.</p>
      <details>
        <summary>Google 연결 설정 방법</summary>
        <p>Google Cloud 프로젝트에서 Gmail API와 Calendar API를 켭니다. 동의 화면을 설정하고 클라이언트 유형을 ‘데스크톱 앱’으로 선택한 뒤 OAuth 설정 파일을 내려받습니다. 테스트 상태에서는 등록한 테스트 계정으로 연결합니다.</p>
        <button type="button" className="button secondary" disabled={busy} onClick={()=>void perform(()=>change('console'))}>Google Cloud 콘솔 열기</button>
      </details>
    </>}
    {connected && <p>{status.email ? '연결된 Google 계정 '+status.email : 'Google 계정이 연결됐습니다.'}</p>}
    {pending && <p role="status">열린 브라우저에서 계정을 선택하고 읽기 권한을 허용해 주세요.</p>}
    {status && <div className="integration-actions">
      {pending
        ? <button type="button" className="button secondary" disabled={busy} onClick={()=>void perform(()=>change('cancel'))}>로그인 취소</button>
        : <>
          <button type="button" className="button secondary" disabled={busy} onClick={()=>void perform(()=>change('configure'))}>
            {status.phase === 'unconfigured' ? 'OAuth 파일 선택' : 'OAuth 파일 변경'}
          </button>
          {connected && <button type="button" className="button secondary" disabled={busy} onClick={()=>void perform(()=>change('disconnect'))}>연결 해제</button>}
          {status.phase !== 'unconfigured' && <button type="button" className="button primary" disabled={busy} onClick={()=>void perform(()=>change('connect'))}>
            {connected?'Google 다시 연결':'Google 계정 연결'}
          </button>}
        </>}
    </div>}
    {(error || status?.notice) && <p role="alert">{error || status?.notice}</p>}
    {connected && <>
      <nav className="native-pim-tabs" aria-label="Google 자료">
        <button type="button" aria-pressed={kind==='mails'} disabled={busy} onClick={()=>switchTo('mails')}>Google 메일</button>
        <button type="button" aria-pressed={kind==='events'} disabled={busy} onClick={()=>switchTo('events')}>Google 일정</button>
      </nav>
      {kind==='events' && <label>캘린더<select value={calendarId} disabled={busy}
        onChange={event=>{const next=event.target.value;setCalendarId(next);void perform(()=>refreshRows(kind,next,query));}}>
        <option value="primary">기본 캘린더</option>
        {calendars.filter(calendar=>!calendar.primary).map(calendar=><option value={calendar.id} key={calendar.id}>{calendar.title}</option>)}
      </select></label>}
      <form className="native-pim-search" onSubmit={event=>{event.preventDefault();void perform(()=>refreshRows(kind,calendarId,query));}}>
        <label>{kind==='mails'?'Google 메일 검색':'Google 일정 검색'}<input value={query} maxLength={240} onChange={event=>setQuery(event.target.value)}/></label>
        <button disabled={busy}>{busy?'조회 중':'조회'}</button>
      </form>
      {kind==='events' && <p>오늘부터 14일 이내의 일정을 표시합니다.</p>}
      {items && items.length===0 && <p className="empty-hint">조회 조건에 맞는 자료가 없습니다.</p>}
      {items?.map(item=><article className="integration-item" key={item.id}>
        <div><strong>{item.title}</strong><small>{[dateLabel(item.at),item.from].filter(Boolean).join(' / ')}</small>{item.detail&&<p>{item.detail}</p>}</div>
        {kind==='mails' && <div className="integration-item-actions"><button type="button" disabled={busy} onClick={()=>void perform(async()=>{
          setMessage(await api!.readGoogleData({action:'mail',id:item.id}));
        })}>메일 본문 읽기</button></div>}
      </article>)}
      {message && <section className="integration-body"><h4>{message.title}</h4><pre>{message.body}</pre></section>}
    </>}
  </section>;
}
