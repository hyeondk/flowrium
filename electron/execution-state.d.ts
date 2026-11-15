import type {Session} from '../shared/types';
import type {WorkflowProposal} from '../shared/workflow';
import type {ExecutionState} from '../shared/execution-state';
export function asksToContinue(text: string): boolean;
export function awaitsContinuation(session: Session): boolean;
export function visibleProposals(rows: WorkflowProposal[], now?: number): WorkflowProposal[];
export function executionFor(session: Session, activity: unknown, deciding: boolean): ExecutionState | null;
