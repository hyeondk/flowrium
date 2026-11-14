import {useCallback,useEffect,useRef,useState,type CSSProperties,type RefObject,type PointerEvent as ReactPointerEvent} from 'react';
import {clampDockSize,dockSizeBounds} from '../shared/dock-size';
const key='flowrium.dock.width.v1';
function stored(){try{const n=JSON.parse(localStorage.getItem(key)||'null');if(typeof n==='number'&&Number.isFinite(n)&&n>=240&&n<=2000)return n;}catch{}return undefined;}
export function useDockResize(panel:RefObject<HTMLElement|null>,overlay:boolean,open=true){
 const [element,setElement]=useState<HTMLElement|null>(null);
 const bindPanel=useCallback((node:HTMLElement|null)=>{panel.current=node;setElement(node)},[panel]);
 const [preferred,setPreferred]=useState<number|undefined>(stored),[geometry,setGeometry]=useState(()=>({viewport:innerWidth,sidebar:72})),[resizing,setResizing]=useState(false),drag=useRef<{pointer:number;x:number;width:number;target:HTMLElement}|undefined>(undefined);
 const bounds=dockSizeBounds(geometry.viewport,geometry.sidebar,overlay),width=preferred===undefined?undefined:clampDockSize(preferred,bounds);
 const latest=useRef(bounds);latest.current=bounds;
 useEffect(()=>{if(!open)return;const root=element?.parentElement;if(!root)return;const side=root.querySelector('.workspace-side');const update=()=>setGeometry({viewport:root.getBoundingClientRect().width||innerWidth,sidebar:side?.getBoundingClientRect().width||72});const observer=new ResizeObserver(update);observer.observe(root);if(side)observer.observe(side);window.addEventListener('resize',update);update();return()=>{observer.disconnect();window.removeEventListener('resize',update)}},[element,open]);
 useEffect(()=>{try{if(preferred===undefined)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(preferred))}catch{}},[preferred]);
 function finish(){const d=drag.current;drag.current=undefined;if(d?.target.hasPointerCapture(d.pointer))d.target.releasePointerCapture(d.pointer);setResizing(false);document.documentElement.removeAttribute('data-dock-resizing');window.dispatchEvent(new Event('flowrium-dock-resize-end'));}
 useEffect(()=>()=>{const d=drag.current;if(d?.target.hasPointerCapture(d.pointer))d.target.releasePointerCapture(d.pointer);document.documentElement.removeAttribute('data-dock-resizing');},[]);
 function start(event:ReactPointerEvent<HTMLDivElement>){if(innerWidth<=760||event.button!==0||!panel.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,x:event.clientX,width:panel.current.getBoundingClientRect().width,target:event.currentTarget};setResizing(true);document.documentElement.dataset.dockResizing='true';void window.flowrium?.hideDotsView().catch(()=>{});}
 useEffect(()=>{if(!open)finish()},[open]);
 const reset=()=>setPreferred(undefined);
 const separator=<div className="dock-resize-handle" role="separator" aria-label="대화 패널 너비 조절" aria-orientation="vertical" aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width||Math.round(panel.current?.getBoundingClientRect().width||360)} tabIndex={0} onDoubleClick={reset} onPointerDown={start} onPointerMove={event=>{const d=drag.current;if(d&&d.pointer===event.pointerId)setPreferred(clampDockSize(d.width+d.x-event.clientX,latest.current));}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={()=>{if(drag.current)finish()}} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const current=panel.current?.getBoundingClientRect().width||360;setPreferred(clampDockSize(event.key==='Home'?bounds.min:event.key==='End'?bounds.max:current+(event.key==='ArrowLeft'?1:-1)*(event.shiftKey?80:20),bounds));}}><span aria-hidden="true"/></div>;
 return {bindPanel,style:(geometry.viewport>760&&width!==undefined?{width:width+'px','--dock-user-width':width+'px'}:{}) as CSSProperties,separator,reset,resizing};
}
