import { DirectedBoard, TeamRunOptions, phaseName, type Strategy } from "./TeamPanelDirected";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare, Pencil, Play, Plus, Trash2, Users, X } from "lucide-react";
import type { Session } from "../shared/types";
import type { DirectOptions, RoleStatus, TeamBoard, TeamDefinition, TeamInput, TeamRole } from "../shared/teams";
import "./teams.css";

const modes = { plan: "계획", build: "구현", review: "검토" };
const statuses: Record<RoleStatus, string> = { running: "실행 중", completed: "완료", failed: "실패", interrupted: "중단" };
const newTeam = (): TeamInput => ({ name: "", roles: [
  { name: "기획", instruction: "요청의 범위와 실행 순서를 정리해 주세요.", mode: "plan" },
  { name: "검토", instruction: "프로젝트에서 요구 사항과 검증할 부분을 확인해 주세요.", mode: "review" },
] });
const formatDate = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const api = window.flowrium;

export default function TeamPanel({ projectId, onOpen }: { projectId: string; onOpen: (session: Session) => void }) {
  const [board, setBoard] = useState<TeamBoard>({ teams: [], runs: [] });
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<Strategy>("manual");
  const [options,setOptions] = useState<DirectOptions>({ strategy:"manual" });
  const [editing, setEditing] = useState<TeamInput>();
  const [expanded, setExpanded] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestToken = useRef<{ key: string; id: string } | null>(null);
  const alive = useRef(false);
  const operation = useRef(false);
  const readVersion = useRef(0);
  const team = board.teams.find((item) => item.id === selected) || board.teams[0];

  const refresh = useCallback(async () => {
    if (!api) return;
    const request = ++readVersion.current;
    const result = await api.readTeams(projectId);
    if (alive.current && request === readVersion.current) setBoard(result);
  }, [projectId]);
  useEffect(() => {
    alive.current = true;
    const fail = (err: unknown) => { if (alive.current) setError(err instanceof Error ? err.message : "팀 기록을 읽지 못했습니다."); };
    void refresh().catch(fail);
    let timer: ReturnType<typeof setTimeout>;
    const off = api?.onEvent((event) => {
      if (event.type !== "done") return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh().catch(fail), 120);
    });
    const poll=setInterval(()=>void refresh().catch(fail),2200);
    return () => { clearInterval(poll); alive.current = false; ++readVersion.current; clearTimeout(timer); off?.(); };
  }, [refresh]);
  async function perform(action: () => Promise<void>) {
    if (!api || operation.current) return;
    operation.current = true;
    setBusy(true); setError("");
    try { await action(); await refresh(); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "팀 요청을 처리하지 못했습니다."); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function edit(value?: TeamDefinition) {
    setError(""); setConfirmDelete(false);
    setEditing(value ? structuredClone(value) : newTeam());
  }
  function setRole(index: number, patch: Partial<TeamRole>) {
    setEditing((current) => current && ({ ...current, roles: current.roles.map((role, i) => i === index ? { ...role, ...patch } : role) }));
  }
  const valid = editing && editing.name.trim() && editing.roles.every((role) => role.name.trim() && role.instruction.trim());
  return <section className="team-panel" aria-label="프로젝트 팀">
    <header className="team-head"><div><Users size={19} /><h2>프로젝트 팀</h2></div>
      {!editing && <button type="button" onClick={() => edit()}><Plus size={15}/>팀 만들기</button>}</header>
    {error && <p role="alert" className="team-error">{error}</p>}
    {editing ? <form className="team-form" onSubmit={(e) => {
      e.preventDefault();
      if (valid) void perform(async () => { const saved = await api!.saveTeam(projectId, editing);
        if (alive.current) { setSelected(saved.id); setEditing(undefined); } });
    }}>
      <label>팀 이름<input autoFocus required maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}/></label>
      {editing.roles.map((role, i) => <fieldset key={i} className="team-role"><legend>역할 {i + 1}</legend>
        <label>역할 이름<input value={role.name} maxLength={80} required onChange={(e) => setRole(i, { name: e.target.value })}/></label>
        <label>실행 모드<select value={role.mode} onChange={(e) => setRole(i, { mode: e.target.value as TeamRole["mode"] })}>
          {Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="team-instruction">역할 지시<textarea rows={2} maxLength={2000} value={role.instruction} required onChange={(e) => setRole(i, { instruction: e.target.value })}/></label>
        <label>역할 모델<input placeholder="계정 기본 모델" value={role.model||""} maxLength={200} onChange={e=>setRole(i,{model:e.target.value})}/></label>
        <label>담당 성향<input placeholder="예: 접근성을 우선하는 검토자" value={role.persona||""} maxLength={600} onChange={e=>setRole(i,{persona:e.target.value})}/></label>
        {editing.roles.length > 2 && <button type="button" onClick={() => setEditing({ ...editing, roles: editing.roles.filter((_, index) => i !== index) })}><X size={13}/>역할 제거</button>}
      </fieldset>)}
      <div className="team-actions">{editing.roles.length < 8 && <button type="button" onClick={() => setEditing({ ...editing, roles: [...editing.roles, { name: "", instruction: "", mode: "plan" }] })}><Plus size={14}/>역할 추가</button>}
        <button type="button" onClick={() => setEditing(undefined)}>취소</button>
        <button className="team-primary" type="submit" disabled={busy || !valid}>팀 저장</button></div>
    </form> : team ? <form className="team-form" onSubmit={(e) => {
      e.preventDefault();
      if (!prompt.trim()) return;
      void perform(async () => {
        const key = JSON.stringify([team.id, prompt, strategy, options]);
        if (requestToken.current?.key !== key) requestToken.current = { key, id: crypto.randomUUID() };
        const run = strategy==="shared" ? await api!.runTeam(projectId, team.id, prompt, requestToken.current.id) :
          await api!.directTeam(projectId,team.id,prompt,requestToken.current.id,{...options,strategy,
            attachments:(options.attachments||[]).map(s=>s.trim()).filter(Boolean),decideOn:(options.decideOn||[]).map(s=>s.trim()).filter(Boolean)});
        if (alive.current) { setExpanded(run.id); setPrompt(""); }
        requestToken.current = null;
      });
    }}>
      <div className="team-selector"><label>실행할 팀<select value={team.id} onChange={(e) => { setSelected(e.target.value); setConfirmDelete(false); }}>
        {board.teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button title="팀 편집" aria-label="팀 편집" type="button" onClick={() => edit(team)}><Pencil size={15}/></button>
        <button title="팀 삭제" aria-label="팀 삭제" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={15}/></button>
      </div>
      {confirmDelete && <div className="team-actions"><span>이 팀 설정을 삭제할까요? 실행 기록은 보존됩니다.</span>
        <button type="button" onClick={() => setConfirmDelete(false)}>취소</button><button type="button" disabled={busy} onClick={() => void perform(async () => {
          await api!.removeTeam(projectId, team.id, team.revision); if (alive.current) setConfirmDelete(false);
        })}>삭제</button></div>}
      <p className="team-members">{team.roles.map((role) => role.name + " (" + modes[role.mode] + ")").join(" / ")}</p>
      <TeamRunOptions strategy={strategy} setStrategy={setStrategy} options={options} setOptions={setOptions}/>
      <label>공동 요청<textarea value={prompt} rows={3} maxLength={12000} placeholder="팀에 맡길 업무와 완료 기준을 입력하세요." onChange={(e) => setPrompt(e.target.value)}/></label>
      <div className="team-actions"><button className="team-primary" type="submit" disabled={busy || !prompt.trim()}><Play size={13}/>{strategy==="manual"?"배정안 만들기":strategy==="plan"?"팀장에게 배정안 요청":"팀 실행"}</button></div>
    </form> : <p className="team-empty">팀의 담당 역할을 만들고, 업무마다 실행할 사람과 과업을 선택하세요.</p>}
    {board.runs.length > 0 && <div className="team-history"><h3>팀 실행 기록</h3>
      {board.runs.map((run) => <article key={run.id}>
        <button type="button" className="team-entry" aria-expanded={expanded === run.id} onClick={() => setExpanded(expanded === run.id ? "" : run.id)}>
          {expanded === run.id ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<strong>{run.name}</strong>
          <span>{run.prompt}{run.directed?" / "+phaseName[run.directed.phase]:""}</span><time dateTime={run.createdAt}>{formatDate.format(new Date(run.createdAt))}</time>
        </button>
        {expanded === run.id && run.directed && <DirectedBoard projectId={projectId} run={run} busy={busy} perform={perform} onOpen={onOpen}/>}
        {expanded === run.id && !run.directed && <div className="team-results"><p>{run.prompt}</p>
          {run.roles.map((role, index) => <div key={index} className="team-result"><div><b>{role.name}</b><small>{statuses[role.status]}</small></div>
            <p>{role.summary}</p>{role.sessionId && <button type="button" disabled={busy} onClick={() => void perform(async () => {
              const session = await api!.openTeamRole(projectId, run.id, index); if (alive.current) onOpen(session);
            })}><MessageSquare size={13}/>역할 대화 열기</button>}</div>)}</div>}
      </article>)}</div>}
  </section>;
}
