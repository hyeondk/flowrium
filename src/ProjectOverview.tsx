import {projectCategory} from "../shared/project-details";
import LoadingProgress from './LoadingProgress';
import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProjectMemory } from "./ProjectMemory";
import DashboardBack from "./DashboardBack";
import {
  BarChart3,
  Folder,
  ListTodo,
  MoreHorizontal,
  Menu,
  Settings2,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  MessagesSquare,
  CalendarDays,
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
const resourceTabs: ProjectTab[] = ["docs", "rules", "design", "meetings"];
const menuTabs = projectTabs.filter(([key]) => key !== "home" && (key === "docs" || !resourceTabs.includes(key)));
const noteNames = { rules: "규칙", design: "디자인 시안", meetings: "회의록" };
interface Props {
  headerActions?: ReactNode;
  nameLink?: import("../shared/portfolio").ProjectNameLink;
  project: Project;
  sessions: Session[];
  tab: ProjectTab;
  onTabChange(tab: ProjectTab): void;
  onOpenSession(session: Session): void;
  renderPanel(tab: ProjectTab): ReactNode;
  onMenu(): void;
  onDashboard(): void;
  onCategory(): void;
  categoryRevision: number;
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
  project, nameLink,
  headerActions,
  sessions,
  tab,
  onTabChange,
  onOpenSession,
  renderPanel,
  onMenu,
  onDashboard,
  onCategory,
  categoryRevision,
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
  }, [project.id, project.name, rev, tab, categoryRevision]);
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
    category: projectCategory(data),
    owner: data?.owner || "",
    goal: data?.goal || "",
    dueDate: data?.dueDate || "",
  };
  const now = new Date(), monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay()+6)%7));
  const weekStart=localDay(monday.toISOString());
  const weeklyGoals=(data?.periodGoals||[]).filter(goal=>goal.period==='week'&&goal.key===weekStart&&!goal.carriedTo);
  const recent=own.filter(row=>row.messages.length).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,3);
  const [checking,setChecking]=useState(false), [creating,setCreating]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false), [analysisOpen,setAnalysisOpen]=useState(false);
  const menuRef=useRef<HTMLDivElement>(null), menuButton=useRef<HTMLButtonElement>(null), analysisRef=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    if(!menuOpen)return;
    const pointer=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setMenuOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setMenuOpen(false);menuButton.current?.focus();}};
    document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};
  },[menuOpen]);
  const chooseTab=(next:ProjectTab)=>{setEditing(false);setMenuOpen(false);onTabChange(next);};
  async function createTask(){
    if(!api||creating)return;
    setCreating(true);setError('');
    try{onOpenSession(await api.createSession(project.id));}
    catch(e){setError(errorText(e));}
    finally{setCreating(false);}
  }
  function showAnalysis(){
    chooseTab('home');setAnalysisOpen(true);
    requestAnimationFrame(()=>analysisRef.current?.scrollIntoView({block:'start',behavior:'auto'}));
  }
  const today=localDay(now.toISOString());
  const phase=data?.archivedAt?'완료':meta.phase||'진행';
  const activeTab=projectTabs.find(([key])=>key===tab)?.[1]||'홈';

  async function checkTask(id:string,done:boolean){
    if(!api||!data||checking)return;
    setChecking(true);
    try{change(await api.updateProjectDetails(project.id,data.revision,{action:'check',id,done}));}
    catch(e){setError(errorText(e));}
    finally{setChecking(false);}
  }
  const isNative = tab === "work" || tab === "team" || tab === "github";
  return (
    <div className={"pf-page pf-overview" + (isNative ? " pf-native" : "")}>
      <header className="project-document-toolbar">
        <div className="project-toolbar-leading">
          <button className="mobile-menu project-toolbar-icon" onClick={onMenu} aria-label="메뉴 열기" title="메뉴 열기"><Menu size={17}/></button>
          <DashboardBack onClick={onDashboard}/>
          <span>{tab==='home'?'프로젝트':activeTab}</span>
        </div>
        <div className="project-toolbar-actions">
          <div className="project-view-switch" role="group" aria-label="프로젝트 보기">
            <button aria-label="업무" aria-pressed={tab==='home'&&!analysisOpen} onClick={()=>{chooseTab('home');setAnalysisOpen(false);}}><ListTodo size={14}/><span>업무</span></button>
            <button aria-label="분석" aria-pressed={tab==='home'&&analysisOpen} onClick={showAnalysis}><BarChart3 size={14}/><span>분석</span></button>
          </div>
          <div className="project-menu" ref={menuRef}>
            <button ref={menuButton} className="project-toolbar-icon" aria-label="프로젝트 메뉴" title="프로젝트 메뉴" aria-expanded={menuOpen} aria-controls="project-detail-navigation" onClick={()=>setMenuOpen(!menuOpen)}><MoreHorizontal size={18}/></button>
            {menuOpen&&<nav id="project-detail-navigation" className="project-detail-navigation" aria-label="프로젝트 상세 탭">
              {menuTabs.map(([key,label])=><button key={key} aria-current={(tab===key || (key==='docs' && resourceTabs.includes(tab)))?'page':undefined} onClick={()=>chooseTab(key)}>{label}{tab===key&&<Check size={14}/>}</button>)}
            </nav>}
          </div>
          {headerActions}
        </div>
      </header>
      <div className="project-document-scroll">
      <div className="pf-content project-document-content" data-project-tab={tab}>
        <header className="project-document-heading">
          <div>
            <div className="project-document-path"><Folder size={13}/><span>{[meta.category||'프로젝트',phase].join(' / ')}</span></div>
            <h1>{name}</h1>
            {data?.goal&&<p>{data.goal}</p>}
          </div>
          <button className="project-new-task" onClick={()=>void createTask()} disabled={creating}><Plus size={14}/>{creating?'준비 중…':'새 업무'}</button>
        </header>
        {error && (
          <p role="alert" className="pf-error">
            {error}{" "}
            <button onClick={() => reload((r) => r + 1)}>
              <RefreshCw size={14} />
              새로 고침
            </button>
          </p>
        )}
        {!data && !error && <LoadingProgress label="프로젝트 정보를 불러오는 중입니다." />}
        {resourceTabs.includes(tab) && <nav className="project-resource-nav" aria-label="자료 종류">
          {projectTabs.filter(([key])=>resourceTabs.includes(key)).map(([key,label])=>
            <button key={key} aria-current={tab===key?'page':undefined} onClick={()=>chooseTab(key)}>{label}</button>)}
        </nav>}
        {isNative && <div className="pf-native-pane">{renderPanel(tab)}</div>}
        {tab === "home" && (
          <>
            <section className="overview-section" aria-label="이번 주 목표">
              <header><h2>이번 주 목표</h2><small>{today.replaceAll('-','.')} 기준</small></header>
              {weeklyGoals.length?weeklyGoals.map(goal=><div key={goal.id} className="overview-goal">
                <div className="overview-goal-heading"><strong>{goal.text}</strong><small>{goal.target!==undefined?(goal.current||0)+' / '+goal.target:goal.done?'완료':'진행 중'}</small></div>
                {goal.target!==undefined&&<progress aria-label={goal.text+' 진척'} value={Math.min(goal.current||0,goal.target)} max={goal.target}/>}
                <div className="overview-goal-footer"><small>{goal.target!==undefined?'남은 목표 '+Math.max(0,goal.target-(goal.current||0)):goal.done?'목표를 완료했습니다.':'목표를 진행하고 있습니다.'}</small>{goal.due&&<small className="overview-deadline" data-today={goal.due===today}><CalendarDays size={12}/>{goal.due===today?'오늘 기한':'기한 '+goal.due}</small>}</div>
              </div>):<div className="overview-empty"><p>이번 주에 등록한 목표가 없습니다.</p><button onClick={showAnalysis}>목표 추가 <ArrowRight size={13}/></button></div>}
            </section>
            <section className="overview-section" aria-label="프로젝트 할 일">
              <header><h2>프로젝트 할 일 <small>{data?.checklist.length||0}</small></h2><button onClick={()=>chooseTab('work')}>업무 현황 <ArrowRight size={13}/></button></header>
              {!!data?.checklist.length&&<div className="overview-task-list">{data.checklist.map(item=><label key={item.id} className="overview-task" data-completed={item.done}>
                <AnimatedCheckbox checked={item.done} disabled={checking} onChange={e=>void checkTask(item.id,e.target.checked)}/>
                <span className="overview-task-copy"><strong>{item.text}</strong><small>{meta.category||name}</small></span><small className="overview-task-state">{item.done?'완료':'진행 예정'}</small>
              </label>)}</div>}
              {!data?.checklist.length&&<div className="overview-empty"><p>등록한 할 일이 없습니다.</p><button onClick={()=>chooseTab('settings')}>할 일 추가 <ArrowRight size={13}/></button></div>}
            </section>
            <section className="overview-section" aria-label="최근 활동">
              <header><h2>최근 활동</h2><small>최근 대화</small></header>
              <div className="overview-activity-list">{recent.map(s=><button key={s.id} className="overview-activity" onClick={()=>onOpenSession(s)}><span className="overview-activity-symbol"><MessagesSquare size={14}/></span><span>{s.title}</span><time dateTime={s.updatedAt}>{localDay(s.updatedAt)===today?'오늘':localDay(s.updatedAt)}</time></button>)}</div>
              {!recent.length&&<p className="overview-muted">아직 기록된 대화가 없습니다.</p>}
            </section>
            <details ref={analysisRef} className="overview-tools" open={analysisOpen} onToggle={e=>setAnalysisOpen(e.currentTarget.open)}>
              <summary><ChevronRight size={14}/><span>프로젝트 분석</span><small>업무 흐름 / 목표 진척</small></summary>
              <div className="overview-tools-body">
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
            <div className="pf-columns pf-project-summary">
              <section className="pf-overview-group">
                <div className="pf-section-header">
                  <h2>다음 업무</h2>
                  <button onClick={() => onTabChange("work")}>
                    업무 열기 <ArrowRight size={14} />
                  </button>
                </div>
                <div className="pf-panel pf-overview-body">
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
                </div>
              </section>
              <section className="pf-overview-group">
                <div className="pf-section-header">
                  <h2>프로젝트 개요</h2>
                  <button onClick={() => onTabChange("settings")}>
                    설정 <ArrowRight size={14} />
                  </button>
                </div>
                <div className="pf-panel pf-overview-body">
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
                </div>
              </section>
            </div>
            {data && <ProjectShortcuts project={project} data={data} onChange={change} onManage={() => onTabChange('settings')}/>}
            {data && <AdvancedGoals data={data} onChange={change} />}
            <ProjectAIActions project={project} purpose="goals" onOpen={onOpenSession}/>
            <div className="pf-columns">
              <section className="pf-overview-group">
                <div className="pf-section-header">
                  <h2>킥오프 체크리스트</h2>
                  <button onClick={() => onTabChange("settings")}>
                    항목 관리
                  </button>
                </div>
                <div className="pf-panel pf-overview-body">
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
                </div>
              </section>
              <section className="pf-overview-group">
                <div className="pf-section-header">
                  <h2>최근 커밋</h2>
                  <button onClick={() => onTabChange("github")}>
                    저장소 열기
                  </button>
                </div>
                <div className="pf-panel pf-overview-body">
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
                </div>
              </section>
            </div>
            </div></details>
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
        {tab === "settings" && <div className="pf-section-header"><h2>카테고리</h2><button onClick={onCategory}>{projectCategory(data) || "미분류"} / 카테고리 관리</button></div>}
        {tab === "settings" && data && <ProjectRepositories project={project} data={data} onChange={change}/>}
        {tab === "settings" && data && <ProjectShortcuts project={project} data={data} editable onChange={change}/>}
        {tab === "settings" && (
          <section className="kickoff-settings">
            <div className="pf-section-header">
              <h2>킥오프 정보</h2>
              {!editing && (
                <button onClick={() => setEditing(true)}>킥오프 수정</button>
              )}
            </div>
            {editing && data ? (
              <KickoffForm
                editing
                nameLink={nameLink}
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
          </section>
        )}
        {tab === 'home' && <footer className="project-document-actions"><button onClick={()=>chooseTab('settings')}><Settings2 size={14}/>프로젝트 설정</button></footer>}
      </div>
      </div>
    </div>
  );
}
