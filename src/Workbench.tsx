import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useRef, useState, type FormEvent } from "react";
import ArtifactViewer from "./ArtifactViewer";
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronRight, ClipboardList, FileText, FolderOpen, GitBranch, GitCommitHorizontal, Hand, ListChecks, LoaderCircle, MessageSquare, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { Mode, Project, Session, Model } from "../shared/types";
import { statusLabels, workKinds, type Artifact, type WorkInput, type WorkFormat, type WorkKind, type WorkOverview, type WorkStatus, type WorkUpdate } from "../shared/workbench";
import "./workbench.css";

const icons = { task: MessageSquare, research: Search, briefing: BookOpen, document: FileText, weekly: ClipboardList, pause: Hand };
const kinds = Object.keys(workKinds) as WorkKind[];
const statuses = Object.keys(statusLabels) as WorkStatus[];
const day = (d: Date) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
const date = (v: string) => new Date(v).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
const workState = (s: Session) => s.workflow?.status || "active";
const fileName = (p: string) => p.split("/").at(-1);
function getAPI() {
  if (!window.flowrium) throw new Error("설치한 Flowrium 앱에서 사용할 수 있습니다.");
  return window.flowrium;
}
type Open = (session: Session, mode?: Mode, initialRequest?: string) => void;
type Props = { project?: Project; sessions: Session[]; onChooseProject: () => void; onOpen: Open; onSessionChange: (session: Session) => void };

function WorkForm({ project, sessions, kind, onOpen, onClose, onSessionChange }: Props & { project: Project; kind: WorkKind; onClose: () => void }) {
  const spec = workKinds[kind];
  const ranged = kind === "weekly" || kind === "briefing";
  const now = new Date();
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const [form, setForm] = useState<WorkInput>({
    projectId: project.id, kind, ...(kind === "research" && { searchMode: "live",researchDepth:"standard" }), ...(kind==='document'&&{documentKind:'report',slideCount:12}), title: ["briefing", "weekly", "pause"].includes(kind) ? spec.label + " / " + day(now) : "",
    brief: "", role: spec.role, audience: "", from: ranged ? day(week) : "", to: ranged ? day(now) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [models,setModels]=useState<Model[]>([]),[authenticated,setAuthenticated]=useState(false);
  useEffect(()=>{let alive=true;window.flowrium?.connect().then(v=>{if(alive){setModels(v.models);setAuthenticated(v.status.authenticated);}}).catch(e=>{if(alive)setError(messageOf(e));});return()=>{alive=false;};},[]);
  const fields = {
    research: ["조사 주제", "알고 싶은 점과 참고할 출처", "보고서 독자와 조사 깊이"],
    briefing: ["브리핑 제목", "특히 확인할 사항", "보고 대상과 형식"],
    document: ["문서 제목", "담을 내용과 참고할 파일이나 링크", "읽는 사람과 문서 형식"],
    weekly: ["보고서 제목", "강조할 사항", "보고 대상과 형식"],
    pause: ["마감 기록 제목", "중단한 이유와 복귀할 때 기억할 내용", "인계받는 사람"],
    task: ["업무 이름", "맡길 일과 완료 기준", "결과를 받을 사람과 형식"],
  }[kind];
  const set = (name: keyof WorkInput, value: string) => setForm((old) => ({ ...old, [name]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if(!authenticated){setError("ChatGPT 계정을 연결한 뒤 AI 업무를 시작하세요.");return;}
    setBusy(true);
    setError("");
    try {
      const s = await getAPI().startWork(form);
      onSessionChange(s);
      onOpen(s, spec.mode, [form.title, form.brief].filter(Boolean).join("\n\n") + "\n\n요청한 " + spec.label + " 업무를 시작해 주세요.");
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }
  return <section className="wb-form" aria-label={spec.label + " 업무 설정"}>
    <header className="wb-section-head"><button className="wb-back" onClick={onClose}><ArrowLeft size={15}/> 업무 목록</button><span>{project.name}</span></header>
    <h1>{spec.label}</h1><p>{spec.description} ChatGPT가 요청과 프로젝트 근거를 확인해 결과를 작성합니다.</p>
    <form onSubmit={submit}>
      <label>사용할 ChatGPT 모델<select aria-label="업무 AI 모델" value={form.model||""} onChange={e=>set("model",e.target.value)}><option value="">계정 기본 모델</option>{models.map(m=><option key={m.id} value={m.id}>{m.displayName||m.id}</option>)}</select></label>
      {!authenticated&&<p>ChatGPT 계정을 연결하면 AI가 이 업무를 수행합니다.</p>}
      <label>{fields[0]}<input autoFocus required maxLength={160} value={form.title} onChange={(e) => set("title", e.target.value)}/></label>
      <label>{fields[1]}<textarea rows={4} maxLength={12000} value={form.brief} onChange={(e) => set("brief", e.target.value)}/></label>
      <div className="wb-field-pair"><label>담당 역할<input required maxLength={120} value={form.role} onChange={(e) => set("role", e.target.value)}/></label>
        <label>{fields[2]}<input maxLength={500} value={form.audience} onChange={(e) => set("audience", e.target.value)}/></label></div>
      {kind === "research" && <label>조사 자료<select value={form.searchMode} onChange={(e) => set("searchMode", e.target.value)}>
        <option value="live">실시간 웹 검색과 프로젝트 자료</option><option value="cached">저장된 검색 결과와 프로젝트 자료</option><option value="disabled">프로젝트 자료만</option></select></label>}
      {kind==='research'&&<label>조사 깊이<select aria-label="조사 깊이" value={form.researchDepth} onChange={e=>set('researchDepth',e.target.value)}><option value="quick">빠른 조사</option><option value="standard">일반 조사</option><option value="deep">심층 조사</option></select></label>}
      {kind==='document'&&<div className="wb-field-pair"><label>결과 형식<select aria-label="문서 결과 형식" value={form.documentKind} onChange={e=>set('documentKind',e.target.value)}><option value="report">보고서 (HTML과 PDF)</option><option value="slides">발표자료 (HTML, PDF, PPTX)</option></select></label>{form.documentKind==='slides'&&<label>슬라이드 수<input aria-label="슬라이드 수" inputMode="numeric" value={String(form.slideCount??'')} onChange={e=>setForm(v=>({...v,slideCount:e.target.value?Number(e.target.value):undefined}))} pattern="[0-9]+" required/></label>}</div>}
      {ranged && <div className="wb-field-pair"><label>조회 시작일<input type="date" required max={form.to} value={form.from} onChange={(e) => set("from", e.target.value)}/></label>
        <label>조회 종료일<input type="date" required min={form.from} value={form.to} onChange={(e) => set("to", e.target.value)}/></label></div>}
      {sessions.length > 0 && <label>인계받을 대화<select value={form.sourceSessionId || ""} onChange={(e) => set("sourceSessionId", e.target.value)}>
        <option value="">새 맥락으로 시작</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
        {form.sourceSessionId && <small>선택한 대화의 최근 메시지를 이 업무의 시작 시점에 복사합니다.</small>}</label>}
      {error && <p className="wb-error" role="alert">{error}</p>}
      <div className="wb-form-footer"><button type="button" className="wb-secondary" onClick={onClose}>취소</button>
        <button className="wb-primary" disabled={busy || !authenticated || !form.title.trim()}>{busy ? <LoaderCircle size={16}/> : <ArrowRight size={16}/>} 업무 시작</button></div>
    </form>
  </section>;
}
export function ArtifactPanel({ overview, project, sessions, onOpen, refresh }: { overview?: WorkOverview; project: Project; sessions: Session[]; onOpen: Open; refresh: () => void }) {
  const [selected, setSelected] = useState<Artifact>();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const accept = ".md,.markdown,.txt,.csv,.html,.htm,.pdf,.docx,.xlsx,.pptx";
  async function importFiles(files: File[]) {
    if (!files.length || importing) return;
    setImporting(true); setImportNotice(""); setError("");
    try {
      if (files.length > 20 || files.some((f) => f.size > 16 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 32 * 1024 * 1024)
        throw new Error("한 번에 20개, 문서당 16MB와 합계 32MB까지 추가할 수 있습니다.");
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, body: new Uint8Array(await f.arrayBuffer()) })));
      const result = await getAPI().importWorkFiles(project.id, payload);
      setImportNotice("문서 " + result.added.length + "개 추가" + (result.skipped.length ? " (제외: " + result.skipped.map((f) => f.name + " (" + f.reason + ")").join(", ") + ")" : ""));
      refresh();
    } catch (e) { setError(messageOf(e)); }
    finally { setImporting(false); if (picker.current) picker.current.value = ""; }
  }
  useEffect(() => {
    if (!selected?.preview) return;
    let live = true;
    setLoading(true);
    setError("");
    getAPI().readWorkArtifact(project.id, selected.path).then((content) => { if (live) setBody(content); })
      .catch((e) => { if (live) setError(messageOf(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [project.id, selected]);
  async function reveal(item: Artifact) {
    try { await getAPI().revealWorkArtifact(project.id, item.path); } catch (e) { setError(messageOf(e)); }
  }
  if (selected) {
    const source = sessions.find((s) => s.id === selected.sessionId);
    return <section className="wb-artifact-detail"><button className="wb-back" onClick={() => { setSelected(undefined); setError(""); }}><ArrowLeft size={15}/> 산출물 목록</button>
      <h2>{source?.title || fileName(selected.path)}</h2><p className="wb-path">{selected.path}</p>
      <div className="wb-tools"><button className="wb-secondary" onClick={() => reveal(selected)}><FolderOpen size={15}/> 파일 위치 열기</button>
        {source && <button className="wb-secondary" onClick={() => onOpen(source)}><MessageSquare size={15}/> 원본 대화</button>}</div>
      {error && <p className="wb-error" role="alert">{error}</p>}
      <ArtifactViewer project={project} artifact={selected} onChange={refresh}/>
      {!/\.html?$/i.test(selected.path) && selected.preview ? (loading ? <p>불러오는 중…</p> : !error && <pre className="wb-preview">{body}</pre>) : <p>파일 위치를 열어 원본 문서를 확인하세요.</p>}
    </section>;
  }
  const items = (overview?.artifacts || []).filter((a) => !filter || a.path.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section><div className="wb-drop" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={(e) => { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files)); }}>
      <button className="wb-secondary" disabled={importing} onClick={() => picker.current?.click()}><Plus size={15}/>문서 추가</button>
      <span>문서를 여기에 끌어다 놓으세요.</span><input ref={picker} type="file" aria-label="추가할 문서 선택" hidden multiple accept={accept} onChange={(e) => void importFiles(Array.from(e.currentTarget.files || []))}/>
    </div>
    {importNotice && <p className="wb-caption" role="status">{importNotice}</p>}{error && <p className="wb-error" role="alert">{error}</p>}
    <div className="wb-section-head"><h2>프로젝트 산출물</h2><input className="wb-filter" aria-label="산출물 검색" placeholder="파일 검색" value={filter} onChange={(e) => setFilter(e.target.value)}/></div>
    <p className="wb-caption">산출물, docs, outputs 폴더에서 문서를 찾습니다.</p>
    {overview?.truncated && <p>표시 가능한 범위의 문서만 불러왔습니다.</p>}
    {items.map((a) => <button className="wb-line-item" key={a.path} onClick={() => { setBody(""); setLoading(a.preview); setError(""); setSelected(a); }}><FileText size={17}/><span>
      <strong>{sessions.find((s) => s.id === a.sessionId)?.title || fileName(a.path)}</strong><small className="wb-path">{a.path}</small></span><time>{date(a.modifiedAt)}</time><ChevronRight size={14}/></button>)}
    {overview && !items.length && <p className="wb-empty">{filter ? "검색 결과가 없습니다." : "아직 산출물이 없습니다. 업무 대화에서 답변을 저장하면 여기에 표시됩니다."}</p>}
  </section>;
}
function RepoPanel({ overview }: { overview?: WorkOverview }) {
  const git = overview?.git;
  if (!git) return null;
  if (!git.available) return <p className="wb-empty">{git.reason}</p>;
  return <section><div className="wb-section-head"><h2>저장소</h2><span className="wb-status"><GitBranch size={14}/>{git.branch || "첫 커밋 전"}</span></div>
    {git.reason && <p>{git.reason}</p>}{git.limited && <p className="wb-caption">변경 파일 120개와 최근 커밋 30개까지 표시합니다.</p>}
    <h3>변경 파일</h3>{git.changes.length ? git.changes.map((c) => <div key={c.path} className="wb-file-row"><code>{c.code}</code><span className="wb-path">{c.path}</span></div>) : <p className="wb-empty">작업 폴더가 깨끗합니다.</p>}
    <h3>최근 커밋</h3>{git.commits.length ? git.commits.map((c) => <div key={c.hash} className="wb-file-row"><GitCommitHorizontal size={15}/><code>{c.hash}</code><span>{c.subject}</span><time>{date(c.at)}</time></div>) : <p className="wb-empty">표시할 커밋이 없습니다.</p>}
  </section>;
}

function ProjectWorkbench(props: Props & { project: Project }) {
  const { project, onOpen } = props;
  const sessions = props.sessions.filter((s) => s.projectId === project.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [tab, setTab] = useState<"board" | "files" | "git">("board");
  const [kind, setKind] = useState<WorkKind>();
  const [status, setStatus] = useState<WorkStatus>("active");
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState<WorkOverview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    Promise.resolve().then(() => getAPI().readWorkbench(project.id)).then((value) => { if (live) setOverview(value); })
      .catch((e) => { if (live) setError(messageOf(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [project.id, refresh, tab]);
  const shown = sessions.filter((s) => workState(s) === status && (s.title + (s.workflow?.role || "")).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <main className="workbench" aria-label="프로젝트 작업실"><div className="wb-inner">
    {kind ? <WorkForm {...props} sessions={sessions} kind={kind} onClose={() => setKind(undefined)}/> : <>
      <header className="wb-project-head"><div><p className="wb-eyebrow">프로젝트 작업실</p><h1>{project.name}</h1></div>
        <button className="wb-icon-button" aria-label="프로젝트 현황 새로 고침" disabled={loading} onClick={() => setRefresh((v) => v + 1)}><RefreshCw size={17}/></button></header>
      <nav aria-label="작업실 화면" className="wb-tabs">{(["board", "files", "git"] as const).map((id) => <button key={id} aria-pressed={id === tab} onClick={() => setTab(id)}>
        {id === "board" ? <ListChecks size={16}/> : id === "files" ? <FileText size={16}/> : <GitBranch size={16}/>}
        {{ board: "업무 현황", files: "산출물", git: "저장소" }[id]}</button>)}</nav>
      {error && <p className="wb-error" role="alert">{error}</p>}
      {tab === "board" && <>
        <section className="wb-actions"><h2>새 업무</h2><div className="wb-actions-grid">
          {kinds.map((k) => { const Icon = icons[k]; return <button key={k} data-work-kind={k} onClick={() => setKind(k)}>
            <span className="wb-action-title"><Icon size={18}/><strong>{workKinds[k].label}</strong><Plus size={14}/></span><small>{workKinds[k].description}</small>
          </button>; })}
        </div></section>
        <section><div className="wb-section-head"><h2>업무 대화</h2><input aria-label="업무 대화 검색" className="wb-filter" placeholder="이름 또는 역할 검색" value={query} onChange={(e) => setQuery(e.target.value)}/></div>
          <div className="wb-status-filters">{statuses.map((st) => <button key={st} aria-pressed={status === st} onClick={() => setStatus(st)}>{statusLabels[st]} <span>{sessions.filter((s) => workState(s) === st).length}</span></button>)}</div>
          {shown.map((s) => <button key={s.id} className="wb-line-item" onClick={() => onOpen(s, workKinds[s.workflow?.kind || "task"].mode)}>
            <MessageSquare size={17}/><span><strong>{s.title}</strong><small>{workKinds[s.workflow?.kind || "task"].label} ({s.workflow?.role || "프로젝트 대화"}){s.workflow?.checklist.length ? " (체크 " + s.workflow.checklist.filter((c) => c.done).length + "/" + s.workflow.checklist.length + ")" : ""}</small></span><time>{date(s.updatedAt)}</time><ChevronRight size={14}/></button>)}
          {!shown.length && <p className="wb-empty">{query ? "조건에 맞는 대화가 없습니다." : status === "active" ? "새 업무에서 역할을 고르면 전용 대화가 열립니다." : statusLabels[status] + " 상태의 업무가 없습니다."}</p>}
        </section>
      </>}
      {tab === "files" && <ArtifactPanel project={project} overview={overview} sessions={sessions} onOpen={onOpen} refresh={() => setRefresh((v) => v + 1)}/>}
      {tab === "git" && <RepoPanel overview={overview}/>}
      {loading && tab !== "board" && <p className="wb-caption" role="status">프로젝트 자료를 불러오는 중…</p>}
    </>}
  </div></main>;
}
export default function Workbench(props: Props) {
  if (!props.project) return <main className="workbench"><div className="wb-inner wb-welcome"><FolderOpen size={30}/><h1>프로젝트 작업실</h1>
    <p>업무 대화와 산출물을 보관할 프로젝트 폴더를 선택하세요.</p><button className="wb-primary" onClick={props.onChooseProject}><Plus size={16}/> 프로젝트 폴더 선택</button></div></main>;
  return <ProjectWorkbench {...props} project={props.project} key={props.project.id}/>;
}

export function WorkSessionControls({ session, onSessionChange, running = false }: { session: Session; onSessionChange: (s: Session) => void; running?: boolean }) {
  return <SessionTools key={session.id} session={session} onSessionChange={onSessionChange} running={running}/>;
}
function SessionTools({ session, onSessionChange, running }: { session: Session; onSessionChange: (s: Session) => void; running: boolean }) {
  const w = session.workflow;
  const status = workState(session);
  const [expanded, setExpanded] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [format, setFormat] = useState<WorkFormat>("md");
  const [messageId, setMessageId] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const answers = session.messages.filter((m) => m.role === "assistant" && m.text.trim());
  const picked = answers.find((m) => m.id === messageId) || answers.at(-1);
  async function update(change: WorkUpdate) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await getAPI().updateWork(session.id, change);
      onSessionChange(value);
      if (mounted.current && change.action === "add") setTask("");
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function save() {
    if (!picked || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const file = await getAPI().saveWorkArtifact(session.id, picked.id, format);
      if (mounted.current) setNotice((file.existing ? "이미 보관된 산출물: " : "저장 완료: ") + file.path);
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="wb-session" aria-label="업무 도구">
    <div className="wb-tools wb-toolbar">
      <button aria-expanded={expanded} className="wb-details-toggle" onClick={() => setExpanded(!expanded)}>
        <ListChecks size={15}/>{workKinds[w?.kind || "task"].label} / {statusLabels[status]}<ChevronRight size={13} className={expanded ? "rotated" : ""}/>
      </button>
      {status === "active" && <button disabled={busy || running} onClick={() => update({ action: "status", status: "review" })}>검토로 이동</button>}
      {status !== "active" && <button disabled={busy || running} onClick={() => update({ action: "status", status: "active" })}>업무 재개</button>}
      {status !== "done" && <button disabled={busy || running} onClick={() => update({ action: "status", status: "done" })}><Check size={14}/>업무 완료</button>}
      {picked && <select className="wb-format" aria-label="산출물 형식" value={format} onChange={(e) => setFormat(e.target.value as WorkFormat)}><option value="md">마크다운</option><option value="html">HTML</option><option value="pdf">PDF</option><option value="pptx">발표자료 (PPTX)</option></select>}
      {picked && <button disabled={busy || running} onClick={save}><FileText size={14}/>답변을 산출물로 저장</button>}
    </div>
    {expanded && <div className="wb-session-body">
      <div className="wb-role"><strong>{w?.role || "프로젝트 실무 담당자"}</strong>{w?.brief && <p>{w.brief}</p>}{w?.audience && <small>대상: {w.audience}</small>}{w?.from && <small>조회 기간: {w.from} ~ {w.to}</small>}{w?.source && <small>인계받은 대화: {w.source.title}</small>}</div>
      {!!answers.length && <label className="wb-answer-select">저장할 답변<select value={picked?.id || ""} onChange={(e) => setMessageId(e.target.value)}>{answers.map((m, i) =>
        <option value={m.id} key={m.id}>{i + 1}번째 답변: {m.text.replace(/\s+/g, " ").slice(0, 38)}</option>)}</select></label>}
      <h3>체크리스트</h3>
      {w?.checklist.map((item) => <div key={item.id} className="wb-check"><label><AnimatedCheckbox checked={item.done} disabled={busy || status === "done"} onChange={() => update({ action: "toggle", id: item.id })}/><span>{item.text}</span></label>
        {status !== "done" && <button disabled={busy} aria-label={item.text + " 제외"} onClick={() => update({ action: "remove", id: item.id })}><Trash2 size={13}/></button>}</div>)}
      {status !== "done" && <form className="wb-check-form" onSubmit={(e) => { e.preventDefault(); if (task.trim()) void update({ action: "add", text: task }); }}>
        <input aria-label="새 체크리스트 항목" maxLength={400} placeholder="확인할 일 추가" value={task} onChange={(e) => setTask(e.target.value)}/>
        <button className="wb-secondary" disabled={!task.trim() || busy}><Plus size={14}/> 추가</button></form>}
      {w?.completion && <div className="wb-completion"><strong><CheckCheck size={15}/> {date(w.completion.at)} 완료 기록</strong>
        {w.completion.summary && <p>{w.completion.summary}</p>}
        {w.completion.commits.map((c) => <small key={c.hash}>{c.hash} ({c.subject})</small>)}</div>}
    </div>}
    {error && <p className="wb-error" role="alert">{error}</p>}
    {notice && <div className="wb-notice" role="status"><span className="wb-path">{notice}</span><button aria-label="저장 안내 닫기" onClick={() => setNotice("")}><X size={13}/></button></div>}
  </section>;
}
