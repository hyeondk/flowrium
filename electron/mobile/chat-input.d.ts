export const maxChatInput: number;
export function chatInput(value: string, hasAttachments?: boolean): string;
export const nativeQueueAction: string;
export const nativeQueueQuestion: string;
export const nativeQueueExplanation: string;
export const clearQueueAction: string;
export const clearQueueQuestion: string;
export const clearQueueExplanation: string;
export function nativeQueueNotice(result:{queued:boolean;nativeDelivery?:string}): string;
export function queuedInputView(item:import('../../shared/types').QueuedMessage): {
  status:string; hint:string; canSendToCodex:boolean; canCancel:boolean; canResume:boolean; canClear:boolean;
};
