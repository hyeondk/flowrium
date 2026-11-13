export type VoiceServerId = 'recognition' | 'synthesis';
export type VoiceServerPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed' | 'external';
export interface VoiceServerConfig {
  id: VoiceServerId;
  command: string;
  args: string[];
  cwd: string;
  endpoint: string;
  healthPath: string;
  startupTimeoutMs: number;
  environmentNames: string[];
}
export interface VoiceServerRun {
  id: VoiceServerId;
  phase: VoiceServerPhase;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  message: string;
  logs: { at: string; stream: 'stdout' | 'stderr' | 'system'; text: string }[];
}
export interface VoiceServersState {
  revision: number;
  servers: { config: VoiceServerConfig; run: VoiceServerRun }[];
}
export interface VoiceServerPreview {
  id: VoiceServerId;
  token: string;
  expiresAt: string;
  command: string;
  args: string[];
  cwd: string;
  endpoint: string;
  healthPath: string;
  environmentNames: string[];
  notice: string;
}
export interface VoiceServerAPI {
  voiceServersState(): Promise<VoiceServersState>;
  configureVoiceServer(input: { id: VoiceServerId; revision: number; config: Omit<VoiceServerConfig, 'id' | 'environmentNames'>; environment?: Record<string, string> }): Promise<VoiceServersState>;
  previewVoiceServer(id: VoiceServerId): Promise<VoiceServerPreview>;
  voiceServerAction(input: { id: VoiceServerId; action: 'start' | 'stop' | 'restart' | 'probe' | 'clearLogs'; token?: string }): Promise<VoiceServersState>;
  chooseVoiceServerPath(kind: 'directory' | 'executable'): Promise<string | null>;
}
