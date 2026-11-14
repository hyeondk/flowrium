import definitions from "../electron/work-kinds.json";
import type { Mode, Session, Effort } from "./types";

export type WorkKind = keyof typeof definitions;
export const workKinds = definitions as Record<
  WorkKind,
  {
    label: string;
    mode: Mode;
    role: string;
    description: string;
    instruction: string;
  }
>;
export type WorkStatus = "active" | "review" | "done";
export const statusLabels: Record<WorkStatus, string> = {
  active: "진행 중",
  review: "검토 중",
  done: "완료",
};
export type ResearchSearch = "live" | "cached" | "disabled";
export interface WorkInput {
  model?:string;
  effort?:Effort;
  searchMode?: ResearchSearch;
  researchDepth?: "quick" | "standard" | "deep";
  documentKind?: "report" | "slides";
  slideCount?: number;
  reportProjects?: string[];
  projectId: string;
  kind: WorkKind;
  title: string;
  brief: string;
  role: string;
  audience: string;
  from: string;
  to: string;
  sourceSessionId?: string;
}
export interface WorkCommit {
  hash: string;
  at: string;
  subject: string;
}
export interface Workflow {
  searchMode?: ResearchSearch;
  researchDepth?: "quick" | "standard" | "deep";
  documentKind?: "report" | "slides";
  slideCount?: number;
  reportProjects?: string[];
  kind: WorkKind;
  role: string;
  brief: string;
  audience: string;
  from: string;
  to: string;
  status: WorkStatus;
  checklist: { id: string; text: string; done: boolean }[];
  teamSlot?: { runId: string; index: number; mode?: Mode; isolated?: boolean; integration?: boolean };
  source?: { sessionId: string; title: string; summary: string };
  completion?: { at: string; summary: string; commits: WorkCommit[]; repositoryFlowId?: string };
}
export type WorkFormat = "md" | "html" | "pdf" | "pptx";
export interface Artifact {
  existing?: boolean;
  path: string;
  size: number;
  modifiedAt: string;
  sessionId?: string;
  preview: boolean;
}
export interface GitOverview {
  available: boolean;
  reason?: string;
  branch: string;
  changes: { code: string; path: string }[];
  commits: WorkCommit[];
  limited: boolean;
}
export interface WorkOverview {
  artifacts: Artifact[];
  truncated: boolean;
  git: GitOverview;
}
export type WorkUpdate =
  | { action: "status"; status: WorkStatus }
  | { action: "add"; text: string }
  | { action: "toggle"; id: string }
  | { action: "remove"; id: string };
export interface WorkbenchAPI {
  readWorkbench(projectId: string): Promise<WorkOverview>;
  startWork(input: WorkInput): Promise<Session>;
  updateWork(id: string, change: WorkUpdate): Promise<Session>;
  saveWorkArtifact(
    sessionId: string,
    messageId: string,
    format?: WorkFormat,
  ): Promise<Artifact>;
  importWorkFiles(
    projectId: string,
    files: { name: string; body: Uint8Array }[],
  ): Promise<{
    added: Artifact[];
    skipped: { name: string; reason: string }[];
  }>;
  readWorkArtifact(projectId: string, path: string): Promise<string>;
  revealWorkArtifact(projectId: string, path: string): Promise<void>;
}

export interface WorkbenchAPI { artifactAction(projectId:string,input:any):Promise<any> }
