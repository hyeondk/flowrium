import type {CodexTransferAPI,CodexTransferLink} from "./codex-transfer";
import type {TrashAPI} from './trash';
import type { DotsAPI } from "./dots";
import type { MigrationAPI } from "./migration";
import type { ProjectPortsAPI } from "./project-ports";
import type { VoiceServerAPI } from "./voice-server";
import type { WorkflowAPI } from "./workflow";
import type { MemoryAPI } from "./memory";
import type { VoiceAPI } from "./voice";
import type { RemoteAPI } from "./remote";
import type { SystemToolsAPI } from "./system-tools";
import type { SecurityAPI } from "./security";
import type { IntegrationAPI } from "./integrations";
import type { MusicAPI } from "./music";
import type { TeamWorktreesAPI } from "./team-worktrees";
import type { PortfolioAPI } from "./portfolio";
import type { TerminalAPI } from "./terminal";
import type { ActivityAPI } from "./activity";
import type { ExternalRepositoryAPI, ProjectDetailsAPI } from "./project-details";
import type { TeamsAPI } from "./teams";
import type { RepositoryAPI } from "./repository";
import type { WorkbenchAPI, Workflow } from "./workbench";
export interface ChatPreferences {
  model?: string;
  effort?: Effort;
  speed?: Speed;
  chatGptUrl?: string;
  answerLength?: "short" | "normal" | "detailed";
  testing?: boolean;
  askNext?: boolean;
  autoCompact?: boolean;
  compactAt?: number;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approval?: "on-request" | "never";
  networkAccess?: boolean;
}
export type ConversationEdit =
  | { action: "preferences"; preferences: ChatPreferences }
  | { action: "model"; model: string; effort?: Effort | ""; speed?: Speed | "" }
  | { action: "rename"; title: string }
  | { action: "branch"; messageId?: string }
  | { action: "rewind"; messageId: string }
  | { action: "compact" };
export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installing"
    | "error"
    | "unsupported";
  currentVersion: string;
  latestVersion?: string;
  launchFailed?: boolean;
  progress?: number;
  message: string;
}
export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type Speed = "standard" | "fast" | "ultrafast";
export type Mode = "plan" | "build" | "review";
export type ConversationScope = "general" | "integrated";
export interface Project {
  trustedForFileAccess?: boolean;
  conversationScope?: ConversationScope;
  id: string;
  name: string;
  path: string;
  createdAt: string;
}
export interface ChatAttachment {id:string;name:string;type:string;size:number;sha256:string}
export interface QueuedMessage {id:string;text:string;mode:Mode;model?:string|null;effort?:Effort;speed?:Speed;attachments:ChatAttachment[];createdAt:string;status:"queued"|"sending"|"sent"|"cancelled";owner:string;sentAt?:string;waitingForWriter?:boolean;branchSessionId?:string;error?:string;nativeQueueAvailable?:boolean;nativeDelivery?:'submitting'|'queued'|'uncertain';nativeCleared?:boolean}
export interface Message {
  workStartedAt?: string;
  workCompletedAt?: string;
  progressCommentary?: true;
  workSteps?: WorkStep[];
  reaction?: 'like';
  requestSource?: ChatAttachment;
  sourceOnly?: boolean;
  delegated?: true;
  attachments?: ChatAttachment[];
  turnId?: string;
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}
export interface WorkStep {
  completedAt?: string;
  id: string;
  label: string;
  state: "running" | "completed" | "failed" | "interrupted";
  createdAt: string;
}
export interface Session {
  defaultProjectMode?: "build";
  desktopThread?: {threadId:string;cwd:string;ownerHash:string};
  codexLink?:CodexTransferLink;
  scope?: ConversationScope;
  restoredDraft?:{text:string;attachments:ChatAttachment[]};
  personalAssistant?: true;
  generalAssistant?: true;
  id: string;
  projectId: string;
  title: string;
  threadId?: string;
  sourceThreadId?: string;
  workflow?: Workflow;
  preferences?: ChatPreferences;
  messages: Message[];
  completedContinuationId?: string;
  queuedMessages?: QueuedMessage[];
  context?: {used:number;total:number;max:number;percent:number;updatedAt:string};
  compacting?: boolean;
  applicationTools?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CodexHistoryEntry {
  id: string;
  title: string;
  updatedAt: string;
  imported: boolean;
}
export interface Settings {
  chatDefaults?: ChatPreferences;
  codexPath?: string;
  model?: string;
  effort: Effort;
  speed?: Speed;
  theme: "dark" | "light";
  accentColor?: "blue" | "green" | "purple";
}
export interface ConnectionStatus {
  available: boolean;
  authenticated: boolean;
  accountLabel?: string;
  dotsEligible?: boolean;
  cliPath?: string;
  error?: string;
}
export interface Model {
  supportedReasoningEfforts?: {reasoningEffort:Effort;description?:string}[];
  defaultReasoningEffort?:Effort;
  supportedSpeeds?: Speed[];
  isDefault?:boolean;
  id: string;
  displayName: string;
  description?: string;
}
export interface InputQuestion {
  id: string; header: string; question: string; options: { label: string; description: string }[];
  isOther: boolean; isSecret: boolean;
}
export type InputAnswers = Record<string, { answers: string[] }>;
export interface FlowriumEvent {
  workProgress?: {messageId: string; step: WorkStep};
  questions?: InputQuestion[];
  isBlocking?: boolean;
  projectsChanged?: boolean;
  restoredProjectIds?: string[];
  removedSessionIds?: string[];
  restoredSessions?: Session[];
  turnId?: string;
  turnMessages?: Message[];
  type: "externalTurn" | "sessionList" | "delta" | "status" | "error" | "done" | "approval" | "session" | "input" | "inputResolved";
  sessionId?: string;
  text?: string;
  status?: string;
  requestId?: string;
  method?: string;
  details?: string;
  session?: Session;
}
export interface Bootstrap {
  externalActivity?: Record<string,'running'|'pending'>;
  conversationProjects?: Project[];
  projects: Project[];
  sessions: Session[];
  settings: Settings;
  version: string;
  platform: string;
}
export interface FlowriumAPI
  extends
    DotsAPI,
    ExternalRepositoryAPI,
    TrashAPI,
    CodexTransferAPI,
    MigrationAPI,
    ProjectPortsAPI,
    VoiceServerAPI,
    WorkflowAPI,
    MemoryAPI,
    VoiceAPI,
    RemoteAPI,
    SystemToolsAPI,
    SecurityAPI,
    IntegrationAPI,
    MusicAPI,
    TeamWorktreesAPI,
    PortfolioAPI,
    WorkbenchAPI,
    RepositoryAPI,
    TeamsAPI,
    ProjectDetailsAPI,
    ActivityAPI,
    TerminalAPI {
  reactMessage(input:{sessionId:string;messageId:string;liked:boolean}):Promise<Session>;
  openGeneralAssistant():Promise<Session>;
  createHubConversation(input:{scope:ConversationScope;title?:string}):Promise<Session>;
  listHubConversations():Promise<{projects:Project[];sessions:Session[]}>;
  addChatAttachments(projectId:string,files:{name:string;type:string;bytes:Uint8Array}[]):Promise<ChatAttachment[]>;
  readRequestSource(sessionId:string,messageId:string,offset:number|"full"):Promise<{text:string;next:number|null}>;
  copyRequestSource(sessionId:string,messageId:string):Promise<void>;
  readChatCitation(session:string,message:string,index:number,action:'preview'|'download'|'reveal'):Promise<{name:string;dataUrl?:string}>;
  readChatAttachment(projectId:string,id:string):Promise<{attachment:ChatAttachment;dataUrl?:string}>;
  listQueuedMessages(sessionId:string):Promise<QueuedMessage[]>;
  cancelQueuedMessage(sessionId:string,id:string):Promise<void>;
  startQueuedBranch(sessionId:string,id:string):Promise<{session:Session}>;
  sendQueuedToCodex(sessionId:string,id:string):Promise<{accepted:boolean;queued:boolean;queueId:string;nativeDelivery?:QueuedMessage['nativeDelivery']}>;
  clearUnconfirmedCodexQueue(sessionId:string,id:string):Promise<unknown>;
  resumeQueuedMessages(sessionId:string):Promise<void>;
  openSessionChatGPT(id: string): Promise<void>;
  editConversation(id: string, input: ConversationEdit): Promise<Session>;
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  bootstrap(): Promise<Bootstrap>;
  chooseProject(): Promise<Project | null>;
  requestProjectTrust(projectId: string): Promise<boolean>;
  createSession(projectId: string, model?: string): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  connectionStatus(): Promise<ConnectionStatus>;
  listAvailableModels():ReturnType<FlowriumAPI['connect']>;
  connect(): Promise<{
    modelAccount?:string;
    status: ConnectionStatus;
    models: Model[];
    accountLabel?: string;
  }>;
  login(): Promise<{ authUrl?: string }>;
  send(input: {
    delivery?: "steer";
    submissionId?:string;
    sessionId: string;
    text: string;
    attachments?: string[];
    mode: Mode;
    model?: string;
    effort?: Effort;
    speed?: Speed;
  }): Promise<{ accepted: boolean; steered?: boolean; queued?: boolean; waitingForWriter?:boolean; queueId?:string }>;
  interrupt(sessionId: string): Promise<void>;
  answerInput(input: { requestId: string; answers: InputAnswers }): Promise<void>;
  approval(input: {
    requestId: string;
    decision: "accept" | "decline";
  }): Promise<void>;
  openExternal(
    target: "chatgpt" | "codex-docs" | "download-docs" | "downloads",
  ): Promise<void>;
  copyText(text: string): Promise<void>;
  openProject(id: string): Promise<void>;
  exportSession(id: string): Promise<boolean>;
  listCodexHistory(projectId: string): Promise<CodexHistoryEntry[]>;
  importCodexHistory(
    projectId: string,
    ids: string[],
  ): Promise<{ imported: number; skipped: number }>;
  onEvent(callback: (event: FlowriumEvent) => void): () => void;
}
declare global {
  interface Window {
    flowrium?: FlowriumAPI;
  }
}
