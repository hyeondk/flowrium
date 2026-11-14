import type {Model} from './types';
import {reasoningEffortOptions} from '../electron/mobile/model-display.js';
export {effortLabels} from '../electron/mobile/model-display.js';
export function effortOptions(model?:Model){return reasoningEffortOptions(model);}
