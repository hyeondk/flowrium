import { AnimatedCheckbox } from './ui-motion';
import { useState } from 'react';
import type { GoogleCalendar, GoogleEventInput, GoogleEventPreview, RemoteItem } from '../shared/integrations';
const local = (value?: string) => { if (!value) return ''; if (value.length === 10) return value; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const verbs = { create: '등록', update: '수정', delete: '삭제' };
export default function GoogleEventEditor({ calendars, calendarId, item, onSaved, provider = 'google' }: { calendars: GoogleCalendar[]; calendarId: string; item?: RemoteItem; onSaved: (message:string) => void; provider?: 'google' | 'mac' }) {
  const [action, setAction] = useState<GoogleEventInput['action']>(item ? 'update' : 'create');
  const [title, setTitle] = useState(item?.title || ''), [start, setStart] = useState(item?.allDay?local(item.at).slice(0,10):local(item?.at)), [end, setEnd] = useState(item?.allDay?local(item.end).slice(0,10):local(item?.end));
  const [description, setDescription] = useState(item?.description || ''), [location, setLocation] = useState(item?.location || '');
  const [allDay, setAllDay] = useState(item?.allDay ?? item?.at?.length === 10), [preview, setPreview] = useState<GoogleEventPreview>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const selected = calendars.find(c => c.id === calendarId || (calendarId === 'primary' && c.primary));
  function dirty() { setPreview(undefined); setNotice(''); }
  async function prepare() {
    setBusy(true); setNotice('');
    try { setPreview(await window.flowrium![provider==='mac'?'prepareMacEvent':'prepareGoogleEvent']({ action, calendarId, eventId: item?.id, etag: item?.etag,
      ...(action !== 'delete' && { summary: title, start: allDay ? start : new Date(start).toISOString(), end: allDay ? end : new Date(end).toISOString(), description, location }) })); }
    catch(e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || busy) return;
    setBusy(true); setNotice('');
    try { await window.flowrium![provider==='mac'?'commitMacEvent':'commitGoogleEvent'](preview.id); setPreview(undefined); setNotice(''); onSaved('일정을 ' + verbs[action] + '했습니다.'); }
    catch(e) { setPreview(undefined); setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="integration-event" aria-label="일정 편집">
    <h4>{item ? '선택한 일정' : '새 일정'} / {selected?.title || calendarId}</h4>
    <fieldset disabled={busy || !selected?.writable}>
      <label>일정 작업<select aria-label="일정 작업" value={action} onChange={e => {setAction(e.target.value as GoogleEventInput['action']);dirty();}}><option value="create">새 일정 등록</option>{item && <><option value="update">선택한 일정 수정</option><option value="delete">선택한 일정 삭제</option></>}</select></label>
      {action !== 'delete' && <>
        <label>일정 제목<input value={title} maxLength={500} onChange={e => {setTitle(e.target.value);dirty();}}/></label>
        <label><AnimatedCheckbox checked={!!allDay} onChange={e => {setAllDay(e.target.checked);setStart('');setEnd('');dirty();}}/>하루 종일</label>
        <div className="integration-period"><label>시작<input type={allDay ? 'date' : 'datetime-local'} value={start} onChange={e => {setStart(e.target.value);dirty();}}/></label>
          <label>종료<input type={allDay ? 'date' : 'datetime-local'} value={end} onChange={e => {setEnd(e.target.value);dirty();}}/></label></div>
        {allDay && <p>종료일은 일정에 포함하지 않습니다. 하루 일정은 다음 날을 종료일로 정하세요.</p>}
        <label>장소<input value={location} maxLength={2000} onChange={e => {setLocation(e.target.value);dirty();}}/></label>
        <label>설명<textarea value={description} maxLength={12000} onChange={e => {setDescription(e.target.value);dirty();}}/></label>
      </>}
      {!preview && <button disabled={busy || (action !== 'delete' && (!title.trim() || !start || !end))} onClick={() => void prepare()}>변경할 일정 검토</button>}
      {preview && <div className="integration-review" role="region" aria-label="일정 변경 검토">
        <strong>{preview.calendarName} / {verbs[preview.action]}</strong>
        {preview.previous && <p>현재 / {preview.previous.title} / {preview.previous.at} ~ {preview.previous.end}</p>}
        {preview.event && <p>변경 / {preview.event.title} / {preview.event.at} ~ {preview.event.end}<br/>{preview.event.detail}</p>}
        <button onClick={() => void commit()}>확인하고 일정 {verbs[preview.action]}</button><button onClick={() => setPreview(undefined)}>취소</button>
      </div>}
    </fieldset>
    {!selected?.writable && <p>선택한 캘린더에는 쓰기 권한이 없습니다.</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
