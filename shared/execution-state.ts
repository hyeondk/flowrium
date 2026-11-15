import type {FlowriumEvent,Session} from './types';
import type {WorkflowProposal} from './workflow';
import {executionFor, visibleProposals} from '../electron/execution-state.js';
export {awaitsContinuation, visibleProposals} from '../electron/execution-state.js';
export type ExecutionState='running'|'waiting'|'decision';
export const executionLabels:Record<ExecutionState,string>={running:'작업중',waiting:'대기',decision:'결정'};
export const executionDescriptions:Record<ExecutionState,string>={running:'AI가 실제 작업을 실행하고 있습니다.',waiting:'다음 진행이나 추가 입력을 기다립니다.',decision:'실행 허락이나 질문에 대한 답변이 필요합니다.'};
export function sessionExecution(session:Session,activity:unknown,requests:FlowriumEvent[],proposals:WorkflowProposal[]=[]):ExecutionState|null{
 const deciding=requests.some(r=>r.sessionId===session.id)||visibleProposals(proposals).some(p=>p.sourceId===session.id||p.targetId===session.id);
 return executionFor(session,activity,deciding);
}
