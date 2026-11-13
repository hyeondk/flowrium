import type {FlowriumEvent,Session} from './types';
import type {WorkflowProposal} from './workflow';
export type ExecutionState='running'|'waiting'|'decision';
export const executionLabels:Record<ExecutionState,string>={running:'작업중',waiting:'대기',decision:'결정'};
export const executionDescriptions:Record<ExecutionState,string>={running:'AI가 실제 작업을 실행하고 있습니다.',waiting:'다음 진행이나 추가 입력을 기다립니다.',decision:'실행 허락이나 질문에 대한 답변이 필요합니다.'};
export function visibleProposals(rows:WorkflowProposal[],now=Date.now()){return rows.filter(p=>!p.hidden&&p.status==='pending'&&(!p.snoozedUntil||p.snoozedUntil<=now))}
export function awaitsContinuation(session:Session){
 if(session.workflow?.status==='done')return false;
 if(session.queuedMessages?.some(q=>q.status==='queued'||q.status==='sending'))return true;
 const last=session.messages.filter(m=>m.role!=='system').at(-1);if(last?.role!=='assistant')return false;
 const ending=last.text.trim().split(/\n\s*\n/).at(-1)||'';
 return /(?:계속|진행|이어서|시작|다음|추가|원하|선택|알려)[\s\S]{0,180}(?:할까요|해드릴까요|될까요|원하시나요|주세요|하실까요|하겠습니까)[?？.!\s]*$|(?:would you like|shall I|should I)[\s\S]{0,150}\?\s*$/i.test(ending);
}
export function sessionExecution(session:Session,activity:unknown,requests:FlowriumEvent[],proposals:WorkflowProposal[]=[]):ExecutionState|null{
 if(requests.some(r=>r.sessionId===session.id)||visibleProposals(proposals).some(p=>p.sourceId===session.id||p.targetId===session.id))return 'decision';
 if(activity)return 'running';
 if(awaitsContinuation(session))return 'waiting';
 return null;
}
