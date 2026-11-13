import type { Kickoff } from "./portfolio";

export interface ProjectRepository { id: string; name: string; path: string; github: string; account: string; base: string; hidden?: boolean }
export interface ProjectService { id:string; name:string; cwd:string; command:string }
export interface ProjectSchedule { id: string; day: number; time: string; text: string }
export interface PeriodGoal { id: string; period: "week" | "month"; key: string; text: string; done: boolean; parent?: string; target?: number; current?: number; due?: string; carriedFrom?: string; carriedTo?: string }
export interface ProjectDetails {
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
  readProjectDetails(projectId: string): Promise<ProjectDetails>;
  updateProjectDetails(
    projectId: string,
    revision: string | null,
    change: ProjectChange,
  ): Promise<ProjectDetails>;
}
