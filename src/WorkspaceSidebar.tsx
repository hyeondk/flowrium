import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  ClipboardList,
  Coffee,
  FileText,
  Folder,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Music2,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import type { Project } from "../shared/types";
import "./workspace-sidebar.css";

export type SideDestination =
  | "dashboard"
  | "kickoff"
  | "archive"
  | "outputs"
  | "weekly"
  | "pause"
  | "terminal"
  | "music"
  | "workflow";
type Props = {
  current: string;
  mobileOpen: boolean;
  projects: Project[];
  selected?: string;
  counts: Record<string, { running: number; waiting: number }>;
  onGo(view: SideDestination): void;
  onProject(p: Project): void;
  onSettings(): void;
  onLock(): void;
  onLogout(): void;
  account?: string;
};
function MenuRow({
  label,
  icon: Icon,
  active,
  onClick,
  extraClass = "",
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick(): void;
  extraClass?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={"side-row " + extraClass}
    >
      <Icon size={17} strokeWidth={1.65} />
      <span>{label}</span>
    </button>
  );
}
function MenuGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="side-group" aria-label={label}>
      <h2>{label}</h2>
      {children}
    </section>
  );
}
export default function WorkspaceSidebar({
  current,
  mobileOpen,
  projects,
  selected,
  counts,
  onGo,
  onProject,
  onSettings,
  onLock,
  onLogout,
  account,
}: Props) {
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem("flowrium.sidebar") === "compact";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("flowrium.sidebar", compact ? "compact" : "wide");
    } catch {}
  }, [compact]);
  const row = (key: SideDestination, label: string, icon: LucideIcon) => (
    <MenuRow
      label={label}
      icon={icon}
      active={current === key}
      onClick={() => onGo(key)}
    />
  );
  return (
    <aside
      aria-label="작업 공간 탐색"
      data-compact={compact}
      className={"sidebar workspace-side" + (mobileOpen ? " is-open" : "")}
    >
      <div className="side-brand-row">
        <button
          className="side-brand"
          onClick={() => onGo("dashboard")}
          aria-label="Flowrium 홈"
        >
          <img src="./flowrium.png" width="33" height="33" alt="" />
          <span>Flowrium</span>
        </button>
        <button
          type="button"
          className="side-collapse"
          title={compact ? "사이드바 펼치기" : "사이드바 접기"}
          aria-label={compact ? "사이드바 펼치기" : "사이드바 접기"}
          aria-expanded={!compact}
          onClick={() => setCompact(!compact)}
        >
          {compact ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav aria-label="주 메뉴">
        {row("dashboard", "대시보드", LayoutDashboard)}
        <section className="side-projects" aria-label="프로젝트">
          <div className="side-project-head">
            <h2>프로젝트</h2>
            <button
              title="프로젝트 추가"
              aria-label="프로젝트 추가"
              aria-current={current === "kickoff" ? "page" : undefined}
              onClick={() => onGo("kickoff")}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="side-project-list">
            {projects.map((p) => {
              const count = counts[p.id];
              const state = count?.waiting
                ? "승인 대기"
                : count?.running
                  ? "실행 중"
                  : "";
              return (
                <button
                  className="side-row side-project"
                  key={p.id}
                  title={p.name + (state ? " / " + state : "")}
                  aria-label={p.name}
                  aria-current={p.id === selected ? "page" : undefined}
                  onClick={() => onProject(p)}
                >
                  <Folder size={16} strokeWidth={1.65} />
                  <span>{p.name}</span>
                  {state && (
                    <small className="side-state" data-state={state}>
                      {state === "승인 대기" ? count.waiting : count.running}
                    </small>
                  )}
                </button>
              );
            })}
            {!projects.length && <p>연결한 프로젝트가 없습니다.</p>}
          </div>
        </section>
        <MenuGroup label="보관">
          {row("outputs", "산출물", FileText)}
          {row("archive", "완료", Archive)}
        </MenuGroup>
        <MenuGroup label="도구">
          {row("workflow", "업무 연결 / 비서", MessagesSquare)}
          {row("weekly", "주간업무보고", ClipboardList)}
          {row("pause", "업무 마감", Coffee)}
          {row("terminal", "터미널", SquareTerminal)}
          {row("music", "뮤직", Music2)}
          <MenuRow
            label="설정"
            icon={Settings2}
            onClick={onSettings}
            extraClass="settings-button"
          />
          <MenuRow label="잠금" icon={LockKeyhole} onClick={onLock} />
          <MenuRow label="로그아웃" icon={LogOut} onClick={onLogout} />
        </MenuGroup>
      </nav>
      <div className="side-account" title={account || "계정 연결 필요"}>
        <i data-connected={Boolean(account)} />
        <span>{account || "계정 연결 필요"}</span>
      </div>
    </aside>
  );
}
