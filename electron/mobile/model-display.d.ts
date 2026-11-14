import type {Effort, Model} from '../../shared/types';

export function modelDisplayName(model?: string | Pick<Model, 'id' | 'displayName'> | null): string;
export function effortDisplayName(effort?: Effort | string | null): string;
export const effortLabels: Readonly<Record<Effort, string>>;
export function reasoningEffortOptions(model?: Pick<Model, 'supportedReasoningEfforts'> | null): NonNullable<Model['supportedReasoningEfforts']>;
