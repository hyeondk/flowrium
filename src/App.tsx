import {projectCategory} from "../shared/project-details";
import LoadingProgress from './LoadingProgress';
import {withLiveTurn} from '../electron/mobile/live-turn.js';
import {RequestSource} from './RequestSource';
import {maxChatInput, nativeQueueNotice} from '../electron/mobile/chat-input.js';
import {projectMode} from '../electron/mobile/project-mode.js';
import {useModelCatalog} from './useModelCatalog';
import codexAvatar from "../electron/mobile/chatgpt.svg?no-inline";
import WorkflowHub from "./WorkflowHub";
import CommandCenter, {openCommandCenter} from "./CommandCenter";
import {isImeKey} from "./ime";
import {AttachmentComposer,ChatAttachmentList,ChatQueuePanel} from "./ChatAttachments";
import InputRequestPanel from "./InputRequestPanel";
import DecisionRequestPanel from './DecisionRequestPanel';
import ChatContinuation from './ChatContinuation';
import { useWorkspaceDrafts } from "./useWorkspaceDrafts";
import {useProjectOrder,projectOrderChanged} from "./ProjectOrder";
import type {ProjectNavigationState} from "../shared/portfolio";
import WorkspaceSidebar from "./WorkspaceSidebar";
import {useAccountUsage} from "./account-usage";
import ConversationDock from "./ConversationDock";
import ProjectCategoryLabel from "./ProjectCategoryLabel";
import {ExecutionSummary} from "./ExecutionStatus";
import {QUESTION_DECISION_NOTICE,sessionExecution,visibleProposals,type ExecutionActivity,type ExecutionState} from "../shared/execution-state";
import type {WorkCloseResume,WorkflowNotification,WorkflowProposal,WorkflowState} from "../shared/workflow";
import {usePresence,MotionOverlay,ModalPortal,Toast,AnimatedCheckbox,AnimatedSwitch,LikeButton,CloseButton} from "./ui-motion";
import PortfolioReports from "./PortfolioReports";
import WorkActionPopup,{type PopupWorkKind} from "./WorkActionPopup";
import MusicPanel from "./MusicPanel";
import IntegrationPanel from "./IntegrationPanel";
import RemotePanel from "./RemotePanel";
import { VoiceSettings, VoiceComposer, SpeakMessageButton } from "./VoiceTools";
import {effortOptions,effortLabels,effectiveEffort} from "../shared/model-options";
import {modelDisplayName} from '../shared/model-display';
import { ProjectCategorySettings } from "./ProjectCategorySettings";
import SettingsLayout,{SettingsGroup} from "./SettingsLayout";
import CodexTransferPanel,{CodexLinkBar} from "./CodexTransferPanel";
import MessageHistory from "./MessageHistory";
import MessageContent from "./MessageContent";
import {ChatMessageTime, TypingMessageContent, findLatestMessage} from "./ChatMessageMedia";
import {AnswerProgress, LiveWorkTimeline, WorkToolDetails, latestWorkProgress, workAnswerCompleted} from "./TurnProgress";
import {presentCitations} from "../electron/mobile/file-citations.js";
import {attachmentDisplayText} from "../electron/mobile/attachment-text.js";
import IconTooltips from "./IconTooltips";
import DotsPanel from "./DotsPanel";
import AttentionCenter,{answerNoticeTitle,FlowNotice,noticePreview} from "./AttentionCenter";
import AccountSetupCard from "./AccountSetupCard";
import type {TrashResult} from "../shared/trash";
import ContextMenu from "./ContextMenu";
import {ItemDeleteDialog,TrashPanel,type DeleteTarget} from "./ItemDeletion";
import MigrationPanel from "./MigrationPanel";
import { useSecurity, SecurityPanel, LockScreen } from "./SecurityPanel";
import { ProjectPortfolio } from "./ProjectPortfolio";
import { ProjectOverview } from "./ProjectOverview";
import DashboardBack from "./DashboardBack";
import PersonalDictionary from './PersonalDictionary';
import type { PortfolioView, ProjectTab } from "../shared/portfolio";
import TerminalPanel from "./TerminalPanel";
import ProjectDetails from "./ProjectDetails";
import { ActivityPanel, useWorkspaceShortcuts } from "./ActivityPanel";
import TeamPanel from "./TeamPanel";
import RepositoryPanel from "./RepositoryPanel";
import { ConversationTools } from "./ConversationTools";
import ChatModelPicker,{AccountSpeedPreference,type ChatModelSelection} from './ChatModelPicker';
import Workbench, { WorkSessionControls } from "./Workbench";
import { UpdatePanel, useDesktopUpdate } from "./UpdatePanel";
import { workKinds } from "../shared/workbench";
import packageInfo from "../package.json";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  LogOut,
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
  UserRound,
  X,
} from "lucide-react";
import type {
  Bootstrap,
  ConnectionStatus,
  Effort,
  FlowriumEvent,
  Message,
  Mode,
  Model,
  Project,
  Session,
  ChatAttachment,
  ChatPreferences,
} from "../shared/types";

type View = "workflow" | PortfolioView | "weekly" | "pause" | "music" | "overview" | "terminal" | "details" | "activity" | "team" | "repo" | "inbox" | "home" | "workspace" | "history" | "library" | 'dictionary';
type CodexHistoryItem = {
  id: string;
  title: string;
  updatedAt: string;
  imported: boolean;
};
const api = window.flowrium;

function previewChatModel(preferences?:ChatPreferences,selection?:ChatModelSelection):ChatPreferences|undefined {
  if(!selection)return preferences;
  return {...preferences,
    ...(selection.model!==undefined&&{model:selection.model||undefined}),
    ...(selection.effort!==undefined&&{effort:selection.effort||undefined}),
    ...(selection.speed!==undefined&&{speed:selection.speed||undefined})};
}
const initial: Bootstrap = {
  projects: [],
  sessions: [],
  settings: { effort: "medium", theme: "light", accentColor:"blue" },
  version: packageInfo.flowriumVersion || packageInfo.version,
  platform: "preview",
};
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
    prompt: "현재 프로젝트의 변경 사항을 검토해줘. 실제 오류 가능성과 회귀 위험을 중심으로 근거와 파일 위치를 알려줘. 파일은 수정하지 마.",
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
  const lockLayer=useRef<HTMLDivElement>(null);
  const lockPresence=usePresence(security.state.loaded&&security.state.locked,460,lockLayer);
  if (!security.state.loaded && security.error) return <main className="loading-page"><p role="alert">{security.error}</p><button onClick={()=>void security.refresh().catch(()=>{})}>연결 다시 확인</button></main>;
  if (!security.state.loaded) return <main className="loading-page"><LoadingProgress startup label="작업 공간을 준비하고 있습니다." /></main>;
  return <div className="security-stage">
    {!security.state.locked&&<div className="unlocked-stage"><UnlockedWorkspace key={security.state.accountRevision} security={security}/></div>}
    {lockPresence.present&&<div ref={lockLayer} className="security-lock-layer" data-phase={lockPresence.phase} inert={!security.state.locked} aria-hidden={!security.state.locked}><LockScreen security={security} releasing={!security.state.locked}/></div>}
  </div>;
}
function externalActivity(state:'running'|'pending'):ExecutionActivity {
  return state==='running'
    ? {source:'external',text:'',status:'Codex 앱에서 작업하고 있습니다.'}
    : {unsettled:true,text:'',status:'Codex 앱의 작업 상태를 확인하고 있습니다.'};
}

const contextPercentFormat = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:1});
function ChatContextMeter({context}:{context:Session['context']}) {
  const known = context && Number.isFinite(context.used) && context.used>=0 && Number.isFinite(context.max) && context.max>0;
  const percent = known ? context.used/context.max*100 : undefined;
  const fill = percent===undefined ? undefined : Math.min(100,percent);
  const detail = known
    ? `${context.used.toLocaleString('ko-KR')} / ${context.max.toLocaleString('ko-KR')} 토큰`
    : '컨텍스트 사용량을 아직 확인하지 못했습니다.';
  const usage = percent===undefined ? undefined : `${contextPercentFormat.format(percent)}% 사용`;
  return <span className="chat-token-summary" tabIndex={0} data-available={Boolean(known)}
    data-visual-tooltip={usage?`컨텍스트 길이\n${usage}\n${detail}`:detail} role={known?'meter':'img'}
    aria-label={known?'컨텍스트 길이':detail} aria-valuemin={known?0:undefined} aria-valuemax={known?100:undefined}
    aria-valuenow={fill} aria-valuetext={usage?`${usage} / ${detail}`:undefined}>
    <span className="chat-token-track" aria-hidden="true">
      {fill!==undefined&&<span className="chat-token-fill" style={{width:`${fill}%`}}/>}
    </span>
  </span>;
}

function UnlockedWorkspace({security}:{security:ReturnType<typeof useSecurity>}) {
  const [logoutOpen,setLogoutOpen] = useState(false);
  const update = useDesktopUpdate();
  const [categoryTarget,setCategoryTarget] = useState<string>();
  const [categoryRevision,setCategoryRevision] = useState(0);
  const [categories,setCategories]=useState<Record<string,string>>({});
  const [archived, setArchived] = useState<Record<string,boolean>>({});
  const [data, setData] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [projectId, setProjectId] = useState<string>();
  useEffect(() => {
    let active = true;
    for (const project of data.projects) {
      api?.readProjectDetails(project.id).then(value => {
        if (active) {setArchived(prev=>({...prev,[project.id]:Boolean(value.archivedAt)}));setCategories(prev=>({...prev,[project.id]:projectCategory(value)||""}));}
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
  const [resumeNotice,setResumeNotice]=useState<Pick<WorkCloseResume,'id'|'reason'|'notificationId'>>();
  const [revealResume,setRevealResume]=useState(false);
  const waitingForResume=useRef(false);
  const resumeRevealed=useCallback(()=>setRevealResume(false),[]);
  function showWorkResume(){setAttentionOpen(false);setReportDialog(undefined);setView('dashboard');setRevealResume(true)}
  const musicPresence=usePresence(musicOpen);
  const [chatActive,setChatActive]=useState(false);
  const [creatingConversation,setCreatingConversation]=useState(false);
  const [dockFilter,setDockFilter]=useState<ExecutionState|'all'>('all');
  const [proposals,setProposals]=useState<WorkflowProposal[]>([]);
  const [projectNavigation,setProjectNavigation]=useState<{id:string;nonce:number}>();
  const [assistantNavigation,setAssistantNavigation]=useState<number>();
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
  const draftSession = data.sessions.find(s => s.id === sessionId);
  const workflow = draftSession?.workflow;
  const mode = projectMode(draftSession, workflow ? workKinds[workflow.kind].mode : undefined);
  const setInput = (text: string) =>
    setDrafts((prev) => ({
      ...prev,
      [draftKey]: { ...prev[draftKey],text, mode: prev[draftKey]?.mode || mode },
    }));
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNavigation,setSettingsNavigation]=useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({
    available: false,
    authenticated: false,
  });
  const [models, setModels] = useState<Model[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chatWebFallback,setChatWebFallback]=useState<{key:string;message:string;canLogin:boolean;showInstall:boolean}>();
  const [desktopChatInstalled,setDesktopChatInstalled]=useState<boolean|null>(null);
  const webInstallNotice=useRef(false);
  const modelSaves = useRef(new Map<string,{next?:ChatModelSelection}>());
  const [modelPreviews,setModelPreviews]=useState(()=>new Map<string,ChatModelSelection>());
  const modelPreview=modelPreviews.get(draftKey);
  const [activities, setActivities] = useState<Record<string, ExecutionActivity>>({});
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
  const decisionFlights=useRef(new Set<string>());
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [toast,setToast]=useState<{message:string;tone:'info'|'error';revision:number}>({message:'',tone:'info',revision:0});
  const [dismissedRequests, setDismissedRequests] = useState<string[]>([]);
  const visibleRequests = approvals.filter(event => event.requestId && !dismissedRequests.includes(event.requestId));
  const questionNotice = visibleRequests.filter(event => event.type === 'input').at(-1) || visibleRequests.at(-1);
  function dismissQuestion(event: FlowriumEvent) {
    if (event.requestId) setDismissedRequests(previous => [...previous, event.requestId!]);
  }
  useEffect(() => {
    setDismissedRequests(previous => {
      const retained = previous.filter(id => approvals.some(event => event.requestId === id));
      return retained.length === previous.length ? previous : retained;
    });
  }, [approvals]);
  const [completionNotice, setCompletionNotice] = useState<WorkflowNotification>();
  const noticeIds = useRef<Set<string> | undefined>(undefined);
  const [focusQuestion, setFocusQuestion] = useState<string>();
  const [reacting,setReacting]=useState<Record<string,boolean>>({});
  const composer = useRef<HTMLTextAreaElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const messageGeometry=useRef<{width:number;height:number;content:number}|undefined>(undefined);
  const messageScrollIntent=useRef(0);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const submittingRef = useRef(false);
  const settingsDialog = useRef<HTMLElement>(null);
  const settingsRequests = useRef<Partial<Record<keyof Bootstrap["settings"], number>>>({});
  const nextSettingsRequest = useRef(0);
  const settingsSaveQueue = useRef(Promise.resolve());
  const persistedSettings = useRef<Partial<Bootstrap["settings"]>>({});
  const voiceSettingsSaveQueue = useRef(Promise.resolve());
  const historyDialog = useRef<HTMLElement>(null);
  const historyRequest = useRef(0);
  const historyImporting = useRef(false);
  const project = data.projects.find((p) => p.id === projectId);
  const session = data.sessions.find((s) => s.id === sessionId);
  const [outgoing,setOutgoing]=useState<{sessionId:string;message:Message}>();
  const [workToolsSession,setWorkToolsSession]=useState<string>();
  const workProgress=useMemo(()=>session?.messages && latestWorkProgress(session.messages),[session?.messages]);
  const answerCompleted=useMemo(()=>Boolean(session?.messages && workAnswerCompleted(session.messages,workProgress)),[session?.messages,workProgress]);
  const conversationProject=session?[...data.projects,...(data.conversationProjects||[])].find(p=>p.id===session.projectId):project;
  const projectOnlySessions=data.sessions.filter(s=>!s.scope);
  const activeCounts={running:0,waiting:0,decision:0};
  const dashboardDecisions=new Set<string>();
  const projectCounts:Record<string,{running:number;waiting:number;decision:number;total:number}>={};
  for(const item of data.sessions){
    const state=sessionExecution(item,activities[item.id],approvals,proposals);
    if(state) activeCounts[state]++;
    if(state==='decision')dashboardDecisions.add(item.id);
    if(item.scope) continue;
    const counts=projectCounts[item.projectId]??={running:0,waiting:0,decision:0,total:0};
    counts.total++;
    if(state) counts[state]++;
  }
  const projectSessions = data.sessions.filter(
    (s) => s.projectId === projectId,
  );
  const activity = sessionId ? activities[sessionId] : undefined;
  const workActive = Boolean(activity?.source);
  const running = activity?.source === 'local';
  const pendingMessage=outgoing?.sessionId===session?.id?outgoing?.message:undefined;
  const pendingRecorded=Boolean(pendingMessage&&session?.messages.some(message=>message.id===pendingMessage.id));
  const streamingMessage=activity?.streamingMessage;
  const typingId=answerCompleted?undefined:running?streamingMessage?.id:activity?.source==='external'&&workProgress?.turnId
    ? findLatestMessage(session?.messages,message=>message.role==='assistant'&&message.turnId===workProgress.turnId)?.id : undefined;
  const displayMessages=useMemo(()=>{
    let visible=session?.messages||[];
    if(running&&streamingMessage&&activity?.text){
      const saved=visible.find(message=>message.id===streamingMessage.id);
      if(!saved)visible=[...visible,{...streamingMessage,role:'assistant',text:activity.text}];
      else if(saved.text!==activity.text)visible=visible.map(message=>message===saved?{...message,text:activity.text}:message);
    }
    return pendingMessage&&!pendingRecorded?[...visible,pendingMessage]:visible;
  },[session?.messages,pendingMessage,pendingRecorded,running,streamingMessage,activity?.text]);
  const streamedLength=typingId?findLatestMessage(displayMessages,message=>message.id===typingId)?.text.length??0:undefined;
  useEffect(()=>{
    if(!pendingRecorded||!pendingMessage)return;
    const timer=window.setTimeout(()=>setOutgoing(current=>current?.message.id===pendingMessage.id?undefined:current),360);
    return ()=>window.clearTimeout(timer);
  },[pendingRecorded,pendingMessage]);
  const sessionApprovals = approvals.filter(
    (a) => !a.sessionId || a.sessionId === sessionId,
  );
  useEffect(() => {
    if (!focusQuestion || !dockOpen || !chatActive) return;
    const frame = requestAnimationFrame(() => {
      const section = Array.from(messages.current?.querySelectorAll<HTMLElement>("[data-question-request]") || [])
        .find(node => node.dataset.questionRequest === focusQuestion);
      if (section) {
        section.scrollIntoView({block: "nearest"});
        section.focus({preventScroll: true});
        setFocusQuestion(undefined);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusQuestion, dockOpen, chatActive, sessionId, approvals]);

  useEffect(() => {
    if (!api || !dockOpen || !chatActive || security.state.locked) return;
    let latestCheck = 0;
    const refreshInstallation = () => {
      const check = ++latestCheck;
      void api.readDesktopChatInstallation().then(installed => {
        if (check === latestCheck) setDesktopChatInstalled(installed);
      }).catch(() => {});
    };
    refreshInstallation();
    window.addEventListener('focus',refreshInstallation);
    return () => {
      latestCheck++;
      window.removeEventListener('focus',refreshInstallation);
    };
  },[dockOpen,chatActive,security.state.locked]);

  const notify = useCallback((message: string) => setToast(old=>({message,tone:'info',revision:old.revision+1})), []);
  const accountLinked=connection.authenticated && security.state.accountLinked === true;
  const accountUsage=useAccountUsage(accountLinked);
  const modelCatalog=useModelCatalog(api,connection.authenticated&&!security.state.locked,setModels,notify);
  const fail = useCallback((error:unknown)=>setToast(old=>({message:error instanceof Error?error.message:"작업을 처리하지 못했습니다.",tone:'error',revision:old.revision+1})),[]);
  const receiveCatalog=useCallback((catalog:ProjectNavigationState)=>{
    setData(prev=>{
      const names=prev.projects.some(p=>catalog.names[p.id] && p.name!==catalog.names[p.id]);
      const titles=prev.sessions.some(s=>catalog.titles[s.id] && s.title!==catalog.titles[s.id]);
      if(!names&&!titles)return prev;
      return {...prev,projects:names?prev.projects.map(p=>catalog.names[p.id]?{...p,name:catalog.names[p.id]}:p):prev.projects,
        sessions:titles?prev.sessions.map(s=>catalog.titles[s.id]?{...s,title:catalog.titles[s.id]}:s):prev.sessions};
    });
  },[]);
  const navigation=useProjectOrder(data.projects,connection.authenticated,receiveCatalog,fail);
  const panelProjects=navigation.projects.filter(p=>!archived[p.id]);
  async function refreshAttention(){if(!api)return;const value=await api.workflowState();setProposals(value.proposals);setAttentionState(value)}
  useEffect(() => {
    if (!attentionState) return;
    const previous = noticeIds.current;
    noticeIds.current = new Set(attentionState.notifications.map(item=>item.id));
    if (!previous) return;
    const newest = attentionState.notifications.find(item=>["done","error","update","github-pr"].includes(item.kind) && !item.readAt && !previous.has(item.id));
    if (newest) setCompletionNotice(newest);
  }, [attentionState]);
  async function openPullNotice(notification:WorkflowNotification){
    if(!api)return;
    try{
      await api.workflowAction({action:'pullWatchOpen',notificationId:notification.id});
      if(!notification.readAt)await api.workflowAction({action:'read',ids:[notification.id]});
      await refreshAttention();
    }catch(error){fail(error);}
  }
  useEffect(()=>{if(update?.status==="available")window.dispatchEvent(new Event("flowrium-attention-refresh"));},[update?.status,update?.latestVersion]);
  useEffect(()=>{if(!api)return;let alive=true;const refresh=()=>api.workflowState().then(value=>{if(alive){setProposals(value.proposals);setAttentionState(value)}}).catch(()=>{});void refresh();const timer=setInterval(refresh,5000);window.addEventListener("flowrium-attention-refresh",refresh);return()=>{alive=false;clearInterval(timer);window.removeEventListener("flowrium-attention-refresh",refresh)}},[]);
  useEffect(()=>{
    if(!api||!loaded||!connection.authenticated)return;
    let active=true;
    let busy=false;
    let retry=false;
    async function resume(){
      if(!api||!active||!waitingForResume.current||document.visibilityState!=='visible'||!document.hasFocus())return;
      if(busy){retry=true;return;}
      busy=true;
      try{
        const result=await api.workflowAction({action:'returnToWork'});
        if(active&&result){
          waitingForResume.current=false;
          setResumeNotice({id:result.id,reason:result.reason,notificationId:result.notificationId});
          window.dispatchEvent(new Event('flowrium-attention-refresh'));
        }
      }catch{/* Account authentication may be changing as the window opens. */}
      finally{
        busy=false;
        if(retry){retry=false;void resume();}
      }
    }
    function onReturn(){waitingForResume.current=true;void resume();}
    function onVisible(){if(document.visibilityState==='visible')onReturn();}
    function onWorkCloseReady(){void resume();}
    onReturn();
    window.addEventListener('focus',onReturn);
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('flowrium-work-close-started',onWorkCloseReady);
    return()=>{
      active=false;
      window.removeEventListener('focus',onReturn);
      document.removeEventListener('visibilitychange',onVisible);
      window.removeEventListener('flowrium-work-close-started',onWorkCloseReady);
    };
  },[loaded,connection.authenticated]);
  useEffect(() => {
    if (!api) {
      setLoaded(true);
      return;
    }
    let alive = true;
    const changedActivity = new Set<string>();
    let restoringActivity = true;
    api
      .bootstrap()
      .then((value) => {
        if (!alive) return;
        setData(value);
        if(value.externalActivity)setActivities(previous=>{
          const next={...previous};
          for(const [id,state] of Object.entries(value.externalActivity!)){
            if(!changedActivity.has(id))next[id]=externalActivity(state);
          }
          return next;
        });
        setProjectId(value.projects[0]?.id);
        setLoaded(true);
      })
      .catch((error) => {
        if (alive) {
          fail(error);
          setLoaded(true);
        }
      }).finally(()=>{restoringActivity=false;});
    api
      .connect()
      .then((value) => {
        if (alive) { setConnection(value.status); modelCatalog.accept(value); }
      })
      .catch(fail);
    let projectListRevision=0;
    const removedBySync=new Set<string>();
    const restoredProjects=new Set<string>();
    const handleEvent = (event:FlowriumEvent) => {
      if (!alive) return;
      if(restoringActivity&&event.sessionId&&['status','externalTurn','done'].includes(event.type))changedActivity.add(event.sessionId);
      if(["done","approval","input","inputResolved","error"].includes(event.type))window.dispatchEvent(new Event("flowrium-attention-refresh"));
      if(event.type==='workCloseReady'){
        window.dispatchEvent(new Event('flowrium-attention-refresh'));
        window.dispatchEvent(new Event('flowrium-work-close-started'));
      }
      if(event.type==='contextUsage'&&event.sessionId&&event.contextUsage){
        const context=event.contextUsage;
        setData(previous=>({...previous,sessions:previous.sessions.map(s=>
          s.id===event.sessionId&&(!s.context||s.context.updatedAt<context.updatedAt)?{...s,context}:s
        )}));
      }
      if(event.type==='externalTurn'&&event.sessionId&&event.turnId&&event.turnMessages){
        setData(previous=>({...previous,sessions:previous.sessions.map(s=>s.id===event.sessionId?{
          ...s,messages:withLiveTurn(s.messages,event.turnId!,event.turnMessages!)
        }:s)}));
        const id=event.sessionId;
        setActivities(previous=>{
          if(previous[id]?.source==='local')return previous;
          if(event.status==='running'||event.status==='pending')return {...previous,[id]:externalActivity(event.status)};
          if(previous[id]?.source!=='external'&&!previous[id]?.unsettled)return previous;
          const next={...previous};delete next[id];return next;
        });
      }
      if(event.type==='sessionTitle'&&event.sessionId&&event.title){
        const title=event.title;
        setData(previous=>({...previous,sessions:previous.sessions.map(session=>session.id===event.sessionId?{...session,title}:session)}));
      }
      if(event.type==='sessionList'){
        const removed=new Set(event.removedSessionIds||[]);
        for(const id of removed)removedBySync.add(id);
        for(const restored of event.restoredSessions||[])removedBySync.delete(restored.id);
        setData(previous=>({...previous,sessions:(event.restoredSessions||[]).reduce(
          (sessions,restored)=>upsert(sessions,restored),previous.sessions.filter(s=>!removed.has(s.id))
        )}));
        setSessionId(current=>current&&removed.has(current)?undefined:current);
        if(removed.size){
          setActivities(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>!removed.has(id))));
          setApprovals(previous=>previous.filter(event=>!event.sessionId||!removed.has(event.sessionId)));
        }
        if(event.projectsChanged){
          for(const id of event.restoredProjectIds||[])restoredProjects.add(id);
          const revision=++projectListRevision;
          void api.bootstrap().then(snapshot=>{
            if(!alive||revision!==projectListRevision)return;
            const projects=new Set(snapshot.projects.map(p=>p.id));
            for(const session of snapshot.sessions)if(restoredProjects.has(session.projectId))removedBySync.delete(session.id);
            restoredProjects.clear();
            const scopes=new Set(snapshot.conversationProjects?.map(p=>p.id));
            setData(previous=>{
            const sessions=previous.sessions.filter(s=>projects.has(s.projectId)||scopes.has(s.projectId));
              const known=new Set(sessions.map(s=>s.id));
              const missing=snapshot.sessions.filter(s=>!known.has(s.id)&&!removedBySync.has(s.id));
              return {...previous,projects:snapshot.projects,sessions:[...sessions,...missing]};
            });
            setProjectId(current=>current&&!projects.has(current)?snapshot.projects[0]?.id:current);
            setSessionId(current=>current&&!snapshot.sessions.some(s=>s.id===current)?undefined:current);
          }).catch(error=>{if(alive)fail(error);});
        }
      }
      if (event.type === "session" && event.session) {
        setData((prev) => ({
          ...prev,
          sessions: upsert(prev.sessions, event.session!),
        }));
        setActivities((prev) => {
          const id=event.session!.id,active=prev[id];
          if(active?.source!=='local')return prev;
          const transcript=event.session!.messages;
          const latest=findLatestMessage(transcript,message=>message.role!=='system');
          if(latest?.role==='assistant'){
            if(active.streamingMessage?.id===latest.id&&active.text===latest.text)return prev;
            return {...prev,[id]:{...active,streamingMessage:{id:latest.id,createdAt:latest.createdAt,turnId:latest.turnId},text:latest.text}};
          }
          if(active.streamingMessage&&transcript.some(message=>message.id===active.streamingMessage!.id))
            return {...prev,[id]:{...active,streamingMessage:undefined,text:''}};
          return prev;
        });
      }
      if (event.type === "delta" && event.sessionId)
        setActivities((prev) =>
          prev[event.sessionId!]?.source === "local"
            ? {
                ...prev,
                [event.sessionId!]: {
                  ...prev[event.sessionId!],
                  text: ((prev[event.sessionId!].streamingMessage?.id===event.streamingMessage?.id ? prev[event.sessionId!].text : '') + (event.text || "")).slice(0,2_000_000),
                  streamingMessage:event.streamingMessage,
                  status: "답변을 작성하고 있습니다",
                },
              }
            : prev,
        );
      if (event.type === "status" && event.sessionId && event.workProgress) {
        const {messageId,step}=event.workProgress;
        setData(previous=>({...previous,sessions:previous.sessions.map(row=>row.id===event.sessionId?{
          ...row,messages:row.messages.map(message=>{
            if(message.id!==messageId)return message;
            const steps=message.workSteps||[];
            return {...message,workSteps:steps.some(s=>s.id===step.id)?steps.map(s=>s.id===step.id?step:s):[...steps,step]};
          })
        }:row)}));
      }
      if (event.type === 'status' && event.sessionId && event.workCommentary) {
        const commentary=event.workCommentary;
        setData(previous=>({...previous,sessions:previous.sessions.map(row=>row.id!==event.sessionId?row:{...row,
          messages:row.messages.some(message=>message.id===commentary.id)
            ? row.messages.map(message=>message.id===commentary.id?commentary:message)
            : [...row.messages,commentary],
        })}));
      }
      if (event.type === "status" && event.sessionId && (event.status === "running" || event.status === "stopping"))
        setActivities((prev) =>
          ({ ...prev, [event.sessionId!]: { source:"local",streamingMessage:prev[event.sessionId!]?.streamingMessage,text:prev[event.sessionId!]?.text || "",status:event.text || "작업 중입니다" } }),
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
          event.status === "login-required" ||
          event.status === "login-completed"
        ) {
          if (event.status === "login-completed" && event.text) notify(event.text);
          api
            .connectionStatus()
            .then((value) => {
              if (alive) setConnection(value);
            })
            .catch(fail);
        }
      }
      if (event.type === "inputResolved") {
        setApprovals(prev=>prev.filter(row=>row.requestId!==event.requestId));
      }
      if ((event.type === "approval" || event.type === "input") && event.requestId) {
        setApprovals((prev) => [
          ...prev.filter((a) => a.requestId !== event.requestId),
          event,
        ]);
      }
      if (event.type === "error") {
        if (event.sessionId)
          setActivities((prev) => ({
            ...prev,
            [event.sessionId!]: {
              ...prev[event.sessionId!],
              text: prev[event.sessionId!]?.text || "",
              status: "작업 상태를 확인하고 있습니다",
              error: event.text || "작업 중 오류가 발생했습니다.",
            },
          }));
        else fail(new Error(event.text || "연결 중 오류가 발생했습니다."));
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
    document.documentElement.dataset.accent = data.settings.accentColor || "blue";
  }, [data.settings.theme,data.settings.accentColor]);
  useEffect(() => {
    const el = messages.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [session?.messages, activity?.text, sessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeKey(e)) return;
      if (e.key === "Escape") {
        closeSettings();
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
      if (event.key !== "Tab" || isImeKey(event)) return;
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
                "project:unassigned": { text: "", mode: "build" },
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
  async function selectChatModel(change: ChatModelSelection) {
    if (!api || !conversationProject || submittingRef.current) return;
    const key = draftKey;
    setModelPreviews(previous=>new Map(previous).set(key,{...previous.get(key),...change}));
    const active=modelSaves.current.get(key);
    if(active){
      active.next={...active.next,...change};
      return;
    }
    const flight:{next?:ChatModelSelection}={};
    modelSaves.current.set(key,flight);
    let created:Session|undefined;
    let saved=session;
    try {
      let next:ChatModelSelection|undefined=change;
      while(next){
        const selection={action:'model' as const,...next,model:next.model??saved?.preferences?.model??''};
        if(saved) saved=await api.editConversation(saved.id,selection);
        else {
          saved=created=await api.createSession(conversationProject.id,selection.model);
          if(next.effort!==undefined||next.speed!==undefined) saved=await api.editConversation(saved.id,selection);
        }
        if(!created){
          const {id,preferences}=saved;
          setData(previous=>({...previous,sessions:previous.sessions.map(item=>item.id===id
            ? {...item,preferences:previewChatModel(item.preferences,{model:preferences?.model||'',effort:preferences?.effort||'',speed:preferences?.speed||''})}
            : item)}));
        }
        next=flight.next;
        flight.next=undefined;
      }
    } catch (error) {
      fail(error);
    } finally {
      if(created&&saved){
        rememberSession(saved);
        if(currentDraftKey.current===key){
          const destination=`session:${saved.id}`;
          voiceContinuity.current.preserve=destination;
          setDrafts(previous=>({...previous,[destination]:previous[key]||{text:'',mode},[key]:{text:'',mode}}));
          setSessionId(saved.id);
        }
      }
      modelSaves.current.delete(key);
      setModelPreviews(previous=>{
        const next=new Map(previous);
        next.delete(key);
        return next;
      });
    }
  }
  async function openWork(value: Session, nextMode?: Mode, request?: string) {
    rememberSession(value);
    selectSession(value);
    if (!request) return;
    try { await sendWorkRequest(value,request,nextMode); } catch(error) { fail(error); }
  }
  async function sendWorkRequest(value:Session,request:string,nextMode?:Mode,overrides?:{model?:string;effort?:Effort;submissionId?:string}) {
    rememberSession(value);
    if (!api) return;
    const mode = nextMode || "plan";
    const key = `session:${value.id}`;
    setDrafts(prev => ({ ...prev, [key]: { text: request, mode } }));
    if (!connection.authenticated) {
      throw new Error("ChatGPT 계정 연결 후 AI 업무를 시작하세요.");
    }
    const chosenModel=overrides?.model||value.preferences?.model||data.settings.model;
    const metadata=models.find(row=>row.id===chosenModel)||(!chosenModel?models.find(row=>row.isDefault):undefined);
    const requested=overrides?.effort||value.preferences?.effort||data.settings.effort;
    const supported=effortOptions(metadata);
    const chosenEffort=supported.some(row=>row.reasoningEffort===requested)?requested:metadata?.defaultReasoningEffort||supported[0]?.reasoningEffort;
    const result=await api.send({ sessionId: value.id, text: request, mode, model:chosenModel, effort:chosenEffort, submissionId:overrides?.submissionId });
    if(!result.accepted)throw new Error('요청을 전송하지 못했습니다. 대화 초안은 보존했습니다.');
    setDrafts(prev => prev[key]?.text === request ? { ...prev, [key]: { text: "", mode } } : prev);
  }
  async function connect() {
    if (!api)
      return notify("실제 Codex 연결은 데스크톱 앱에서 사용할 수 있습니다.");
    setConnecting(true);
    try {
      const result = await api.connect();
      setConnection(result.status);
      modelCatalog.accept(result);
      notify(
        result.status.authenticated
          ? (security.state.accountLinked ? "Codex에 연결했습니다." : "기존 ChatGPT 계정을 찾았습니다. 로그인 버튼으로 연결하세요.")
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
      notify("브라우저에서 로그인을 마치면 Flowrium에 자동으로 연결됩니다.");
    } catch (error) {
      fail(error);
    } finally {
      setConnecting(false);
    }
  }
  async function openPersonalAssistant(){
    if(!api)return;
    if(connection.authenticated&&connection.dotsEligible){
      setChatActive(false);setDockFilter('all');setDockOpen(true);setAssistantNavigation(value=>(value||0)+1);
      return;
    }
    setCreatingConversation(true);
    try {
      const value=await api.openGeneralAssistant();
      setData(await api.bootstrap());rememberSession(value);selectSession(value);
    } catch(error){fail(error)} finally{setCreatingConversation(false)}
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
  function openCategorySettings(id: string) {
    setCategoryTarget(id);
    setSettingsOpen(true);
  }
  useEffect(() => { if (!settingsOpen) setCategoryTarget(undefined); }, [settingsOpen]);
  function itemContext(event:{preventDefault():void;clientX:number;clientY:number},target:DeleteTarget){event.preventDefault();setItemMenu({x:event.clientX,y:event.clientY,target})}
  async function reloadItems(result?:TrashResult){if(!api)return;const next=await api.bootstrap();setData(next);if(sessionId&&!next.sessions.some(s=>s.id===sessionId)){setSessionId(undefined);setChatActive(false)}if(projectId&&!next.projects.some(p=>p.id===projectId)){setProjectId(next.projects[0]?.id);setView("dashboard")}notify(result?.notice||"항목을 반영했습니다.");await refreshAttention()}
  function openUpdateSettings(){setCategoryTarget(undefined);setSettingsNavigation(value=>value+1);setSettingsOpen(true);}
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
  const submissionReceipts=useRef(new Map<string,{id:string;text:string}>());
  async function restoreFailedRequest(message:Message){
    if(submittingRef.current||currentDraftKey.current!==draftKey)return;
    try {
      const text=message.sourceOnly && api && session
        ? (await api.readRequestSource(session.id,message.id,"full")).text
        : attachmentDisplayText(message.text);
      if(submittingRef.current||currentDraftKey.current!==draftKey)return;
      setDrafts(previous=>{
        const draft=previous[draftKey];
        if(draft?.text||draft?.attachments?.length)return previous;
        return {...previous,[draftKey]:{mode:draft?.mode||mode,text,attachments:message.attachments||[]}};
      });
      composer.current?.focus();
    } catch(error){ fail(error); }
  }
  function longSubmission(key:string,text:string) {
    if(text.length<=maxChatInput)return {};
    const prior=submissionReceipts.current.get(key);
    if(prior?.text===text)return {submissionId:prior.id};
    const id=crypto.randomUUID();submissionReceipts.current.set(key,{id,text});
    return {submissionId:id};
  }
  async function confirmChatFolders(projectId:string, target?:Session) {
    if (target?.scope) return true;
    if (!api) return false;
    const folders = new Set([projectId, ...(target?.workflow?.reportProjects || [])]);
    for (const id of folders) if (!await api.requestProjectTrust(id)) return false;
    return true;
  }
  async function openDashboardDraft(projectId:string,text:string,target?:Session) {
    if(!api||!data.projects.some(project=>project.id===projectId)||archived[projectId])
      throw Error('현재 작업할 프로젝트를 다시 선택해 주세요.');
    const current=target ? data.sessions.find(session=>session.id===target.id&&session.projectId===projectId) : undefined;
    if(target&&(!current||current.workflow?.status==='done'))throw Error('초안을 추가할 대화를 다시 선택해 주세요.');
    const destination=current||await api.createSession(projectId);
    if(!current){
      const state=await api.securityState();
      if(state.locked||state.accountRevision!==security.state.accountRevision)
        throw Error('계정이나 잠금 상태가 바뀌었습니다. 초안을 다시 열어 주세요.');
    }
    const key='session:'+destination.id;
    setDrafts(previous=>{
      const prior=previous[key], existing=prior?.text||'';
      if(existing===text||existing.endsWith('\n\n'+text))return previous;
      return {...previous,[key]:{...prior,mode:prior?.mode||projectMode(destination),text:[existing,text].filter(Boolean).join('\n\n')}};
    });
    rememberSession(destination);
    selectSession(destination);
  }
  async function sendDashboardDraft(target:Session,text:string,submissionId:string){
    const current=data.sessions.find(session=>session.id===target.id&&session.projectId===target.projectId&&!session.scope);
    if(!api||!current||current.workflow?.status==='done'||archived[current.projectId])
      throw Error('보낼 수 있는 프로젝트 대화를 다시 선택해 주세요.');
    const connection=await api.readChatConnection();
    if(!connection.ready)throw Error(connection.message);
    if(!await confirmChatFolders(current.projectId,current))throw Error('프로젝트 편집 권한을 확인해 주세요.');
    const state=await api.securityState();
    if(state.locked||state.accountRevision!==security.state.accountRevision)
      throw Error('계정이나 잠금 상태가 바뀌었습니다. 대상 대화를 다시 확인해 주세요.');
    const sent=await api.send({
      sessionId:current.id,text,submissionId,
      mode:projectMode(current,current.workflow?workKinds[current.workflow.kind].mode:undefined),
      model:data.settings.model||undefined,effort:data.settings.effort,
    });
    if(!sent.accepted)throw Error('대화에 요청을 접수하지 못했습니다.');
    return {queued:sent.queued,queueId:sent.queueId};
  }
  async function send(textOverride?:string, nextTurn=false) {
    const requestText=textOverride??input;
    if ((!/\S/.test(requestText) && !attachments.length) || submittingRef.current || modelSaves.current.has(draftKey)) return;
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
    const text = requestText;
    let draftCleared = false;
    let submissionId:string|undefined;
    try {
      if (!connection.authenticated && !wasRunning) {
        const prepared = await api.readChatConnection();
        if (currentDraftKey.current !== originKey) return;
        if (!prepared.ready) {
          if (textOverride && !/\S/.test(input)) {
            setDrafts(prev => prev[originKey]?.text ? prev : {...prev,[originKey]:{...prev[originKey],text:requestText,mode}});
          }
          if (prepared.reason === 'changed') return fail(new Error(prepared.message));
          setChatWebFallback({key:originKey,message:prepared.message,canLogin:prepared.reason==='login',showInstall:prepared.desktopInstalled===false});
          if (prepared.desktopInstalled === false && !webInstallNotice.current) {
            webInstallNotice.current = true;
            const marker='flowrium.desktop-chat-install-hint';
            let seen=false;
            try { seen=localStorage.getItem(marker)==='1'; if(!seen)localStorage.setItem(marker,'1'); } catch { /* Keep the notice once per app launch if local storage is unavailable. */ }
            if (!seen) notify('데스크톱 앱을 설치하면 Flowrium과 Codex 대화를 양방향으로 이어갈 수 있습니다.');
          }
          return;
        }
      }
      setChatWebFallback(undefined);
      if (!await confirmChatFolders(conversationProject.id,session)) {
        if (textOverride && !/\S/.test(input)) {
          setDrafts(prev => prev[originKey]?.text ? prev : {
            ...prev, [originKey]: { ...prev[originKey], text: requestText, mode },
          });
        }
        return;
      }
      if (currentDraftKey.current !== originKey) return;
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
            [targetKey]: { text: "", mode },
            [originKey]: { text: "", mode },
          }));
          setSessionId(created.id);
        }
      }
      stickToBottom.current = true;
      submissionId=longSubmission(restoreKey,text).submissionId||crypto.randomUUID();
      if(!nextTurn)setOutgoing({sessionId:activeId,message:{
        id:submissionId,role:'user',createdAt:new Date().toISOString(),attachments:originalAttachments,
        text:text.length>maxChatInput?'긴 요청을 보내고 있어요.':text.trim()?text:'첨부한 자료를 확인해 주세요.',
      }});
      setDrafts(prev => ({ ...prev, [originKey]: { text: "", mode } }));
      draftCleared = true;
      const sent=await api.send({
        submissionId,
        ...(wasRunning&&!nextTurn&&{delivery:"steer" as const}),
        sessionId: activeId,
        text,
        attachments:originalAttachments.map(a=>a.id),
        mode,
        model: data.settings.model || undefined,
        effort: data.settings.effort,
      });
      submissionReceipts.current.delete(restoreKey);
      if(sent.steered)notify("현재 작업에 추가 지시를 전달했습니다.");
      else if(sent.queued){
        setOutgoing(current=>current?.message.id===submissionId?undefined:current);
        notify(sent.waitingForWriter?"Codex에서 원래 대화를 사용 중입니다. 추가 지시에서 ‘지금 분기해 실행’을 선택할 수 있습니다.":"추가 지시를 보관했습니다. 현재 작업이 끝나면 차례로 전달합니다.");
      }
    } catch (error) {
      if (!draftCleared) { fail(error); return; }
      setOutgoing(current=>current?.message.id===submissionId?undefined:current);
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
  async function openChatWeb() {
    if (!api) return;
    try {
      if (/\S/.test(input)) await api.copyText(input);
      if (session?.preferences?.chatGptUrl) await api.openSessionChatGPT(session.id);
      else await api.openExternal('chatgpt');
      notify(/\S/.test(input) ? '초안을 복사했습니다. 브라우저에서 붙여넣어 보내세요.' : '브라우저에서 대화를 열었습니다.');
    } catch (error) { fail(error); }
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
  function closeSettings() {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && settingsDialog.current?.contains(focused))
      focused.blur();
    setSettingsOpen(false);
  }
  async function saveSettings(patch: Partial<Bootstrap["settings"]>) {
    const request = ++nextSettingsRequest.current;
    const keys = Object.keys(patch) as (keyof Bootstrap["settings"])[];
    for (const key of keys) settingsRequests.current[key] = request;
    function applySavedSettings() {
      setData((previous) => {
        const changed = Object.fromEntries(keys.filter(key => settingsRequests.current[key] === request && Object.hasOwn(persistedSettings.current,key))
          .map(key => [key, persistedSettings.current[key]]));
        return { ...previous, settings: { ...previous.settings, ...changed } };
      });
    }
    const saving = settingsSaveQueue.current.then(async () => {
      try {
        const saved = api ? await api.saveSettings(patch) : patch;
        Object.assign(persistedSettings.current,Object.fromEntries(keys.map(key=>[key,saved[key]])));
        applySavedSettings();
        return true;
      } catch (error) {
        applySavedSettings();
        fail(error);
        return false;
      }
    });
    settingsSaveQueue.current = saving.then(()=>{});
    return saving;
  }
  async function decide(event: FlowriumEvent, decision: "accept" | "decline") {
    if (!api || !event.requestId || decisionFlights.current.has(event.requestId)) return;
    const requestId = event.requestId;
    decisionFlights.current.add(requestId);
    setDeciding((prev) => ({ ...prev, [requestId]: true }));
    try {
      await api.approval({ requestId, decision });
      setApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
    } catch (error) {
      fail(error);
    } finally {
      decisionFlights.current.delete(requestId);
      setDeciding((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  }
  async function continueWaitingSession(messageId:string,suggested?:string){
    if(!api||!session||submittingRef.current||workActive||modelSaves.current.has(draftKey))return;
    const originKey=draftKey,originalInput=input,originalAttachments=attachments,request=input.trim()?input:suggested||input;
    submittingRef.current=true;setSubmitting(true);
    try{
      if (!await confirmChatFolders(session.projectId,session)) return;
      await api.workflowAction({action:'continueConversation',sessionId:session.id,messageId,...longSubmission(originKey,request),text:request,attachments:originalAttachments.map(a=>a.id),mode,model:data.settings.model||undefined,effort:data.settings.effort});
      submissionReceipts.current.delete(originKey);
      setDrafts(previous=>{const draft=previous[originKey];return {...previous,[originKey]:{...draft,mode:draft?.mode||mode,text:draft?.text===originalInput?'':draft?.text||'',attachments:(draft?.attachments||[]).filter(item=>!originalAttachments.some(sent=>sent.id===item.id))}}});
      stickToBottom.current=true;
    }finally{submittingRef.current=false;setSubmitting(false)}
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

  function openQuestion(event: FlowriumEvent) {
    const owner = data.sessions.find(item => item.id === event.sessionId);
    if (owner) {
      setAttentionOpen(false);
      selectSession(owner);
      if (event.type === "input") setFocusQuestion(event.requestId);
    } else {
      setAttentionOpen(false);
      setView("inbox");
    }
    dismissQuestion(event);
  }
  function renderChat(){
    const project = conversationProject;
    const queued = session?.queuedMessages?.some(row=>row.status==="queued" || row.status==="sending");
    const queue = session && <ChatQueuePanel session={session} onCancel={id=>{void api!.cancelQueuedMessage(session.id,id).catch(fail);}} onResume={async()=>{try{if(await confirmChatFolders(session.projectId,session))await api!.resumeQueuedMessages(session.id);}catch(error){fail(error);}}}
      onBranch={async id=>{try{if(!await confirmChatFolders(session.projectId,session))return;const result=await api!.startQueuedBranch(session.id,id);openWork(result.session);notify('새 분기에서 작업을 시작했습니다.');}catch(error){fail(error);}}}
      onSendToCodex={async id=>{try{if(!await confirmChatFolders(session.projectId,session))return;const result=await api!.sendQueuedToCodex(session.id,id);if(result.accepted)notify(nativeQueueNotice(result));}catch(error){fail(error);}}}
      onClear={async id=>{try{await api!.clearUnconfirmedCodexQueue(session.id,id);}catch(error){fail(error);}}}/>;
    return (
          <div className="dock-chat-content">
            {isChatFocused&&!settingsOpen&&<UpdatePanel state={update} fail={fail}/>}
            <div className={`workspace-main ${session ? "has-session" : ""}`}>
              {session ? (
                <>
                  <div className="session-heading">
                    <div>
                      <span className="eyebrow">
                        {session.scope?<MessageSquare size={13}/>:<ProjectCategoryLabel category={categories[session.projectId]}/>}
                        {session.scope==='integrated'?'통합 채팅':session.scope==='general'?'일반 대화':conversationProject?.name||'프로젝트 대화'}
                      </span>
                      <h2 title={session.title}>{session.title}</h2>
                    </div>
                    <div className="session-actions">
                      <ChatContextMeter context={session.context}/>
                        <details className="session-details" key={`connection:${session.id}`} onToggle={event=>setWorkToolsSession(event.currentTarget.open ? session.id : undefined)}>
                          <summary aria-label="대화 연결 및 작업 도구" title="대화 연결 및 작업 도구"><Settings2 size={16}/></summary>
                          <div className="session-details-body">
                            <CodexLinkBar session={session} running={workActive}/>
                            {session.context && <div className="chat-context">문맥 {session.context.percent}% ({session.context.used.toLocaleString("ko-KR")} / {session.context.max.toLocaleString("ko-KR")} 토큰) <progress max={100} value={session.context.percent}/></div>}
                            {!queued && queue}
                            {session.workflow && <WorkSessionControls session={session} onSessionChange={rememberSession} running={workActive}/>}
                            {workToolsSession===session.id && <WorkToolDetails progress={workProgress} messages={session.messages} projectId={session.projectId}/>}
                          </div>
                        </details>
                      <ConversationTools onHandoff={handoff} onNew={newSession} onExport={async()=>{try{if(await api?.exportSession(session.id))notify("작업 대화를 내보냈습니다.");}catch(error){fail(error);}}} onDelete={()=>setDeletionTarget({kind:"session",id:session.id,name:session.title})} key={`tools:${session.id}`} session={session} models={models} running={workActive} onOpen={openWork} onChange={rememberSession} notify={notify} fail={fail} defaults={data.settings.chatDefaults} defaultModel={data.settings.model} onDefaults={chatDefaults=>setData(old=>({...old,settings:{...old.settings,chatDefaults}}))} onRewind={draft=>setDrafts(prev=>({...prev,[draftKey]:{text:draft.text,mode,attachments:draft.attachments}}))} />
                    </div>
                  </div>
                  {session.compacting && <p className="chat-context" role="status">문맥 압축 중</p>}
                  {queued && queue}
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
                    <MessageHistory key={session.id} running={workActive} checking={Boolean(activity?.unsettled)} messages={displayMessages} scrollRef={messages} stickToBottom={stickToBottom} renderMessage={(message,hasLaterRequest,failedRequest) => (
                      <article
                        className={`message ${message.role}`}
                        data-message-id={message.id}
                        data-outgoing={pendingMessage?.id===message.id||undefined}
                        aria-label={message.role==="user"?"내 메시지":undefined}
                        key={message.id}
                      >
                        <div className="message-body">
                          {(message.role!=="user"||message.delegated)&&<div className="message-meta">
                        <span className={`message-avatar ${message.role}`}>
                          {message.role === "assistant" ? (
                            <img className="codex-avatar" src={codexAvatar} width="24" height="24" alt="" draggable={false}/>
                          ) : message.role === "user" ? (
                            <UserRound size={16} aria-hidden="true" />
                          ) : (
                            <Circle size={13} />
                          )}
                        </span>
                            <strong>
                              {message.role === "assistant"
                                ? "Codex"
                                : message.role === "user"
                                  ? (message.delegated ? "전달된 요청" : "나")
                                  : "작업 상태"}
                            </strong>
                          </div>}
                          <div className="message-bubble-row">
                          {message.role==="user"&&<ChatMessageTime createdAt={message.createdAt}/>}
                          <div className="message-bubble">
                          {Boolean(message.attachments?.length)&&conversationProject&&<ChatAttachmentList projectId={conversationProject.id} items={message.role==="assistant"?message.attachments!.filter(a=>!presentCitations(message.text).references.some(r=>r.attachmentId===a.id)):message.attachments!}/>}
                          <div className="markdown">
                            {typingId===message.id?<TypingMessageContent sessionId={session.id} messageId={message.id} text={message.text}/>:
                            <MessageContent sessionId={session.id} messageId={message.id} text={message.text} role={message.role} hasLaterRequest={hasLaterRequest}
                              retryAction={failedRequest&&<button type="button" className="button subtle" data-message-detail-control
                                disabled={submitting||Boolean(input.length||attachments.length)}
                                title={input.length||attachments.length?"입력창을 비우면 이 요청을 다시 담을 수 있습니다.":"요청을 입력창에 담아 다시 확인합니다."}
                                onClick={()=>restoreFailedRequest(failedRequest)}>입력창에 다시 담기</button>}/>}
                            {message.sourceOnly && <RequestSource sessionId={session.id} messageId={message.id}/>}
                          </div>
                          </div>
                          </div>
                            <span className="message-meta-actions">
                              {message.role !== "system" && (
                                <button
                                  className="icon-button copy-message"
                                  aria-label="메시지 복사"
                                  onClick={async () => {
                                    try {
                                      if(message.sourceOnly) await api!.copyRequestSource(session.id,message.id);
                                      else await api!.copyText(message.role==="assistant"?presentCitations(message.text).text:message.text);
                                      notify("메시지를 복사했습니다.");
                                    } catch (error) {
                                      fail(error);
                                    }
                                  }}
                                >
                                  <Copy size={13} />
                                </button>
                              )}
                              {message.role === "assistant" && <>
                                <SpeakMessageButton text={presentCitations(message.text).text} onError={fail}/>
                                <LikeButton
                                  active={message.reaction === 'like'}
                                  disabled={reacting[message.id] || !api}
                                  onClick={() => {
                                    setReacting(previous => ({ ...previous, [message.id]: true }));
                                    void api!.reactMessage({ sessionId: session.id, messageId: message.id, liked: message.reaction !== 'like' })
                                      .then(rememberSession).catch(fail)
                                      .finally(() => setReacting(previous => ({ ...previous, [message.id]: false })));
                                  }}
                                />
                              </>}
                              {message.role!=="user"&&<ChatMessageTime createdAt={message.createdAt}/>}
                            </span>
                        </div>
                      </article>
                    )}/>
                    <AnswerProgress key={session.id+':'+(workProgress?.key||'')} active={workActive} progress={workProgress}
                      finished={answerCompleted} messages={session.messages} streamedLength={streamedLength} paused={sessionApprovals.length>0}/>
                    {activity?.error && (
                      <div className="inline-error">{activity.error}</div>
                    )}
                    {sessionApprovals.filter(event=>event.type==="input").map(event=>
                      <section key={event.requestId} className="conversation-question" data-question-request={event.requestId} tabIndex={-1} aria-label="응답 요청">
                        <InputRequestPanel event={event} onResolved={()=>notify("답변을 전달했어요.")}/>
                      </section>)}
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
                </div>
              )}
              {workActive&&<LiveWorkTimeline key={draftKey} progress={workProgress}/>}
              <div className="composer-area">
                {sessionApprovals.filter(event=>event.type!=="input" || !session).map(event=><DecisionRequestPanel key={event.requestId} event={event}/>)}
                {draftError && <p role="alert" className="composer-draft-error">{draftError} <button onClick={retryDrafts}>초안 다시 불러오기</button></p>}
                {!connection.authenticated && chatWebFallback?.key===draftKey ? <section className="composer-web-fallback" aria-label="브라우저에서 대화 이어가기">
                  <p role="status">{chatWebFallback.message}{!conversationProject?.conversationScope&&!session?.preferences?.chatGptUrl&&' 웹에서 코딩 작업을 하려면 작업 위치로 클라우드를 선택하세요.'}{attachments.length>0&&' 웹에서는 첨부 파일을 다시 선택해 주세요.'}</p>
                  <div>
                    {chatWebFallback.showInstall&&<button type="button" className="button subtle" onClick={()=>void api?.openExternal('chatgpt-desktop').catch(fail)}><Download size={14} aria-hidden="true"/>데스크톱 앱 설치</button>}
                    {chatWebFallback.canLogin&&<button type="button" className="button subtle" disabled={connecting} onClick={()=>void login()}><LogIn size={14} aria-hidden="true"/>Flowrium에서 로그인</button>}
                    <button type="button" className="button secondary" onClick={()=>void openChatWeb()}><ExternalLink size={14} aria-hidden="true"/>{/\S/.test(input)?'초안 복사하고 웹 열기':'웹에서 이어가기'}</button>
                  </div>
                </section>:desktopChatInstalled===false&&!workActive&&<div className="composer-web-options" role="group" aria-label="데스크톱 앱과 브라우저 선택">
                  <button type="button" className="button subtle" title="데스크톱 앱을 설치하면 같은 기기의 Codex 대화를 Flowrium과 이어갈 수 있어요." onClick={()=>void api?.openExternal('chatgpt-desktop').catch(fail)}><Download size={14} aria-hidden="true"/>데스크톱 앱 설치</button>
                  <button type="button" className="button subtle" onClick={()=>void openChatWeb()}><ExternalLink size={14} aria-hidden="true"/>{/\S/.test(input)?'초안 복사하고 웹 열기':'웹에서 이어가기'}</button>
                </div>}
                <AttachmentComposer key={voiceContinuity.current.generation} projectId={project?.id} items={attachments} onChange={setAttachments} disabled={security.state.locked} report={notify}>{attachmentControl=>(
                <div className={`composer ${workActive ? "working" : ""}`}>
                  {(!workActive || input) && <div className="composer-topline">
                    {!workActive && <span>
                      <span
                        className={`status-dot ${connection.authenticated ? "online" : ""}`}
                      />
                      {project ? `${project.name} 작업 요청` : "작업 요청"}
                    </span>}
                    {input && (
                      <button
                        className="icon-button"
                        aria-label="입력 지우기"
                        onClick={() => setInput("")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>}
                  <ChatContinuation key={draftKey} session={session} running={workActive || Boolean(activity?.unsettled) || sessionApprovals.length > 0 || Boolean(session && visibleProposals(proposals).some(p=>p.sourceId===session.id || p.targetId===session.id))}
                    authenticated={connection.authenticated} aiFollowups={data.settings.aiFollowups===true} busy={submitting || !!modelPreview} draft={input} textareaRef={composer}
                    active={chatActive && dockOpen && !settingsOpen && !attentionOpen}
                    placeholder={project ? "어떤 작업을 함께 해볼까요?" : "만들고 싶은 것, 풀고 싶은 문제를 적어 주세요."}
                    onChange={setInput} onSend={() => void send()} onContinue={continueWaitingSession}
                    onChoose={prompt => {
                      setDrafts(previous => {
                        const draft = previous[draftKey];
                        return {...previous, [draftKey]: {...draft, mode: draft?.mode || mode,
                          text: draft?.text.trim() ? draft.text + "\n\n" + prompt : prompt}};
                      });
                      composer.current?.focus();
                    }}
                  />
                  <div className="composer-toolbar">
                    <div className="composer-options">
                      {attachmentControl}
                      <VoiceComposer key={voiceContinuity.current.generation} suspend={settingsOpen||attentionOpen||!dockOpen||!chatActive} disabled={running||security.state.locked} onText={text=>setDrafts(prev=>{
                        const draft=prev[draftKey];return {...prev,[draftKey]:{mode:draft?.mode||mode,text:[draft?.text,text].filter(Boolean).join("\n"),attachments:draft?.attachments}};
                      })} onSubmit={text=>void send([input,text].filter(Boolean).join("\n"))}/>
                      <ChatModelPicker onOpen={()=>void modelCatalog.refresh(true)} models={models}
                        preferences={previewChatModel(session?.preferences,modelPreview)} conversationKey={draftKey}
                        defaultModel={data.settings.chatDefaults?.model||data.settings.model}
                        defaultEffort={data.settings.chatDefaults?.effort??data.settings.effort} defaultSpeed={data.settings.chatDefaults?.speed??data.settings.speed}
                        pro={connection.authenticated&&connection.accountPlan==='pro'}
                        disabled={!conversationProject || submitting}
                        onChange={change => void selectChatModel(change)}/>
                    </div>
                    <div className="chat-run-controls">
                    {running&&<><button type="button" className="chat-delivery" data-delivery="queue" aria-label="추가 지시 대기열에 넣기" onClick={()=>void send(undefined,true)} disabled={(!/\S/.test(input)&&!attachments.length)||submitting||!!modelPreview}>다음 차례</button>
                    <button type="button" className="chat-delivery" data-delivery="steer" aria-label="현재 작업에 추가 지시 보내기" onClick={()=>void send()} disabled={(!/\S/.test(input)&&!attachments.length)||submitting||!!modelPreview}>지금 전달</button></>}
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
                        disabled={(!/\S/.test(input)&&!attachments.length) || submitting || !!modelPreview || !project}
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
                {session?.scope && <div className="composer-footnote">
                  <span><ShieldCheck size={12}/>{session.scope === 'general' ? '일반 대화' : '프로젝트 현황 조회'}</span>
                  <span>줄바꿈 ⇧ ↵</span>
                </div>}
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
  const unreadCount = (attentionState?.notifications.filter(item=>!item.readAt).length || 0) + activeCounts.decision;
  const headerActions = (
    <div className="workspace-utilities" role="group" aria-label="작업 공간 도구">
      <button type="button" className="command-trigger header-search" aria-label="프로젝트와 화면 찾기" title="프로젝트와 대화 찾기" onClick={openCommandCenter}>
        <Search size={16}/><span>프로젝트와 대화 찾기</span><kbd>{/Mac/.test(navigator.platform)?'⌘':'Ctrl'} K</kbd>
      </button>
      <button type="button" className="icon-button assistant-entry" aria-label="개인 비서" title="개인 비서" onClick={()=>void openPersonalAssistant()}><MessageSquare size={17}/></button>
      <button type="button" className="icon-button header-music" aria-label="음악 열기" title="뮤직" onClick={()=>setMusicOpen(true)}><Music2 size={17}/></button>
      <button type="button" className="icon-button header-decisions" aria-label={`알림 ${unreadCount}건`} title={unreadCount?`알림과 검토 요청 (${unreadCount}건)`:"알림과 검토 요청"} onClick={openDecisions}>
        <Bell size={17}/>{unreadCount>0&&<span className="notification-count" aria-hidden="true">{unreadCount>99?'99+':unreadCount}</span>}
      </button>
    </div>
  );
  return (
    <div className="app-shell" data-chat-focus={isChatFocused}>
      {sidebarPresence.present && (
        <button
          className="sidebar-backdrop" data-phase={sidebarPresence.phase}
          aria-hidden="true" tabIndex={-1} type="button"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <CommandCenter projects={data.projects} sessions={data.sessions} onProject={selectProject} onSession={selectSession} onView={value=>{if(value==="settings")setSettingsOpen(true);else if(value==="music")setMusicOpen(true);else setView(value as View);}} onNew={()=>{void newSession();}}/>
      <WorkspaceSidebar categories={categories} current={reportDialog||view} mobileOpen={sidebarOpen} onClose={()=>setSidebarOpen(false)} projects={panelProjects} onProjectMove={navigation.move}
        selected={["overview","home","workspace","terminal"].includes(view)?projectId:undefined}
        onProjectMenu={(event,p)=>itemContext(event,{kind:"project",id:p.id,name:p.name})} counts={projectCounts} accountUsage={accountUsage}
        onGo={value=>{if(value==='weekly'||value==='pause')setReportDialog(value);else setView(value);setSidebarOpen(false);}} onProject={selectProject}
        onTrash={()=>{setTrashOpen(true);setSidebarOpen(false);}} onSettings={()=>{setSettingsOpen(true);setSidebarOpen(false);}}
        onLock={()=>{setSidebarOpen(false);if(!security.state.hasPin){setSettingsOpen(true);notify("설정에서 잠금 번호를 정하세요.");return;}void security.lock().catch(fail);}}
        accountLinked={accountLinked} onLogin={()=>{setSidebarOpen(false);void login();}} onLogout={()=>{setSidebarOpen(false);setLogoutOpen(true);}}/>
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
            {view!=="dashboard" && <DashboardBack onClick={()=>setView("dashboard")}/>}
            <span>내 작업 공간</span>
            <ChevronRight size={13} />
            <strong>
              {({dashboard:"대시보드",kickoff:"새 프로젝트",archive:"완료",outputs:"산출물",timeline:"날짜별 기록",workflow:"업무 연결 / 비서",weekly:"주간업무보고",pause:"업무 마감",music:"뮤직",history:"작업 기록",library:"프롬프트 보관함",dictionary:'사전',activity:"작업 현황",inbox:"승인함",terminal:"터미널"} as Partial<Record<View,string>>)[view] || project?.name || "시작하기"}
            </strong>
            {!api && <span className="preview-badge">화면 미리보기</span>}
          </div>
          {view!=="overview" && headerActions}
        </header>

        {!settingsOpen&&!isChatFocused && <UpdatePanel state={update} fail={fail} />}
        {loaded&&view==="dashboard"&&!data.projects.length&&<AccountSetupCard chatConnected={accountLinked} onChat={()=>setSettingsOpen(true)}/>}
        {!loaded ? (
          <div className="loading-page">
            <LoadingProgress startup label="작업 공간을 불러오고 있습니다." />
          </div>
        ) : view === "music" ? null : view === "workflow" ? (
          <div className="page-scroll"><div className="page-inner"><WorkflowHub onOpen={openWork} onOpenInbox={()=>setView("inbox")}/><details className="work-resources"><summary>자료 관리</summary><CodexTransferPanel onChanged={async()=>{if(!api)return;const next=await api.bootstrap();setData(next);if(!projectId&&next.projects[0])setProjectId(next.projects[0].id);}} onOpen={id=>{void (async()=>{const next=await api!.bootstrap();setData(next);const found=next.sessions.find(row=>row.id===id);if(found){setSettingsOpen(false);selectSession(found);}})().catch(fail);}}/><MigrationPanel/>
              <IntegrationPanel projectId={projectId}/></details></div></div>
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
              {owner && <button className="button subtle" onClick={()=>selectSession(owner)}><MessageSquare size={14} aria-hidden="true"/>대화 열기</button>}
              <button className="button subtle" disabled={deciding[event.requestId || ""]} onClick={()=>decide(event,"decline")}><X size={14} aria-hidden="true"/>거절</button>
              <button className="button primary" disabled={deciding[event.requestId || ""]} onClick={()=>decide(event,"accept")}><Check size={14} aria-hidden="true"/>이번 작업 승인</button></div></section>;
          })}</div></div>
        ) : (view==="dashboard"||view==="kickoff"||view==="archive"||view==="outputs"||view==="timeline") ? (
          <ProjectPortfolio categoryRevision={categoryRevision} onProjectMenu={(event,p)=>itemContext(event,{kind:"project",id:p.id,name:p.name})} view={view} projects={navigation.projects} sessions={projectOnlySessions}
            dashboard={{accountRevision:security.state.accountRevision,drafts,decisionSessionIds:dashboardDecisions,workClose:attentionState?.workClose,revealResume,onResumeRevealed:resumeRevealed,onDraft:openDashboardDraft,onSend:sendDashboardDraft}}
            onProjectMove={navigation.move}
            onNavigate={setView} onProject={selectProject} onOpenSession={openWork} onChooseProject={chooseProject}
            onSessionChange={rememberSession} onArchived={(id,value)=>setArchived(prev=>({...prev,[id]:value}))}
            tools={<>
              <div className="pf-tool-group" role="group" aria-label="작성과 분석"><h3>작성과 분석</h3><div>
              <button onClick={()=>setWorkPopup("research")}><Search size={15}/>리서치</button>
              <button onClick={()=>setWorkPopup("briefing")}><BookOpen size={15}/>전체 브리핑</button>
              <button onClick={()=>setWorkPopup("document")}><FileText size={15}/>문서 작성</button>
              <button onClick={()=>setView("library")}><BookOpen size={15}/>프롬프트 보관함</button>
              </div></div>
              <div className="pf-tool-group" role="group" aria-label="업무 관리"><h3>업무 관리</h3><div>
              <button onClick={()=>setView("activity")}><Clock3 size={15}/>작업 현황</button>
              <button onClick={()=>setView("inbox")}><ShieldCheck size={15}/>승인함{approvals.length>0&&<span>{approvals.length}</span>}</button>
              <button onClick={()=>setView("history")}><History size={15}/>작업 기록</button>
              <button onClick={()=>setView("home")}><LayoutDashboard size={15}/>업무 보드</button>
              <button onClick={()=>void newSession()}><Plus size={15}/>새 자유 대화</button>
              </div></div></>}
            onCreated={async p=>{
              try { if(api) setData(await api.bootstrap()); selectProject(p); } catch(error){fail(error);}
            }}/>
        ) : view==="overview" && project ? (
          <ProjectOverview key={project.id} headerActions={headerActions} categoryRevision={categoryRevision} onCategory={()=>openCategorySettings(project.id)} project={project} nameLink={navigation.nameLinks?.[project.id]} sessions={projectSessions} tab={projectTab}
            onTabChange={setProjectTab} onOpenSession={openWork} onMenu={()=>setSidebarOpen(true)} onDashboard={()=>setView("dashboard")}
            onDetailsChange={d=>{setCategories(prev=>({...prev,[d.projectId]:projectCategory(d)||""}));setArchived(prev=>({...prev,[d.projectId]:!!d.archivedAt}));if(d.kickoff?.name){const name=d.kickoff.name;setData(prev=>prev.projects.some(p=>p.id===d.projectId&&p.name!==name)?{...prev,projects:prev.projects.map(p=>p.id===d.projectId?{...p,name}:p)}:prev);}window.dispatchEvent(new Event(projectOrderChanged));}}
            renderPanel={tab=>tab==="work"?<Workbench project={project} sessions={projectSessions} onChooseProject={chooseProject} onOpen={openWork} onSessionChange={rememberSession}/>:
              tab==="team"?<TeamPanel projectId={project.id} onOpen={openWork}/>:<RepositoryPanel project={project}/>}/>
        ) : view === "home" ? (
          <Workbench key={projectId || "welcome"} project={project} sessions={projectSessions} onChooseProject={chooseProject} onOpen={openWork} onSessionChange={rememberSession} />
        ) : view === 'dictionary' ? (
          <PersonalDictionary authenticated={connection.authenticated}/>
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
        <footer className="statusbar"><span><span className={`status-dot ${accountLinked?'online':''}`}/>{accountLinked?'ChatGPT 연결됨':'ChatGPT 연결 전'}</span><ExecutionSummary counts={activeCounts} onSelect={showExecution}/></footer>
      </main>
      <IconTooltips/>
      <ContextMenu anchor={itemMenu?{x:itemMenu.x,y:itemMenu.y}:null} label="항목 메뉴" onClose={()=>setItemMenu(null)} items={itemMenu?[{id:'open',label:itemMenu.target.kind==='project'?'프로젝트 열기':'대화 열기',onSelect:()=>{const target=itemMenu.target;if(target.kind==='project'){const p=data.projects.find(p=>p.id===target.id);if(p)selectProject(p)}else{const s=data.sessions.find(s=>s.id===target.id);if(s)selectSession(s)}}},...(itemMenu.target.kind==='project'?[{id:'category',label:'카테고리 관리',onSelect:()=>openCategorySettings(itemMenu.target.id)}]:[]),{id:'delete',label:itemMenu.target.kind==='project'?'프로젝트 삭제…':'대화 삭제…',danger:true,disabled:itemMenu.target.kind==='session'?Boolean(activities[itemMenu.target.id]):data.sessions.some(s=>s.projectId===itemMenu.target.id&&Boolean(activities[s.id])),onSelect:()=>setDeletionTarget(itemMenu.target)},{id:'trash',label:'휴지통 열기',onSelect:()=>setTrashOpen(true)}]:[]}/>
      <ItemDeleteDialog target={deletionTarget} onClose={()=>setDeletionTarget(null)} onDeleted={reloadItems}/>
      <TrashPanel open={trashOpen} onClose={()=>setTrashOpen(false)} onRestored={reloadItems}/>

      <MotionOverlay open={musicOpen} persist onClose={()=>setMusicOpen(false)} label="뮤직" className="music-popup"><header className="utility-popup-heading"><div><Music2 size={20}/><h2>뮤직</h2></div><CloseButton aria-label="뮤직 닫기" onClick={()=>setMusicOpen(false)}/></header><MusicPanel visible={musicPresence.present} locked={security.state.locked}/></MotionOverlay>
      <AttentionCenter open={attentionOpen} onClose={()=>setAttentionOpen(false)} data={attentionState} sessions={data.sessions} requests={approvals} onOpen={selectSession} onQuestion={openQuestion} onDecisions={()=>{setAttentionOpen(false);setView(visibleProposals(proposals).length?'workflow':'inbox')}} onUpdate={openUpdateSettings} onResume={showWorkResume} onPullRequest={notification=>void openPullNotice(notification)} onRefresh={refreshAttention}/>
      {!dockPresence.present && <button type="button" className="dock-reopen-tab"
        aria-label="대화 패널 펼치기" aria-expanded={false} title="대화 패널 펼치기"
        onClick={() => setDockOpen(true)}>
        <PanelRight size={16} aria-hidden="true"/><span>대화</span>
      </button>}
      <ConversationDock revealQuestion={Boolean(focusQuestion)} dotsEligible={Boolean(connection.authenticated&&connection.dotsEligible)} onAssistant={()=>void openPersonalAssistant()} assistantNavigation={assistantNavigation} assistantContent={<DotsPanel active={dockOpen} blocked={settingsOpen||historyOpen||musicOpen||attentionOpen||Boolean(workPopup)||Boolean(deletionTarget)||trashOpen||Boolean(reportDialog)||sidebarOpen||logoutOpen}/>} projectNavigation={projectNavigation} open={dockOpen} chatActive={chatActive} expanded={chatExpanded} onExpand={()=>setChatExpanded(v=>!v)} onClose={()=>setDockOpen(false)} onLeaveChat={()=>setChatActive(false)} projects={panelProjects} categories={categories} onProjectMove={navigation.move} sessions={data.sessions} projectId={projectId} sessionId={sessionId} activities={activities} requests={approvals} proposals={proposals} counts={activeCounts} filter={dockFilter} onFilter={setDockFilter} onOpen={selectSession} onProject={()=>{}} onCreate={(scope,id)=>void startDockConversation(scope,id)} onCreateProject={()=>setView('kickoff')} onSessionMenu={(event,s)=>itemContext(event,{kind:"session",id:s.id,name:s.title})} onProjectMenu={(event,p)=>itemContext(event,{kind:"project",id:p.id,name:p.name})} attentionCount={attentionState?.notifications.filter(n=>!n.readAt).length||0} onDecisions={openDecisions} busy={creatingConversation}>{renderChat()}</ConversationDock>
      <WorkActionPopup kind={workPopup} projects={data.projects.filter(p=>!archived[p.id])} initialProject={view==="overview"?projectId:undefined} onClose={()=>setWorkPopup(null)} onStart={async(record,text,options)=>{await sendWorkRequest(record,text,record.workflow?.kind?workKinds[record.workflow.kind].mode:"plan",options)}} onOpen={selectSession}/>
      <MotionOverlay open={Boolean(reportDialog)} onClose={()=>setReportDialog(undefined)} label={reportDialog==='pause'?'업무 마감':'주간업무보고'} className="report-overlay">
        {reportDialog&&<PortfolioReports key={reportDialog} kind={reportDialog} projects={data.projects.filter(p=>!archived[p.id])} sessions={projectOnlySessions} authenticated={connection.authenticated}
          onClose={()=>setReportDialog(undefined)} onBeginPause={()=>{waitingForResume.current=false;}} onStart={(record,request,options)=>sendWorkRequest(record,request,workKinds[record.workflow!.kind].mode,options)} onOpen={record=>{setReportDialog(undefined);selectSession(record);}} onCreateProject={()=>{setReportDialog(undefined);setView('kickoff');}}/>}
      </MotionOverlay>
      <MotionOverlay open={logoutOpen} onClose={()=>setLogoutOpen(false)} label="계정 로그아웃" className="logout-overlay"><div className="pf-logout-content">
        <h2>로그아웃할까요?</h2><p>이 기기의 Codex에서 ChatGPT 계정을 로그아웃합니다. 같은 로그인 정보를 쓰는 Codex 앱과 명령줄에서도 다시 로그인해야 할 수 있습니다. 저장한 프로젝트와 대화는 보존됩니다.</p>
        <div className="pf-actions"><button className="button secondary" autoFocus onClick={()=>setLogoutOpen(false)}><X size={14} aria-hidden="true"/>취소</button><button className="button primary" onClick={()=>{setLogoutOpen(false);void security.logout().catch(fail);}}><LogOut size={14} aria-hidden="true"/>로그아웃 확인</button></div>
      </div></MotionOverlay>
      <div className="flow-notice-stack">
      <Toast message={toast.message} tone={toast.tone} revision={toast.revision} onClose={()=>setToast(old=>({...old,message:''}))}/>
      <FlowNotice {...(questionNotice && questionNotice.requestId ? {noticeId:questionNotice.requestId,tone:"question" as const,
        title:questionNotice.type==="input"?QUESTION_DECISION_NOTICE:"승인 요청이 도착했어요",
        summary:data.sessions.find(item=>item.id===questionNotice.sessionId)?.title || "답변을 기다리는 질문이 있습니다.",
        action:questionNotice.type==="input"?"대화에서 답하기":"대화에서 확인하기",onOpen:()=>openQuestion(questionNotice),onExpire:()=>dismissQuestion(questionNotice)}
        : completionNotice ? {noticeId:completionNotice.id,tone:completionNotice.kind==="error"?"error" as const:"success" as const,
          title:['update','github-pr'].includes(completionNotice.kind)?completionNotice.title:answerNoticeTitle(completionNotice,data.sessions.find(item=>item.id===completionNotice.sessionId)?.title),
          summary:noticePreview(completionNotice),action:completionNotice.kind==='github-pr'?'깃허브에서 열기':completionNotice.kind==='update'?'업데이트 열기':'대화 열기',onExpire:()=>setCompletionNotice(undefined),
          onOpen:()=>{
            const owner=data.sessions.find(item=>item.id===completionNotice.sessionId);
            if(completionNotice.kind==='github-pr'){void openPullNotice(completionNotice);setCompletionNotice(undefined);return;}
            if(completionNotice.kind==="update")openUpdateSettings();
            else if(owner)selectSession(owner);
            else setAttentionOpen(true);
            void api?.workflowAction({action:"read",ids:[completionNotice.id]}).then(refreshAttention).catch(fail);
            setCompletionNotice(undefined);
          }} : {})}/>
      <FlowNotice {...(resumeNotice?{noticeId:resumeNotice.id,tone:'success' as const,title:'업무를 다시 이어갈 시간이에요.',
        summary:`${resumeNotice.reason} 전에 남긴 업무 마감 기록을 확인할 수 있습니다.`,action:'업무 재개',onOpen:()=>{
          showWorkResume();
          if(resumeNotice.notificationId)void api?.workflowAction({action:'read',ids:[resumeNotice.notificationId]}).then(refreshAttention).catch(fail);
          setResumeNotice(undefined);
        },onExpire:()=>setResumeNotice(undefined)}:{noticeId:undefined})}/>
      </div>
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
              <CloseButton aria-label="Codex 기록 가져오기 닫기" onClick={closeCodexHistory} disabled={historySaving}/>
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
                  <X size={14} aria-hidden="true"/>취소
                </button>
                <button
                  className="button primary"
                  onClick={importCodexHistory}
                  disabled={
                    historyLoading || historySaving || !historySelected.length
                  }
                >
                  {historySaving ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : <Check size={14} aria-hidden="true"/>}
                  선택 대화 저장
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
            if (e.target === e.currentTarget) closeSettings();
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
                <span className="eyebrow">Flowrium {data.version}</span>
                <h2 id="settings-title">설정</h2>
              </div>
              <CloseButton aria-label="설정 닫기" onClick={closeSettings}/>
            </div>
            <SettingsLayout key={settingsNavigation} initialGroup={categoryTarget ? "categories" : "general"}>
              <SettingsGroup id="general"><UpdatePanel settings state={update} fail={fail}/></SettingsGroup>
              <SettingsGroup id="categories"><ProjectCategorySettings key={categoryTarget} projects={data.projects} categories={categories} initialProject={categoryTarget || projectId} onSaved={(id,category)=>{setCategories(previous=>({...previous,[id]:category}));setCategoryRevision(value=>value+1);}}/></SettingsGroup>
              <SettingsGroup id="security"><SecurityPanel security={security} accountUsage={accountUsage}/></SettingsGroup>
              <SettingsGroup id="remote"><RemotePanel/></SettingsGroup>
              <SettingsGroup id="voice"><VoiceSettings accountRevision={security.state.accountRevision} saveQueue={voiceSettingsSaveQueue}/></SettingsGroup>
              <SettingsGroup id="account"><div className="settings-section">
                <h3>
                  <Terminal size={17} />
                  Codex 연결
                </h3>
                <p>
                  기본 브라우저에서 ChatGPT 계정으로 로그인하면 Flowrium에 자동으로 연결됩니다.
                </p>
                <div className="connection-state">
                  <span
                    className={`status-dot ${accountLinked ? "online" : ""}`}
                  />
                  <span>
                    {accountLinked
                      ? connection.accountLabel || "ChatGPT 계정 연결됨"
                      : connection.authenticated
                        ? "기존 Codex 계정을 찾았습니다. 로그인 버튼으로 연결하세요."
                        : connection.available ? "로그인이 필요합니다" : "연결 확인 전"}
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
                    onKeyDown={e => {
                      if (e.key === "Enter" && !isImeKey(e.nativeEvent)) e.currentTarget.blur();
                    }}
                    onBlur={async (e) => {
                      const value = e.currentTarget.value.trim();
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
                    <option value="">계정 기본 모델</option>
                    {data.settings.model &&
                      !models.some((m) => m.id === data.settings.model) && (
                        <option value={data.settings.model}>
                          {modelDisplayName(data.settings.model)}
                        </option>
                      )}
                    {models.map((m) => (
                      <option value={m.id} key={m.id}>
                        {modelDisplayName(m)}
                      </option>
                    ))}
                  </select>
                </label>
                {!models.length && (
                  <p className="field-hint">
                    연결을 확인하면 계정에서 사용 가능한 모델을 불러옵니다.
                  </p>
                )}
                <AccountSpeedPreference speed={data.settings.speed} pro={connection.authenticated&&connection.accountPlan==='pro'} model={models.find(row=>data.settings.model?row.id===data.settings.model:row.isDefault)}
                  onChange={speed=>void saveSettings({speed})}/>
                <label className="field-label">
                  생각의 깊이
                  <select
                    className="text-input"
                    value={effectiveEffort(models.find(row=>row.id===data.settings.model)||(!data.settings.model?models.find(row=>row.isDefault):undefined),data.settings.effort)||''}
                    onChange={(e) =>
                      saveSettings({ effort: e.target.value as Effort })
                    }
                  >
                    <option value="" disabled>모델 기본값</option>
                    {effortOptions(models.find(row=>row.id===data.settings.model)||(!data.settings.model?models.find(row=>row.isDefault):undefined)).map(row=><option key={row.reasoningEffort} value={row.reasoningEffort}>{effortLabels[row.reasoningEffort]}</option>)}
                  </select>
                </label>
                <label>
                  모델로 다음 작업 추천
                  <AnimatedSwitch
                    checked={data.settings.aiFollowups === true}
                    disabled={!connection.authenticated}
                    aria-describedby="model-followups-description"
                    onChange={(event) => void saveSettings({ aiFollowups: event.target.checked })}
                  />
                </label>
                <p className="field-hint" id="model-followups-description">
                  켜면 현재 대화의 일부를 연결한 ChatGPT 계정에 보내 명령 초안을 만듭니다. 계정 사용량이나 크레딧이 차감될 수 있습니다.
                </p>
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
              <div className="settings-section appearance"><div><h3>강조색</h3><p>선택한 항목과 주요 버튼에 적용합니다.</p></div>
                <div className="segmented accent-options" role="group" aria-label="강조색">
                  {([['blue','파랑'],['green','초록'],['purple','보라']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={(data.settings.accentColor||'blue')===key} className={(data.settings.accentColor||'blue')===key?'selected':''} onClick={()=>saveSettings({accentColor:key})}><i data-swatch={key}/>{label}</button>)}
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
          </section>
        </div></ModalPortal>
      )}

    </div>
  );
}
