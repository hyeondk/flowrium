export interface RemoteAccess {
  enabled: boolean;
  url?: string;
  localUrl?: string;
  message?: string;
}
export interface RemoteAPI extends WebPushAPI {
  remoteAccess(): Promise<RemoteAccess>;
  startRemoteAccess(): Promise<RemoteAccess>;
  stopRemoteAccess(): Promise<RemoteAccess>;
}
export type PushKind="decision"|"done"|"error"|"report"|"reminder"|"message";
export interface PushDevice {id:string;label:string;kinds:PushKind[];createdAt:string;lastSentAt?:string;lastError?:string}
export interface WebPushState {available:boolean;enabled:boolean;kinds:PushKind[];devices:PushDevice[];message?:string}
export type WebPushAction =
 |{action:"prepare"}
 |{action:"subscribe";subscription:{endpoint:string;keys:{p256dh:string;auth:string}};label:string;kinds:PushKind[]}
 |{action:"unsubscribe"|"test";id:string}
 |{action:"preferences";id:string;kinds:PushKind[]};
export interface WebPushAPI {
 webPushState():Promise<WebPushState>;
 webPushAction(input:WebPushAction):Promise<{id?:string;publicKey?:string;sent?:boolean;saved?:boolean;removed?:boolean;kinds?:PushKind[]}>;
}
