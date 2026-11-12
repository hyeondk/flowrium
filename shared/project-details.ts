import type { Kickoff } from "./portfolio";

export interface ProjectDetails {
  kickoff?: Kickoff;
  periodGoals?: {
    id: string;
    period: "week" | "month";
    key: string;
    text: string;
    done: boolean;
  }[];
  projectId: string;
  revision: string | null;
  owner: string;
  goal: string;
  dueDate: string;
  archivedAt: string | null;
  checklist: { id: string; text: string; done: boolean }[];
}
export type ProjectChange =
  | { action: "goal-add"; period: "week" | "month"; key: string; text: string }
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
