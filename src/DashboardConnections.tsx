import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, ExternalLink, LoaderCircle, Mail, RefreshCw, X } from 'lucide-react';
import type { GoogleStatus, RemoteItem } from '../shared/integrations';
import './dashboard-connections.css';

type MailContent = { id: string; title: string; from: string; to: string; at: string; body: string; url: string };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function time(value?: string) {
  if (!value) return '';
  if (value.length === 10) return '하루 종일';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date) : '';
}

export default function DashboardConnections({ onOpenCalendar }: { onOpenCalendar(): void }) {
  const api = window.flowrium;
  const [status, setStatus] = useState<GoogleStatus>();
  const [events, setEvents] = useState<RemoteItem[]>([]), [mails, setMails] = useState<RemoteItem[]>([]);
  const [errors, setErrors] = useState({ calendar: '', mail: '', connection: '' });
  const [busy, setBusy] = useState(false), [mailBusy, setMailBusy] = useState(false);
  const [selected, setSelected] = useState<MailContent>();
  const dialog = useRef<HTMLDialogElement>(null), alive = useRef(true), request = useRef(0), mailRequest = useRef(0), lastLoaded = useRef(0);
  const statusRef = useRef<GoogleStatus | undefined>(undefined);

  const load = useCallback(async (force = false) => {
    if (!api || (!force && Date.now() - lastLoaded.current < 30000)) return;
    lastLoaded.current = Date.now();
    const revision = ++request.current;
    setBusy(true); setErrors({ calendar: '', mail: '', connection: '' });
    try {
      const value = await api.googleStatus();
      if (!alive.current || revision !== request.current) return;
      if (statusRef.current?.account !== value.account || !value.connected) { setEvents([]); setMails([]); setSelected(undefined); mailRequest.current++; }
      statusRef.current = value; setStatus(value);
      if (!value.connected) return;
      const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), now.getDate()), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const results = await Promise.allSettled([
        api.readGoogle({ kind: 'calendar', calendarId: 'primary', from: first.toISOString(), to: next.toISOString() }),
        api.readGoogle({ kind: 'mail', query: 'is:unread' }),
      ]);
      const current = await api.googleStatus();
      if (!alive.current || revision !== request.current) return;
      if (!current.connected || current.account !== value.account) { statusRef.current = current; setStatus(current); setEvents([]); setMails([]); setSelected(undefined); mailRequest.current++; return; }
      setEvents(results[0].status === 'fulfilled' ? results[0].value.slice(0, 5) : []);
      setMails(results[1].status === 'fulfilled' ? results[1].value.slice(0, 5) : []);
      setErrors({ connection: '', calendar: results[0].status === 'rejected' ? message(results[0].reason) : '', mail: results[1].status === 'rejected' ? message(results[1].reason) : '' });
    } catch (error) { if (alive.current && revision === request.current) setErrors({ calendar: '', mail: '', connection: message(error) }); }
    finally { if (alive.current && revision === request.current) setBusy(false); }
  }, [api]);

  useEffect(() => {
    alive.current = true; void load(true);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { alive.current = false; request.current++; mailRequest.current++; window.removeEventListener('focus', focus); };
  }, [load]);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);

  function close() { mailRequest.current++; setSelected(undefined); setMailBusy(false); }
  async function openMail(item: RemoteItem) {
    if (!api || !statusRef.current?.connected) return;
    const revision = ++mailRequest.current, owner = statusRef.current.account;
    setSelected({ id: item.id, title: item.title, from: item.from || '', to: '', at: item.at || '', body: '', url: item.url || 'https://mail.google.com/' }); setMailBusy(true);
    try {
      const body = await api.googleMail(item.id), current = await api.googleStatus();
      if (!alive.current || revision !== mailRequest.current) return;
      if (!current.connected || current.account !== owner) { close(); return; }
      setSelected(body);
    } catch (error) { if (alive.current && revision === mailRequest.current) setSelected(current => current ? { ...current, body: '본문을 읽지 못했습니다.\n' + message(error) } : current); }
    finally { if (alive.current && revision === mailRequest.current) setMailBusy(false); }
  }
  const unconnected = <div className="dc-unconnected"><p>{status?.authorizing ? '브라우저에서 Google 로그인을 마쳐 주세요.' : 'Google 계정을 연결하면 이곳에서 확인할 수 있습니다.'}</p><button type="button" onClick={onOpenCalendar}>일정 화면에서 연결하기<ChevronRight size={14} /></button></div>;

  return <section className="dashboard-connections" aria-label="오늘 일정과 미확인 메일">
    <header className="dc-heading"><span>내 외부 자료</span><button type="button" disabled={busy} onClick={() => void load(true)} aria-label="대시보드 외부 자료 새로고침"><RefreshCw size={14} className={busy ? 'spin' : ''} />새로고침</button></header>
    {errors.connection && <p className="dc-error" role="status">연결 상태를 확인하지 못했습니다. {errors.connection}</p>}
    <div className="dc-grid"><article className="dc-card" aria-label="오늘 일정 요약"><header><h2><CalendarDays size={17} />오늘 일정</h2><button type="button" onClick={onOpenCalendar}>일정 열기<ChevronRight size={14} /></button></header>
      {!status && busy ? <p className="dc-empty"><LoaderCircle size={15} className="spin" />연결 확인 중</p> : !status?.connected ? unconnected : errors.calendar ? <p className="dc-error" role="status">일정을 읽지 못했습니다. {errors.calendar}</p> : !events.length ? <p className="dc-empty">{busy ? '일정 조회 중…' : '오늘 등록된 일정이 없습니다.'}</p> : <ul>{events.map(event => <li key={event.id}><button type="button" onClick={onOpenCalendar}><time>{time(event.at)}</time><span><strong>{event.title}</strong>{event.location && <small>{event.location}</small>}</span><ChevronRight size={14} /></button></li>)}</ul>}
      {status?.connected && <footer>기본 캘린더의 오늘 일정 / 최대 5개</footer>}
    </article><article className="dc-card" aria-label="미확인 메일 요약"><header><h2><Mail size={17} />미확인 메일</h2><span>직접 선택하면 본문을 엽니다</span></header>
      {!status && busy ? <p className="dc-empty"><LoaderCircle size={15} className="spin" />연결 확인 중</p> : !status?.connected ? unconnected : errors.mail ? <p className="dc-error" role="status">메일을 읽지 못했습니다. {errors.mail}</p> : !mails.length ? <p className="dc-empty">{busy ? '메일 조회 중…' : '표시할 미확인 메일이 없습니다.'}</p> : <ul>{mails.map(mail => <li key={mail.id}><button type="button" onClick={() => void openMail(mail)}><span className="dc-mail-dot" /><span><strong>{mail.title}</strong><small>{mail.from || mail.detail}</small></span><ChevronRight size={14} /></button></li>)}</ul>}
      {status?.connected && <footer>최근 미확인 메일 / 최대 5개 / 자동 변경과 발송 없음</footer>}
    </article></div>
    {selected && <dialog ref={dialog} className="dc-mail-dialog" aria-label="받은 메일 본문" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><section><header><div><span>받은 메일</span><h2>{selected.title}</h2></div><button type="button" aria-label="메일 본문 닫기" onClick={close}><X size={18} /></button></header><dl><div><dt>보낸 사람</dt><dd>{selected.from}</dd></div>{selected.to && <div><dt>받는 사람</dt><dd>{selected.to}</dd></div>}</dl>{mailBusy ? <p role="status" className="dc-empty"><LoaderCircle size={16} className="spin" />본문을 읽고 있습니다.</p> : <pre>{selected.body}</pre>}<footer><button type="button" onClick={close}>닫기</button>{selected.url && <button type="button" onClick={() => void api?.openGoogleItem(selected.url).catch(error => setErrors(current => ({ ...current, mail: message(error) })))}><ExternalLink size={15} />Gmail에서 보기</button>}</footer></section></dialog>}
  </section>;
}
