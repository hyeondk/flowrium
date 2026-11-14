import SystemTools from "./SystemTools";
import { useEffect, useState } from "react";
import { ListChecks, MessageSquare, RefreshCw, Square } from "lucide-react";
import type { SystemActivity } from "../shared/activity";
import type { FlowriumEvent, Project, Session } from "../shared/types";
import "./activity.css";
import {ExecutionBadge} from './ExecutionStatus';
import {sessionExecution,executionLabels,type ExecutionState} from '../shared/execution-state';
import type {WorkflowProposal} from '../shared/workflow';

interface ShortcutActions {
  board(): void;
  newChat(): void;
  history(): void;
  settings(): void;
}

export function useWorkspaceShortcuts({ board, newChat, history, settings }: ShortcutActions) {
  useEffect(() => {
    const mac = /Mac/.test(navigator.platform);
    function handle(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return;
      if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
      if (document.querySelector('dialog[open], [role="dialog"]:not([hidden])')) return;
      const actions: Record<string, () => void> = {Digit1: board, KeyN: newChat, Digit2: history, Comma: settings};
      const action = actions[event.code];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [board, newChat, history, settings]);
}

interface Props {
  projects: Project[];
  sessions: Session[];
  activities: Record<string, {status: string}>;
  approvals: FlowriumEvent[];
  proposals?:WorkflowProposal[];
  onOpen(session: Session): void;
  onInterrupt(id: string): Promise<void>;
}
const gigabytes = (bytes: number) => (bytes / 1024 ** 3).toLocaleString("ko-KR", {maximumFractionDigits: 1}) + " GiB";
const clock = (date: string) => new Date(date).toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit", second:"2-digit"});

function latestRequest(session: Session) {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === "user") return session.messages[i].text;
  }
  return "";
}

export function ActivityPanel({ projects, sessions, activities, approvals, proposals=[], onOpen, onInterrupt }: Props) {
  const [source, setSource] = useState<ExecutionState | "all">("running");
  const [system, setSystem] = useState<SystemActivity>();
  const [refresh, setRefresh] = useState(0);
  const [systemError, setSystemError] = useState("");
  const [stopError, setStopError] = useState("");
  const [stopping, setStopping] = useState<string[]>([]);
  const api = window.flowrium;

  useEffect(() => {
    if (!api) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const snapshot = await api!.readSystemActivity();
        if (!stopped) { setSystem(snapshot); setSystemError(""); }
      } catch (error) {
        if (!stopped) setSystemError(error instanceof Error ? error.message : "시스템 정보를 가져오지 못했습니다.");
      } finally {
        if (!stopped) timer = setTimeout(poll, 10000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, refresh]);

  async function stop(id: string) {
    setStopping(previous => [...previous, id]);
    setStopError("");
    try { await onInterrupt(id); }
    catch (error) { setStopError(error instanceof Error ? error.message : "작업을 중단하지 못했습니다."); }
    finally { setStopping(previous => previous.filter(value => value !== id)); }
  }

  const running = sessions.filter(session => activities[session.id]);
  const visible = source === "all" ? sessions : sessions.filter(s=>sessionExecution(s,activities[s.id],approvals,proposals)===source);
  const shortcut = /Mac/.test(navigator.platform) ? "⌘" : "Ctrl";
  return <main className="flow-activity">
    <header><ListChecks size={22}/><h1>작업 현황</h1></header>
    <section aria-label="시스템 자원">
      <div className="activity-section-title"><h2>이 컴퓨터</h2>
        {api && <button className="button subtle" onClick={() => setRefresh(value=>value+1)}><RefreshCw size={14}/>새로 고침</button>}
      </div>
      {system && <><dl className="activity-metrics">
        <div><dt>전체 CPU 사용률</dt><dd>{system.cpuPercent === null ? "측정 대기" : system.cpuPercent + "%"}</dd></div>
        <div><dt>논리 코어</dt><dd>{system.logicalCores}개</dd></div>
        <div><dt>여유 메모리 (전체 용량)</dt><dd>{gigabytes(system.freeMemoryBytes)} ({gigabytes(system.totalMemoryBytes)})</dd></div>
      </dl><small>최근 측정 {clock(system.measuredAt)}</small></>}
      {!system && !systemError && <p>{api ? "시스템 정보를 읽고 있습니다." : "데스크톱 앱에서 확인할 수 있습니다."}</p>}
      {systemError && <p role="alert">{systemError}</p>}
    </section>
    <SystemTools projects={projects}/>
    <section aria-label="전체 프로젝트의 업무">
      <div className="activity-section-title"><h2>업무 목록</h2><div className="activity-filter" aria-label="업무 범위">
        {(['running','waiting','decision'] as const).map(state=><button key={state} aria-pressed={source===state} onClick={()=>setSource(state)}>{executionLabels[state]} {sessions.filter(s=>sessionExecution(s,activities[s.id],approvals,proposals)===state).length}</button>)}
        <button aria-pressed={source === "all"} onClick={()=>setSource("all")}>전체 {sessions.length}</button>
      </div></div>
      {stopError && <p role="alert">{stopError}</p>}
      {visible.length === 0 && <p>{source === "all" ? "연결된 대화가 없습니다." : executionLabels[source]+" 상태의 대화가 없습니다."}</p>}
      <ul>{visible.map(session => {
        const active = activities[session.id];
        const state=sessionExecution(session,active,approvals,proposals);
        const request = latestRequest(session);
        const project = projects.find(value=>value.id===session.projectId);
        return <li key={session.id}><div>
          <small>{session.scope==='general'?'일반 대화':session.scope==='integrated'?'통합 채팅':project?.name || "프로젝트"} <ExecutionBadge state={state}/></small>
          <h3>{session.title}</h3>{request && <p className="activity-request">{request.slice(0,300)}</p>}
        </div><div className="activity-buttons">
          <button className="button subtle" onClick={()=>onOpen(session)}><MessageSquare size={14}/>대화 열기</button>
          {active && <button className="button subtle" disabled={stopping.includes(session.id)} onClick={()=>void stop(session.id)}><Square size={13}/>중단</button>}
        </div></li>;
      })}</ul>
    </section>
    <details><summary>작업 공간 단축키</summary>
      <dl className="activity-shortcuts">{[[1,"업무 보드"],["N","새 자유 대화"],[2,"작업 기록"],[",","설정"]].map(([key,name])=><div key={key}><dt>{name}</dt><dd><kbd>{shortcut} + {key}</kbd></dd></div>)}</dl>
    </details>
  </main>;
}
