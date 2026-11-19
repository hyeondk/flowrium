import {useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent} from 'react';
import type {Project} from '../shared/types';
import type {ProjectNavigationState} from '../shared/portfolio';
import './project-order.css';

export const projectOrderChanged = 'flowrium-project-order-changed';
export type MoveProject = (id:string, target:string) => Promise<boolean>;

export function useProjectOrder(projects:Project[], connected:boolean, onCatalog:(value:ProjectNavigationState)=>void, onError:(e:unknown)=>void) {
  const [nameLinks,setNameLinks]=useState<ProjectNavigationState['nameLinks']>({});
  const [order,setOrder] = useState<string[]>([]);
  const request = useRef(0);
  const moves = useRef(0);
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
      if (!active || polling || moves.current || document.hidden) return;
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
  const move:MoveProject = async (id,target)=>{
    const api = window.flowrium;
    if(!api || id===target) return false;
    const token=++request.current;
    moves.current++;
    try{
      const value=await api.portfolioAction({action:'move',id,target,sync:connected});
      if(token===request.current) receive(value);
      return true;
    }catch(error){
      onError(error);
      return false;
    }finally{
      moves.current--;
      window.dispatchEvent(new Event(projectOrderChanged));
    }
  };
  const positions=new Map(order.map((id,i)=>[id,i]));
  return {nameLinks,projects:[...projects].sort((a,b)=>(positions.get(a.id)??order.length)-(positions.get(b.id)??order.length)),move};
}

type Grip = {
  id:string; x:number; y:number; startX:number; startY:number; pointerId:number;
  row:HTMLButtonElement; list:HTMLElement;
  timer?:ReturnType<typeof setTimeout>; frame?:number;
  scroll?:HTMLElement; stopTouch:()=>void;
  origin?:Slot; phase:'pressing'|'moving'|'settling';
  target:string;
  painted?:{x:number;y:number;scroll:number};
  rows:HTMLButtonElement[];
};

type Slot = {row:HTMLButtonElement;id:string;x:number;y:number;width:number;height:number};
const motionDuration=220;

function slots(list:HTMLElement,rows:HTMLButtonElement[]):Slot[] {
  const bounds=list.getBoundingClientRect();
  const left=bounds.left+list.clientLeft-list.scrollLeft;
  const top=bounds.top+list.clientTop-list.scrollTop;
  return rows.map(row=>({row,id:row.dataset.projectSortId!,x:left+row.offsetLeft,y:top+row.offsetTop,
    width:row.offsetWidth,height:row.offsetHeight}));
}

function translate(row:HTMLElement,x:number,y:number) {
  row.style.setProperty('--project-order-x',x+'px');
  row.style.setProperty('--project-order-y',y+'px');
}

function destination(g:Grip,layout:Slot[]):Slot|undefined {
  const area=g.list.getBoundingClientRect(),clip=g.scroll?.getBoundingClientRect();
  if(g.x<Math.max(area.left,clip?.left??0)||g.x>Math.min(area.right,clip?.right??innerWidth)||
     g.y<Math.max(area.top,clip?.top??0)||g.y>Math.min(area.bottom,clip?.bottom??innerHeight))return;
  let closest:Slot|undefined,score=Infinity;
  for(const slot of layout){
    const dx=Math.max(slot.x-g.x,0,g.x-slot.x-slot.width);
    const dy=Math.max(slot.y-g.y,0,g.y-slot.y-slot.height);
    const distance=dx*dx+dy*dy;
    if(distance<score){closest=slot;score=distance;}
  }
  return closest;
}

function place(g:Grip,layout:Slot[],target:string,settling:boolean,axis:'list'|'grid') {
  const from=layout.findIndex(slot=>slot.id===g.id),to=layout.findIndex(slot=>slot.id===target);
  if(from<0||to<0)return;
  const origin=layout[from],end=layout[to];
  for(const [index,slot] of layout.entries()){
    if(index===from){
      slot.row.dataset.projectDrag=settling?'settling':'moving';
      const dx=axis==='grid'?g.x-g.startX+g.origin!.x-origin.x:0;
      const dy=g.y-g.startY+g.origin!.y-origin.y-3;
      translate(slot.row,settling?end.x-origin.x:dx,settling?end.y-origin.y:dy);
    }else{
      const shifted=from<index&&index<=to?index-1:to<=index&&index<from?index+1:index;
      const next=layout[shifted];
      if(index===to)slot.row.dataset.projectDrag=from<to?'after':'before';
      else slot.row.removeAttribute('data-project-drag');
      translate(slot.row,next.x-slot.x,next.y-slot.y);
    }
  }
}

export function useProjectGrip(projects:Project[], move:MoveProject, axis:'list'|'grid'='list') {
  const grip=useRef<Grip | undefined>(undefined), suppress=useRef('');
  const [engaged,setEngaged]=useState(false);
  const [announcement,setAnnouncement]=useState('');
  const orderKey=projects.map(project=>project.id).join(',');

  function paint(g:Grip) {
    const layout=slots(g.list,g.rows);
    g.target=destination(g,layout)?.id||g.id;
    place(g,layout,g.target,false,axis);
  }
  function follow(g:Grip) {
    if(grip.current!==g || g.phase!=='moving')return;
    if(!g.row.isConnected||!g.row.getClientRects().length){stop();return;}
    if(g.scroll) {
      const box=g.scroll.getBoundingClientRect();
      const dy=g.y>=box.top&&g.y<box.top+24 ? -6 : g.y<=box.bottom&&g.y>box.bottom-24 ? 6 : 0;
      if(dy && g.x>=box.left && g.x<=box.right)g.scroll.scrollTop+=dy;
    }
    const current={x:g.x,y:g.y,scroll:g.scroll?.scrollTop||0};
    if(!g.painted||current.x!==g.painted.x||current.y!==g.painted.y||current.scroll!==g.painted.scroll){
      paint(g);
      g.painted=current;
    }
    g.frame=requestAnimationFrame(()=>follow(g));
  }
  function release(g:Grip) {
    clearTimeout(g.timer);
    if(g.frame!==undefined)cancelAnimationFrame(g.frame);
    g.stopTouch();
    if(g.row.hasPointerCapture(g.pointerId))g.row.releasePointerCapture(g.pointerId);
  }
  function stop() {
    const g=grip.current;
    if(!g)return;
    grip.current=undefined;
    release(g);
    g.list.removeAttribute('data-project-sorting');
    for(const row of g.rows){
      row.removeAttribute('data-project-drag');
      row.style.removeProperty('--project-order-x');
      row.style.removeProperty('--project-order-y');
    }
    setEngaged(false);
  }
  useLayoutEffect(()=>{stop();},[orderKey]);
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape' && grip.current){event.preventDefault();event.stopImmediatePropagation();stop();}};
    document.addEventListener('keydown',cancel,true);window.addEventListener('blur',stop);
    return ()=>{document.removeEventListener('keydown',cancel,true);window.removeEventListener('blur',stop);stop();};
  },[]);
  async function commit(id:string,target:string) {
    if(id===target)return false;
    const project=projects.find(item=>item.id===id),index=projects.findIndex(item=>item.id===target);
    const saved=await move(id,target);
    if(saved&&project&&index>=0)setAnnouncement(project.name+' ('+(index+1)+'번째 위치)');
    return saved;
  }
  function settle(g:Grip) {
    g.phase='settling';
    release(g);
    place(g,slots(g.list,g.rows),g.target,true,axis);
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:motionDuration;
    g.timer=setTimeout(async()=>{
      if(grip.current!==g)return;
      if(g.id===g.target){stop();return;}
      const saved=await commit(g.id,g.target);
      if(grip.current!==g)return;
      if(saved){
        // The layout effect clears the preview in the same commit as the saved
        // order. Keep the translated rows in place until React renders it.
        g.frame=requestAnimationFrame(()=>{
          if(grip.current===g)g.frame=requestAnimationFrame(()=>{if(grip.current===g)stop();});
        });
        return;
      }
      place(g,slots(g.list,g.rows),g.id,true,axis);
      g.timer=setTimeout(()=>{if(grip.current===g)stop();},duration);
    },duration);
  }
  function start(event:PointerEvent<HTMLButtonElement>,id:string) {
    if(event.button!==0 || !event.isPrimary || projects.length<2 || grip.current?.phase==='settling')return;
    stop();
    suppress.current='';
    const row=event.currentTarget, x=event.clientX,y=event.clientY, pointerId=event.pointerId;
    const list=row.parentElement;
    if(!list?.classList.contains('project-order-list'))return;
    const rows=[...list.querySelectorAll<HTMLButtonElement>(':scope > [data-project-sort-id]')];
    const touch=(e:TouchEvent)=>{if(grip.current?.phase==='moving' && e.cancelable)e.preventDefault();};
    row.addEventListener('touchmove',touch,{passive:false});
    const g:Grip={row,list,rows,id,x,y,startX:x,startY:y,pointerId,target:id,phase:'pressing',stopTouch:()=>row.removeEventListener('touchmove',touch),timer:setTimeout(()=>{
      if(grip.current!==g)return;
      if(!row.isConnected || row.closest('[inert]')){stop();return;}
      g.origin=slots(list,rows).find(slot=>slot.row===row);
      if(!g.origin)return;
      try{row.setPointerCapture(pointerId);}catch{stop();return;}
      let scroll:HTMLElement|null=list;
      while(scroll && (scroll.scrollHeight<=scroll.clientHeight || !/(auto|scroll)/.test(getComputedStyle(scroll).overflowY))) scroll=scroll.parentElement;
      g.scroll=scroll||undefined;
      g.phase='moving';suppress.current=id;
      list.dataset.projectSorting='true';
      setEngaged(true);
      follow(g);
    },320)};
    grip.current=g;
  }
  function keyboardTarget(row:HTMLButtonElement,index:number,key:string) {
    if(axis!=='grid'||key==='ArrowLeft'||key==='ArrowRight')return projects[index+(['ArrowLeft','ArrowUp'].includes(key)?-1:1)]?.id;
    const list=row.parentElement;
    if(!list)return;
    const column=slots(list,[...list.querySelectorAll<HTMLButtonElement>(':scope > [data-project-sort-id]')]);
    const at=column.find(slot=>slot.row===row);
    if(!at)return;
    const rows=column.filter(slot=>key==='ArrowUp'?slot.y<at.y:slot.y>at.y);
    const y=key==='ArrowUp'?rows.at(-1)?.y:rows[0]?.y;
    return rows.filter(slot=>slot.y===y).sort((a,b)=>Math.abs(a.x-at.x)-Math.abs(b.x-at.x))[0]?.id;
  }
  function props(id:string):ButtonHTMLAttributes<HTMLButtonElement>&{'data-project-sort-id':string} {
    const index=projects.findIndex(p=>p.id===id);
    const arrows=axis==='grid'?['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];
    return {'data-project-sort-id':id,
      'aria-keyshortcuts':arrows.map(key=>'Alt+'+key).join(' '),
      onKeyDown:e=>{
        if(!e.altKey || !arrows.includes(e.key) || grip.current)return;
        e.preventDefault();
        const target=keyboardTarget(e.currentTarget,index,e.key);
        if(target)void commit(id,target);
      },
      onPointerDown:e=>start(e,id),onPointerMove:e=>{
        const g=grip.current;if(!g || e.pointerId!==g.pointerId)return;g.x=e.clientX;g.y=e.clientY;
        if(g.phase==='pressing'&&Math.hypot(g.x-g.startX,g.y-g.startY)>8)stop();
      },onPointerUp:e=>{
        const g=grip.current;if(!g||g.pointerId!==e.pointerId||g.phase==='settling')return;
        if(g.phase==='pressing'){stop();return;}
        g.x=e.clientX;g.y=e.clientY;
        g.target=destination(g,slots(g.list,g.rows))?.id||g.id;
        settle(g);
      },
      onPointerLeave:()=>{if(grip.current?.phase==='pressing')stop();},
      onLostPointerCapture:()=>{if(grip.current?.phase==='moving')stop();},
      onPointerCancel:stop,
      onContextMenuCapture:e=>{if(grip.current?.phase==='moving'){e.preventDefault();e.stopPropagation();}},
      onClickCapture:e=>{if(e.detail!==0 && suppress.current===id){suppress.current='';e.preventDefault();e.stopPropagation();}},
    };
  }
  return {props,announcement,engaged};
}
