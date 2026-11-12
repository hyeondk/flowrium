import type { Mode, Session } from "./types";

export interface TeamRole { name: string; instruction: string; mode: Mode }
export interface TeamInput { id?: string; revision?: string; name: string; roles: TeamRole[] }
export interface TeamDefinition { id: string; revision: string; name: string; roles: TeamRole[] }
export type RoleStatus = "running" | "completed" | "failed" | "interrupted";
export interface RoleResult extends TeamRole {
  status: RoleStatus; sessionId?: string; summary: string;
}
export interface TeamExecution {
  id: string; teamId: string; name: string; prompt: string; createdAt: string; roles: RoleResult[];
}
export interface TeamBoard { teams: TeamDefinition[]; runs: TeamExecution[] }
export interface TeamsAPI {
  readTeams(projectId: string): Promise<TeamBoard>;
  saveTeam(projectId: string, input: TeamInput): Promise<TeamDefinition>;
  removeTeam(projectId: string, id: string, revision: string): Promise<void>;
  runTeam(projectId: string, teamId: string, prompt: string, requestId: string): Promise<TeamExecution>;
  openTeamRole(projectId: string, runId: string, index: number): Promise<Session>;
}
