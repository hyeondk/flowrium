import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Coffee,
} from "lucide-react";
import type { Project, Session, Model, Effort } from "../shared/types";
import { workKinds, type WorkInput } from "../shared/workbench";
import { errorText, localDay } from "./ProjectPortfolio";

type Props = {
  kind: "weekly" | "pause";
  projects: Project[];
  sessions: Session[];
  onOpen(session: Session): void;
  onStart(session: Session, request: string, options?:{model?:string;effort?:Effort}): Promise<void>;
  onCreateProject(): void;
  authenticated: boolean;
};
export default function PortfolioReports({
  kind,
  projects,
  sessions,
  onOpen,
  onStart,
  onCreateProject,
  authenticated,
}: Props) {
  const weekly = kind === "weekly",
    title = workKinds[kind].label,
    today = new Date(),
    week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay()+6)%7));
  const [tab, setTab] = useState<"create" | "history">("create");
  const [picked, setPicked] = useState<string[]>([]),
    [destination, setDestination] = useState("");
  const friday=new Date(week);friday.setDate(week.getDate()+4);
  const [from, setFrom] = useState(localDay(week.toISOString())),
    [to, setTo] = useState(localDay(friday.toISOString()));
  const [name, setName] = useState(
      title + " / " + localDay(today.toISOString()),
    ),
    [brief, setBrief] = useState(""),
    [audience, setAudience] = useState(""),
    [reason, setReason] = useState("퇴근");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState<Session[]>([]);
  const [success, setSuccess] = useState(false);
  const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[modelError,setModelError]=useState(''),[period,setPeriod]=useState('this');
  useEffect(()=>{let active=true;window.flowrium?.connect().then(result=>{if(active){setModels(result.models);setModelError(result.status.authenticated?'':'ChatGPT 계정을 연결한 뒤 AI 작성을 시작하세요.');}}).catch(e=>{if(active)setModelError(e.message);});return()=>{active=false;};},[]);
  function choosePeriod(value:string){setPeriod(value);if(value==='custom')return;const start=new Date();start.setDate(start.getDate()-((start.getDay()+6)%7)-(value==='last'?7:0));const end=new Date(start);end.setDate(start.getDate()+4);setFrom(localDay(start.toISOString()));setTo(localDay(end.toISOString()));}
  const recent = new Set(
    sessions
      .filter(
        (s) => Date.now() - Date.parse(s.updatedAt) <= 12 * 60 * 60 * 1000,
      )
      .map((s) => s.projectId),
  );
  const past = sessions
    .filter((s) => s.workflow?.kind === kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const targets = projects.filter((p) => picked.includes(p.id));
  const output = targets.find((p) => p.id === destination) || targets[0];
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.flowrium || busy || !output || !targets.length) return;
    if(!authenticated){setError("ChatGPT 계정을 연결한 뒤 AI 작성을 시작하세요.");return;}
    setBusy(true);
    setError("");
    const finished = new Set(created.map((s) => s.projectId)),
      newEntries: Session[] = [];
    const issues: string[] = [];
    for (const p of weekly ? [output] : targets) {
      if (finished.has(p.id)) continue;
      const seed: WorkInput = {
        projectId: p.id,
        kind,
        title: name,
        role: workKinds[kind].role,
        brief: weekly ? brief : [reason, brief].filter(Boolean).join(" / "),
        audience,
        from: weekly ? from : "",
        to: weekly ? to : "",
        ...(model && {model}),
        ...(weekly && { reportProjects: targets.map((item) => item.id) }),
      };
      try {
        const record = await window.flowrium.startWork(seed);
        await onStart(
          record,
          [
            name,
            seed.brief,
            "선택한 프로젝트 기록을 바탕으로 " +
              title +
              " 업무를 실행해 주세요.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          {model:model || undefined},
        );
        newEntries.push(record);
      } catch (e) {
        issues.push(p.name + " / " + errorText(e));
      }
    }
    setCreated((current) => [...current, ...newEntries]);
    setError(issues.join("\n"));
    const all = [...created, ...newEntries];
    if (all.length === (weekly ? 1 : targets.length)) {
      setSuccess(true);
      if (weekly && !issues.length) onOpen(all[0]);
    }
    setBusy(false);
  }
  return (
    <div className="pf-page">
      <div className="pf-content">
        <header className="pf-heading">
          <div>
            <h1>{title}</h1>
            <p>
              {weekly
                ? "ChatGPT가 선택한 프로젝트의 완료 업무 / 커밋 / 변경 요청을 확인해 보고서를 생성합니다."
                : "ChatGPT가 최근 업무와 저장소 상태를 확인해 중단 지점과 복귀 순서를 프로젝트별로 작성합니다."}
            </p>
          </div>
        </header>
        <nav className="pf-tabs" aria-label={title + " 화면"}>
          <button
            aria-current={tab === "create" ? "page" : undefined}
            onClick={() => setTab("create")}
          >
            {weekly ? "새로 쓰기" : "AI 마감 기록"}
          </button>
          <button
            aria-current={tab === "history" ? "page" : undefined}
            onClick={() => setTab("history")}
          >
            {weekly ? "작성된 보고" : "이전 마감 기록"}
          </button>
        </nav>
        {tab === "history" ? (
          <div className="pf-list">
            {past.map((s) => (
              <button key={s.id} className="pf-row" onClick={() => onOpen(s)}>
                <BookOpen size={17} />
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {projects.find((p) => p.id === s.projectId)?.name ||
                      "보관한 프로젝트"}
                  </small>
                </span>
                <time>{localDay(s.updatedAt)}</time>
              </button>
            ))}
            {!past.length && (
              <p className="pf-empty">아직 작성한 기록이 없습니다.</p>
            )}
          </div>
        ) : !projects.length ? (
          <section className="pf-welcome">
            <h2>프로젝트를 먼저 추가하세요</h2>
            <p>보고와 마감 기록은 선택한 프로젝트 폴더에 저장합니다.</p>
            <button onClick={onCreateProject}>프로젝트 추가</button>
          </section>
        ) : (
          <form className="pf-form" onSubmit={submit}>
            <fieldset disabled={busy || success}>
              <legend>{weekly ? "보고할 프로젝트" : "마감할 프로젝트"} / 선택 {targets.length}개</legend>
              <div className="pf-actions">
                <button
                  type="button"
                  disabled={created.length > 0}
                  onClick={() =>
                    setPicked(projects.slice(0, 64).map((p) => p.id))
                  }
                >
                  전체 선택
                </button>
                {!weekly && (
                  <button
                    type="button"
                    disabled={created.length > 0}
                    onClick={() =>
                      setPicked(
                        projects
                          .filter((p) => recent.has(p.id))
                          .slice(0, 64)
                          .map((p) => p.id),
                      )
                    }
                  >
                    최근 12시간 작업 선택
                  </button>
                )}
                {!!picked.length && (
                  <button
                    type="button"
                    disabled={created.length > 0}
                    onClick={() => setPicked([])}
                  >
                    선택 해제
                  </button>
                )}
              </div>
              <div className="pf-report-targets">
                {projects.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      disabled={
                        created.length > 0 ||
                        (!picked.includes(p.id) && picked.length >= 64)
                      }
                      checked={picked.includes(p.id)}
                      onChange={(e) =>
                        setPicked((v) =>
                          e.target.checked
                            ? [...v, p.id]
                            : v.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
              {weekly && targets.length > 0 && (
                <label>
                  보고서를 저장할 프로젝트
                  <select
                    value={output.id}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    {targets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>사용할 ChatGPT 모델<select aria-label="보고서 AI 모델" value={model} onChange={e=>setModel(e.target.value)}><option value="">계정 기본 모델</option>{models.map(m=><option key={m.id} value={m.id}>{m.displayName||m.id}</option>)}</select></label>
              {modelError&&<p role="status">{modelError}</p>}
              {weekly&&<label>보고 기간<select aria-label="보고 기간 선택" value={period} onChange={e=>choosePeriod(e.target.value)}><option value="this">이번 주</option><option value="last">지난 주</option><option value="custom">직접 정하기</option></select></label>}
              {weekly && period === "custom" && (
                <div className="pf-grid2">
                  <label>
                    조회 시작일
                    <input
                      type="date"
                      required
                      value={from}
                      max={to}
                      onChange={(e) => {setFrom(e.target.value);setPeriod("custom");}}
                    />
                  </label>
                  <label>
                    조회 종료일
                    <input
                      type="date"
                      required
                      value={to}
                      min={from}
                      onChange={(e) => {setTo(e.target.value);setPeriod("custom");}}
                    />
                  </label>
                </div>
              )}
              <label>
                {weekly ? "보고서 제목" : "마감 기록 제목"}
                <input
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {!weekly && (
                <label>
                  마감 사유
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {["점심", "퇴근", "회의", "기타"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {weekly ? "덧붙일 말 선택 사항" : "복귀할 때 참고할 메모 선택 사항"}
                <textarea
                  maxLength={11500}
                  rows={3}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                />
              </label>
              <label>
                {weekly ? "보고 대상 또는 형식" : "인계받는 사람"}
                <input
                  maxLength={500}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </label>
              {!authenticated && (
                <p className="pf-muted">
                  ChatGPT 계정을 연결하면 선택한 모델이 보고서와 마감 기록을 작성합니다.
                </p>
              )}
              <div className="pf-actions">
                <button
                  className="pf-primary"
                  disabled={busy || success || !authenticated || !targets.length || !name.trim()}
                >
                  {weekly ? <ClipboardList size={16} /> : <Coffee size={16} />}{" "}
                  {busy
                    ? "처리 중…"
                    : weekly
                      ? "ChatGPT로 보고서 작성"
                      : "ChatGPT로 업무 마감 작성"}
                </button>
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="pf-error">
                {error}
              </p>
            )}
            {created.length > 0 && (
              <section className="pf-panel">
                <h2>
                  <Check size={17} /> 만든 대화
                </h2>
                {created.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className="pf-row"
                    onClick={() => onOpen(s)}
                  >
                    <span>
                      {projects.find((p) => p.id === s.projectId)?.name} /{" "}
                      {s.title}
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </section>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
