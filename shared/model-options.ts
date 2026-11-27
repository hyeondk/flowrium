import type {Model} from './types';
import {reasoningEffortOptions} from '../electron/mobile/model-display.js';
export {effortLabels} from '../electron/mobile/model-display.js';
export function effortOptions(model?:Model){return reasoningEffortOptions(model);}
export function supportedEffort(model:Model|undefined,requested:string|undefined) {
  return effortOptions(model).find(row=>row.reasoningEffort===requested)?.reasoningEffort;
}
export function effectiveEffort(model:Model|undefined,requested:string|undefined) {
  return supportedEffort(model,requested)??supportedEffort(model,model?.defaultReasoningEffort);
}
