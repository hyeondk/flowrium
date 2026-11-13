import { AnimatedCheckbox, AnimatedSwitch } from './ui-motion';
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import InputRequestPanel from "./InputRequestPanel";
import type {FlowriumAPI,Session} from "../shared/types";
import type {WorkflowAction,WorkflowAPI,WorkflowPreferences,WorkflowProposal,WorkflowState} from "../shared/workflow";
import "./workflow.css";

const proposalState={pending:"결정 대기",running:"진행 중",completed:"완료",rejected:"거절",failed:"실패",held:"확인 후 재시도"};
const deliveryState={queued:"전달 대기",dispatching:"전달 중",sent:"전달됨",failed:"실패",held:"확인 필요"};
const dayNames=["일","월","화","수","목","금","토"];
const describe=(e:unknown)=>e instanceof Error?e.message:String(e);
function EventPreview({proposal}:{proposal:WorkflowProposal}){
  const value=proposal.preview;if(!value)return null;
  if(value.kind==="repository"&&value.rows)return <section aria-label="저장소 변경 검토"><h4>저장소 변경 검토 / {value.projectName}</h4>{value.rows.map((row,index)=><div key={index}>
    <strong>{row.name}</strong><p>작업 브랜치 / {row.expected?.branch}</p><p>커밋 메시지 / {row.message}</p>
    <p>실행할 마지막 단계 / {({commit:"로컬 커밋",push:"원격 푸시",pr:"변경 요청 생성",merge:"변경 요청 병합",done:"업무 완료"} as Record<string,string>)[row.through]||row.through}</p>
    <p>{row.through==="commit"?"선택한 변경을 현재 로컬 브랜치에 커밋합니다.":"선택한 변경을 커밋한 뒤 연결된 원격 저장소에 반영합니다. 표시한 마지막 단계까지 진행합니다."}</p>
    <details><summary>선택한 파일 {row.files.length}개와 기준 커밋 확인</summary><p>기준 커밋 / {row.expected?.head}</p><pre>{row.files.join("\n")}</pre></details>
  </div>)}<p>승인하면 표시한 단계까지 실행합니다. 파일이나 기준 커밋이 달라지면 실행을 거절합니다.</p></section>;
  return <section aria-label="외부 변경 검토"><h4>외부 변경 검토 / {value.calendarName||"일정"}</h4>
    {([ ["변경 전",value.previous],["적용할 내용",value.event] ] as const).map(([title,event])=>event&&<div key={title}><strong>{title}</strong>
      <dl><dt>제목</dt><dd>{event.title||"제목 없음"}</dd><dt>시작</dt><dd>{event.at?new Date(event.at).toLocaleString("ko-KR"):"확인 필요"}</dd>
        <dt>종료</dt><dd>{event.end?new Date(event.end).toLocaleString("ko-KR"):"확인 필요"}</dd><dt>장소</dt><dd>{event.location||"없음"}</dd><dt>본문</dt><dd>{event.description||"없음"}</dd></dl></div>)}
    <p>{value.action==="delete"?"승인하면 위 일정을 삭제합니다.":"승인하면 위 내용을 외부 일정에 적용합니다."}</p>
    {value.expiresAt&&<p>확인 유효 시각 / {new Date(value.expiresAt).toLocaleString("ko-KR")}</p>}
  </section>;
}

export default function WorkflowHub({onOpen,onOpenInbox}:{onOpen?:(session:Session)=>void;onOpenInbox?:()=>void}){
  const api=window.flowrium as (FlowriumAPI&WorkflowAPI)|undefined;
  const [data,setData]=useState<WorkflowState>();
  const [tab,setTab]=useState<"decisions"|"notifications"|"messages"|"assistant">("decisions");
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [showHidden,setShowHidden]=useState(false),[showHistory,setShowHistory]=useState(false),[unreadOnly,setUnreadOnly]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [source,setSource]=useState(""),[target,setTarget]=useState(""),[title,setTitle]=useState(""),[message,setMessage]=useState(""),[project,setProject]=useState("");
  const [when,setWhen]=useState(""),[reminder,setReminder]=useState(""),[repeatDays,setRepeatDays]=useState(0);
  const [prefs,setPrefs]=useState<WorkflowPreferences>();
  const alive=useRef(true),sending=useRef(false),prefDirty=useRef(false);
  const refresh=useCallback(async()=>{
    if(!api)return;
    const next=await api.workflowState();if(!alive.current)return;
    setData(next);if(!prefDirty.current)setPrefs(next.preferences);
    setSelected(previous=>previous.filter(id=>next.proposals.some(p=>p.id===id)));
  },[api]);
  useEffect(()=>{
    alive.current=true;void refresh().catch(e=>{if(alive.current)setError(describe(e));});
    const timer=setInterval(()=>{if(!document.hidden)void refresh().catch(()=>{});},2500);
    let owner:number|undefined;
    const cleanup=api?.onSecurity(state=>{
      if(state.locked||owner!==undefined&&owner!==state.accountRevision){
        setData(undefined);setMessage("");setTitle("");setReminder("");setSelected([]);setPrefs(undefined);prefDirty.current=false;
      }
      owner=state.accountRevision;if(!state.locked)void refresh().catch(()=>{});
    });
    return()=>{alive.current=false;clearInterval(timer);cleanup?.();};
  },[api,refresh]);
  async function act(input:WorkflowAction,success?:string){
    if(!api||sending.current)return;
    sending.current=true;setBusy(true);setError("");setNotice("");
    try{const result=await api.workflowAction(input);await refresh();if(success)setNotice(success);return result;}
    catch(e){setError(describe(e));await refresh().catch(()=>{});}
    finally{sending.current=false;setBusy(false);}
  }
  async function open(sessionId:string|null){
    if(!sessionId||!api)return;
    try{const snapshot=await api.bootstrap();const session=snapshot.sessions.find(s=>s.id===sessionId);if(!session)throw new Error("대화가 삭제됐거나 다른 위치로 옮겨졌습니다.");
      await api.workflowAction({action:"readSession",sessionId});onOpen?.(session);await refresh();}
    catch(e){setError(describe(e));}
  }
  function preference<K extends keyof WorkflowPreferences>(key:K,value:WorkflowPreferences[K]){
    prefDirty.current=true;setPrefs(previous=>previous?{...previous,[key]:value}:previous);
  }
  function chosen(){return(data?.proposals||[]).filter(p=>selected.includes(p.id)).map(p=>({id:p.id,revision:p.revision}));}
  function proposalAction(p:WorkflowProposal,action:"approve"|"reject"|"hide"|"restore"){
    void act({action,id:p.id,revision:p.revision});
  }
  async function send(event:FormEvent,request:boolean){
    event.preventDefault();if(!message.trim()||(!request&&!target))return;
    const result=await act(request?{action:"request",sourceId:source||undefined,targetId:target||undefined,projectId:project||undefined,title:title.trim(),text:message.trim()}:
      {action:"send",sourceId:source||null,targetId:target,text:message.trim()},request?"실행 제안을 결정함에 추가했습니다.":"메시지를 전달했습니다.");
    if(result){setMessage("");setTitle("");if(request)setTab("decisions");}
  }
  if(!api)return <p>데스크톱 앱에서 작업 공간을 열어 주세요.</p>;
  const pending=(data?.proposals||[]).filter(p=>(showHidden||!p.hidden)&&(showHistory||p.status==="pending"||p.status==="running"||p.status==="held")&&(showHidden||!p.snoozedUntil||p.snoozedUntil<=Date.now()));
  const unread=data?.notifications.filter(n=>!n.readAt).length||0;
  return <section className="workflow-hub" aria-label="업무 연결과 비서">
    <header><div><h2>업무 연결과 비서</h2><p>대화 사이의 요청과 결과, 필요한 결정과 알림을 한곳에서 확인합니다.</p></div>
      <button disabled={busy} onClick={()=>void refresh().catch(e=>setError(describe(e)))}>새로고침</button></header>
    <nav aria-label="업무 연결 화면">{([
      ["decisions","결정과 보고"],["notifications",`알림 ${unread}`],["messages","대화에 전달"],["assistant","비서와 예약"]
    ] as const).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data&&<p>업무 연결 기록을 불러오고 있습니다.</p>}
    {data&&tab==="decisions"&&<>
      <div className="workflow-actions"><label><AnimatedSwitch checked={showHidden} onChange={e=>setShowHidden(e.target.checked)}/>숨긴 항목과 미룬 항목</label>
        <label><AnimatedSwitch checked={showHistory} onChange={e=>setShowHistory(e.target.checked)}/>처리한 기록</label>
        <button disabled={busy||!data.proposals.some(p=>p.status==="pending")} onClick={()=>void act({action:"recommend"},"결정 묶음을 검토하는 대화를 시작했습니다. 승인 전에는 업무를 실행하지 않습니다.")}>AI로 결정 묶음 추천</button>
        {onOpenInbox&&<button onClick={onOpenInbox}>실행 승인함 열기</button>}</div>
      {data.pending.map(event=>event.questions?<InputRequestPanel key={event.requestId} event={event} title={data.sessions.find(s=>s.id===event.sessionId)?.title} onOpen={()=>void open(event.sessionId||null)}/>:
        <article className="workflow-card" key={event.requestId}><h3>실행 승인 / {data.sessions.find(s=>s.id===event.sessionId)?.title}</h3><pre>{event.details||event.text}</pre>
          <button disabled={busy} onClick={()=>void api.approval({requestId:event.requestId!,decision:"accept"}).then(refresh).catch(e=>setError(describe(e)))}>허용</button>
          <button disabled={busy} onClick={()=>void api.approval({requestId:event.requestId!,decision:"decline"}).then(refresh).catch(e=>setError(describe(e)))}>거절</button></article>)}
      {selected.length>0&&<div className="workflow-actions" aria-label="선택한 결정 처리">
        <button disabled={busy} onClick={()=>void act({action:"bulk",operation:"approve",items:chosen().filter(v=>data.proposals.find(p=>p.id===v.id)?.status==="pending")})}>선택한 항목 승인</button>
        <button disabled={busy} onClick={()=>void act({action:"bulk",operation:"reject",items:chosen()})}>선택한 항목 거절</button>
        <button disabled={busy} onClick={()=>void act({action:"bulk",operation:"hide",items:chosen()})}>선택한 항목 숨기기</button>
        <button disabled={busy} onClick={()=>void act({action:"bulk",operation:"restore",items:chosen()})}>선택한 항목 복원</button>
      </div>}
      {!pending.length&&!data.pending.length&&<p>확인할 결정이 없습니다.</p>}
      {pending.map(p=><article className="workflow-card" key={p.id}>
        <header><label><AnimatedCheckbox checked={selected.includes(p.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><strong>{p.title}</strong></label><span>{proposalState[p.status]}</span></header>
        <p>{new Date(p.createdAt).toLocaleString("ko-KR")}</p><EventPreview proposal={p}/>{!(p.kind==="external"&&p.preview)&&<pre>{p.body}</pre>}{p.result&&<details><summary>처리 결과</summary><pre>{p.result}</pre></details>}
        <div className="workflow-actions">{p.status==="pending"&&<><button disabled={busy} onClick={()=>proposalAction(p,"approve")}>내용 확인하고 승인</button><button disabled={busy} onClick={()=>proposalAction(p,"reject")}>거절</button>
          <button disabled={busy} onClick={()=>void act({action:"snooze",id:p.id,revision:p.revision,minutes:60})}>한 시간 미루기</button></>}
          <button disabled={busy} onClick={()=>proposalAction(p,p.hidden?"restore":"hide")}>{p.hidden?"목록에 복원":"목록에서 숨기기"}</button>
          {["failed","held"].includes(p.status)&&p.method==="repositoryFlow"&&<button disabled={busy} onClick={()=>void act({action:"resumeExternal",id:p.id,revision:p.revision})}>기록 확인 후 실패 위치에서 재개</button>}
          {p.sourceId&&<button onClick={()=>void open(p.sourceId)}>요청 대화</button>}{p.targetId&&<button onClick={()=>void open(p.targetId)}>담당 대화</button>}
        </div></article>)}
      {data.reports.length>0&&<details><summary>프로젝트 보고 기록 {data.reports.length}개</summary>{data.reports.map(r=><article key={r.id}><h3>{new Date(r.at).toLocaleString("ko-KR")} / {r.reason}</h3>
        <p>{r.status==="queued"?"AI 보고 대기":r.status==="writing"?"AI 보고 작성 중":r.status==="failed"?"작성 확인 필요":"보고 완료"}</p>
        {r.body&&<pre>{r.body}</pre>}{r.artifactPath&&<p>저장한 산출물 / {r.artifactPath}</p>}{r.error&&<p>{r.error}</p>}{r.sessionId&&<button onClick={()=>void open(r.sessionId||null)}>보고 대화 열기</button>}</article>)}</details>}
    </>}
    {data&&tab==="notifications"&&<>
      <div className="workflow-actions"><label><AnimatedSwitch checked={unreadOnly} onChange={e=>setUnreadOnly(e.target.checked)}/>미확인 알림만</label>
        <button disabled={busy||!unread} onClick={()=>void act({action:"read",ids:data.notifications.filter(n=>!n.readAt).map(n=>n.id)})}>모두 읽음</button>
        <button disabled={busy} onClick={()=>void act({action:"clearNotifications",readOnly:true})}>읽은 알림 정리</button></div>
      {[...new Set(data.notifications.map(n=>n.group))].map(group=><section key={group}><h3>{data.sessions.find(s=>s.id===group)?.title||(/^[a-f0-9-]{36}$/i.test(group)?"팀 업무 보고":group)}</h3>
        {data.notifications.filter(n=>n.group===group&&(!unreadOnly||!n.readAt)).map(n=><article className="workflow-card" key={n.id}>
          <h4>{!n.readAt&&"미확인 / "}{n.title}</h4><time>{new Date(n.createdAt).toLocaleString("ko-KR")}</time><p>{n.body}</p>
          <div className="workflow-actions">{!n.readAt&&<button onClick={()=>void act({action:"read",ids:[n.id]})}>읽음 표시</button>}{n.sessionId&&<button onClick={()=>void open(n.sessionId)}>대화 열기</button>}</div>
        </article>)}</section>)}
      {!data.notifications.length&&<p>도착한 알림이 없습니다.</p>}
    </>}
    {data&&tab==="messages"&&<>
      <form onSubmit={event=>void send(event,false)} className="workflow-form"><h3>대화에 메시지 또는 조사 요청 전달</h3>
        <label>보내는 대화<select aria-label="보내는 대화" value={source} onChange={e=>setSource(e.target.value)}><option value="">사용자가 직접 전달</option>{data.sessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <label>받는 대화<select aria-label="받는 대화" value={target} onChange={e=>setTarget(e.target.value)}><option value="">새 대화에 조사 요청</option>{data.sessions.filter(s=>s.id!==source).map(s=><option key={s.id} value={s.id}>{s.title}{s.running?" / 실행 중":""}</option>)}</select></label>
        {!target&&<label>새 대화를 보관할 프로젝트<select aria-label="새 대화를 보관할 프로젝트" value={project} onChange={e=>setProject(e.target.value)}><option value="">선택하세요</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label>조사 요청 제목<input maxLength={180} value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label>전할 내용<textarea aria-label="전할 내용" rows={5} maxLength={12000} value={message} onChange={e=>setMessage(e.target.value)}/></label>
        <p>메시지는 상대 대화의 작업이 끝나면 전달합니다. 조사 요청은 결정함에서 승인한 뒤 시작하고 결과를 요청 대화로 돌려줍니다.</p>
        <div className="workflow-actions"><button disabled={busy||!target||!message.trim()}>메시지 전달</button>
          <button type="button" disabled={busy||!title.trim()||!message.trim()||(!target&&!project&&!source)} onClick={event=>void send(event,true)}>승인할 조사 요청 만들기</button></div>
      </form>
      <h3>전달 기록</h3>{data.deliveries.map(d=><article className="workflow-card" key={d.id}><strong>{deliveryState[d.status]} / {data.sessions.find(s=>s.id===d.targetId)?.title||"대화"}</strong><p>{d.text}</p>{d.error&&<p>{d.error}</p>}
        {["held","failed"].includes(d.status)&&<button disabled={busy} onClick={()=>void act({action:"retryDelivery",id:d.id})}>대화 확인 후 다시 전달</button>}</article>)}
    </>}
    {data&&prefs&&tab==="assistant"&&<>
      <form className="workflow-form" onSubmit={event=>{event.preventDefault();void act({action:"preferences",value:prefs},"비서 운영 설정을 저장했습니다.").then(()=>{prefDirty.current=false;});}}>
        <h3>개인 비서 운영 설정</h3><p>켜기 전에는 주기 감시와 AI 보고를 실행하지 않습니다. AI 보고를 켜면 연결한 ChatGPT 계정의 사용량을 씁니다.</p>
        <label><AnimatedSwitch checked={prefs.enabled} onChange={e=>preference("enabled",e.target.checked)}/>정한 시간에 프로젝트 감시와 반복 목표 알림 켜기</label>
        <label><AnimatedSwitch checked={prefs.aiReports} onChange={e=>preference("aiReports",e.target.checked)}/>수집한 근거를 개인 비서 AI에게 보내 보고받기</label>
        <label>보고를 보관할 프로젝트<select aria-label="보고를 보관할 프로젝트" value={prefs.projectId||""} onChange={e=>preference("projectId",e.target.value||null)}><option value="">선택하세요</option>{data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>감시 주기<select aria-label="감시 주기" value={prefs.intervalMinutes} onChange={e=>preference("intervalMinutes",Number(e.target.value))}>{[5,15,30,60,120,240,1440].map(n=><option key={n} value={n}>{n}분</option>)}</select></label>
        <div className="workflow-actions"><label>시작 시각<select aria-label="시작 시각" value={prefs.startHour} onChange={e=>preference("startHour",Number(e.target.value))}>{Array.from({length:24},(_,n)=><option key={n} value={n}>{n}시</option>)}</select></label>
          <label>마침 시각<select aria-label="마침 시각" value={prefs.endHour} onChange={e=>preference("endHour",Number(e.target.value))}>{Array.from({length:24},(_,n)=><option key={n} value={n}>{n}시</option>)}</select></label></div>
        <fieldset><legend>운영 요일</legend><div className="workflow-actions">{dayNames.map((day,index)=><label key={day}><AnimatedCheckbox checked={prefs.weekdays.includes(index)} onChange={e=>preference("weekdays",e.target.checked?[...prefs.weekdays,index]:prefs.weekdays.filter(d=>d!==index))}/>{day}</label>)}</div></fieldset>
        <label>시간대<input value={prefs.timezone} maxLength={100} onChange={e=>preference("timezone",e.target.value)}/></label>
        <label><AnimatedSwitch checked={prefs.github} onChange={e=>preference("github",e.target.checked)}/>GitHub 현황을 보고에 포함</label>
        <label><AnimatedSwitch checked={prefs.mail} onChange={e=>preference("mail",e.target.checked)}/>연결한 메일 현황을 보고에 포함</label>
        <div className="workflow-actions"><button disabled={busy}>비서 설정 저장</button><button type="button" disabled={busy} onClick={()=>void act({action:"reportNow"},"현재 상태 보고를 만들었습니다.")}>지금 상태 보고</button></div>
      </form>
      <form className="workflow-form" onSubmit={event=>{event.preventDefault();void act({action:"reminderAdd",when:new Date(when).toISOString(),text:reminder,repeatDays},"알림을 등록했습니다.").then(result=>{if(result){setReminder("");setWhen("");}});}}>
        <h3>예약 알림</h3><label>알릴 시각<input type="datetime-local" required value={when} onChange={e=>setWhen(e.target.value)}/></label>
        <label>알릴 내용<textarea aria-label="알릴 내용" required rows={2} maxLength={2000} value={reminder} onChange={e=>setReminder(e.target.value)}/></label>
        <label>반복<select aria-label="반복" value={repeatDays} onChange={e=>setRepeatDays(Number(e.target.value))}><option value={0}>한 번</option><option value={1}>매일</option><option value={7}>매주</option><option value={30}>30일마다</option></select></label>
        <p>앱이 켜져 있고 잠금이 해제됐을 때 전달합니다. 놓친 알림은 다음 실행에서 한 번 전달합니다.</p><button disabled={busy||!when||!reminder.trim()}>예약 알림 등록</button>
      </form>
      {data.reminders.filter(r=>!r.cancelled).map(r=><article className="workflow-card" key={r.id}><h4>{r.text}</h4><p>{new Date(r.nextAt).toLocaleString("ko-KR")} / {r.repeatDays?`${r.repeatDays}일마다 반복`:r.firedAt?"전달 완료":"한 번"}</p><button disabled={busy} onClick={()=>void act({action:"reminderCancel",id:r.id})}>알림 취소</button></article>)}
    </>}
  </section>;
}
