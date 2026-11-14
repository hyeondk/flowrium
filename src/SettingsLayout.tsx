import {useEffect,useRef,useState,type ReactNode} from 'react';
const groups=[['general','일반'],['security','보안'],['transfer','대화와 자료'],['integrations','외부 자료'],['remote','휴대폰'],['voice','음성'],['account','계정과 모델'],['appearance','화면']] as const;
export function SettingsGroup({id,children}:{id:typeof groups[number][0];children:ReactNode}){
 return <div className="settings-group" data-settings-group={id}>{children}</div>;
}
export default function SettingsLayout({children}:{children:ReactNode}){
 const [active,setActive]=useState<string>('general'),content=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const root=content.current;if(!root)return;
  let frame=0;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const top=root.getBoundingClientRect().top;const sections=[...root.querySelectorAll<HTMLElement>('[data-settings-group]')];const match=sections.find(node=>node.getBoundingClientRect().bottom>top+60);if(match)setActive(match.dataset.settingsGroup||'general');});};
  root.addEventListener('scroll',update,{passive:true});update();return()=>{root.removeEventListener('scroll',update);cancelAnimationFrame(frame);};
 },[]);
 function select(id:string){const node=[...(content.current?.querySelectorAll<HTMLElement>('[data-settings-group]')||[])].find(node=>node.dataset.settingsGroup===id);node?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});setActive(id);}
 return <div className="settings-layout"><nav className="settings-nav" aria-label="설정 분류">{groups.map(([id,label])=><button type="button" key={id} data-settings-target={id} className="settings-nav-item" aria-current={active===id?'page':undefined} onClick={()=>select(id)}>{label}</button>)}</nav><div className="modal-content settings-content" ref={content}>{children}</div></div>;
}
