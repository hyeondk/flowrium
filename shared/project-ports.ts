export type ProjectPortRole = 'web' | 'admin' | 'api' | 'db' | 'aux';
export type ProjectPortValues = Record<ProjectPortRole, number>;
export interface ProjectPortAssignment {
  projectId: string;
  revision: string | null;
  enabled: boolean;
  number: number | null;
  mode: 'automatic' | 'custom';
  ports: ProjectPortValues | null;
  updatedAt: string | null;
}
export interface ProjectPortCheck {
  role: ProjectPortRole;
  port: number;
  status: 'free' | 'listening' | 'unavailable';
  families: { family: 'IPv4' | 'IPv6'; status: 'free' | 'listening' | 'unavailable' | 'unsupported'; code?: string }[];
}
export interface ProjectPortConflict {
  kind: 'number' | 'port' | 'reserved';
  role?: ProjectPortRole;
  port?: number;
  projectId?: string;
  projectName?: string;
}
export interface ProjectPortsState extends ProjectPortAssignment {
  checks: ProjectPortCheck[];
  checkedAt: string;
  conflicts: ProjectPortConflict[];
  projects: (ProjectPortAssignment & { name: string })[];
  reservations: { revision: string | null; ports: number[] };
  warnings: string[];
}
export type ProjectPortsInput =
  | { action: 'check' }
  | { action: 'allocate' | 'reallocate' | 'release'; revision: string | null }
  | { action: 'save'; revision: string | null; number: number; ports: ProjectPortValues; allowListening?: boolean }
  | { action: 'reservations'; revision: string | null; ports: number[] }
  | { action: 'import'; revision: string | null; number: number; ports?: ProjectPortValues; allowListening?: boolean };
export interface ProjectPortsAPI {
  readProjectPorts(projectId: string): Promise<ProjectPortsState>;
  projectPortsAction(projectId: string, input: ProjectPortsInput): Promise<ProjectPortsState>;
}
