import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
export default function IconTooltips(){
 const [tip,setTip]=useState<{text:string;x:number;y:number}|null>(null);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined,target:HTMLElement|null=null,previousTitle:string|null=null;
  const hide=()=>{clearTimeout(timer);if(target&&previousTitle!==null)target.setAttribute('title',previousTitle);if(target?.getAttribute('aria-describedby')==='flowrium-icon-tip')target.removeAttribute('aria-describedby');target=null;previousTitle=null;setTip(null)};
  const show=(event:Event)=>{const node=(event.target as Element)?.closest<HTMLElement>('button,[role=button]');if(node===target)return;hide();if(!node?.querySelector('svg'))return;const text=node.getAttribute('title')||node.getAttribute('aria-label');if(!text)return;target=node;previousTitle=node.getAttribute('title');node.removeAttribute('title');timer=setTimeout(()=>{if(!target?.isConnected)return;const box=target.getBoundingClientRect();target.setAttribute('aria-describedby','flowrium-icon-tip');setTip({text,x:Math.max(140,Math.min(innerWidth-140,box.left+box.width/2)),y:box.bottom+10>innerHeight-44?box.top-38:box.bottom+8})},300)};
  const leave=(event:Event)=>{const next=(event as PointerEvent).relatedTarget as Node|null;if(target&&next&&target.contains(next))return;hide()};
  document.addEventListener('pointerover',show);document.addEventListener('pointerout',leave);document.addEventListener('focusin',show);document.addEventListener('focusout',hide);document.addEventListener('pointerdown',hide,true);window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  return()=>{hide();document.removeEventListener('pointerover',show);document.removeEventListener('pointerout',leave);document.removeEventListener('focusin',show);document.removeEventListener('focusout',hide);document.removeEventListener('pointerdown',hide,true);window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)};
 },[]);
 return tip?createPortal(<div id="flowrium-icon-tip" className="icon-tooltip" role="tooltip" style={{left:tip.x,top:tip.y}}>{tip.text}</div>,document.body):null;
}
