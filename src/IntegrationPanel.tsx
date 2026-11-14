import { useEffect, useState } from "react";
import {
  CalendarDays,
  FileText,
  Mail,
  RefreshCw,
  ExternalLink,
  Download,
} from "lucide-react";
import type { GoogleStatus, RemoteItem, GoogleCalendar } from "../shared/integrations";
import GoogleEventEditor from './GoogleEventEditor';
import NativePimPanel from './NativePimPanel';
import LinkDeliveryPanel from './LinkDeliveryPanel';
import './integrations.css';
export default function IntegrationPanel({
  projectId,
}: {
  projectId?: string;
}) {
  const [status, setStatus] = useState<GoogleStatus>(),
    [client, setClient] = useState(""),
    [secret, setSecret] = useState(""),
    [kind, setKind] = useState<"calendar" | "drive" | "mail">("calendar"),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<RemoteItem[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const api = window.flowrium;
  const [calendars,setCalendars] = useState<GoogleCalendar[]>([]), [calendarId,setCalendarId] = useState('primary');
  const [selectedEvent,setSelectedEvent] = useState<RemoteItem>(), [body,setBody] = useState<{title:string;body:string}>();
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (api) setStatus(await api.googleStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    api
      ?.googleStatus()
      .then((v) => {
        if (active) setStatus(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function read(next = kind, calendar = calendarId) {
    if (api) {
      setKind(next);
      setBody(undefined);setSelectedEvent(undefined);
      if(next === 'calendar') setCalendars(await api.googleCalendars());
      setItems(await api.readGoogle({ kind: next, query, calendarId: calendar }));
    }
  }
  return (
    <><section className="integration-panel settings-section">
      <h3>메일과 일정, 드라이브</h3>
      <p>본인의 Google 계정을 연결해 자료를 확인하고 프로젝트로 가져옵니다.</p>
      <div className="connection-state">
        <span className={"status-dot " + (status?.connected ? "online" : "")} />
        {status?.connected
          ? status.account || "Google 연결됨"
          : status?.authorizing
            ? "브라우저에서 승인 대기 중"
            : status?.configured
              ? "계정 연결 대기"
              : "연결 설정 전"}
      </div>
      {(
        <details>
          <summary>Google 연결 설정</summary>
          <p>
            Google Cloud에서 만든 데스크톱 앱 OAuth 클라이언트를 입력합니다.
            Calendar, Drive, Gmail API를 활성화해 주세요.
          </p>
          <label>
            클라이언트 ID
            <input
              autoComplete="off"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </label>
          <label>
            클라이언트 보안 비밀
            <input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !client.trim()}
            onClick={() =>
              void perform(async () => {
                await api?.configureGoogle({
                  clientId: client.trim(),
                  clientSecret: secret.trim(),
                });
                setClient("");
                setSecret("");
              })
            }
          >
            연결 설정 저장
          </button>
        </details>
      )}
      <div className="settings-buttons">
        {status?.connected && (!status.calendarWrite || !status.mailSend) && <button disabled={busy || status.authorizing} onClick={()=>void perform(()=>api!.connectGoogle())}>일정과 메일 권한 다시 연결</button>}
        {!status?.connected && (
          <button
            className="button secondary"
            disabled={busy || !status?.configured || status?.authorizing}
            onClick={() => void perform(() => api!.connectGoogle())}
          >
            Google 계정으로 연결
          </button>
        )}
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => void perform(() => api!.googleStatus())}
        >
          <RefreshCw size={14} />
          연결 확인
        </button>
        {status?.connected && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api?.disconnectGoogle();
                setItems([]);
              })
            }
          >
            Google 연결 해제
          </button>
        )}
      </div>
      {status?.connected && (
        <>
          {kind === 'calendar' && <label>캘린더<select aria-label="조회할 캘린더" value={calendarId} disabled={busy} onChange={e=>{const id=e.target.value;setCalendarId(id);void perform(()=>read('calendar',id));}}><option value="primary">기본 캘린더</option>{calendars.map(c=><option value={c.id} key={c.id}>{c.title}{c.writable?'':' (읽기 전용)'}</option>)}</select></label>}
          <nav className="integration-tabs">
            {(
              [
                ["calendar", "일정", CalendarDays],
                ["drive", "드라이브", FileText],
                ["mail", "메일", Mail],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                className="button subtle"
                key={id}
                aria-pressed={kind === id}
                disabled={busy}
                onClick={() => void perform(() => read(id))}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
          <form
            className="integration-search"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(() => read());
            }}
          >
            <input
              aria-label="연동 자료 검색"
              placeholder={
                kind === "calendar"
                  ? "일주일 일정 검색"
                  : kind === "drive"
                    ? "파일 이름 검색"
                    : "메일 검색"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="button secondary" disabled={busy}>
              조회
            </button>
          </form>
          {!items.length && (
            <p className="empty-hint">
              조회 결과가 없습니다. 검색어를 바꾸거나 조회를 눌러 주세요.
            </p>
          )}
          {items.map((item) => (
            <article className="integration-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.at ? new Date(item.at).toLocaleString("ko-KR") : ""}
                </small>
                <p>{item.detail}</p>
              </div>
              <div className="integration-item-actions">
                {item.url && (
                  <a
                    href={item.url}
                    onClick={(e) => {
                      e.preventDefault();
                      void perform(() => api!.openGoogleItem(item.url!));
                    }}
                  >
                    <ExternalLink size={14} />
                    원본
                  </a>
                )}
                {kind === 'calendar' && <button disabled={busy} onClick={()=>setSelectedEvent(item)}>일정 상세와 수정</button>}
                {(kind === 'mail' || kind === 'drive') && <button disabled={busy} onClick={()=>void perform(async()=>{
                  const value=kind==='mail'?await api!.googleMail(item.id):await api!.googleDocument(item.id);
                  setBody({title:kind==='mail'?item.title:('name' in value?value.name:item.title),body:value.body});
                })}>본문 읽기</button>}
                {kind === "drive" && projectId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await api!.importGoogleFile(
                          projectId,
                          item.id,
                        );
                        setNotice("프로젝트에 저장했습니다. " + result.path);
                      })
                    }
                  >
                    <Download size={14} />
                    가져오기
                  </button>
                )}
              </div>
            </article>
          ))}
          {body && <section className="integration-body" aria-label="연동 자료 본문"><h4>{body.title}</h4><pre>{body.body || '이 파일은 본문 미리보기를 지원하지 않습니다. 프로젝트로 가져와 파일을 여세요.'}</pre></section>}
          {kind==='calendar' && status.calendarWrite && <GoogleEventEditor key={calendarId+':'+(selectedEvent?.id||'new')} calendars={calendars} calendarId={calendarId} item={selectedEvent} onSaved={message=>{setNotice(message);void perform(()=>read());}}/>}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section><NativePimPanel/><LinkDeliveryPanel/></>
  );
}
