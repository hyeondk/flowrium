import type {WorkStep} from '../../shared/types';

type Activity = Pick<WorkStep,'label'> & Partial<WorkStep>;

export const agentActivityText: Record<WorkStep['state'],string>;
export function describeActivity(step:Activity):{label:string;target?:string;result?:string};
export function activityText(step:Activity):string;
export function sameWorkActivity(a?:WorkStep,b?:WorkStep):boolean;
