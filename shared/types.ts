import type { ActivityAPI } from "./activity";
import type { ProjectDetailsAPI } from "./project-details";
import type { TeamsAPI } from "./teams";
import type { RepositoryAPI } from "./repository";
import type { WorkbenchAPI, Workflow } from "./workbench";
export type ConversationEdit = { action: "rename"; title: string } | { action: "branch"; messageId?: string } | { action: "rewind"; messageId: string } | { action: "compact" };
export interface UpdateState {
  status: "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error" | "unsupported";
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  message: string;
}
export type Effort = "low" | "medium" | "high";
export type Mode = "plan" | "build" | "review";
export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}
export interface Session {
  id: string;
  projectId: string;
  title: string;
  threadId?: string;
  sourceThreadId?: string;
  workflow?: Workflow;
  messages: Message[];
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
  codexPath?: string;
  model?: string;
  effort: Effort;
  theme: "dark" | "light";
}
export interface ConnectionStatus {
  available: boolean;
  authenticated: boolean;
  accountLabel?: string;
  cliPath?: string;
  error?: string;
}
export interface Model {
  id: string;
  displayName: string;
  description?: string;
}
export interface FlowriumEvent {
  type: "delta" | "status" | "error" | "done" | "approval" | "session";
  sessionId?: string;
  text?: string;
  status?: string;
  requestId?: string;
  method?: string;
  details?: string;
  session?: Session;
}
export interface Bootstrap {
  projects: Project[];
  sessions: Session[];
  settings: Settings;
  version: string;
  platform: string;
}
export interface FlowriumAPI extends WorkbenchAPI, RepositoryAPI, TeamsAPI, ProjectDetailsAPI, ActivityAPI {
  editConversation(id: string, input: ConversationEdit): Promise<Session>;
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  bootstrap(): Promise<Bootstrap>;
  chooseProject(): Promise<Project | null>;
  createSession(projectId: string): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  connectionStatus(): Promise<ConnectionStatus>;
  connect(): Promise<{
    status: ConnectionStatus;
    models: Model[];
    accountLabel?: string;
  }>;
  login(): Promise<{ authUrl?: string }>;
  send(input: {
    sessionId: string;
    text: string;
    mode: Mode;
    model?: string;
    effort?: Effort;
  }): Promise<{ accepted: boolean }>;
  interrupt(sessionId: string): Promise<void>;
  approval(input: {
    requestId: string;
    decision: "accept" | "decline";
  }): Promise<void>;
  openExternal(
    target: "chatgpt" | "codex-docs" | "download-docs",
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
