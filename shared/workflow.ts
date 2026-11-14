import type { FlowriumEvent, Session, Mode, Effort } from "./types";

export interface WorkflowPreferences {
  enabled:boolean;
  aiReports:boolean;
  github:boolean;
  mail:boolean;
  intervalMinutes:number;
  startHour:number;
  endHour:number;
  weekdays:number[];
  timezone:string;
  projectId:string|null;
}
export interface WorkflowNotification {
  id:string;kind:string;title:string;body:string;sessionId:string|null;group:string;createdAt:string;readAt:string|null;
}
export interface WorkflowProposal {
  id:string;revision:number;kind:"request"|"external"|"next"|"report"|"team";title:string;body:string;
  sourceId:string|null;targetId:string|null;projectId:string|null;
  status:"pending"|"running"|"completed"|"rejected"|"failed"|"held";
  createdAt:string;hidden:boolean;snoozedUntil:number|null;result:string;
  method?:string;
  preview?:{kind?:string;projectName?:string;rows?:{name:string;files:string[];message:string;through:string;expected?:{branch:string;head:string}}[];action?:string;calendarName?:string;event?:ExternalEvent;previous?:ExternalEvent;expiresAt?:number}|null;
}
interface ExternalEvent {title?:string;at?:string;end?:string;description?:string;location?:string}
export interface WorkflowReminder {
  id:string;text:string;at:number;nextAt:number;repeatDays:number;createdAt:string;cancelled:boolean;firedAt:string|null;
}
export interface WorkflowDelivery {
  id:string;sourceId:string|null;targetId:string;text:string;createdAt:string;status:"queued"|"dispatching"|"sent"|"failed"|"held";error?:string;
}
export interface WorkflowState {
  version:1;revision:number;preferences:WorkflowPreferences;
  notifications:WorkflowNotification[];proposals:WorkflowProposal[];reminders:WorkflowReminder[];deliveries:WorkflowDelivery[];
  reports:{id:string;at:string;reason:string;body:string;status?:string;sessionId?:string;artifactPath?:string;error?:string}[];
  pending:FlowriumEvent[];
  projects:{id:string;name:string}[];
  sessions:{id:string;projectId:string;title:string;running:boolean}[];
}
export type WorkflowAction =
  |{action:'followupSuggestions';sessionId:string;messageId:string}
  |{action:'continueConversation';sessionId:string;messageId:string;text?:string;attachments?:string[];mode:Mode;model?:string;effort?:Effort}
  |{action:"preferences";value:Partial<WorkflowPreferences>}
  |{action:"send";sourceId?:string|null;targetId:string;text:string}
  |{action:"request";sourceId?:string;projectId?:string;targetId?:string;title:string;text:string}
  |{action:"propose";kind:"next"|"report";sourceId?:string;projectId?:string;targetId?:string;title:string;text:string}
  |{action:"approve"|"reject"|"hide"|"restore";id:string;revision:number}
  |{action:"snooze";id:string;revision:number;minutes:number}
  |{action:"resumeExternal";id:string;revision:number}
  |{action:"bulk";operation:"approve"|"reject"|"hide"|"restore";items:{id:string;revision:number}[]}
  |{action:"read";ids:string[]}
  |{action:"readSession";sessionId:string}
  |{action:"clearNotifications";readOnly:true}
  |{action:"reportNow"|"collect"|"recommend"}
  |{action:"reminderAdd";when:string;text:string;repeatDays:number}
  |{action:"reminderCancel";id:string}
  |{action:"retryDelivery";id:string};
export interface WorkflowAPI {
  workflowState():Promise<WorkflowState>;
  workflowAction(input:WorkflowAction):Promise<unknown|Session>;
}
