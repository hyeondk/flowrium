import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useState, type ReactNode } from "react";
import { ProjectMemory } from "./ProjectMemory";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Project, Session } from "../shared/types";
import type { ProjectDetails as Details } from "../shared/project-details";
import type { NoteKind, ProjectNote, ProjectTab } from "../shared/portfolio";
import type { WorkOverview } from "../shared/workbench";
import { ArtifactPanel } from "./Workbench";
import ProjectDetails from "./ProjectDetails";
import {
  emptyKickoff,
  errorText,
  KickoffForm,
  localDay,
} from "./ProjectPortfolio";
import "./portfolio.css";
import AdvancedGoals from "./AdvancedGoals";
import ProjectRepositories from "./ProjectRepositories";
import ProjectAIActions from "./ProjectAIActions";
import ProjectShortcuts from "./ProjectShortcuts";

const api = window.flowrium;
export const projectTabs: [ProjectTab, string][] = [
  ["home", "홈"],
  ["work", "업무 현황"],
  ["team", "팀"],
  ["github", "GitHub"],
  ["rules", "규칙"],
  ["design", "디자인 시안"],
  ["meetings", "회의록"],
  ["docs", "문서"],
  ["settings", "프로젝트 설정"],
];
const noteNames = { rules: "규칙", design: "디자인 시안", meetings: "회의록" };
interface Props {
  project: Project;
  sessions: Session[];
  tab: ProjectTab;
  onTabChange(tab: ProjectTab): void;
  onOpenSession(session: Session): void;
  renderPanel(tab: ProjectTab): ReactNode;
  onBack(): void;
  onDetailsChange?(details: Details): void;
}
function ProjectNotes({ project, kind, onOpen }: { project: Project; kind: NoteKind;onOpen(s:Session):void }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]),
    [query, setQuery] = useState(""),
    [selected, select] = useState<ProjectNote>();
  const [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, reload] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    api
      ?.listProjectNotes(project.id, kind)
      .then((list) => {
        if (live) setNotes(list);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [project.id, kind, refresh]);
  useEffect(() => {
    let live = true;
    setText("");
    setError("");
    if (selected?.preview)
      api
        ?.readProjectNote(project.id, kind, selected.path)
        .then((s) => {
          if (live) setText(s);
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [project.id, kind, selected]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const note = await api.createProjectNote(
        project.id,
        kind,
        title.trim(),
        body,
      );
      reload((i) => i + 1);
      select(note);
      setAdding(false);
      setTitle("");
      setBody("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const label = noteNames[kind],
    shown = notes.filter((n) =>
      n.path.toLowerCase().includes(query.trim().toLowerCase()),
    );
  return (
    <section className="pf-panel">
      <ProjectAIActions project={project} purpose={kind} onOpen={onOpen}/>
      <div className="pf-section-header">
        <h2>{label}</h2>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              select(undefined);
              setError("");
            }}
          >
            <Plus size={14} />
            {kind === "design" ? "시안 설명 작성" : label + " 작성"}
          </button>
        )}
      </div>
      <p className="pf-muted">
        {
          {
            rules: "프로젝트의 AGENTS.md와 규칙 폴더에 있는 문서를 확인하세요.",
            design:
              "프로젝트 디자인 폴더의 문서와 시안을 모아 보고 검토 내용을 남기세요.",
            meetings:
              "회의에서 결정한 내용과 후속 업무를 프로젝트 문서로 남기세요.",
          }[kind]
        }
      </p>
      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}
      {adding ? (
        <form className="pf-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <label>
              문서 이름
              <input
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label>
              본문
              <textarea
                rows={8}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="마크다운으로 작성하세요."
              />
            </label>
            <div className="pf-actions">
              <button type="button" onClick={() => setAdding(false)}>
                취소
              </button>
              <button className="pf-primary" type="submit">
                문서 저장
              </button>
            </div>
          </fieldset>
        </form>
      ) : selected ? (
        <>
          <div className="pf-section-header">
            <strong className="pf-path">{selected.path}</strong>
            <div className="pf-actions">
              <button onClick={() => select(undefined)}>목록으로</button>
              <button
                onClick={() =>
                  void api
                    ?.revealProjectNote(project.id, kind, selected.path)
                    .catch((e) => setError(errorText(e)))
                }
              >
                <FolderOpen size={15} />
                파일 위치 열기
              </button>
            </div>
          </div>
          {selected.preview ? (
            <pre className="pf-preview">{text}</pre>
          ) : (
            <p className="pf-empty">파일 위치에서 원본을 열 수 있습니다.</p>
          )}
        </>
      ) : (
        <>
          <div className="pf-filter">
            <Search size={15} />
            <input
              aria-label={label + " 검색"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="문서 이름 또는 경로 검색"
            />
          </div>
          <div className="pf-list">
            {shown.map((note) => (
              <button
                key={note.path}
                className="pf-row"
                onClick={() => select(note)}
              >
                <FileText size={17} />
                <span>
                  <strong>{note.path.split("/").pop()}</strong>
                  <small className="pf-path">{note.path}</small>
                </span>
                <time>{localDay(note.modifiedAt)}</time>
              </button>
            ))}
          </div>
          {!shown.length && (
            <p className="pf-empty">조건에 맞는 문서가 없습니다.</p>
          )}
        </>
      )}
    </section>
  );
}

function anchorPeriod(day: string, period: "week" | "month") {
  if (period === "month") return day.slice(0, 7);
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d.toISOString());
}
function Goals({
  data,
  onChange,
}: {
  data: Details;
  onChange(d: Details): void;
}) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [date, setDate] = useState(localDay(new Date().toISOString())),
    [value, setValue] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = anchorPeriod(date, period);
  const shown = (data.periodGoals || []).filter(
    (g) => g.period === period && g.key === key,
  );
  async function update(
    action: "goal-add" | "goal-check" | "goal-remove",
    id?: string,
    done?: boolean,
  ) {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const change =
        action === "goal-add"
          ? { action, period, key, text: value }
          : action === "goal-check"
            ? { action, id: id!, done: !!done }
            : { action, id: id! };
      const next = await api.updateProjectDetails(
        data.projectId,
        data.revision,
        change,
      );
      onChange(next);
      if (action === "goal-add") setValue("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pf-panel">
      <div className="pf-section-header">
        <h2>기간별 목표</h2>
        <div className="pf-actions">
          <select
            aria-label="목표 기간"
            value={period}
            onChange={(e) => setPeriod(e.target.value as "week" | "month")}
          >
            <option value="week">주간</option>
            <option value="month">월간</option>
          </select>
          <input
            type="date"
            aria-label="목표 기준일"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
        </div>
      </div>
      {error && (
        <p className="pf-error" role="alert">
          {error}
        </p>
      )}
      <div className="pf-goals">
        {shown.map((g) => (
          <label key={g.id}>
            <AnimatedCheckbox
              checked={g.done}
              disabled={busy}
              onChange={(e) =>
                void update("goal-check", g.id, e.target.checked)
              }
            />
            <span>{g.text}</span>
            <button
              disabled={busy}
              onClick={() => void update("goal-remove", g.id)}
            >
              삭제
            </button>
          </label>
        ))}
      </div>
      <form
        className="pf-filter"
        onSubmit={(e) => {
          e.preventDefault();
          void update("goal-add");
        }}
      >
        <input
          aria-label="기간 목표"
          maxLength={500}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            period === "week" ? "이 주에 달성할 목표" : "이 달에 달성할 목표"
          }
        />
        <button disabled={busy || !value.trim()}>목표 추가</button>
      </form>
    </section>
  );
}

export function ProjectOverview({
  project,
  sessions,
  tab,
  onTabChange,
  onOpenSession,
  renderPanel,
  onBack,
  onDetailsChange,
}: Props) {
  const [data, setData] = useState<Details>(),
    [overview, setOverview] = useState<WorkOverview>();
  const [error, setError] = useState(""),
    [rev, reload] = useState(0),
    [editing, setEditing] = useState(false),
    [settingsEpoch, setSettingsEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setData(undefined);
    api
      ?.readProjectDetails(project.id)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [project.id, rev, tab]);
  useEffect(() => {
    let live = true;
    setOverview(undefined);
    if (tab === "home" || tab === "docs")
      api
        ?.readWorkbench(project.id)
        .then((v) => {
          if (live) setOverview(v);
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [project.id, rev, tab]);
  const own = sessions.filter((s) => s.projectId === project.id);
  const name = data?.kickoff?.name || project.name,
    done = own.filter((s) => s.workflow?.status === "done");
  const incomplete = own
    .filter((s) => s.workflow?.status !== "done")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const change = (d: Details) => {
    setData(d);
    onDetailsChange?.(d);
  };
  const meta = {
    ...emptyKickoff,
    name,
    ...data?.kickoff,
    owner: data?.owner || "",
    goal: data?.goal || "",
    dueDate: data?.dueDate || "",
  };
  const isNative = tab === "work" || tab === "team" || tab === "github";
  return (
    <div className={"pf-page pf-overview" + (isNative ? " pf-native" : "")}>
      <div className="pf-content">
        <button className="pf-back" onClick={onBack}>
          <ArrowLeft size={14} />
          프로젝트 대시보드
        </button>
        <header className="pf-heading">
          <div>
            <h1>{name}</h1>
            <p>
              {data?.goal || "프로젝트 홈에서 목표, 업무, 자료를 관리하세요."}
            </p>
          </div>
          <span
            className="pf-status"
            data-phase={data?.archivedAt ? "보관" : meta.phase}
          >
            {data?.archivedAt ? "보관" : meta.phase || "진행"}
          </span>
        </header>
        <nav className="pf-tabs" aria-label="프로젝트 상세 탭">
          {projectTabs.map(([key, label]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setEditing(false);
                onTabChange(key);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="pf-error">
            {error}{" "}
            <button onClick={() => reload((r) => r + 1)}>
              <RefreshCw size={14} />
              새로 고침
            </button>
          </p>
        )}
        {isNative && <div className="pf-native-pane">{renderPanel(tab)}</div>}
        {tab === "home" && (
          <>
            {data && <ProjectShortcuts project={project} data={data} onChange={change} onManage={() => onTabChange('settings')}/>}
            <div className="pf-stats">
              <button onClick={() => onTabChange("work")}>
                <span>진행 및 검토 업무</span>
                <strong>{incomplete.length}</strong>
              </button>
              <button onClick={() => onTabChange("work")}>
                <span>완료한 업무</span>
                <strong>{done.length}</strong>
              </button>
              <button onClick={() => onTabChange("docs")}>
                <span>프로젝트 문서</span>
                <strong>{overview?.artifacts.length ?? "…"}</strong>
              </button>
            </div>
            <div className="pf-columns">
              <section className="pf-panel">
                <div className="pf-section-header">
                  <h2>프로젝트 개요</h2>
                  <button onClick={() => onTabChange("settings")}>
                    설정 <ArrowRight size={14} />
                  </button>
                </div>
                <dl className="pf-metadata">
                  {[
                    ["담당자", data?.owner],
                    ["참여자", meta.members],
                    [
                      "기간",
                      [meta.startedAt, data?.dueDate]
                        .filter(Boolean)
                        .join(" ~ "),
                    ],
                    ["구분", meta.category],
                    ["발주처 또는 대상", meta.client],
                    ["자료 분류", meta.privacy],
                    ["저장소", meta.repository],
                  ]
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd className="pf-path">{v}</dd>
                      </div>
                    ))}
                </dl>
                {meta.notes && <p className="pf-note-text">{meta.notes}</p>}
              </section>
              <section className="pf-panel">
                <div className="pf-section-header">
                  <h2>다음 업무</h2>
                  <button onClick={() => onTabChange("work")}>
                    업무 열기 <ArrowRight size={14} />
                  </button>
                </div>
                {incomplete.slice(0, 4).map((s) => (
                  <button
                    className="pf-row"
                    key={s.id}
                    onClick={() => onOpenSession(s)}
                  >
                    <span>
                      <strong>{s.title}</strong>
                      <small>
                        {s.workflow?.checklist.find((c) => !c.done)?.text ||
                          s.workflow?.brief ||
                          "대화 이어가기"}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {!incomplete.length && (
                  <p className="pf-empty">
                    진행 중인 업무가 없습니다. 업무 현황에서 담당할 일을
                    선택하세요.
                  </p>
                )}
              </section>
            </div>
            {data && <AdvancedGoals data={data} onChange={change} />}
            <ProjectAIActions project={project} purpose="goals" onOpen={onOpenSession}/>
            <div className="pf-columns">
              <section className="pf-panel">
                <div className="pf-section-header">
                  <h2>킥오프 체크리스트</h2>
                  <button onClick={() => onTabChange("settings")}>
                    항목 관리
                  </button>
                </div>
                {(data?.checklist || []).map((c) => (
                  <p key={c.id}>
                    {c.done ? <Check size={14} /> : null} {c.text}
                  </p>
                ))}
                {!data?.checklist.length && (
                  <p className="pf-empty">
                    프로젝트 설정에서 확인할 항목을 추가하세요.
                  </p>
                )}
              </section>
              <section className="pf-panel">
                <div className="pf-section-header">
                  <h2>최근 커밋</h2>
                  <button onClick={() => onTabChange("github")}>
                    저장소 열기
                  </button>
                </div>
                {overview?.git.commits.slice(0, 4).map((c) => (
                  <div key={c.hash} className="pf-row">
                    <code>{c.hash}</code>
                    <span>{c.subject}</span>
                    <time>{localDay(c.at)}</time>
                  </div>
                ))}
                {overview && !overview.git.commits.length && (
                  <p className="pf-empty">
                    {overview.git.reason || "저장소에 기록된 커밋이 없습니다."}
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        {tab === "rules" && <ProjectMemory projectId={project.id} />}
        {(tab === "rules" || tab === "design" || tab === "meetings") && (
          <ProjectNotes key={project.id + tab} project={project} kind={tab} onOpen={onOpenSession}/>
        )}
        {tab === "docs" && <ProjectAIActions project={project} purpose="docs" onOpen={onOpenSession}/>}
        {tab === "docs" && (
          <ArtifactPanel
            overview={overview}
            project={project}
            sessions={own}
            onOpen={async (s) => onOpenSession(s)}
            refresh={() => reload((r) => r + 1)}
          />
        )}
        {tab === "settings" && data && <ProjectRepositories project={project} data={data} onChange={change}/>}
        {tab === "settings" && data && <ProjectShortcuts project={project} data={data} editable onChange={change}/>}
        {tab === "settings" && (
          <>
            <div className="pf-section-header">
              <h2>킥오프 정보</h2>
              {!editing && (
                <button onClick={() => setEditing(true)}>킥오프 수정</button>
              )}
            </div>
            {editing && data ? (
              <KickoffForm
                editing
                initial={meta}
                onCancel={() => setEditing(false)}
                onSave={async (values) => {
                  const d = await api!.setKickoffDetails(
                    project.id,
                    data.revision,
                    values,
                  );
                  change(d);
                  setSettingsEpoch((n) => n + 1);
                  setEditing(false);
                }}
              />
            ) : (
              <p className="pf-muted">
                {meta.notes ||
                  "프로젝트의 범위, 담당자, 기간과 저장소를 관리하세요."}
              </p>
            )}
            <ProjectDetails
              key={project.id + "-" + settingsEpoch}
              project={project}
              onChange={(d) => {
                if (d.revision !== data?.revision) change(d);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
