import type { Kickoff } from "./portfolio";

export interface ProjectRepository { sourceProjectId?:string; id: string; name: string; path: string; github: string; account: string; base: string; hidden?: boolean }
export interface ProjectService { id:string; name:string; cwd:string; command:string }
export interface ProjectSchedule { id: string; day: number; time: string; text: string }
export interface PeriodGoal { id: string; period: "week" | "month"; key: string; text: string; done: boolean; parent?: string; target?: number; current?: number; due?: string; carriedFrom?: string; carriedTo?: string }
export interface ProjectShortcut {id:string;kind:'operation'|'local'|'drive';label:string;target:string;localMode?:'relative'|'absolute';disabled?:boolean}
export interface ProjectDetails {
  shortcuts?:ProjectShortcut[];
  repositories?: ProjectRepository[];
  services?: ProjectService[];
  chatCwd?: string;
  schedule?: ProjectSchedule[];
  kickoff?: Kickoff;
  periodGoals?: PeriodGoal[];
  projectId: string;
  revision: string | null;
  owner: string;
  goal: string;
  dueDate: string;
  archivedAt: string | null;
  checklist: { id: string; text: string; done: boolean }[];
}
export type ProjectChange =
  | { action: "goal-add"; period: "week" | "month"; key: string; text: string; parent?: string; target?: number; due?: string }
  | { action: "goal-progress"; id: string; current: number }
  | { action: "goal-carry"; id: string; key: string }
  | { action: "schedule"; entries: ProjectSchedule[] }
  | { action: "repositories"; repositories: ProjectRepository[]; chatCwd: string; services?:ProjectService[] }
  | { action: "repository-hide"; id: string; hidden: boolean }
  | { action: "phase"; phase: string; name?: string }
  | { action: "goal-check"; id: string; done: boolean }
  | { action: "goal-remove"; id: string }
  | { action: "details"; owner: string; goal: string; dueDate: string }
  | { action: "archive" | "resume" }
  | { action: "add"; text: string }
  | { action: "check"; id: string; done: boolean }
  | { action: "remove"; id: string };
export interface ProjectDetailsAPI {
  projectShortcutAction(projectId:string,input:{action:'chooseLocal'}):Promise<ProjectShortcut|null>;
  projectShortcutAction(projectId:string,input:{action:'open';id:string}):Promise<{opened:boolean}>;
  projectShortcutAction(projectId:string,input:{action:'save';revision:string|null;shortcuts:ProjectShortcut[]}):Promise<ProjectDetails>;
  readProjectDetails(projectId: string): Promise<ProjectDetails>;
  updateProjectDetails(
    projectId: string,
    revision: string | null,
    change: ProjectChange,
  ): Promise<ProjectDetails>;
}

export type RepositoryAccessState='local'|'authorized'|'needs-selection'|'missing-source'|'account-required'|'moved'|'unavailable';
export interface RepositoryAccessSnapshot {
 sources:{id:string;name:string;path:string}[];
 repositories?:{repositoryId:string;sourceProjectId?:string;access:RepositoryAccessState;message:string}[];
}
export interface ExternalRepositoryAPI {
 repositoryAccessAction(projectId:string,input:{action:'sources'}|{action:'status';repositories:ProjectRepository[]}):Promise<RepositoryAccessSnapshot>;
 repositoryAccessAction(projectId:string,input:{action:'authorize'|'revoke';repositoryId:string;sourceProjectId:string}):Promise<{authorized?:boolean;revoked?:boolean;sourceProjectId?:string}|null>;
}
