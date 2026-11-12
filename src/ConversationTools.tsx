import { useState } from "react";
import type { Session, ConversationEdit } from "../shared/types";

export function ConversationTools({session, running, onOpen, onChange, notify, fail}: {
  session: Session; running: boolean; onOpen: (session: Session) => void; onChange: (session: Session) => void;
  notify: (message: string) => void; fail: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [messageId, select] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function apply(change: ConversationEdit) {
    if (!window.flowrium || busy) return;
    setBusy(true);
    try {
      const value = await window.flowrium.editConversation(session.id, change);
      if (change.action === "branch") onOpen(value); else onChange(value);
      notify(change.action === "compact" ? "Codex에 문맥 압축을 요청했습니다." : change.action === "rewind" ? "선택한 요청 직전으로 대화를 되감았습니다." : change.action === "branch" ? "분기한 대화를 열었습니다." : "대화 이름을 변경했습니다.");
      setOpen(false); setConfirm(false); select("");
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  return <div className="conversation-tools">
    <button className="button subtle" aria-expanded={open} onClick={() => {setOpen(!open); setTitle(session.title);}}>대화 관리</button>
    {open && <fieldset disabled={running || busy} className="conversation-popover">
      <label>대화 이름<input aria-label="대화 이름" maxLength={300} value={title} onChange={e=>setTitle(e.target.value)} /></label>
      <button className="button subtle" disabled={!title.trim()} onClick={()=>apply({ action:"rename", title })}>이름 저장</button>
      <label>기준 요청<select aria-label="기준 요청" value={messageId} onChange={e=>{select(e.target.value);setConfirm(false);}}>
        <option value="">대화 끝</option>
        {session.messages.filter(m=>m.role==="user").map((m,i)=><option value={m.id} key={m.id}>{i+1} / {m.text.slice(0,48)}</option>)}
      </select></label>
      <button className="button subtle" onClick={()=>apply({action:"branch",messageId:messageId || undefined})}>여기까지 새 대화로 분기</button>
      {messageId && <button className="button subtle" onClick={()=>setConfirm(true)}>이 요청 전으로 되감기</button>}
      {confirm && <div><p>선택한 요청과 이후 메시지를 이 대화에서 제외합니다. 프로젝트 파일은 보존됩니다.</p>
        <button className="button primary" onClick={()=>apply({action:"rewind",messageId})}>되감기 확인</button></div>}
      <button className="button subtle" disabled={!session.threadId} onClick={()=>apply({action:"compact"})}>Codex 문맥 압축</button>
    </fieldset>}
  </div>
}
