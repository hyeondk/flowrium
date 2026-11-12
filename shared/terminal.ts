export interface TerminalSession { id: string; projectId: string; title: string; startDir: string; closed: boolean; exitCode: number | null }
export interface TerminalChunk { data: string; offset: number; truncated: boolean; closed: boolean; exitCode: number | null }
export interface TerminalAPI {
  terminalList(projectId: string): Promise<TerminalSession[]>;
  terminalOpen(projectId: string): Promise<TerminalSession>;
  terminalRead(projectId: string, id: string, offset: number): Promise<TerminalChunk>;
  terminalWrite(projectId: string, id: string, data: string): Promise<void>;
  terminalResize(projectId: string, id: string, columns: number, rows: number): Promise<void>;
  terminalClose(projectId: string, id: string): Promise<void>;
}
