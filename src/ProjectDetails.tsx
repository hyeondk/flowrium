import { AnimatedCheckbox } from './ui-motion';
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Plus, RefreshCw, X } from "lucide-react";
import type { Project } from "../shared/types";
import type { ProjectChange, ProjectDetails as Details } from "../shared/project-details";
import "./project-details.css";

const api = window.flowrium;
type Metadata = Pick<Details, "owner" | "goal" | "dueDate">;
const metadata = (data: Details): Metadata => ({ owner: data.owner, goal: data.goal, dueDate: data.dueDate });
const message = (error: unknown) => error instanceof Error ? error.message : "프로젝트 상세 정보를 처리하지 못했습니다.";

export default function ProjectDetails({ project, onChange }: { project: Project; onChange?: (data: Details) => void }) {
  const [data, setData] = useState<Details>();
  const [fields, setFields] = useState<Metadata>({ owner: "", goal: "", dueDate: "" });
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
  const writing = useRef(false);
  const change = useRef(onChange);
  change.current = onChange;
  const load = useCallback(async () => {
    if (!api) return;
    try {
      const value = await api.readProjectDetails(project.id);
      if (!alive.current) return;
      setData(value); setFields(metadata(value)); setError(""); change.current?.(value);
    } catch (e) { if (alive.current) setError(message(e)); }
  }, [project.id]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  async function save(input: ProjectChange) {
    if (!api || !data || writing.current) return;
    writing.current = true;
    setBusy(true); setError("");
    try {
      const next = await api.updateProjectDetails(project.id, data.revision, input);
      if (!alive.current) return;
      setData(next); change.current?.(next);
      if (input.action === "details") setFields(metadata(next));
      if (input.action === "add") setItem("");
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { writing.current = false; if (alive.current) setBusy(false); }
  }
  const dirty = data && (fields.owner !== data.owner || fields.goal !== data.goal || fields.dueDate !== data.dueDate);
  return <details className="project-details"><summary>프로젝트 상세{data?.archivedAt && <span>보관됨</span>}</summary>
    {error && <div role="alert" className="pd-error">{error}<button type="button" onClick={() => void load()}><RefreshCw size={13}/>새로고침</button></div>}
    {data && <div className="pd-body"><form onSubmit={(e) => { e.preventDefault(); void save({ action: "details", ...fields }); }}>
      <div className="pd-fields"><label>프로젝트 담당자<input maxLength={150} value={fields.owner} onChange={(e) => setFields({ ...fields, owner: e.target.value })}/></label>
        <label>프로젝트 기한<input type="date" value={fields.dueDate} onChange={(e) => setFields({ ...fields, dueDate: e.target.value })}/></label></div>
      <label>프로젝트 목표<textarea rows={2} maxLength={4000} value={fields.goal} onChange={(e) => setFields({ ...fields, goal: e.target.value })}/></label>
      <button type="submit" disabled={busy || !dirty}>상세 정보 저장</button>
    </form>
    <section aria-label="프로젝트 체크리스트" className="pd-checklist"><h3>프로젝트 체크리스트</h3>
      {data.checklist.map((task) => <div className="pd-check" key={task.id}>
        <label><AnimatedCheckbox disabled={busy} checked={task.done} onChange={(e) => void save({ action: "check", id: task.id, done: e.target.checked })}/>{task.text}</label>
        <button type="button" aria-label={task.text + " 삭제"} disabled={busy} onClick={() => void save({ action: "remove", id: task.id })}><X size={13}/></button></div>)}
      <form className="pd-add" onSubmit={(e) => { e.preventDefault(); if (item.trim()) void save({ action: "add", text: item }); }}>
        <input aria-label="새 프로젝트 체크리스트 항목" maxLength={500} placeholder="새 항목" value={item} onChange={(e) => setItem(e.target.value)}/>
        <button type="submit" disabled={busy || !item.trim()}><Plus size={14}/>항목 추가</button></form>
    </section>
    <button type="button" disabled={busy} onClick={() => void save({ action: data.archivedAt ? "resume" : "archive" })}>
      {data.archivedAt ? <ArchiveRestore size={14}/> : <Archive size={14}/>}
      {data.archivedAt ? "프로젝트 재개" : "프로젝트 보관"}</button></div>}
  </details>;
}
