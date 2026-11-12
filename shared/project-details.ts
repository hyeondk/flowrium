export interface ProjectDetails {
  projectId: string;
  revision: string | null;
  owner: string;
  goal: string;
  dueDate: string;
  archivedAt: string | null;
  checklist: { id: string; text: string; done: boolean }[];
}
export type ProjectChange =
  | { action: "details"; owner: string; goal: string; dueDate: string }
  | { action: "archive" | "resume" }
  | { action: "add"; text: string }
  | { action: "check"; id: string; done: boolean }
  | { action: "remove"; id: string };
export interface ProjectDetailsAPI {
  readProjectDetails(projectId: string): Promise<ProjectDetails>;
  updateProjectDetails(projectId: string, revision: string | null, change: ProjectChange): Promise<ProjectDetails>;
}
