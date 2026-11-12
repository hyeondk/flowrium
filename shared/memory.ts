import type { Session } from "./types";
export type MemoryScope = "project" | "personal";
export interface MemoryNote {
  id: string;
  rev: string;
  at: string;
  title: string;
  body: string;
  role: string;
  link: string;
  linked: boolean;
  deleted: boolean;
  scope: MemoryScope;
}
type MemoryChange = {
  id?: string;
  revision: string | null;
  scope: MemoryScope;
} & (
  | {
      action: "save";
      title: string;
      body: string;
      role: string;
      link: string;
      linked: boolean;
    }
  | { action: "delete" }
  | { action: "restore"; target: string }
);
export interface MemoryAPI {
  listMemory(projectId: string): Promise<MemoryNote[]>;
  memoryVersions(
    projectId: string,
    scope: MemoryScope,
    id: string,
  ): Promise<MemoryNote[]>;
  changeMemory(projectId: string, input: MemoryChange): Promise<MemoryNote>;
  assistantHome(): Promise<{
    projectId: string | null;
    connected: boolean;
    sessionId: string | null;
  }>;
  openAssistant(selected?: string): Promise<Session>;
}
