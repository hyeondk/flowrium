// The composing target supplements browsers whose commit key has isComposing=false.
const composing = new WeakSet<EventTarget>();
if (typeof document !== 'undefined') {
  document.addEventListener('compositionstart', event => {if(event.target) composing.add(event.target);}, true);
  document.addEventListener('compositionend', event => {const target=event.target;if(target)queueMicrotask(()=>composing.delete(target));}, true);
}
export function isImeKey(event:{isComposing?:boolean;keyCode?:number;target?:EventTarget|null}) {
  return Boolean(event.isComposing || event.keyCode === 229 || (event.target && composing.has(event.target)));
}
