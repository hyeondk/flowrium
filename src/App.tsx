import WorkflowHub from "./WorkflowHub";
import CommandCenter from "./CommandCenter";
import {AttachmentComposer,ChatAttachmentList,ChatQueuePanel} from "./ChatAttachments";
import InputRequestPanel from "./InputRequestPanel";
import { useWorkspaceDrafts } from "./useWorkspaceDrafts";
import WorkspaceSidebar from "./WorkspaceSidebar";
import ConversationDock from "./ConversationDock";
import {ExecutionSummary} from "./ExecutionStatus";
import {sessionExecution,visibleProposals,type ExecutionState} from "../shared/execution-state";
import type {WorkflowProposal,WorkflowState} from "../shared/workflow";
import {usePresence,MotionOverlay,ModalPortal,Toast,Snackbar,AnimatedCheckbox,LikeButton} from "./ui-motion";
import { AssistantShortcut } from "./ProjectMemory";
import PortfolioReports from "./PortfolioReports";
import WorkActionPopup,{type PopupWorkKind} from "./WorkActionPopup";
import MusicPanel from "./MusicPanel";
import IntegrationPanel from "./IntegrationPanel";
import RemotePanel from "./RemotePanel";
import { VoiceSettings, VoiceComposer, SpeakMessageButton } from "./VoiceTools";
import {effortOptions,effortLabels} from "../shared/model-options";
import SettingsLayout,{SettingsGroup} from "./SettingsLayout";
import CodexTransferPanel,{CodexLinkBar} from "./CodexTransferPanel";
import MessageHistory from "./MessageHistory";
import MessageContent from "./MessageContent";
import IconTooltips from "./IconTooltips";
import DotsPanel from "./DotsPanel";
import AttentionCenter from "./AttentionCenter";
import GoogleCalendarWorkspace from "./GoogleCalendarWorkspace";
import AccountSetupCard from "./AccountSetupCard";
import type {TrashResult} from "../shared/trash";
import ContextMenu from "./ContextMenu";
import {ItemDeleteDialog,TrashPanel,type DeleteTarget} from "./ItemDeletion";
import MigrationPanel from "./MigrationPanel";
import { useSecurity, SecurityPanel, LockScreen } from "./SecurityPanel";
import { ProjectPortfolio } from "./ProjectPortfolio";
import { ProjectOverview } from "./ProjectOverview";
import type { PortfolioView, ProjectTab } from "../shared/portfolio";
import TerminalPanel from "./TerminalPanel";
import ProjectDetails from "./ProjectDetails";
import { ActivityPanel, useWorkspaceShortcuts } from "./ActivityPanel";
import TeamPanel from "./TeamPanel";
import RepositoryPanel from "./RepositoryPanel";
import { ConversationTools } from "./ConversationTools";
import Workbench, { WorkSessionControls } from "./Workbench";
import { UpdatePanel, useDesktopUpdate } from "./UpdatePanel";
import { workKinds } from "../shared/workbench";
import packageInfo from "../package.json";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Bell,
  PanelRight,
  Music2,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Code2,
  Command,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  ConnectionStatus,
  Effort,
  FlowriumEvent,
  Mode,
  Model,
  Project,
  Session,
  ChatAttachment,
} from "../shared/types";

type View = "calendar" | "workflow" | PortfolioView | "weekly" | "pause" | "music" | "overview" | "terminal" | "details" | "activity" | "team" | "repo" | "inbox" | "home" | "workspace" | "history" | "library";
type Activity = { text: string; status: string; error?: string };
type CodexHistoryItem = {
  id: string;
  title: string;
  updatedAt: string;
  imported: boolean;
};
const api = window.flowrium;
const initial: Bootstrap = {
  projects: [],
  sessions: [],
  settings: { effort: "medium", theme: "light" },
  version: packageInfo.flowriumVersion || packageInfo.version,
  platform: "preview",
};
const modes = [
  {
    id: "plan" as Mode,
    title: "계획",
    label: "계획",
    icon: Sparkles,
    description: "구조를 읽고 다음 단계를 정리합니다.",
    prompt:
      "이 프로젝트의 구조를 살펴보고, 다음 개발을 위한 실행 계획을 세워줘. 먼저 현재 상태와 확인이 필요한 부분을 정리해줘.",
  },
  {
    id: "build" as Mode,
    title: "구현",
    label: "구현",
    icon: Code2,
    description: "프로젝트 파일을 수정하고 검증합니다.",
    prompt:
      "이 프로젝트에서 다음 기능을 구현하고 싶어. 먼저 관련 코드를 확인하고 구현 방법과 검증 계획을 알려줘.\n\n만들 기능: ",
  },
  {
    id: "review" as Mode,
    title: "검토",
    label: "검토",
    icon: ShieldCheck,
    description: "변경 사항과 회귀 위험을 확인합니다.",
    prompt:
      "현재 프로젝트의 변경 사항을 검토해줘. 실제 오류 가능성과 회귀 위험을 중심으로 근거와 파일 위치를 알려줘. 파일은 수정하지 마.",
  },
];
const templates = [
  {
    title: "새 프로젝트의 첫 설계",
    category: "기획",
    mode: "plan" as Mode,
    description: "아이디어를 정리하고 작은 첫 버전을 설계합니다.",
    prompt:
      "새 프로젝트를 시작하려고 해. 아래 아이디어를 바탕으로 핵심 사용자 흐름, 첫 버전 범위, 기술 선택, 구현 순서를 정리해줘. 아직 파일은 변경하지 마.\n\n아이디어: ",
  },
  {
    title: "코드의 지도를 그려줘",
    category: "탐색",
    mode: "plan" as Mode,
    description: "구조와 진입점을 파악하고 다음 작업을 준비합니다.",
    prompt:
      "현재 프로젝트를 읽고 주요 디렉터리, 실행 진입점, 데이터 흐름, 개발 및 검증 명령을 설명해줘. 파일은 수정하지 마.",
  },
  {
    title: "증상부터 원인까지",
    category: "문제 해결",
    mode: "build" as Mode,
    description: "재현 조건을 확인하고 원인을 수정합니다.",
    prompt:
      "아래 문제를 해결해줘. 먼저 증상과 발생 조건을 재현하고 원인을 확인한 뒤 수정해줘. 같은 조건과 관련 회귀 시나리오로 검증하고 미검증 범위도 알려줘.\n\n증상: ",
  },
  {
    title: "변경 사항 검토",
    category: "품질",
    mode: "review" as Mode,
    description: "실제 결함과 검증이 빠진 부분을 찾습니다.",
    prompt: modes[2].prompt,
  },
  {
    title: "다음 작업을 위한 인수인계",
    category: "기록",
    mode: "plan" as Mode,
    description: "완료한 일과 남은 결정을 한 번에 정리합니다.",
    prompt:
      "현재 프로젝트 상태와 이 대화를 바탕으로 인수인계 문서를 작성해줘. 목표 / 완료한 내용 / 주요 파일 / 검증 결과 / 남은 사항 / 다음 작업 순서로 정리해줘. 파일은 수정하지 마.",
  },
  {
    title: "배포 전 마지막 확인",
    category: "배포",
    mode: "review" as Mode,
    description: "빌드와 설정을 확인해 배포 준비 상태를 봅니다.",
    prompt:
      "이 프로젝트의 배포 준비 상태를 검토해줘. 빌드 방법, 환경 설정, 인증 정보 노출, 운영체제 호환성, 실패 시 복구 방법을 실제 파일을 근거로 확인해줘. 외부 배포나 파일 수정은 하지 마.",
  },
];
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const upsert = (items: Session[], session: Session) =>
  [session, ...items.filter((item) => item.id !== session.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

export default function App() {
  const security = useSecurity();
  const lockPresence=usePresence(security.state.loaded&&security.state.locked,360);
  if (!security.state.loaded && security.error) return <main className="loading-page"><p role="alert">{security.error}</p><button onClick={()=>void security.refresh().catch(()=>{})}>연결 다시 확인</button></main>;
  if (!security.state.loaded) return <main className="loading-page"><LoaderCircle className="spin"/>작업 공간을 준비하고 있습니다.</main>;
  return <div className="security-stage">
    {!security.state.locked&&<div className="unlocked-stage"><UnlockedWorkspace key={security.state.accountRevision} security={security}/></div>}
    {lockPresence.present&&<div className="security-lock-layer" data-phase={lockPresence.phase} inert={!security.state.locked} aria-hidden={!security.state.locked}><LockScreen security={security} releasing={!security.state.locked}/></div>}
  </div>;
}
function UnlockedWorkspace({security}:{security:ReturnType<typeof useSecurity>}) {
  const [logoutOpen,setLogoutOpen] = useState(false);
  const update = useDesktopUpdate();
  const [archived, setArchived] = useState<Record<string,boolean>>({});
  const [data, setData] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [projectId, setProjectId] = useState<string>();
  useEffect(() => {
    let active = true;
    for (const project of data.projects) {
      api?.readProjectDetails(project.id).then(value => {
        if (active) setArchived(prev=>({...prev,[project.id]:Boolean(value.archivedAt)}));
      }).catch(()=>{});
    }
    return () => { active = false; };
  }, [data.projects]);
  const [sessionId, setSessionId] = useState<string>();
  const [view, setView] = useState<View>("dashboard");
  const [reportDialog,setReportDialog]=useState<"weekly"|"pause">();
  const [workPopup,setWorkPopup]=useState<PopupWorkKind|null>(null);
  const [dockOpen,setDockOpen]=useState(()=>window.innerWidth>=900);
  const [chatExpanded,setChatExpanded]=useState(false);
  const [musicOpen,setMusicOpen]=useState(false),[attentionOpen,setAttentionOpen]=useState(false);
  const [attentionState,setAttentionState]=useState<WorkflowState>();
  const musicPresence=usePresence(musicOpen);
  const [chatActive,setChatActive]=useState(false);
  const [creatingConversation,setCreatingConversation]=useState(false);
  const [dockFilter,setDockFilter]=useState<ExecutionState|'all'>('all');
  const [proposals,setProposals]=useState<WorkflowProposal[]>([]);
  const [projectNavigation,setProjectNavigation]=useState<{id:string;nonce:number}>();
  const [projectTab,setProjectTab] = useState<ProjectTab>("home");
  const {drafts,setDrafts,error:draftError,retry:retryDrafts} = useWorkspaceDrafts(security.state.accountRevision);
  const draftKey = sessionId
    ? `session:${sessionId}`
    : `project:${projectId || "unassigned"}`;
  const voiceContinuity=useRef({draftKey,generation:0,preserve:""});
  if(voiceContinuity.current.draftKey!==draftKey){
    if(voiceContinuity.current.preserve!==draftKey)voiceContinuity.current.generation++;
    voiceContinuity.current.draftKey=draftKey;voiceContinuity.current.preserve="";
  }
  const input = drafts[draftKey]?.text || "";
  const attachments=drafts[draftKey]?.attachments||[];
  const setAttachments=(items:ChatAttachment[])=>setDrafts(prev=>({...prev,[draftKey]:{text:prev[draftKey]?.text||"",mode:prev[draftKey]?.mode||mode,attachments:items}}));
  const workflow = data.sessions.find(s => s.id === sessionId)?.workflow;
  const mode = drafts[draftKey]?.mode || workflow?.teamSlot?.mode || (workflow ? workKinds[workflow.kind].mode : "plan");
  const setInput = (text: string) =>
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: { ...prev[draftKey],text, mode: prev[draftKey]?.mode || mode },
    }));
  const setMode = (nextMode: Mode) =>
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: { ...prev[draftKey],text: prev[draftKey]?.text || "", mode: nextMode },
    }));
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({
    available: false,
    authenticated: false,
  });
  const [models, setModels] = useState<Model[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activities, setActivities] = useState<Record<string, Activity>>({});
  const [approvals, setApprovals] = useState<FlowriumEvent[]>([]);
  const [deletionTarget,setDeletionTarget]=useState<DeleteTarget|null>(null),[trashOpen,setTrashOpen]=useState(false);
  const [itemMenu,setItemMenu]=useState<{x:number;y:number;target:DeleteTarget}|null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProject, setHistoryProject] = useState<Project>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySaving, setHistorySaving] = useState(false);
  const [historyItems, setHistoryItems] = useState<CodexHistoryItem[]>([]);
  const [historySelected, setHistorySelected] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState("");
  const settingsPresence=usePresence(settingsOpen),historyPresence=usePresence(historyOpen),sidebarPresence=usePresence(sidebarOpen,260),dockPresence=usePresence(dockOpen,280);
  const isChatFocused=false;
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [reacting,setReacting]=useState<Record<string,boolean>>({});
  const [snackbar,setSnackbar]=useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    let frame=0,target:HTMLElement|null=null,x=0,y=0;
    const move=(event:PointerEvent)=>{if(event.pointerType==='touch')return;target=(event.target as Element)?.closest<HTMLElement>('.pf-card')||null;if(!target)return;x=event.clientX;y=event.clientY;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!target?.isConnected)return;const box=target.getBoundingClientRect();target.style.setProperty('--surface-x',(x-box.left)+'px');target.style.setProperty('--surface-y',(y-box.top)+'px');});};
    document.addEventListener('pointermove',move,{passive:true});return()=>{document.removeEventListener('pointermove',move);cancelAnimationFrame(frame);};
  },[]);

  useLayoutEffect(()=>{
    const inputElement=composer.current;if(!inputElement||!chatActive)return;
    let frame=0,lastWidth=-1;
    const fit=()=>{inputElement.style.height='auto';inputElement.style.height=Math.min(132,Math.max(48,inputElement.scrollHeight+2))+'px';};
    fit();const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width===lastWidth)return;lastWidth=width;cancelAnimationFrame(frame);frame=requestAnimationFrame(fit);});observer.observe(inputElement);
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[input,chatActive,chatExpanded,sessionId]);
  const messages = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const messageGeometry=useRef<{width:number;height:number;content:number}|undefined>(undefined);
  const messageScrollIntent=useRef(0);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const submittingRef = useRef(false);
  const settingsDialog = useRef<HTMLElement>(null);
  const historyDialog = useRef<HTMLElement>(null);
  const historyRequest = useRef(0);
  const historyImporting = useRef(false);
  const project = data.projects.find((p) => p.id === projectId);
  const session = data.sessions.find((s) => s.id === sessionId);
  const conversationProject=session?[...data.projects,...(data.conversationProjects||[])].find(p=>p.id===session.projectId):project;
  const projectOnlySessions=data.sessions.filter(s=>!s.scope);
  const activeCounts={running:0,waiting:0,decision:approvals.length+visibleProposals(proposals).length};
  for(const item of data.sessions){const state=sessionExecution(item,activities[item.id],approvals,proposals);if(state&&state!=='decision')activeCounts[state]++;}
  const projectCounts=Object.fromEntries(data.projects.map(p=>{const rows=projectOnlySessions.filter(s=>s.projectId===p.id);return[p.id,{
    running:rows.filter(s=>sessionExecution(s,activities[s.id],approvals,proposals)==='running').length,
    waiting:rows.filter(s=>sessionExecution(s,activities[s.id],approvals,proposals)==='waiting').length,
    decision:rows.filter(s=>sessionExecution(s,activities[s.id],approvals,proposals)==='decision').length
  }]}));
  const projectSessions = data.sessions.filter(
    (s) => s.projectId === projectId,
  );
  const activity = sessionId ? activities[sessionId] : undefined;
  const running = Boolean(activity);
  const currentMode = modes.find((m) => m.id === mode)!;
  const sessionApprovals = approvals.filter(
    (a) => !a.sessionId || a.sessionId === sessionId,
  );

  const notify = useCallback((message: string) => setToast(message), []);
  const fail = useCallback((error:unknown)=>setSnackbar(error instanceof Error?error.message:"작업을 처리하지 못했습니다."),[]);
  async function refreshAttention(){if(!api)return;const value=await api.workflowState();setProposals(value.proposals);setAttentionState(value)}
  useEffect(()=>{if(!api)return;let alive=true;const refresh=()=>api.workflowState().then(value=>{if(alive){setProposals(value.proposals);setAttentionState(value)}}).catch(()=>{});void refresh();const timer=setInterval(refresh,5000);window.addEventListener("flowrium-attention-refresh",refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener("flowrium-attention-refresh",refresh)}},[]);
  useEffect(()=>{if(!snackbar)return;const timer=setTimeout(()=>setSnackbar(''),6500);return()=>clearTimeout(timer)},[snackbar]);
  useEffect(() => {
    if (!api) {
      setLoaded(true);
      return;
    }
    let alive = true;
    api
      .bootstrap()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setProjectId(value.projects[0]?.id);
        setLoaded(true);
      })
      .catch((error) => {
        if (alive) {
          fail(error);
          setLoaded(true);
        }
      });
    api
      .connect()
      .then((value) => {
        if (alive) { setConnection(value.status); setModels(value.models); }
      })
      .catch(fail);
    const handleEvent = (event:FlowriumEvent) => {
      if (!alive) return;
      if(["done","approval","input","inputResolved","error"].includes(event.type))window.dispatchEvent(new Event("flowrium-attention-refresh"));
      if (event.type === "session" && event.session) {
        setData((prev) => ({
          ...prev,
          sessions: upsert(prev.sessions, event.session!),
        }));
        if (event.session.messages.at(-1)?.role === "assistant")
          setActivities((prev) => {
            const active = prev[event.session!.id];
            return active
              ? { ...prev, [event.session!.id]: { ...active, text: "" } }
              : prev;
          });
      }
      if (event.type === "delta" && event.sessionId)
        setActivities((prev) =>
          prev[event.sessionId!]
            ? {
                ...prev,
                [event.sessionId!]: {
                  text: prev[event.sessionId!].text + (event.text || ""),
                  status: "답변을 작성하고 있습니다",
                },
              }
            : prev,
        );
      if (event.type === "status" && event.sessionId)
        setActivities((prev) =>
          ({ ...prev, [event.sessionId!]: { ...prev[event.sessionId!], text: prev[event.sessionId!]?.text || "", status: event.text || "작업 중입니다" } }),
        );
      if (event.type === "status" && !event.sessionId) {
        if (event.status === "disconnected") {
          setConnection((prev) => ({
            ...prev,
            authenticated: false,
            error: event.text,
          }));
          setModels([]);
        } else if (
          event.status === "connected" ||
          event.status === "login-required"
        )
          api
            .connectionStatus()
            .then((value) => {
              if (alive) setConnection(value);
            })
            .catch(fail);
        else if (event.status === "login-completed")
          api
            .connect()
            .then((value) => {
              if (alive) {
                setConnection(value.status);
                setModels(value.models);
              }
            })
            .catch(fail);
      }
      if (event.type === "inputResolved") setApprovals(prev=>prev.filter(row=>row.requestId!==event.requestId));
      if (event.type === "approval" || event.type === "input") {
        setApprovals((prev) => [
          ...prev.filter((a) => a.requestId !== event.requestId),
          event,
        ]);
        notify(
          event.type === "input" ? "Codex 질문이 도착했습니다. 작업 대화나 승인함에서 답할 수 있습니다." : "작업 실행에 대한 확인 요청이 도착했습니다. 해당 작업 대화에서 승인할 수 있습니다.",
        );
      }
      if (event.type === "error") {
        if (event.sessionId)
          setActivities((prev) => ({
            ...prev,
            [event.sessionId!]: {
              text: prev[event.sessionId!]?.text || "",
              status: "작업 상태를 확인하고 있습니다",
              error: event.text || "작업 중 오류가 발생했습니다.",
            },
          }));
        else notify(event.text || "연결 중 오류가 발생했습니다.");
      }
      if (event.type === "done" && event.sessionId) {
        setActivities((prev) => {
          const next = { ...prev };
          delete next[event.sessionId!];
          return next;
        });
        setApprovals((prev) =>
          prev.filter((a) => a.sessionId !== event.sessionId),
        );
        setStopping((prev) => {
          const next = { ...prev };
          delete next[event.sessionId!];
          return next;
        });
      }
    };
    const finishedSessions = new Set<string>();
    const changedRequests = new Set<string>();
    let restoring = true;
    const off = api.onEvent(event => {
      if (restoring && event.type === "done" && event.sessionId) finishedSessions.add(event.sessionId);
      if (restoring && event.requestId && ["approval","input","inputResolved"].includes(event.type)) changedRequests.add(event.requestId);
      handleEvent(event);
    });
    api.securityPending().then(events=>{
      if(alive) events.filter(event=>!finishedSessions.has(event.sessionId || "") && !changedRequests.has(event.requestId || "")).forEach(handleEvent);
    }).catch(error=>{if(alive)fail(error);}).finally(()=>{restoring=false;finishedSessions.clear();changedRequests.clear();});
    return () => {
      alive = false;
      off();
    };
  }, [fail, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
  }, [data.settings.theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const el = messages.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [session?.messages, activity?.text, sessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettingsOpen(false);
        setSidebarOpen(false);
        closeCodexHistory();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!settingsOpen && !deletionTarget && !historyOpen)
          composer.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, deletionTarget, historyOpen, historySaving]);
  useEffect(() => {
    const dialog = historyOpen
      ? historyDialog.current
      : settingsOpen
          ? settingsDialog.current
          : null;
    if (!dialog) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
    const focusFirst = () => (focusable()[0] || dialog).focus();
    focusFirst();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target))
        focusFirst();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      previous?.focus();
    };
  }, [settingsOpen, historyOpen,settingsPresence.present,historyPresence.present]);

  useWorkspaceShortcuts({ board:()=>setView("home"), newChat:()=>void newSession(), history:()=>setView("history"), settings:()=>setSettingsOpen(true) });
  function chooseProject() { return chooseProjectFor("home"); }
  async function chooseProjectFor(nextView:"home"|"terminal") {
    if (!api)
      return notify("데스크톱 앱에서 실제 작업 폴더를 연결할 수 있습니다.");
    try {
      const result = await api.chooseProject();
      if (result) {
        const restored = await api.bootstrap();
        setData(restored);
        setDrafts((prev) => {
          const unassigned = prev["project:unassigned"];
          const key = `project:${result.id}`;
          return unassigned?.text && !prev[key]?.text
            ? {
                ...prev,
                [key]: unassigned,
                "project:unassigned": { text: "", mode: "plan" },
              }
            : prev;
        });
        setProjectId(result.id);
        setSessionId(undefined);
        setView(nextView);
        setSidebarOpen(false);
      }
    } catch (error) {
      fail(error);
    }
  }
  function selectProject(value: Project, tab:ProjectTab="home") {
    if(!chatActive)setProjectNavigation({id:value.id,nonce:Date.now()});if(innerWidth>=900)setDockOpen(true);
    setProjectId(value.id);
    setProjectTab(tab);
    setView("overview");
    setSidebarOpen(false);
  }
  function selectSession(value: Session) {
    setSessionId(value.id);
    setDockOpen(true);setChatActive(true);setDockFilter("all");
    stickToBottom.current = true;
    setSidebarOpen(false);
  }
  function rememberSession(value: Session) {
    setData(prev => ({ ...prev, sessions: upsert(prev.sessions, value) }));
  }
  async function openWork(value: Session, nextMode?: Mode, request?: string) {
    rememberSession(value);
    selectSession(value);
    if (!request) return;
    try { await sendWorkRequest(value,request,nextMode); } catch(error) { fail(error); }
  }
  async function sendWorkRequest(value:Session,request:string,nextMode?:Mode,overrides?:{model?:string;effort?:Effort}) {
    rememberSession(value);
    if (!api) return;
    const mode = nextMode || "plan";
    const key = `session:${value.id}`;
    setDrafts(prev => ({ ...prev, [key]: { text: request, mode } }));
    if (!connection.authenticated) {
      throw new Error("ChatGPT 계정 연결 후 AI 업무를 시작하세요.");
    }
    const chosenModel=overrides?.model||value.preferences?.model||data.settings.model;
    const metadata=models.find(row=>row.id===chosenModel);
    const requested=overrides?.effort||value.preferences?.effort||data.settings.effort;
    const supported=effortOptions(metadata);
    const chosenEffort=supported.some(row=>row.reasoningEffort===requested)?requested:metadata?.defaultReasoningEffort||supported[0].reasoningEffort;
    await api.send({ sessionId: value.id, text: request, mode, model:chosenModel, effort:chosenEffort });
    setDrafts(prev => prev[key]?.text === request ? { ...prev, [key]: { text: "", mode } } : prev);
  }
  async function connect() {
    if (!api)
      return notify("실제 Codex 연결은 데스크톱 앱에서 사용할 수 있습니다.");
    setConnecting(true);
    try {
      const result = await api.connect();
      setConnection(result.status);
      setModels(result.models);
      notify(
        result.status.authenticated
          ? "Codex에 연결했습니다."
          : result.status.error ||
              "Codex가 준비됐습니다. ChatGPT 계정으로 로그인해 주세요.",
      );
    } catch (error) {
      setConnection((prev) => ({ ...prev, authenticated: false }));
      fail(error);
    } finally {
      setConnecting(false);
    }
  }
  async function login() {
    if (!api)
      return notify("데스크톱 앱에서 ChatGPT 계정으로 로그인할 수 있습니다.");
    setConnecting(true);
    try {
      await api.login();
      notify("브라우저에서 로그인을 마친 뒤 연결 확인을 눌러 주세요.");
    } catch (error) {
      fail(error);
    } finally {
      setConnecting(false);
    }
  }
  async function startDockConversation(scope:'project'|'integrated'|'general',id?:string){
    if(!api)return notify('데스크톱 앱에서 대화를 시작할 수 있습니다.');
    setCreatingConversation(true);
    try{
      const value=scope==='project'?await api.createSession(id||projectId!):await api.createHubConversation({scope});
      if(scope!=='project')setData(await api.bootstrap());
      rememberSession(value);selectSession(value);setTimeout(()=>composer.current?.focus(),240);
    }catch(error){fail(error)}finally{setCreatingConversation(false)}
  }
  async function newSession(){
    if(session?.scope)return startDockConversation(session.scope);
    if(project)return startDockConversation('project',project.id);
    setDockOpen(true);setChatActive(false);setDockFilter('all');
  }
  function showExecution(state:ExecutionState){setDockOpen(true);setChatActive(false);setDockFilter(state)}
  function openDecisions(){setAttentionOpen(true)}
  function itemContext(event:{preventDefault():void;clientX:number;clientY:number},target:DeleteTarget){event.preventDefault();setItemMenu({x:event.clientX,y:event.clientY,target})}
  async function reloadItems(result?:TrashResult){if(!api)return;const next=await api.bootstrap();setData(next);if(sessionId&&!next.sessions.some(s=>s.id===sessionId)){setSessionId(undefined);setChatActive(false)}if(projectId&&!next.projects.some(p=>p.id===projectId)){setProjectId(next.projects[0]?.id);setView("dashboard")}notify(result?.notice||"항목을 반영했습니다.");await refreshAttention()}
  function useTemplate(prompt: string, nextMode: Mode) {
    const key = `project:${projectId || "unassigned"}`;
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        text: prev[key]?.text ? `${prev[key].text}\n\n${prompt}` : prompt,
        mode: nextMode,
      },
    }));
    setDockOpen(true);setChatActive(true);setDockFilter("all");
    setSessionId(undefined);
    setTimeout(() => composer.current?.focus(), 0);
  }
  async function send(textOverride?:string) {
    const requestText=textOverride??input;
    if ((!requestText.trim() && !attachments.length) || submittingRef.current) return;
    if (!api)
      return notify("데스크톱 앱에서 작업 폴더와 Codex를 연결해 주세요.");
    if (!conversationProject) return notify("먼저 대화할 프로젝트나 대화 범위를 선택해 주세요.");
    submittingRef.current = true;
    setSubmitting(true);
    let activeId = sessionId;
    let restoreKey = draftKey;
    const originKey = draftKey;
    const originalInput = requestText;
    const originalAttachments=attachments;
    const wasRunning=running;
    const text = requestText.trim();
    setDrafts((prev) => ({ ...prev, [originKey]: { text: "", mode } }));
    try {
      if (!activeId) {
        const created = await api.createSession(conversationProject.id);
        activeId = created.id;
        setData((prev) => ({
          ...prev,
          sessions: upsert(prev.sessions, created),
        }));
        if (currentDraftKey.current === originKey) {
          restoreKey = `session:${created.id}`;
          const targetKey = restoreKey;
          voiceContinuity.current.preserve=targetKey;
          setDrafts((prev) => ({
            ...prev,
            [targetKey]: prev[originKey] || { text: "", mode },
            [originKey]: { text: "", mode },
          }));
          setSessionId(created.id);
        }
      }
      if(!wasRunning)setActivities((prev) => ({
        ...prev,
        [activeId!]: { text: "", status: "Codex에 연결하고 있습니다" },
      }));
      stickToBottom.current = true;
      const sent=await api.send({
        sessionId: activeId,
        text,
        attachments:originalAttachments.map(a=>a.id),
        mode,
        model: data.settings.model || undefined,
        effort: data.settings.effort,
      });
      if(sent.queued)notify("추가 지시를 보관했습니다. 현재 작업이 끝나면 차례로 전달합니다.");
    } catch (error) {
      if (activeId&&!wasRunning)
        setActivities((prev) => {
          const next = { ...prev };
          delete next[activeId!];
          return next;
        });
      setDrafts((prev) => ({
        ...prev,
        [restoreKey]: {
          text: prev[restoreKey]?.text
            ? `${originalInput}\n\n${prev[restoreKey].text}`
            : originalInput,
          mode: prev[restoreKey]?.mode || mode,
          attachments:[...originalAttachments,...(prev[restoreKey]?.attachments||[]).filter(a=>!originalAttachments.some(b=>b.id===a.id))],
        },
      }));
      fail(error);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }
  async function handoff() {
    if (!api)
      return notify(
        "데스크톱 앱에서 작업 문맥을 복사해 ChatGPT를 열 수 있습니다.",
      );
    try {
      if (!chatActive || !dockOpen) { await api.openExternal("chatgpt"); return; }
      const context = [
        "# Flowrium 작업 인수인계",
        project ? `프로젝트: ${project.name}` : "",
        "아래 문맥을 바탕으로 다음 작업을 함께 정리해 주세요.",
        session ? `작업: ${session.title}` : "",
        ...(session?.messages || [])
          .slice(-16)
          .map(
            (m) =>
              `${m.role === "user" ? "사용자" : m.role === "assistant" ? "Codex" : "작업 상태"}:\n${m.text}`,
          ),
        input ? `다음 요청:\n${input}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await api.copyText(context);
      if (session) await api.openSessionChatGPT(session.id);
      else await api.openExternal("chatgpt");
      notify("작업 문맥을 복사했습니다. 열린 ChatGPT 대화에 붙여넣어 주세요.");
    } catch (error) {
      fail(error);
    }
  }
  async function saveSettings(patch: Partial<Bootstrap["settings"]>) {
    try {
      const settings = api
        ? await api.saveSettings(patch)
        : { ...data.settings, ...patch };
      setData((prev) => ({ ...prev, settings }));
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }
  async function decide(event: FlowriumEvent, decision: "accept" | "decline") {
    if (!api || !event.requestId || deciding[event.requestId]) return;
    const requestId = event.requestId;
    setDeciding((prev) => ({ ...prev, [requestId]: true }));
    try {
      await api.approval({ requestId, decision });
      setApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
    } catch (error) {
      fail(error);
    } finally {
      setDeciding((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  }
  async function interrupt() {
    if (!api || !sessionId || stopping[sessionId]) return;
    const id = sessionId;
    setStopping((prev) => ({ ...prev, [id]: true }));
    try {
      await api.interrupt(id);
    } catch (error) {
      setStopping((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      fail(error);
    }
  }
  function closeCodexHistory() {
    if (historyImporting.current) return;
    historyRequest.current += 1;
    setHistoryOpen(false);
  }
  async function openCodexHistory() {
    if (!api)
      return notify(
        "Codex 기록 가져오기는 데스크톱 앱에서 사용할 수 있습니다.",
      );
    if (!project)
      return notify("기록을 가져올 프로젝트 폴더를 먼저 선택해 주세요.");
    const selectedProject = project;
    const request = ++historyRequest.current;
    setHistoryProject(selectedProject);
    setHistoryItems([]);
    setHistorySelected([]);
    setHistoryError("");
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      const items = await api.listCodexHistory(selectedProject.id);
      if (historyRequest.current === request) setHistoryItems(items);
    } catch (error) {
      if (historyRequest.current === request)
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Codex 기록을 불러오지 못했습니다.",
        );
    } finally {
      if (historyRequest.current === request) setHistoryLoading(false);
    }
  }
  async function importCodexHistory() {
    if (
      !api ||
      !historyProject ||
      !historySelected.length ||
      historyImporting.current
    )
      return;
    historyImporting.current = true;
    setHistorySaving(true);
    setHistoryError("");
    try {
      const result = await api.importCodexHistory(
        historyProject.id,
        historySelected,
      );
      const restored = await api.bootstrap();
      setData(restored);
      setHistoryOpen(false);
      setHistorySelected([]);
      notify(
        `대화 ${result.imported}개를 프로젝트에 저장했습니다.${result.skipped ? ` 이미 저장된 대화 ${result.skipped}개는 건너뛰었습니다.` : ""}`,
      );
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : "선택한 대화를 저장하지 못했습니다.",
      );
    } finally {
      historyImporting.current = false;
      setHistorySaving(false);
    }
  }
  const filtered = data.sessions.filter((s) =>
    `${s.title} ${data.projects.find((p) => p.id === s.projectId)?.name || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function renderChat(){const project=conversationProject;return (
          <div className="dock-chat-content">
            {isChatFocused&&!settingsOpen&&<UpdatePanel state={update} fail={fail}/>}
            <div className={`workspace-main ${session ? "has-session" : ""}`}>
              {session ? (
                <>
                  <div className="session-heading">
                    <div>
                      <span className="eyebrow">
                        <MessageSquare size={13} />
                        {session.scope==='integrated'?'통합 채팅':session.scope==='general'?'일반 대화':'프로젝트 대화'}
                      </span>
                      <h2 title={session.title}>{session.title}</h2>
                    </div>
                    <div className="session-actions">
                      <button className="icon-button dock-chatgpt-button" aria-label="ChatGPT로 이어가기" title="ChatGPT로 이어가기" onClick={handoff}><ExternalLink size={17}/></button>
                      <ConversationTools onDelete={()=>setDeletionTarget({kind:"session",id:session.id,name:session.title})} key={session.id} session={session} models={models} running={running} onOpen={openWork} onChange={rememberSession} notify={notify} fail={fail} defaults={data.settings.chatDefaults} onDefaults={chatDefaults=>setData(old=>({...old,settings:{...old.settings,chatDefaults}}))} onRewind={draft=>setDrafts(prev=>({...prev,[draftKey]:{text:draft.text,mode,attachments:draft.attachments}}))} />
                      <button
                        className="icon-button"
                        aria-label="대화 내보내기"
                        onClick={async () => {
                          try {
                            if (await api?.exportSession(session.id))
                              notify("작업 대화를 내보냈습니다.");
                          } catch (error) {
                            fail(error);
                          }
                        }}
                      >
                        <Download size={17} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="새 작업"
                        onClick={newSession}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                  <CodexLinkBar key={session.id} session={session} running={running} onChange={rememberSession}/>
                  {session.context&&<div className="chat-context">문맥 {session.context.percent}% ({session.context.used.toLocaleString("ko-KR")} / {session.context.max.toLocaleString("ko-KR")} 토큰) <progress max={100} value={session.context.percent}/>{session.compacting&&<span>문맥 압축 중</span>}</div>}
                  <ChatQueuePanel session={session} onCancel={id=>{void api!.cancelQueuedMessage(session.id,id).catch(fail);}} onResume={()=>{void api!.resumeQueuedMessages(session.id).catch(fail);}}/>
                  {session.workflow && <WorkSessionControls key={session.id} session={session} onSessionChange={rememberSession} running={running} />}
                  <div
                    className="messages"
                    ref={messages}
                    onWheel={()=>{messageScrollIntent.current=Date.now();}}
                    onTouchMove={()=>{messageScrollIntent.current=Date.now();}}
                    onPointerDown={()=>{messageScrollIntent.current=Date.now();}}
                    onScroll={() => {
                      const el = messages.current;
                      if (el) {
                        const old=messageGeometry.current,next={width:el.clientWidth,height:el.clientHeight,content:el.scrollHeight};messageGeometry.current=next;
                        const layoutChanged=old&&(old.width!==next.width||old.height!==next.height||old.content!==next.content);
                        if(layoutChanged&&stickToBottom.current&&Date.now()-messageScrollIntent.current>250){el.scrollTop=el.scrollHeight;return;}
                        stickToBottom.current =
                          el.scrollHeight - el.clientHeight - el.scrollTop < 90;
                      }
                    }}
                  >
                    <MessageHistory key={session.id} messages={session.messages} scrollRef={messages} stickToBottom={stickToBottom} renderMessage={(message) => (
                      <article
                        className={`message ${message.role}`}
                        data-message-id={message.id}
                        key={message.id}
                      >
                        <span className={`message-avatar ${message.role}`}>
                          {message.role === "assistant" ? (
                            <Waves size={17} />
                          ) : message.role === "user" ? (
                            <Command size={16} />
                          ) : (
                            <Circle size={13} />
                          )}
                        </span>
                        <div className="message-body">
                          <div className="message-meta">
                            <strong>
                              {message.role === "assistant"
                                ? "Codex"
                                : message.role === "user"
                                  ? "나"
                                  : "작업 상태"}
                            </strong>
                            <time>
                              {new Date(message.createdAt).toLocaleTimeString(
                                "ko-KR",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </time>
                            <span className="message-meta-actions">
                            {message.role==="assistant" && <SpeakMessageButton text={message.text}/>}
                            {message.role==='assistant'&&<LikeButton active={message.reaction==='like'} disabled={reacting[message.id]||!api} onClick={()=>{
                              setReacting(previous=>({...previous,[message.id]:true}));
                              void api!.reactMessage({sessionId:session.id,messageId:message.id,liked:message.reaction!=='like'}).then(rememberSession).catch(fail).finally(()=>setReacting(previous=>({...previous,[message.id]:false})));
                            }}/>}
                            {message.role !== "system" && (
                              <button
                                className="icon-button copy-message"
                                aria-label="메시지 복사"
                                onClick={async () => {
                                  try {
                                    await api?.copyText(message.text);
                                    notify("메시지를 복사했습니다.");
                                  } catch (error) {
                                    fail(error);
                                  }
                                }}
                              >
                                <Copy size={13} />
                              </button>
                            )}
                            </span>
                          </div>
                          {message.attachments?.length&&project&&<ChatAttachmentList projectId={project.id} items={message.attachments}/>}
                          <div className="markdown">
                            <MessageContent text={message.text} role={message.role}/>
                          </div>
                        </div>
                      </article>
                    )}/>
                    {running && (
                      <article className="message assistant">
                        <span className="message-avatar assistant">
                          <Waves size={17} />
                        </span>
                        <div className="message-body">
                          <div className="message-meta">
                            <strong>Codex</strong>
                            <span className="live-label">
                              <span className="status-dot online" />
                              작업 중
                            </span>
                          </div>
                          {activity?.text ? (
                            <div className="markdown">
                              <MessageContent text={activity.text} role="assistant" streaming/>
                            </div>
                          ) : (
                            <div className="working-indicator">
                              <LoaderCircle size={14} className="spin" />
                              {activity?.status}
                            </div>
                          )}
                        </div>
                      </article>
                    )}
                    {activity?.error && (
                      <div className="inline-error">{activity.error}</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="welcome-content">
                  <h1>새 자유 대화</h1>
                  <p className="welcome-description">
                    프로젝트를 선택하고 Codex에게 요청할 내용을 적으세요.
                  </p>
                  <div className={`project-banner ${project ? "ready" : ""}`}>
                    <div className="banner-icon">
                      <FolderOpen size={23} />
                    </div>
                    <div>
                      <strong>
                        {project ? project.name : "프로젝트 폴더 연결"}
                      </strong>
                      <p>
                        {project
                          ? project.path
                          : "이 컴퓨터에서 작업할 폴더를 선택하세요."}
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={
                        project
                          ? () => api?.openProject(project.id).catch(fail)
                          : chooseProject
                      }
                    >
                      {project ? "폴더 열기" : "폴더 연결"}
                      {project ? (
                        <ExternalLink size={14} />
                      ) : (
                        <Plus size={15} />
                      )}
                    </button>
                  </div>
                  <div className="section-heading workflow-heading">
                    <h2>작업 방식</h2>
                  </div>
                  <div className="workflow-cards">
                    {modes.map((item) => (
                      <button
                        key={item.id}
                        className={`workflow-card ${mode === item.id ? "selected" : ""}`}
                        onClick={() => {
                          setMode(item.id);
                          setInput(item.prompt);
                          composer.current?.focus();
                        }}
                      >
                        <span className={`workflow-icon ${item.id}`}>
                          <item.icon size={19} />
                        </span>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                        <span className="card-arrow">
                          <ArrowRight size={16} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="composer-area">
                {sessionApprovals.map((event) => event.type === "input" ? <InputRequestPanel key={event.requestId} event={event}/> : (
                  <div
                    className="approval-card"
                    key={event.requestId}
                    role="alert"
                  >
                    <div className="approval-title">
                      <ShieldCheck size={17} />
                      <strong>진행하려면 확인이 필요합니다</strong>
                    </div>
                    <p>
                      {event.details ||
                        event.method ||
                        "Codex가 작업 승인을 요청했습니다."}
                    </p>
                    <div>
                      <button
                        className="button secondary"
                        disabled={Boolean(
                          event.requestId && deciding[event.requestId],
                        )}
                        onClick={() => decide(event, "decline")}
                      >
                        거절
                      </button>
                      <button
                        className="button primary"
                        disabled={Boolean(
                          event.requestId && deciding[event.requestId],
                        )}
                        onClick={() => decide(event, "accept")}
                      >
                        이번 작업 승인
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {draftError && <p role="alert" className="composer-draft-error">{draftError} <button onClick={retryDrafts}>초안 다시 불러오기</button></p>}
                <AttachmentComposer key={voiceContinuity.current.generation} projectId={project?.id} items={attachments} onChange={setAttachments} disabled={security.state.locked} report={notify}>{attachmentControl=>(
                <div className={`composer ${running ? "working" : ""}`}>
                  <div className="composer-topline">
                    <span>
                      <span
                        className={`status-dot ${connection.authenticated ? "online" : ""}`}
                      />
                      {running
                        ? activity?.status || "작업을 진행하고 있습니다"
                        : project
                          ? `${project.name} 작업 요청`
                          : "작업 요청"}
                    </span>
                    {input && (
                      <button
                        className="icon-button"
                        aria-label="입력 지우기"
                        onClick={() => setInput("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <textarea
                    ref={composer}
                    aria-label="Codex에 보낼 작업 요청"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      project
                        ? "어떤 작업을 함께 해볼까요?"
                        : "만들고 싶은 것, 풀고 싶은 문제를 적어 주세요."
                    }
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <div className="composer-toolbar">
                    <div className="composer-options">
                      {attachmentControl}
                      <VoiceComposer key={voiceContinuity.current.generation} suspend={settingsOpen||!dockOpen||!chatActive} disabled={running||security.state.locked} onText={text=>setDrafts(prev=>{
                        const draft=prev[draftKey];return {...prev,[draftKey]:{mode:draft?.mode||mode,text:[draft?.text,text].filter(Boolean).join("\n"),attachments:draft?.attachments}};
                      })} onSubmit={text=>void send([input,text].filter(Boolean).join("\n"))}/>
                      {!session?.scope&&<label className="mode-select">
                        <currentMode.icon size={14} />
                        <select
                          aria-label="작업 모드"
                          value={mode}
                          onChange={(e) => setMode(e.target.value as Mode)}
                          disabled={running}
                        >
                          {modes.map((m) => (
                            <option value={m.id} key={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={12} />
                      </label>}
                      <span className="option-divider" />
                      <button
                        className="model-select"
                        onClick={() => setSettingsOpen(true)}
                      >
                        <span className="small-codex-icon">
                          <Terminal size={12} />
                        </span>
                        {session?.preferences?.model || data.settings.model || "Codex 기본 모델"}
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <div className="chat-run-controls">
                    {running&&<button className="button secondary" aria-label="추가 지시 대기열에 넣기" onClick={()=>void send()} disabled={(!input.trim()&&!attachments.length)||submitting}>추가 지시 보내기</button>}
                    {running ? (
                      <button
                        className="send-button stop-button"
                        aria-label="작업 중지"
                        disabled={Boolean(sessionId && stopping[sessionId])}
                        onClick={interrupt}
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        aria-label="작업 보내기"
                        onClick={()=>void send()}
                        disabled={(!input.trim()&&!attachments.length) || submitting || !project}
                      >
                        {submitting ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <ArrowUp size={19} />
                        )}
                      </button>
                    )}</div>
                  </div>
                </div>)}
                </AttachmentComposer>
                <div className="composer-footnote">
                  <span>
                    <ShieldCheck size={12} />
                    {session?.scope ? (session.scope==='general'?'프로젝트 파일에 접근하지 않는 개인 대화입니다':'프로젝트 현황을 확인하고, 업무는 승인 후 실행합니다') : mode === "build"
                      ? "프로젝트 안에서 구현합니다 (필요한 작업은 승인 후 실행)"
                      : "읽기 전용 (프로젝트 파일은 변경하지 않습니다)"}
                  </span>
                  <span>줄바꿈 ⇧ ↵</span>
                </div>
              </div>
              {!session && (
                <div className="recent-section">
                  <div className="section-heading">
                    <h2>최근 작업</h2>
                    <button onClick={() => setView("history")}>
                      모두 보기
                      <ArrowRight size={13} />
                    </button>
                  </div>
                  {projectSessions.length ? (
                    projectSessions.slice(0, 3).map((s) => (
                      <button
                        className="recent-row"
                        key={s.id}
                        onClick={() => selectSession(s)}
                      >
                        <MessageSquare size={15} />
                        <strong>{s.title}</strong>
                        <time>{formatDate(s.updatedAt)}</time>
                        <ChevronRight size={14} />
                      </button>
                    ))
                  ) : (
                    <div className="recent-empty">
                      <Clock3 size={16} />
                      <span>
                        아직 기록된 작업이 없습니다. 첫 대화가 이곳에 남습니다.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
  )}
  return (
    <div className="app-shell" data-chat-focus={isChatFocused}>
      {sidebarPresence.present && (
        <button
          className="sidebar-backdrop" data-phase={sidebarPresence.phase}
          aria-label="메뉴 닫기"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <WorkspaceSidebar current={reportDialog||view} mobileOpen={sidebarOpen} projects={data.projects.filter(p=>!archived[p.id])}
        selected={["overview","home","workspace","terminal"].includes(view)?projectId:undefined}
        onProjectMenu={(event,p)=>itemContext(event,{kind:"project",id:p.id,name:p.name})} counts={projectCounts} account={connection.authenticated?(connection.accountLabel||"ChatGPT 연결됨"):undefined}
        onGo={value=>{if(value==='weekly'||value==='pause')setReportDialog(value);else if(value==='music')setMusicOpen(true);else setView(value);setSidebarOpen(false);}} onProject={selectProject}
        onTrash={()=>{setTrashOpen(true);setSidebarOpen(false);}} onSettings={()=>{setSettingsOpen(true);setSidebarOpen(false);}}
        onLock={()=>{setSidebarOpen(false);if(!security.state.hasPin){setSettingsOpen(true);notify("설정에서 잠금 번호를 정하세요.");return;}void security.lock().catch(fail);}}
        onLogout={()=>{setSidebarOpen(false);setLogoutOpen(true);}}/>
      <main className="main-shell" data-view={view}>
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span>내 작업 공간</span>
            <ChevronRight size={13} />
            <strong>
              {({dashboard:"대시보드",calendar:"일정",kickoff:"새 프로젝트",archive:"완료",outputs:"산출물",timeline:"날짜별 기록",workflow:"업무 연결 / 비서",weekly:"주간업무보고",pause:"업무 마감",music:"뮤직",history:"작업 기록",library:"프롬프트 보관함",activity:"작업 현황",inbox:"승인함",terminal:"터미널"} as Partial<Record<View,string>>)[view] || project?.name || "시작하기"}
            </strong>
            {!api && <span className="preview-badge">화면 미리보기</span>}
          </div>
          <div className="topbar-actions">
            <CommandCenter projects={data.projects} sessions={data.sessions} onProject={selectProject} onSession={selectSession} onView={value=>{if(value==="settings")setSettingsOpen(true);else if(value==="music")setMusicOpen(true);else setView(value as View);}} onNew={()=>{void newSession();}}/>
            <AssistantShortcut projects={data.projects.filter(p=>!archived[p.id])} onOpen={openWork} onCreateProject={()=>setView("kickoff")}/>
            <button className="icon-button header-music" aria-label="뮤직 열기" title="뮤직" onClick={()=>setMusicOpen(true)}><Music2 size={18}/></button>
            <button className="icon-button header-decisions" aria-label={`알림 ${(attentionState?.notifications.filter(n=>!n.readAt).length||0)+activeCounts.decision}건`} title="알림과 검토 요청" onClick={openDecisions}><Bell size={18}/>{((attentionState?.notifications.filter(n=>!n.readAt).length||0)+activeCounts.decision)>0&&<span>{(attentionState?.notifications.filter(n=>!n.readAt).length||0)+activeCounts.decision}</span>}</button>
            <button className="icon-button dock-toggle" aria-label={dockOpen?'대화함 닫기':'대화함 열기'} aria-expanded={dockOpen} onClick={()=>setDockOpen(v=>!v)}><PanelRight size={19}/></button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="사용 안내"
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>

        {!settingsOpen&&!isChatFocused && <UpdatePanel state={update} fail={fail} />}
        {loaded&&view==="dashboard"&&!data.projects.length&&<AccountSetupCard chatConnected={connection.authenticated} onChat={()=>setSettingsOpen(true)} onCalendar={()=>setView("calendar")}/>}
        {!loaded ? (
          <div className="loading-page">
            <LoaderCircle className="spin" />
            작업 공간을 불러오고 있습니다.
          </div>
        ) : view === "calendar" ? <GoogleCalendarWorkspace onOpenSettings={()=>setSettingsOpen(true)}/> : view === "music" ? null : view === "workflow" ? (
          <div className="page-scroll"><div className="page-inner"><WorkflowHub onOpen={openWork} onOpenInbox={()=>setView("inbox")}/></div></div>
        ) : view === "terminal" && !project ? (
          <div className="pf-page"><div className="pf-content"><h1>터미널</h1><section className="pf-welcome"><h2>터미널을 열 폴더를 연결하세요</h2><button onClick={()=>void chooseProjectFor("terminal")}>프로젝트 폴더 선택</button></section></div></div>
        ) : view === "details" && project ? (
          <div className="page-scroll"><div className="page-inner"><ProjectDetails key={project.id} project={project} onChange={value=>setArchived(prev=>({...prev,[value.projectId]:Boolean(value.archivedAt)}))}/></div></div>
        ) : view === "activity" ? (
          <ActivityPanel projects={data.projects} sessions={data.sessions} activities={activities} approvals={approvals} proposals={proposals} onOpen={selectSession} onInterrupt={id=>api!.interrupt(id)}/>
        ) : view === "terminal" && project ? (
          <TerminalPanel key={project.id} projectId={project.id}/>
        ) : view === "team" && project ? (
          <div className="page-scroll"><div className="page-inner"><TeamPanel key={project.id} projectId={project.id} onOpen={openWork}/></div></div>
        ) : view === "repo" && project ? (
          <RepositoryPanel key={project.id} project={project}/>
        ) : view === "inbox" ? (
          <div className="page-scroll"><div className="page-inner inbox-page"><h1>승인함</h1>
          {!approvals.length && <p>확인을 기다리는 요청이 없습니다.</p>}
          {approvals.map(event => {
            const owner=data.sessions.find(s=>s.id===event.sessionId);
            if(event.type==="input") return <InputRequestPanel key={event.requestId} event={event} title={owner?.title} onOpen={owner?()=>selectSession(owner):undefined}/>;
            return <section className="approval-card" key={event.requestId}><h3>{owner?.title || "실행 요청"}</h3>
              <p>{event.details || event.method}</p><div>
              {owner && <button className="button subtle" onClick={()=>selectSession(owner)}>대화 열기</button>}
              <button className="button subtle" disabled={deciding[event.requestId || ""]} onClick={()=>decide(event,"decline")}>거절</button>
              <button className="button primary" disabled={deciding[event.requestId || ""]} onClick={()=>decide(event,"accept")}>이번 작업 승인</button></div></section>;
          })}</div></div>
        ) : (view==="dashboard"||view==="kickoff"||view==="archive"||view==="outputs"||view==="timeline") ? (
          <ProjectPortfolio view={view} projects={data.projects} sessions={projectOnlySessions}
            onNavigate={setView} onProject={selectProject} onOpenSession={openWork} onChooseProject={chooseProject}
            onSessionChange={rememberSession} onArchived={(id,value)=>setArchived(prev=>({...prev,[id]:value}))}
            tools={<div className="pf-dashboard-tools" aria-label="작업 도구">
              <button onClick={()=>setWorkPopup("research")}><Search size={15}/>리서치</button>
              <button onClick={()=>setWorkPopup("briefing")}><BookOpen size={15}/>전체 브리핑</button>
              <button onClick={()=>setWorkPopup("document")}><FileText size={15}/>문서 작성</button>
              <button onClick={()=>setView("activity")}><Clock3 size={15}/>작업 현황</button>
              <button onClick={()=>setView("inbox")}><ShieldCheck size={15}/>승인함{approvals.length>0&&<span>{approvals.length}</span>}</button>
              <button onClick={()=>setView("history")}><History size={15}/>작업 기록</button>
              <button onClick={()=>setView("library")}><BookOpen size={15}/>프롬프트 보관함</button>
              <button onClick={()=>setView("home")}><LayoutDashboard size={15}/>업무 보드</button>
              <button onClick={()=>void newSession()}><Plus size={15}/>새 자유 대화</button>
            </div>}
            onCreated={async p=>{
              try { if(api) setData(await api.bootstrap()); selectProject(p); } catch(error){fail(error);}
            }}/>
        ) : view==="overview" && project ? (
          <ProjectOverview key={project.id} project={project} sessions={projectSessions} tab={projectTab}
            onTabChange={setProjectTab} onOpenSession={openWork} onBack={()=>setView("dashboard")}
            onDetailsChange={d=>setArchived(prev=>({...prev,[d.projectId]:!!d.archivedAt}))}
            renderPanel={tab=>tab==="work"?<Workbench project={project} sessions={projectSessions} onChooseProject={chooseProject} onOpen={openWork} onSessionChange={rememberSession}/>:
              tab==="team"?<TeamPanel projectId={project.id} onOpen={openWork}/>:<RepositoryPanel project={project}/>}/>
        ) : view === "home" ? (
          <Workbench key={projectId || "welcome"} project={project} sessions={projectSessions} onChooseProject={chooseProject} onOpen={openWork} onSessionChange={rememberSession} />
        ) : view === "library" ? (
          <div className="page-scroll">
            <div className="page-inner library-page">
              <div className="eyebrow">
                <BookOpen size={14} />
                작업 도구
              </div>
              <h1>프롬프트 보관함</h1>
              <p className="page-description">
                필요한 요청을 선택한 뒤 프로젝트에 맞게 수정하세요.
              </p>
              <div className="template-grid">
                {templates.map((t, i) => (
                  <button
                    className="template-card"
                    key={t.title}
                    onClick={() => useTemplate(t.prompt, t.mode)}
                  >
                    <span className="template-category">
                      {t.category} (0{i + 1})
                    </span>
                    <h3>{t.title}</h3>
                    <p>{t.description}</p>
                    <span className="template-use">
                      이 프롬프트로 시작 <ArrowUp size={16} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="quiet-note">
                <ShieldCheck size={15} />
                계획과 검토는 읽기 전용으로 진행됩니다. 구현 모드에서 프로젝트
                파일을 변경할 수 있습니다.
              </div>
            </div>
          </div>
        ) : view === "history" ? (
          <div className="page-scroll">
            <div className="page-inner history-page">
              <div className="eyebrow">
                <History size={14} />
                대화
              </div>
              <div className="section-heading">
                <div>
                  <h1>작업 기록</h1>
                  <p className="page-description">
                    프로젝트별 대화를 찾아 다시 열 수 있습니다.
                  </p>
                </div>
                <span className="count-label">총 {data.sessions.length}개</span>
              </div>
              <div className="project-banner" style={{ marginTop: 24 }}>
                <FolderOpen size={20} />
                <div>
                  <strong>
                    {project
                      ? `선택한 프로젝트: ${project.name}`
                      : "프로젝트를 먼저 선택하세요"}
                  </strong>
                  <p>
                    이 프로젝트와 연결된 기존 Codex 대화를 선택해 가져옵니다.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={openCodexHistory}
                  disabled={!project}
                >
                  Codex 기록 가져오기
                  <Download size={14} />
                </button>
              </div>
              <label className="search-field">
                <Search size={17} />
                <input
                  placeholder="작업 이름 또는 프로젝트 검색"
                  aria-label="작업 기록 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="검색 지우기"
                    onClick={() => setSearch("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </label>
              <div className="history-list">
                {filtered.length ? (
                  filtered.map((s) => (
                    <div className="history-row" key={s.id}>
                      <button
                        className="history-open"
                        onClick={() => selectSession(s)}
                      >
                        <span className="history-icon">
                          <MessageSquare size={19} />
                        </span>
                        <span>
                          <strong>{s.title}</strong>
                          <small>
                            {
                              data.projects.find((p) => p.id === s.projectId)
                                ?.name
                            }{" "}
                            {" "}({formatDate(s.updatedAt)}, 대화 {s.messages.length}개)
                          </small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                      <button
                        className="icon-button danger-hover"
                        aria-label={`${s.title} 삭제`}
                        onClick={() => setDeletionTarget({kind:"session",id:s.id,name:s.title})}
                        disabled={Boolean(activities[s.id])}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <History size={30} />
                    <h3>
                      {search
                        ? "일치하는 작업이 없습니다"
                        : "첫 작업을 기다리고 있어요"}
                    </h3>
                    <p>
                      {search
                        ? "다른 검색어로 찾아보세요."
                        : "Codex와 나눈 대화가 이곳에 차곡차곡 남습니다."}
                    </p>
                    <button className="button primary" onClick={newSession}>
                      작업 시작하기
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="page-scroll"><div className="empty-state"><h1>대화를 오른쪽에서 이어가세요</h1><button className="button primary" onClick={()=>setDockOpen(true)}>대화함 열기</button></div></div>
        )}
        <footer className="statusbar"><span><span className={`status-dot ${connection.authenticated?'online':''}`}/>{connection.authenticated?'ChatGPT 연결됨':'ChatGPT 연결 전'}</span><ExecutionSummary counts={activeCounts} onSelect={showExecution}/></footer>
      </main>
      <IconTooltips/>
      <ContextMenu anchor={itemMenu?{x:itemMenu.x,y:itemMenu.y}:null} label="항목 메뉴" onClose={()=>setItemMenu(null)} items={itemMenu?[{id:'open',label:itemMenu.target.kind==='project'?'프로젝트 열기':'대화 열기',onSelect:()=>{const target=itemMenu.target;if(target.kind==='project'){const p=data.projects.find(p=>p.id===target.id);if(p)selectProject(p)}else{const s=data.sessions.find(s=>s.id===target.id);if(s)selectSession(s)}}},{id:'delete',label:itemMenu.target.kind==='project'?'프로젝트 삭제…':'대화 삭제…',danger:true,disabled:itemMenu.target.kind==='session'?Boolean(activities[itemMenu.target.id]):data.sessions.some(s=>s.projectId===itemMenu.target.id&&Boolean(activities[s.id])),onSelect:()=>setDeletionTarget(itemMenu.target)},{id:'trash',label:'휴지통 열기',onSelect:()=>setTrashOpen(true)}]:[]}/>
      <ItemDeleteDialog target={deletionTarget} onClose={()=>setDeletionTarget(null)} onDeleted={reloadItems}/>
      <TrashPanel open={trashOpen} onClose={()=>setTrashOpen(false)} onRestored={reloadItems}/>

      <MotionOverlay open={musicOpen} persist onClose={()=>setMusicOpen(false)} label="뮤직" className="music-popup"><header className="utility-popup-heading"><div><Music2 size={20}/><h2>뮤직</h2></div><button className="icon-button" aria-label="뮤직 닫기" onClick={()=>setMusicOpen(false)}><X size={18}/></button></header><MusicPanel visible={musicPresence.present} locked={security.state.locked}/></MotionOverlay>
      <AttentionCenter open={attentionOpen} onClose={()=>setAttentionOpen(false)} data={attentionState} sessions={data.sessions} requests={approvals} onOpen={selectSession} onDecisions={()=>{setAttentionOpen(false);setView(visibleProposals(proposals).length?'workflow':'inbox')}} onRefresh={refreshAttention}/>
      <ConversationDock dotsContent={<DotsPanel active={dockOpen} blocked={settingsOpen||historyOpen||musicOpen||attentionOpen||Boolean(workPopup)||Boolean(deletionTarget)||trashOpen||Boolean(reportDialog)||sidebarOpen||logoutOpen}/>} projectNavigation={projectNavigation} open={dockOpen} chatActive={chatActive} expanded={chatExpanded} onExpand={()=>setChatExpanded(v=>!v)} onMenu={()=>setSidebarOpen(true)} onSettings={()=>setSettingsOpen(true)} onClose={()=>setDockOpen(false)} onLeaveChat={()=>setChatActive(false)} projects={data.projects} sessions={data.sessions} projectId={projectId} sessionId={sessionId} activities={activities} requests={approvals} proposals={proposals} counts={activeCounts} filter={dockFilter} onFilter={setDockFilter} onOpen={selectSession} onProject={()=>{}} onCreate={(scope,id)=>void startDockConversation(scope,id)} onCreateProject={()=>setView('kickoff')} onSessionMenu={(event,s)=>itemContext(event,{kind:"session",id:s.id,name:s.title})} onProjectMenu={(event,p)=>itemContext(event,{kind:"project",id:p.id,name:p.name})} attentionCount={attentionState?.notifications.filter(n=>!n.readAt).length||0} onDecisions={openDecisions} busy={creatingConversation}>{renderChat()}</ConversationDock>
      <WorkActionPopup kind={workPopup} projects={data.projects.filter(p=>!archived[p.id])} initialProject={view==="overview"?projectId:undefined} onClose={()=>setWorkPopup(null)} onStart={async(record,text,options)=>{await sendWorkRequest(record,text,record.workflow?.kind?workKinds[record.workflow.kind].mode:"plan",options)}} onOpen={selectSession}/>
      <MotionOverlay open={Boolean(reportDialog)} onClose={()=>setReportDialog(undefined)} label={reportDialog==='pause'?'업무 마감':'주간업무보고'} className="report-overlay">
        {reportDialog&&<PortfolioReports key={reportDialog} kind={reportDialog} projects={data.projects.filter(p=>!archived[p.id])} sessions={projectOnlySessions} authenticated={connection.authenticated}
          onClose={()=>setReportDialog(undefined)} onStart={(record,request,options)=>sendWorkRequest(record,request,workKinds[record.workflow!.kind].mode,options)} onOpen={record=>{setReportDialog(undefined);selectSession(record);}} onCreateProject={()=>{setReportDialog(undefined);setView('kickoff');}}/>}
      </MotionOverlay>
      <MotionOverlay open={logoutOpen} onClose={()=>setLogoutOpen(false)} label="계정 로그아웃" className="logout-overlay"><div className="pf-logout-content">
        <h2>로그아웃할까요?</h2><p>이 기기의 Codex에서 ChatGPT 계정을 로그아웃합니다. 같은 로그인 정보를 쓰는 Codex 앱과 명령줄에서도 다시 로그인해야 할 수 있습니다. 저장한 프로젝트와 대화는 보존됩니다.</p>
        <div className="pf-actions"><button autoFocus onClick={()=>setLogoutOpen(false)}>취소</button><button onClick={()=>{setLogoutOpen(false);void security.logout().catch(fail);}}>로그아웃 확인</button></div>
      </div></MotionOverlay>
      <Toast message={toast} onClose={()=>setToast('')}/>
      <Snackbar message={snackbar} tone="error" onClose={()=>setSnackbar('')}/>
      {historyPresence.present && (
        <ModalPortal><div
          className="modal-backdrop motion-overlay" data-phase={historyPresence.phase}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeCodexHistory();
          }}
        >
          <section
            ref={historyDialog}
            tabIndex={-1}
            className="settings-modal" data-motion="popup" data-phase={historyPresence.phase} inert={historyPresence.phase==='exit'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="codex-history-title"
            aria-describedby="codex-history-description"
            aria-busy={historyLoading || historySaving}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">
                  선택한 프로젝트: {historyProject?.name}
                </span>
                <h2 id="codex-history-title">Codex 기록 가져오기</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Codex 기록 가져오기 닫기"
                onClick={closeCodexHistory}
                disabled={historySaving}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <p className="page-description" id="codex-history-description">
                이 컴퓨터의 선택한 프로젝트와 연결된 대화를 버튼을 누를 때만
                조회합니다. 공식 Codex가 제공하는 사용자 요청과 답변 본문을
                프로젝트의 .flowrium 폴더에 복사합니다.
              </p>
              <div className="path-note">
                프로젝트 폴더: {historyProject?.path}
              </div>
              {historyError && (
                <p
                  className="inline-error"
                  role="alert"
                  style={{ marginTop: 16 }}
                >
                  {historyError}
                </p>
              )}
              {historyLoading ? (
                <div
                  className="working-indicator"
                  role="status"
                  style={{ marginTop: 22 }}
                >
                  <LoaderCircle size={16} className="spin" />
                  Codex 기록을 불러오고 있습니다.
                </div>
              ) : (
                <>
                  <div className="settings-buttons" style={{ marginTop: 22 }}>
                    <button
                      className="button secondary"
                      disabled={
                        historySaving ||
                        !historyItems.some((item) => !item.imported)
                      }
                      onClick={() =>
                        setHistorySelected(
                          historyItems
                            .filter((item) => !item.imported)
                            .map((item) => item.id),
                        )
                      }
                    >
                      전체 선택
                    </button>
                    <button
                      className="button secondary"
                      disabled={historySaving || !historySelected.length}
                      onClick={() => setHistorySelected([])}
                    >
                      선택 해제
                    </button>
                    <button
                      className="button subtle"
                      disabled={historySaving}
                      onClick={openCodexHistory}
                    >
                      다시 불러오기
                    </button>
                  </div>
                  {historyItems.length ? (
                    <div className="history-list">
                      {historyItems.map((item) => (
                        <label className="history-open" key={item.id}>
                          <AnimatedCheckbox
                            checked={
                              item.imported || historySelected.includes(item.id)
                            }
                            disabled={item.imported || historySaving}
                            onChange={(e) =>
                              setHistorySelected((prev) =>
                                e.target.checked
                                  ? [...prev, item.id]
                                  : prev.filter((id) => id !== item.id),
                              )
                            }
                            aria-label={`${item.title} 선택`}
                          />
                          <span>
                            <strong
                              style={{
                                whiteSpace: "normal",
                                wordBreak: "keep-all",
                              }}
                            >
                              {item.title}
                            </strong>
                            <small>
                              {Number.isNaN(new Date(item.updatedAt).getTime())
                                ? "날짜 정보 없음"
                                : formatDate(item.updatedAt)}
                              {item.imported ? " (이미 가져옴)" : ""}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    !historyError && (
                      <div className="empty-state">
                        <History size={25} />
                        <h3>가져올 Codex 기록이 없습니다</h3>
                        <p>
                          선택한 프로젝트 폴더와 연결된 대화를 찾지 못했습니다.
                        </p>
                      </div>
                    )
                  )}
                </>
              )}
              {historySaving && (
                <div className="working-indicator" role="status">
                  <LoaderCircle size={16} className="spin" />
                  선택한 대화 내용을 저장하고 있습니다.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <span>선택한 대화 {historySelected.length}개</span>
              <div className="settings-buttons">
                <button
                  className="button secondary"
                  onClick={closeCodexHistory}
                  disabled={historySaving}
                >
                  취소
                </button>
                <button
                  className="button primary"
                  onClick={importCodexHistory}
                  disabled={
                    historyLoading || historySaving || !historySelected.length
                  }
                >
                  {historySaving && <LoaderCircle size={14} className="spin" />}
                  선택 대화 저장
                  <Check size={14} />
                </button>
              </div>
            </div>
          </section>
        </div></ModalPortal>
      )}
      {settingsPresence.present && (
        <ModalPortal><div
          className="modal-backdrop motion-overlay" data-phase={settingsPresence.phase}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            ref={settingsDialog}
            tabIndex={-1}
            className="settings-modal" data-motion="popup" data-phase={settingsPresence.phase} inert={settingsPresence.phase==='exit'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Flowrium</span>
                <h2 id="settings-title">설정</h2>
              </div>
              <button
                className="icon-button"
                aria-label="설정 닫기"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <SettingsLayout>
              <SettingsGroup id="general"><UpdatePanel settings state={update} fail={fail}/></SettingsGroup>
              <SettingsGroup id="security"><SecurityPanel security={security}/></SettingsGroup>
              <SettingsGroup id="transfer"><CodexTransferPanel onChanged={async()=>{if(!api)return;const next=await api.bootstrap();setData(next);if(!projectId&&next.projects[0])setProjectId(next.projects[0].id);}} onOpen={id=>{void (async()=>{const next=await api!.bootstrap();setData(next);const found=next.sessions.find(row=>row.id===id);if(found){setSettingsOpen(false);selectSession(found);}})().catch(fail);}}/><MigrationPanel/></SettingsGroup>
              <SettingsGroup id="integrations"><IntegrationPanel projectId={projectId}/></SettingsGroup>
              <SettingsGroup id="remote"><RemotePanel/></SettingsGroup>
              <SettingsGroup id="voice"><VoiceSettings/></SettingsGroup>
              <SettingsGroup id="account"><div className="settings-section">
                <h3>
                  <Terminal size={17} />
                  Codex 연결
                </h3>
                <p>
                  Codex의 공식 연결 방식으로 기존 ChatGPT 로그인을 활용합니다.
                </p>
                <div className="connection-state">
                  <span
                    className={`status-dot ${connection.authenticated ? "online" : ""}`}
                  />
                  <span>
                    {connection.authenticated
                      ? connection.accountLabel || "ChatGPT 계정 연결됨"
                      : connection.available
                        ? "로그인이 필요합니다"
                        : "연결 확인 전"}
                  </span>
                  {connecting && <LoaderCircle size={15} className="spin" />}
                </div>
                {connection.error && (
                  <p className="settings-error">{connection.error}</p>
                )}
                <div className="settings-buttons">
                  <button
                    className="button secondary"
                    onClick={connect}
                    disabled={connecting}
                  >
                    {connecting ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Terminal size={14} />
                    )}
                    연결 확인
                  </button>
                  <button
                    className="button primary"
                    onClick={login}
                    disabled={connecting}
                  >
                    ChatGPT 계정으로 로그인
                    <ExternalLink size={13} />
                  </button>
                </div>
                <label className="field-label">
                  Codex 실행 파일 경로<span>선택 사항 (비우면 자동 검색)</span>
                  <input
                    className="text-input"
                    placeholder="자동 검색 (앱에 포함된 Codex 사용)"
                    defaultValue={data.settings.codexPath || ""}
                    onBlur={async (e) => {
                      const value = e.target.value;
                      if (
                        value !== (data.settings.codexPath || "") &&
                        (await saveSettings({ codexPath: value }))
                      ) {
                        setConnection({
                          available: false,
                          authenticated: false,
                        });
                        setModels([]);
                      }
                    }}
                  />
                </label>
                {connection.cliPath && (
                  <div className="path-note">
                    현재 경로: {connection.cliPath}
                  </div>
                )}
              </div>
              <div className="settings-section">
                <h3>
                  <Sparkles size={17} />
                  작업 기본값
                </h3>
                <label className="field-label">
                  모델
                  <select
                    className="text-input"
                    aria-label="기본 모델"
                    value={data.settings.model || ""}
                    onChange={(e) => saveSettings({ model: e.target.value })}
                  >
                    <option value="">Codex 기본 모델</option>
                    {data.settings.model &&
                      !models.some((m) => m.id === data.settings.model) && (
                        <option value={data.settings.model}>
                          {data.settings.model}
                        </option>
                      )}
                    {models.map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.displayName || m.id}
                      </option>
                    ))}
                  </select>
                </label>
                {!models.length && (
                  <p className="field-hint">
                    연결을 확인하면 계정에서 사용 가능한 모델을 불러옵니다.
                  </p>
                )}
                <label className="field-label">
                  생각의 깊이
                  <select
                    className="text-input"
                    value={data.settings.effort}
                    onChange={(e) =>
                      saveSettings({ effort: e.target.value as Effort })
                    }
                  >
                    {effortOptions(models.find(row=>row.id===data.settings.model)).map(row=><option key={row.reasoningEffort} value={row.reasoningEffort}>{effortLabels[row.reasoningEffort]}</option>)}
                  </select>
                </label>
              </div>
              </SettingsGroup><SettingsGroup id="appearance"><div className="settings-section appearance">
                <div>
                  <h3>화면 테마</h3>
                  <p>편안하게 집중할 수 있는 모습으로</p>
                </div>
                <div className="segmented">
                  <button
                    className={data.settings.theme === "dark" ? "selected" : ""}
                    onClick={() => saveSettings({ theme: "dark" })}
                  >
                    어둡게
                  </button>
                  <button
                    className={
                      data.settings.theme === "light" ? "selected" : ""
                    }
                    onClick={() => saveSettings({ theme: "light" })}
                  >
                    밝게
                  </button>
                </div>
              </div>
              <div className="settings-note">
                <ShieldCheck size={17} />
                <p>
                  대화와 자료는 이 기기와 선택한 프로젝트에 보관합니다.
                  공개 설치 파일과 소스 묶음에는 개인 대화나 로그인 자료를 포함하지 않습니다.
                </p>
              </div>
              <button
                className="text-link"
                onClick={() => api?.openExternal("codex-docs").catch(fail)}
              >
                공식 Codex 연결 문서
                <ExternalLink size={13} />
              </button></SettingsGroup>
            </SettingsLayout>
            <div className="modal-footer">
              <span>Flowrium</span><span>{data.version}</span>
              <button
                className="button secondary"
                onClick={() => setSettingsOpen(false)}
              >
                완료
                <Check size={14} />
              </button>
            </div>
          </section>
        </div></ModalPortal>
      )}

    </div>
  );
}
