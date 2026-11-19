import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
export default function IconTooltips(){
 const [tip,setTip]=useState<{text:string;left:number;top:number;bottom:number;width:number}|null>(null);
 const tipRef=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 useLayoutEffect(()=>{
  if(!tip||!tipRef.current){setPosition(null);return;}
  const box=tipRef.current.getBoundingClientRect();
  const left=Math.max(8,Math.min(innerWidth-box.width-8,tip.left+tip.width/2-box.width/2));
  const below=tip.bottom+8;
  const top=below+box.height<=innerHeight-8?below:Math.max(8,tip.top-box.height-8);
  setPosition({left,top});
 },[tip]);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined,target:HTMLElement|null=null,previousTitle:string|null=null;
  const hide=()=>{clearTimeout(timer);if(target&&previousTitle!==null)target.setAttribute('title',previousTitle);if(target?.getAttribute('aria-describedby')==='flowrium-icon-tip')target.removeAttribute('aria-describedby');target=null;previousTitle=null;setTip(null)};
  const show=(event:Event)=>{
   const node=(event.target as Element)?.closest<HTMLElement>('[data-visual-tooltip],button,[role=button]');
   if(node===target)return;
   hide();
   if(!node)return;
   const visual=node.getAttribute('data-visual-tooltip');
   if(!visual&&!node.querySelector('svg'))return;
   const text=visual||node.getAttribute('title')||node.getAttribute('aria-label');
   if(!text)return;
   target=node;
   previousTitle=node.getAttribute('title');
   node.removeAttribute('title');
   timer=setTimeout(()=>{
    if(!target?.isConnected)return;
    const box=target.getBoundingClientRect();
    if(!visual)target.setAttribute('aria-describedby','flowrium-icon-tip');
    setTip({text:target.getAttribute('data-visual-tooltip')||text,left:box.left,top:box.top,bottom:box.bottom,width:box.width});
   },300);
  };
  const leave=(event:Event)=>{const next=(event as PointerEvent).relatedTarget as Node|null;if(target&&next&&target.contains(next))return;hide()};
  document.addEventListener('pointerover',show);document.addEventListener('pointerout',leave);document.addEventListener('focusin',show);document.addEventListener('focusout',hide);document.addEventListener('pointerdown',hide,true);window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  return()=>{hide();document.removeEventListener('pointerover',show);document.removeEventListener('pointerout',leave);document.removeEventListener('focusin',show);document.removeEventListener('focusout',hide);document.removeEventListener('pointerdown',hide,true);window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)};
 },[]);
 return tip?createPortal(<div ref={tipRef} id="flowrium-icon-tip" className="icon-tooltip" role="tooltip" style={{left:position?.left??8,top:position?.top??8,transform:'none',whiteSpace:'pre-line',visibility:position?'visible':'hidden'}}>{tip.text}</div>,document.body):null;
}
