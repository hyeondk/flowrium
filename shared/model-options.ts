import type {Model} from './types';
import {reasoningEffortOptions} from '../electron/mobile/model-display.js';
export {effortLabels} from '../electron/mobile/model-display.js';
export function effortOptions(model?:Model){return reasoningEffortOptions(model);}
export function effectiveEffort(model:Model|undefined,requested:string|undefined){const supported=effortOptions(model).map(row=>row.reasoningEffort);return supported.includes(requested as never)?requested:supported.includes(model?.defaultReasoningEffort as never)?model?.defaultReasoningEffort:undefined;}
