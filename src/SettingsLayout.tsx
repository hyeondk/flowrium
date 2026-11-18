import {createContext,useContext,useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent,type ReactNode} from 'react';
import {ChevronRight} from 'lucide-react';
import './settings-layout.css';
const groups=[['general','일반'],['categories','카테고리 관리'],['security','보안'],['remote','휴대폰'],['voice','음성'],['account','계정과 모델'],['appearance','화면']] as const;
type GroupId=typeof groups[number][0];
const SettingsContext=createContext<{selected:GroupId;expanded:boolean;prefix:string}|null>(null);
export function SettingsGroup({id,children}:{id:GroupId;children:ReactNode}){
 const state=useContext(SettingsContext),selected=!state||state.selected===id,open=selected&&(!state||state.expanded);
 return <section className="settings-group" data-settings-group={id} data-selected={selected} hidden={!open} inert={!open} aria-hidden={!open} id={state?`${state.prefix}-panel-${id}`:undefined} aria-labelledby={state?`${state.prefix}-nav-${id}`:undefined}>
  {state&&<h3 className="settings-group-title">{groups.find(([key])=>key===id)?.[1]}</h3>}
  {children}
 </section>;
}
export default function SettingsLayout({children,initialGroup='general'}:{children:ReactNode;initialGroup?:GroupId}){
 const [selected,setSelected]=useState<GroupId>(initialGroup),[expanded,setExpanded]=useState(true),content=useRef<HTMLDivElement>(null),prefix=useId();
 useEffect(()=>{setSelected(initialGroup);setExpanded(true);},[initialGroup]);
 useEffect(()=>{if(content.current)content.current.scrollTop=0;},[selected,expanded]);
 useLayoutEffect(()=>{
  const viewport=content.current,layout=viewport?.parentElement,account=viewport?.querySelector<HTMLElement>('[data-settings-group=account]');
  if(!viewport||!layout||!account)return;
  let frame=0,alive=true,lastWidth=0;
  const measure=()=>{
   if(!alive)return;
   const style=getComputedStyle(viewport),width=viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
   if(width<=0)return;
   lastWidth=width;
   const copy=account.cloneNode(true) as HTMLElement;
   copy.removeAttribute('hidden');copy.removeAttribute('id');copy.removeAttribute('data-settings-group');copy.removeAttribute('aria-labelledby');copy.inert=true;
   copy.setAttribute('aria-hidden','true');copy.setAttribute('data-settings-measurement','account');
   for(const child of copy.querySelectorAll('[id]'))child.removeAttribute('id');
   Object.assign(copy.style,{position:'absolute',left:'0',top:'0',width:width+'px',visibility:'hidden',pointerEvents:'none',display:'flex',transition:'none',height:'auto'});
   viewport.append(copy);
   const height=Math.ceil(copy.getBoundingClientRect().height+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom));
   copy.remove();layout.style.setProperty('--settings-reference-height',height+'px');
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
  measure();
  const resize=new ResizeObserver(()=>{const style=getComputedStyle(viewport),width=viewport.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);if(Math.abs(width-lastWidth)>.5)schedule();});resize.observe(viewport);
  const mutation=new MutationObserver(schedule);mutation.observe(account,{subtree:true,childList:true,characterData:true});
  void document.fonts.ready.then(()=>{if(alive)schedule();});
  return()=>{alive=false;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();};
 },[]);
 function select(id:GroupId){if(selected===id)setExpanded(value=>!value);else{setSelected(id);setExpanded(true);}}
 function moveFocus(event:KeyboardEvent<HTMLElement>){
  const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('.settings-nav-item')],index=buttons.indexOf(event.target as HTMLButtonElement);
  if(index<0)return;
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%buttons.length:['ArrowUp','ArrowLeft'].includes(event.key)?(index+buttons.length-1)%buttons.length:-1;
  if(next<0)return;
  event.preventDefault();buttons[next].focus({preventScroll:true});buttons[next].scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
 }
 return <SettingsContext.Provider value={{selected,expanded,prefix}}><div className="settings-layout settings-disclosure-layout">
  <nav className="settings-nav" aria-label="설정 분류" onKeyDown={moveFocus}>{groups.map(([id,label])=><button type="button" key={id} id={`${prefix}-nav-${id}`} data-settings-target={id} className="settings-nav-item" aria-current={selected===id&&expanded?'page':undefined} aria-expanded={selected===id&&expanded} aria-controls={`${prefix}-panel-${id}`} onClick={()=>select(id)}><span>{label}</span><ChevronRight size={15} aria-hidden="true"/></button>)}</nav>
  <div className="modal-content settings-content" ref={content}>{children}</div>
 </div></SettingsContext.Provider>;
}
