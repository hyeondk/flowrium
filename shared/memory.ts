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
  exportMemory(projectId: string): Promise<MemoryBundle>;
  previewMemoryImport(projectId: string, bundle: unknown, scope: MemoryScope): Promise<MemoryImportPlan>;
  applyMemoryImport(projectId: string, planId: string, keys: string[]): Promise<{notes: MemoryNote[];backups:number}>;
  moveMemory(projectId: string, input:{id:string;scope:MemoryScope;revision:string;to:MemoryScope}): Promise<{note:MemoryNote;sourceRetained:boolean;notice?:string}>;
  assistantHome(): Promise<{
    projectId: string | null;
    connected: boolean;
    sessionId: string | null;
  }>;
  openAssistant(selected?: string): Promise<Session>;
}
export interface MemoryBundle {
  format:"flowrium-memory";
  version:1;
  createdAt:string;
  notes:(MemoryNote&{history:MemoryNote[]})[];
}
export interface MemoryImportPlan {
  id:string;
  entries:{key:string;title:string;scope:MemoryScope;action:"create"|"update";body:string;previous:string}[];
}
