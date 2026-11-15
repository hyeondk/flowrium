import {useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent} from 'react';
import type {Project} from '../shared/types';
import type {ProjectNavigationState} from '../shared/portfolio';
import './project-order.css';

export const projectOrderChanged = 'flowrium-project-order-changed';
export type MoveProject = (id:string, target:string) => void;

export function useProjectOrder(projects:Project[], connected:boolean, onCatalog:(value:ProjectNavigationState)=>void, onError:(e:unknown)=>void) {
  const [nameLinks,setNameLinks]=useState<ProjectNavigationState['nameLinks']>({});
  const [order,setOrder] = useState<string[]>([]);
  const request = useRef(0);
  const ids = projects.map(p=>p.id).join(',');
  const receive = useCallback((value:ProjectNavigationState) => {
    setOrder(value.order);
    setNameLinks(value.nameLinks);
    onCatalog(value);
  }, [onCatalog]);
  useEffect(()=>{
    const api = window.flowrium;
    if (!api || (!ids && !connected)) return;
    let active=true, polling=false;
    async function refresh() {
      if (!active || polling || document.hidden) return;
      const token=++request.current;
      polling=true;
      try {
        const next=await api!.portfolioAction({action:'navigation',sync:connected});
        if(active && token===request.current) receive(next);
      } catch {
        // Older/offline Codex installations can still read the saved device order.
        const next=await api!.portfolioAction({action:'navigation'}).catch(()=>undefined);
        if(active && next && token===request.current) receive(next);
      } finally {polling=false;}
    }
    void refresh();
    const interval=connected ? window.setInterval(refresh,15000) : undefined;
    window.addEventListener('focus',refresh);
    window.addEventListener(projectOrderChanged,refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{active=false;clearInterval(interval);window.removeEventListener('focus',refresh);window.removeEventListener(projectOrderChanged,refresh);document.removeEventListener('visibilitychange',refresh);};
  },[ids,connected,receive]);
  const move:MoveProject = (id,target)=>{
    const api = window.flowrium;
    if(!api || id===target) return;
    const token=++request.current;
    void api.portfolioAction({action:'move',id,target,sync:connected}).then(value=>{
      if(token===request.current) receive(value);
      window.dispatchEvent(new Event(projectOrderChanged));
    }).catch(onError);
  };
  const positions=new Map(order.map((id,i)=>[id,i]));
  return {nameLinks,projects:[...projects].sort((a,b)=>(positions.get(a.id)??order.length)-(positions.get(b.id)??order.length)),move};
}

type Grip = {
  id:string; x:number; y:number; startX:number; startY:number; pointerId:number;
  row:HTMLButtonElement; timer:ReturnType<typeof setTimeout>; frame?:number; target:string; held:boolean;
  scroll?:HTMLElement; stopTouch:()=>void;
};

export function useProjectGrip(projects:Project[], move:MoveProject) {
  const grip=useRef<Grip | undefined>(undefined), suppress=useRef('');
  const [drag,setDrag]=useState<{id:string;target:string}>();
  const [announcement,setAnnouncement]=useState('');
  function hit(g:Grip) {
    const row=document.elementFromPoint(g.x,g.y)?.closest<HTMLElement>('[data-project-sort-id]');
    if (!row || row.parentElement!==g.row.parentElement) return;
    const id=row.dataset.projectSortId;
    if(id && g.target!==id) {g.target=id;setDrag({id:g.id,target:id});}
  }
  function scrollWhileHeld(g:Grip) {
    if(grip.current!==g || !g.held) return;
    if(g.scroll) {
      const box=g.scroll.getBoundingClientRect();
      const dy=g.y<box.top+24 ? -6 : g.y>box.bottom-24 ? 6 : 0;
      if(dy && g.x>=box.left && g.x<=box.right) {g.scroll.scrollTop+=dy;hit(g);}
    }
    g.frame=requestAnimationFrame(()=>scrollWhileHeld(g));
  }
  function stop() {
    const g=grip.current;
    if(!g) return;
    grip.current=undefined;
    clearTimeout(g.timer);
    if(g.frame!==undefined) cancelAnimationFrame(g.frame);
    g.stopTouch();
    if(g.row.hasPointerCapture(g.pointerId)) g.row.releasePointerCapture(g.pointerId);
    setDrag(undefined);
  }
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape' && grip.current){event.preventDefault();event.stopImmediatePropagation();stop();}};
    document.addEventListener('keydown',cancel,true);window.addEventListener('blur',stop);
    return ()=>{document.removeEventListener('keydown',cancel,true);window.removeEventListener('blur',stop);stop();};
  },[]);
  function settle(id:string,target:string) {
    if(id===target) return;
    move(id,target);
    const index=projects.findIndex(p=>p.id===target);
    setAnnouncement(projects.find(p=>p.id===id)?.name+' ('+(index+1)+'번째 위치)');
  }
  function start(event:PointerEvent<HTMLButtonElement>,id:string) {
    if(event.button!==0 || !event.isPrimary || projects.length<2) return;
    stop();
    suppress.current='';
    const row=event.currentTarget, x=event.clientX,y=event.clientY, pointerId=event.pointerId;
    const touch=(e:TouchEvent)=>{if(grip.current?.held && e.cancelable)e.preventDefault();};
    row.addEventListener('touchmove',touch,{passive:false});
    const g:Grip={row,id,x,y,startX:x,startY:y,pointerId,target:id,held:false,stopTouch:()=>row.removeEventListener('touchmove',touch),timer:setTimeout(()=>{
      if(grip.current!==g || !row.isConnected) return;
      g.held=true;suppress.current=id;
      row.setPointerCapture(pointerId);setDrag({id,target:id});
      let scroll=row.parentElement;
      while(scroll && (scroll.scrollHeight<=scroll.clientHeight || !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY))) scroll=scroll.parentElement;
      g.scroll=scroll||undefined;
      scrollWhileHeld(g);
    },320)};
    grip.current=g;
  }
  function props(id:string):ButtonHTMLAttributes<HTMLButtonElement>&{'data-project-sort-id':string;'data-project-drag'?:string} {
    const index=projects.findIndex(p=>p.id===id);
    return {'data-project-sort-id':id,'data-project-drag':drag?.id===id?'moving':drag?.target===id?(projects.findIndex(p=>p.id===drag.id)<index?'after':'before'):undefined,
      'aria-keyshortcuts':'Alt+ArrowUp Alt+ArrowDown',
      onKeyDown:e=>{if(!e.altKey || !['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const next=projects[index+(e.key==='ArrowUp'?-1:1)];if(next)settle(id,next.id);},
      onPointerDown:e=>start(e,id),onPointerMove:e=>{
        const g=grip.current;if(!g || e.pointerId!==g.pointerId)return;g.x=e.clientX;g.y=e.clientY;
        if(g.held) hit(g);else if(Math.hypot(g.x-g.startX,g.y-g.startY)>8) stop();
      },onPointerUp:e=>{const g=grip.current;if(!g||g.pointerId!==e.pointerId)return;if(g.held){hit(g);settle(g.id,g.target);}stop();},
      onPointerLeave:()=>{if(grip.current&&!grip.current.held)stop();},onLostPointerCapture:()=>{if(grip.current)stop();},onPointerCancel:stop,
      onContextMenuCapture:e=>{if(grip.current?.held){e.preventDefault();e.stopPropagation();}},
      onClickCapture:e=>{if(e.detail!==0 && suppress.current===id){suppress.current='';e.preventDefault();e.stopPropagation();}},
    };
  }
  return {props,announcement};
}
