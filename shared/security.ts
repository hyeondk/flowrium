import type { FlowriumEvent, Mode } from "./types";

export interface SecurityPreferences {
  idleMinutes: number;
  lockAfterPause: boolean;
  lockOnSuspend: boolean;
  notifyApproval: boolean;
  notifyDone: boolean;
  preventSleep: boolean;
}
export interface SecurityState {
  loaded: boolean;
  locked: boolean;
  hasPin: boolean;
  retryAt: number;
  reason: string;
  accountRevision: number;
  preferences?: SecurityPreferences;
}
export interface UsageSnapshot {
  checkedAt: number;
  allowed: boolean | null;
  buckets: {
    name: string;
    plan: string | null;
    credits?: { unlimited: boolean; balance: string | null };
    windows: {
      key: string;
      usedPercent: number;
      minutes: number | null;
      resetsAt: number | null;
    }[];
  }[];
}
export type ComposerDraft = { text: string; mode: Mode };
export interface SecurityAPI {
  readDrafts(revision: number): Promise<Record<string, ComposerDraft>>;
  writeDrafts(
    revision: number,
    patch: Record<string, ComposerDraft | null>,
  ): Promise<void>;
  securityState(): Promise<SecurityState>;
  lockSecurity(): Promise<SecurityState>;
  unlockSecurity(pin: string): Promise<SecurityState>;
  setSecurityPin(current: string, next: string | null): Promise<SecurityState>;
  setSecurityPreferences(
    prefs: Partial<SecurityPreferences>,
  ): Promise<SecurityState>;
  securityPending(): Promise<FlowriumEvent[]>;
  readAccountUsage(): Promise<UsageSnapshot>;
  logoutSecurity(): Promise<SecurityState>;
  onSecurity(callback: (state: SecurityState) => void): () => void;
}
