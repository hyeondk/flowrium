export interface RemoteAccess {
  enabled: boolean;
  url?: string;
  localUrl?: string;
  message?: string;
}
export interface RemoteAPI {
  remoteAccess(): Promise<RemoteAccess>;
  startRemoteAccess(): Promise<RemoteAccess>;
  stopRemoteAccess(): Promise<RemoteAccess>;
}
