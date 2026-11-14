export type TrashKind='session'|'project';
export type TrashNativeMode='keep'|'archive'|'delete';
export interface NativeDeleteImpact {id:string;title:string;parentId?:string;archived:boolean;active:boolean}
export interface TrashPreview {token:string;kind:TrashKind;id:string;title:string;projectName:string;conversations:number;native:{available:boolean;reason?:string;roots:NativeDeleteImpact[];descendants:NativeDeleteImpact[];notice:string};notice:string}
export interface TrashEntry {id:string;kind:TrashKind;title:string;projectName:string;deletedAt:string;native:TrashNativeMode;nativeStatus:'kept'|'completed'|'failed'|'partial';notice?:string;restoredAt?:string}
export interface TrashResult {entry:TrashEntry;notice:string;restoredSessionId?:string;restoredProjectId?:string}
export type TrashAction={action:'preview';kind:TrashKind;id:string}|{action:'delete';token:string;native:TrashNativeMode;confirmTitle?:string}|{action:'list'}|{action:'restore';id:string};
export interface TrashAPI {trashAction(input:TrashAction):Promise<TrashPreview|TrashEntry[]|TrashResult>}
