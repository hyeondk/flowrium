import type {Effort,Model} from './types';
export const effortLabels:Record<Effort,string>={none:'바로 응답',minimal:'최소한으로',low:'가볍게 / 빠른 탐색',medium:'균형 있게 / 일반 작업',high:'깊이 있게 / 복잡한 문제',xhigh:'매우 깊이 있게',max:'최대 깊이',ultra:'가장 깊이 있게'};
export function effortOptions(model?:Model){return model?.supportedReasoningEfforts?.length?model.supportedReasoningEfforts:[{reasoningEffort:'low' as const},{reasoningEffort:'medium' as const},{reasoningEffort:'high' as const}];}
