import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {usePresence} from './ui-motion';
import './context-menu.css';
export interface ContextMenuItem {id:string;label:string;onSelect():void;disabled?:boolean;danger?:boolean}
export default function ContextMenu({anchor,label,items,onClose}:{anchor:{x:number;y:number}|null;label:string;items:ContextMenuItem[];onClose():void}){
 const panel=useRef<HTMLDivElement>(null),last=useRef({anchor:anchor||{x:0,y:0},label,items}),[position,setPosition]=useState({x:0,y:0}),close=useRef(onClose),active=Boolean(anchor),{present,phase}=usePresence(active,220);close.current=onClose;
 if(anchor)last.current={anchor,label,items};
 useLayoutEffect(()=>{if(!anchor||!present)return;const rect=panel.current?.getBoundingClientRect();setPosition({x:Math.max(8,Math.min(anchor.x,innerWidth-(rect?.width||240)-8)),y:Math.max(8,Math.min(anchor.y,innerHeight-(rect?.height||200)-8))});},[anchor?.x,anchor?.y,items.length,present]);
 useEffect(()=>{if(!active||!present)return;const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const targets=()=>[...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])];targets()[0]?.focus();
  const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node))close.current();};
  const key=(event:KeyboardEvent)=>{const rows=targets(),index=rows.indexOf(document.activeElement as HTMLButtonElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();rows[event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();}else if(['Escape','Tab'].includes(event.key)){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();}close.current();}};
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);const resize=()=>close.current();window.addEventListener('resize',resize);window.addEventListener('blur',resize);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',resize);window.removeEventListener('blur',resize);if(before?.isConnected)before.focus();};
 },[active,present]);
 return present?createPortal(<div className="flow-context-menu" ref={panel} role="menu" aria-label={last.current.label} data-phase={phase} inert={phase==='exit'} style={{left:position.x,top:position.y}}>{last.current.items.map(item=><button role="menuitem" key={item.id} disabled={item.disabled} data-danger={item.danger||undefined} onClick={()=>{close.current();item.onSelect();}}>{item.label}</button>)}</div>,document.body):null;
}
