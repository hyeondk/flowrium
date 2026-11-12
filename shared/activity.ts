export interface SystemActivity {
  cpuPercent: number | null;
  logicalCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  measuredAt: string;
}
export interface ActivityAPI {
  readSystemActivity(): Promise<SystemActivity>;
}
