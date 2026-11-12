import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  Coffee,
} from "lucide-react";
import type { Project, Session } from "../shared/types";
import { workKinds, type WorkInput } from "../shared/workbench";
import { errorText, localDay } from "./ProjectPortfolio";

type Props = {
  kind: "weekly" | "pause";
  projects: Project[];
  sessions: Session[];
  onOpen(session: Session): void;
  onStart(session: Session, request: string): Promise<void>;
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
  week.setDate(today.getDate() - 6);
  const [tab, setTab] = useState<"create" | "history">("create");
  const [picked, setPicked] = useState<string[]>([]),
    [destination, setDestination] = useState("");
  const [from, setFrom] = useState(localDay(week.toISOString())),
    [to, setTo] = useState(localDay(today.toISOString()));
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
        ...(weekly && { reportProjects: targets.map((item) => item.id) }),
      };
      try {
        const record = await window.flowrium.startWork(seed);
        newEntries.push(record);
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
        );
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
                ? "선택한 프로젝트의 완료 업무와 커밋을 모아 보고서를 작성하세요."
                : "자리를 비우기 전에 진행 내용과 다음에 할 일을 프로젝트별로 기록하세요."}
            </p>
          </div>
        </header>
        <nav className="pf-tabs" aria-label={title + " 화면"}>
          <button
            aria-current={tab === "create" ? "page" : undefined}
            onClick={() => setTab("create")}
          >
            {weekly ? "새 보고서" : "마감 기록 작성"}
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
              <legend>{weekly ? "보고할 프로젝트" : "마감할 프로젝트"}</legend>
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
              {weekly && (
                <div className="pf-grid2">
                  <label>
                    조회 시작일
                    <input
                      type="date"
                      required
                      value={from}
                      max={to}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    조회 종료일
                    <input
                      type="date"
                      required
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
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
                {weekly ? "강조할 사항" : "복귀할 때 참고할 메모"}
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
                  대화를 만든 뒤 설정에서 계정을 연결하면 요청을 보낼 수
                  있습니다.
                </p>
              )}
              <div className="pf-actions">
                <button
                  className="pf-primary"
                  disabled={busy || success || !targets.length || !name.trim()}
                >
                  {weekly ? <ClipboardList size={16} /> : <Coffee size={16} />}{" "}
                  {busy
                    ? "처리 중…"
                    : weekly
                      ? "보고서 작성"
                      : "마감 기록 만들기"}
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
