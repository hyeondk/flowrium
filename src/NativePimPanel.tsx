import {useEffect,useState} from 'react';
import type {GoogleCalendar,RemoteItem} from '../shared/integrations';
import GoogleEventEditor from './GoogleEventEditor';
export default function NativePimPanel(){
 const api=window.flowrium;
 const[status,setStatus]=useState<{available:boolean;enabled:boolean}>(),[calendars,setCalendars]=useState<GoogleCalendar[]>([]),[items,setItems]=useState<RemoteItem[]>([]);
 const[kind,setKind]=useState<'events'|'mails'>('events'),[calendarId,setCalendar]=useState('primary'),[selected,setSelected]=useState<RemoteItem>(),[body,setBody]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{let alive=true;api?.macPimStatus().then(v=>{if(alive)setStatus(v);}).catch(()=>{});return()=>{alive=false;};},[]);
 async function perform(fn:()=>Promise<void>){if(busy)return;setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 async function read(next=kind,cal=calendarId){setKind(next);setSelected(undefined);setBody('');if(next==='events')setCalendars(await api!.macPim({action:'calendars'}));const result=await api!.macPim({action:next,calendarId:cal,query});setItems(result||[]);if(result===null)setNotice('메일 앱을 먼저 열어 주세요.');}
 if(!status?.available)return null;
 return <section className="settings-section integration-panel native-pim-panel"><h3>맥 메일과 캘린더</h3><p>이 맥에 연결한 계정으로 자료를 읽고, 검토한 일정 변경을 적용합니다. 처음에는 운영체제가 접근 권한을 요청할 수 있습니다.</p>
 <button className="native-pim-toggle button secondary" aria-pressed={status.enabled} disabled={busy} onClick={()=>void perform(async()=>{const next=await api!.configureMacPim(!status.enabled);setStatus(next);setItems([]);setSelected(undefined);setBody('');})}>{status.enabled?'맥 기본 앱 연결 끄기':'맥 기본 앱 연결 켜기'}</button>
 {status.enabled&&<><nav className="native-pim-tabs"><button aria-pressed={kind==='events'} disabled={busy} onClick={()=>void perform(()=>read('events'))}>맥 일정 조회</button><button aria-pressed={kind==='mails'} disabled={busy} onClick={()=>void perform(()=>read('mails'))}>맥 메일 조회</button></nav>
 {kind==='events'&&<label>맥 캘린더<select value={calendarId} onChange={e=>{const id=e.target.value;setCalendar(id);void perform(()=>read('events',id));}}><option value="primary">기본 캘린더</option>{calendars.map(c=><option value={c.id} key={c.id}>{c.title}{c.writable?'':' (읽기 전용)'}</option>)}</select></label>}
 <form className="native-pim-search" onSubmit={e=>{e.preventDefault();void perform(()=>read());}}><label>기본 앱 자료 검색<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy}>검색</button></form>
 {items.map(item=><article className="integration-item" key={item.id}><div><strong>{item.title}</strong><small>{item.at}</small><p>{item.detail}</p></div><div className="integration-item-actions"><button disabled={busy} onClick={()=>kind==='events'?setSelected(item):void perform(async()=>{const result=await api!.macPim({action:'mail',id:item.id});setSelected(item);setBody(result.body);})}>{kind==='events'?'일정 상세와 수정':'메일 본문 읽기'}</button></div></article>)}
 {body&&<section className="integration-body"><h4>{selected?.title}</h4><pre>{body}</pre></section>}
 {kind==='events'&&<GoogleEventEditor provider="mac" key={calendarId+':'+(selected?.id||'new')} calendars={calendars} calendarId={calendarId} item={selected} onSaved={message=>void perform(async()=>{await read();setNotice(message);})}/>}</>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
