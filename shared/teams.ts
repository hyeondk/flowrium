import type { Mode, Session } from "./types";

export interface TeamRole {
  name: string;
  instruction: string;
  mode: Mode;
  model?: string;
  persona?: string;
}
export interface TeamInput {
  id?: string;
  revision?: string;
  name: string;
  roles: TeamRole[];
}
export interface TeamDefinition {
  id: string;
  revision: string;
  name: string;
  roles: TeamRole[];
}
export type RoleStatus = "running" | "completed" | "failed" | "interrupted";
export interface RoleResult extends TeamRole {
  status: RoleStatus;
  sessionId?: string;
  summary: string;
}
export interface TeamExecution {
  id: string;
  teamId: string;
  name: string;
  prompt: string;
  createdAt: string;
  roles: RoleResult[];
  directed?: Directed;
}
export interface TeamBoard {
  teams: TeamDefinition[];
  runs: TeamExecution[];
}
export interface TeamsAPI extends DirectedTeamsAPI {
  readTeams(projectId: string): Promise<TeamBoard>;
  saveTeam(projectId: string, input: TeamInput): Promise<TeamDefinition>;
  removeTeam(projectId: string, id: string, revision: string): Promise<void>;
  runTeam(
    projectId: string,
    teamId: string,
    prompt: string,
    requestId: string,
  ): Promise<TeamExecution>;
  openTeamRole(
    projectId: string,
    runId: string,
    index: number,
  ): Promise<Session>;
}

export type NodeState =
  | "waiting"
  | "running"
  | "question"
  | "done"
  | "failed"
  | "interrupted"
  | "stopped";
export type RunPhase =
  | "planning"
  | "draft"
  | "running"
  | "decisions"
  | "paused"
  | "stopped"
  | "review"
  | "reporting"
  | "done";
export interface TeamAssignment {
  index: number;
  title: string;
  task: string;
  steps: string[];
  targetIndex?: number;
}
export interface TeamNode extends TeamAssignment {
  status: NodeState;
  sessionId?: string;
  summary: string;
  stepsDone: number;
  tokens: number;
  progress?: { step: string; status: string }[];
  queue?: { from: string; text: string }[];
}
export interface TeamDecision {
  id: string;
  node: number;
  question: string;
  why: string;
  options: string[];
  answer?: string;
}
export interface TeamNote {
  at: string;
  from: string;
  to: string;
  type: string;
  text: string;
}
export interface DirectOptions {
  strategy: "manual" | "plan";
  assignments?: TeamAssignment[];
  isolate?: boolean;
  autoReport?: boolean;
  budget?: number;
  minutes?: number;
  attachments?: string[];
  leadModel?: string;
  decideOn?: string[];
}
export interface Directed {
  revision: number;
  strategy: "manual" | "plan";
  phase: RunPhase;
  lead: TeamNode;
  nodes: TeamNode[];
  decisions: TeamDecision[];
  notes: TeamNote[];
  isolate: boolean;
  autoReport: boolean;
  budget: number;
  minutes: number;
  tokens: number;
  attachments: string[];
  decideOn: string[];
  artifactPath?: string;
}
export type TeamChange =
  | { action: "dispatch"; assignments: TeamAssignment[] }
  | {
      action:
        | "pause"
        | "resume"
        | "stop"
        | "reopen"
        | "report"
        | "raiseLimit"
        | "finishStopped"
        | "deleteRun";
    }
  | { action: "answer"; decisionId: string; text: string }
  | { action: "instruct" | "ask" | "explain"; index: number; text?: string }
  | { action: "reassign"; index: number; toIndex: number; text: string }
  | { action: "message"; index: number; toIndex: number; text: string }
  | { action: "stopNode" | "completeNode" | "retry"; index: number };
export interface DirectedTeamsAPI {
  directTeam(
    projectId: string,
    teamId: string,
    prompt: string,
    requestId: string,
    options: DirectOptions,
  ): Promise<TeamExecution>;
  changeTeamRun(
    projectId: string,
    runId: string,
    change: TeamChange,
    revision: number,
  ): Promise<TeamExecution>;
  openTeamNode(
    projectId: string,
    runId: string,
    index: number,
  ): Promise<Session>;
}
