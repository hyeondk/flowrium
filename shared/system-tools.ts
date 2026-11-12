export interface SystemProcess {
  pid: number;
  name: string;
  cpu: number | null;
  memoryBytes: number;
}
export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
}
export interface ServiceInfo {
  id: string;
  projectId: string;
  script: string;
  state: "running" | "done";
  code: number | null;
  output: string;
}
export interface SystemToolsAPI {
  systemProcesses(): Promise<SystemProcess[]>;
  stopSystemProcess(pid: number): Promise<void>;
  dockerContainers(): Promise<{
    available: boolean;
    message?: string;
    containers: ContainerInfo[];
  }>;
  controlContainer(
    id: string,
    action: "start" | "stop" | "restart",
  ): Promise<void>;
  projectScripts(projectId: string): Promise<string[]>;
  listServices(): Promise<ServiceInfo[]>;
  runService(projectId: string, script: string): Promise<ServiceInfo>;
  stopService(id: string): Promise<void>;
}
