import type {Session} from './types';
export type CodexTransferMode='linked'|'copy';
export interface CodexProjectInput {key?:string;name:string;path:string;threadIds?:string[]}
export interface CodexTransferEntry {threadId:string;projectKey:string;projectName:string;title:string;createdAt:string;updatedAt:string;messages:number;items:number;attachments:number;bytes:number;active:boolean;imported:boolean;error?:string;warnings:string[]}
export interface CodexTransferPlan {id:string;createdAt:string;projects:{key:string;name:string;path:string;threads:number}[];entries:CodexTransferEntry[];warnings:string[]}
export interface CodexTransferResult {id:string;at:string;mode:CodexTransferMode;imported:number;updated:number;skipped:number;failed:number;entries:{threadId:string;sessionId?:string;projectId?:string;status:'imported'|'updated'|'skipped'|'failed';error?:string}[];warnings:string[];attachments?:{copied:number;recovered:number;missing:number}}
export interface CodexTransferLink {version:1;mode:CodexTransferMode;sourceThreadId:string;ownerHash:string;deviceHash:string;importedAt:string;sourceUpdatedAt:string;snapshotHash:string;archivePath:string;activeAtImport:boolean;sourceMessageIds:string[]}
export type CodexTransferAction=
 |{action:'status'|'receipts'}
 |{action:'preview';projects?:CodexProjectInput[];activeThreadIds?:string[]}
 |{action:'apply';planId:string;threadIds?:string[];mode?:CodexTransferMode;retryAttachments?:boolean}
 |{action:'refresh';sessionId:string;externalFinished?:boolean;background?:boolean}
 |{action:'readOriginal';receiptId:string;threadId:string};
export interface CodexTransferAPI {codexTransferAction(input:CodexTransferAction):Promise<CodexTransferPlan|CodexTransferResult|CodexTransferResult[]|Session|{busy:boolean;plans:number;linked:number;copies:number}|{text:string;sha256:string}>}
