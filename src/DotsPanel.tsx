import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ExternalLink,LoaderCircle,RefreshCw} from 'lucide-react';
import type {DotsState} from '../shared/dots';
import './dots-panel.css';
export default function DotsPanel({active=true,blocked=false}:{active?:boolean;blocked?:boolean}){
 const host=useRef<HTMLDivElement>(null),generation=useRef(0),[state,setState]=useState<DotsState>(),[error,setError]=useState('');
 const api=window.flowrium;
 useLayoutEffect(()=>{
  const epoch=++generation.current;
  if(!api)return;
  if(!active||blocked){void api.hideDotsView().catch(()=>{});return;}
  let stopped=false,frame=0,last='';
  const modalOpen=()=>[...document.querySelectorAll<HTMLElement>('[role="dialog"],dialog[open],.flow-context-menu')].some(el=>{
   const rect=el.getBoundingClientRect(),style=getComputedStyle(el);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
  });
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const el=host.current;if(stopped||epoch!==generation.current||!el)return;
   if(document.hidden||modalOpen()||el.closest('[inert],[data-phase="exit"],[hidden],[aria-hidden="true"]')){last='';void api.hideDotsView().catch(()=>{});return;}
   const rect=el.getBoundingClientRect(),bounds={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
   if(rect.width<120||rect.height<120){void api.hideDotsView().catch(()=>{});return;}
   const signature=JSON.stringify(bounds);if(signature===last)return;last=signature;
   void api.showDotsView(bounds).then(value=>{if(!stopped&&epoch===generation.current){setState(value);setError('')}}).catch(e=>{last='';if(!stopped&&epoch===generation.current)setError(e instanceof Error?e.message:String(e));});
  });};
  const observer=new ResizeObserver(()=>{last='';update()});if(host.current)observer.observe(host.current);
  const mutations=new MutationObserver(update);mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','open','inert','data-phase','aria-hidden','role']});
  const focus=()=>{last='';update()},visibility=()=>{if(document.hidden){void api.hideDotsView().catch(()=>{});last=''}else focus()};
  const geometry=setInterval(update,250);
  window.addEventListener('resize',focus);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);update();
  return()=>{stopped=true;generation.current++;clearInterval(geometry);cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();window.removeEventListener('resize',focus);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);void api.hideDotsView().catch(()=>{});};
 },[api,active,blocked]);
 useEffect(()=>{
  if(!api||!active||blocked)return;let alive=true;
  const refresh=()=>{void api.readDotsState().then(value=>{if(alive)setState(value)}).catch(()=>{});};refresh();const timer=setInterval(refresh,1200);return()=>{alive=false;clearInterval(timer)};
 },[api,active,blocked]);
 async function perform(action:()=>Promise<unknown>){try{await action();setError('');if(api)setState(await api.readDotsState())}catch(e){setError(e instanceof Error?e.message:String(e))}}
 return <section className="dots-panel" aria-label="Dots 공식 화면">
  <header className="dots-toolbar"><div><strong>Dots</strong><small>ChatGPT 공식 웹 화면</small></div><button className="dock-icon" aria-label="Dots 새로고침" disabled={!api||blocked||!active} onClick={()=>void perform(()=>api!.reloadDotsView())}><RefreshCw size={15}/></button><button className="dock-icon" aria-label="Dots 외부 브라우저에서 열기" disabled={!api||blocked||!active} onClick={()=>void perform(()=>api!.openDotsExternal())}><ExternalLink size={15}/></button></header>
  <p className="dots-caption">공식 텍스트 웹 화면에서 별도로 로그인합니다. 통화 기능과 Flowrium 대화 자동 동기화는 지원하지 않습니다.</p>
  {state?.externalHost&&<div className="dots-external-request"><span>{state.externalHost}에서 외부 페이지를 열려고 합니다.</span><button type="button" className="button subtle" disabled={blocked||!active} onClick={()=>void perform(()=>api!.openDotsExternal())}>외부 브라우저에서 열기</button></div>}
  {(error||state?.error)&&<p className="dots-error" role="status">{error||state?.error}</p>}
  <div className="dots-native-host" ref={host}>{blocked||!active?<p>다른 창을 닫은 뒤 Dots를 이어서 확인하세요.</p>:state?.loading?<p><LoaderCircle className="spin" size={16}/>공식 화면을 불러오고 있습니다.</p>:null}</div>
 </section>;
}
