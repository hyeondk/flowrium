export type TrashKind='session'|'project';
export type TrashNativeMode='keep'|'archive'|'delete';
export interface NativeDeleteImpact {id:string;title:string;parentId?:string;archived:boolean;active:boolean}
export interface TrashPreview {token:string;kind:TrashKind;id:string;title:string;projectName:string;conversations:number;native:{available:boolean;reason?:string;roots:NativeDeleteImpact[];descendants:NativeDeleteImpact[];notice:string};notice:string}
export interface TrashEntry {id:string;kind:TrashKind;title:string;projectName:string;deletedAt:string;native:TrashNativeMode;nativeStatus:'kept'|'completed'|'failed'|'partial';notice?:string;restoredAt?:string}
export interface TrashResult {entry:TrashEntry;notice:string;restoredSessionId?:string;restoredProjectId?:string}
export interface TrashPurgeReferences {attachmentReferences:number;sharedAttachmentReferences:number;originalArchives:number;sharedOriginalArchives:number;activeCopies:number;retainedProjectFolders:number;projectConnections:number;revision:string}
export interface TrashPurgePreview {token:string;scope:'selected'|'all';entries:TrashEntry[];records:number;historicalRecords:number;unfinishedRecords:number;bytes:number;confirmation:string;references:TrashPurgeReferences;notice:string}
export interface TrashPurgeResult {deletedIds:string[];failed:{id:string;title:string;message:string}[];notice:string}
export type TrashAction={action:'preview';kind:TrashKind;id:string}|{action:'delete';token:string;native:TrashNativeMode;confirmTitle?:string}|{action:'list'}|{action:'restore';id:string}|{action:'purgePreview';scope:'selected';ids:string[]}|{action:'purgePreview';scope:'all'}|{action:'purge';token:string;acknowledged:boolean;confirmText:string};
export interface TrashAPI {trashAction(input:TrashAction):Promise<TrashPreview|TrashEntry[]|TrashResult|TrashPurgePreview|TrashPurgeResult>}
