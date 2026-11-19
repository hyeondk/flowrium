import type {Message,Session} from '../shared/types';
import type {WorkflowProposal} from '../shared/workflow';
import type {ExecutionState} from '../shared/execution-state';
export function asksToContinue(text: string): boolean;
export function continuationAnswer(session: Session): Message | undefined;
export function awaitsContinuation(session: Session): boolean;
export function visibleProposals(rows: WorkflowProposal[], now?: number): WorkflowProposal[];
export function executionFor(session: Session, running: boolean, deciding: boolean, unsettled?: boolean): ExecutionState | null;
export const QUESTION_DECISION_NOTICE: string;
