import type { Project } from "./types";
import type { ProjectDetails } from "./project-details";

export type PortfolioView =
  | "dashboard"
  | "kickoff"
  | "archive"
  | "outputs"
  | "timeline";
export type ProjectTab =
  | "home"
  | "work"
  | "team"
  | "github"
  | "rules"
  | "design"
  | "meetings"
  | "docs"
  | "settings";
export type NoteKind = "rules" | "design" | "meetings";
export interface Kickoff {
  name: string;
  category: string;
  phase: string;
  privacy: string;
  client: string;
  owner: string;
  members: string;
  goal: string;
  startedAt: string;
  dueDate: string;
  repository: string;
  notes: string;
}
export interface KickoffInput extends Kickoff {
  createFolder?: boolean;
  clone?: boolean;
  scaffold?: boolean;
}
export interface PortfolioCard {
  project: Project;
  details: ProjectDetails | null;
  error?: string;
}
export interface ProjectNote {
  path: string;
  modifiedAt: string;
  size: number;
  preview: boolean;
}
export interface PortfolioAPI {
  readPortfolio(): Promise<PortfolioCard[]>;
  kickoffProject(input: KickoffInput): Promise<Project | null>;
  setKickoffDetails(
    projectId: string,
    revision: string | null,
    input: Kickoff,
  ): Promise<ProjectDetails>;
  listProjectNotes(projectId: string, kind: NoteKind): Promise<ProjectNote[]>;
  readProjectNote(
    projectId: string,
    kind: NoteKind,
    path: string,
  ): Promise<string>;
  createProjectNote(
    projectId: string,
    kind: NoteKind,
    title: string,
    text: string,
  ): Promise<ProjectNote>;
  revealProjectNote(
    projectId: string,
    kind: NoteKind,
    path: string,
  ): Promise<void>;
}
