import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';
import {isImeKey} from './ime';
import './choice-picker.css';

type Props = {
  label: string;
  value: string;
  options: {value: string; label: string;leading?:ReactNode}[];
  onChange(value: string): void;
  disabled?: boolean;
  editable?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  triggerLabel?:string;
  menuMinWidth?:number;
  placement?:'auto'|'up'|'down';
  onOpen?():void;
  onFocus?():void;
};

export default function ChoicePicker({label,value,options,onChange,disabled,editable,placeholder,maxLength,className,placement='auto',onOpen,onFocus,triggerLabel,menuMinWidth=0}: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const outsidePointer = useRef(false);
  const optionRows = useRef<(HTMLButtonElement | null)[]>([]);
  const [open,setOpen] = useState(false);
  const [cursor,setCursor] = useState(0);
  const [filter,setFilter] = useState('');
  const [position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number;side:'up'|'down'}>();
  const supportsPopover=typeof HTMLElement!=='undefined'&&typeof HTMLElement.prototype.showPopover==='function';
  const rows = editable && filter ? options.filter(row=>row.label.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) : options;
  const expanded = open && !disabled && rows.length > 0;
  const selected = options.find(row=>row.value===value);
  const inside=(node:Node|null)=>Boolean(node&&(root.current?.contains(node)||popup.current?.contains(node)));

  function show() {
    if (disabled) return;
    setFilter('');
    setCursor(Math.max(0,options.findIndex(row=>row.value===value)));
    setOpen(true);
    onOpen?.();
  }
  function choose(index: number) {
    const item = rows[index];
    if (!item || disabled) return;
    onChange(item.value);
    setOpen(false);
    (editable ? input.current : trigger.current)?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isImeKey(event.nativeEvent)) return;
    if (event.key==='Tab') setOpen(false);
    else if (event.key==='Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key==='ArrowDown' || event.key==='ArrowUp') {
      event.preventDefault();
      if (!expanded) show();
      else setCursor(i=>Math.max(0,Math.min(rows.length-1,i+(event.key==='ArrowDown'?1:-1))));
    } else if (!editable && expanded && (event.key==='Home' || event.key==='End')) {
      event.preventDefault();
      setCursor(event.key==='Home'?0:rows.length-1);
    } else if (expanded && (event.key==='Enter' || (!editable && event.key===' '))) {
      event.preventDefault();
      choose(cursor);
    }
  }
  useEffect(()=>{
    if (!open) return;
    function pointerDown(event: PointerEvent) {
      outsidePointer.current = event.target instanceof Node && !inside(event.target);
    }
    function outside(event: MouseEvent) {
      if (event.target instanceof Node && !inside(event.target)) setOpen(false);
      outsidePointer.current = false;
    }
    function cancelPointer() {
      outsidePointer.current = false;
      if (!inside(document.activeElement)) setOpen(false);
    }
    // 목록을 먼저 접으면 같은 흐름의 바깥 버튼이 이동해 누름과 클릭의 대상이 달라집니다.
    document.addEventListener('pointerdown',pointerDown,true);
    document.addEventListener('click',outside);
    document.addEventListener('pointercancel',cancelPointer);
    return ()=>{
      document.removeEventListener('pointerdown',pointerDown,true);
      document.removeEventListener('click',outside);
      document.removeEventListener('pointercancel',cancelPointer);
      outsidePointer.current = false;
    };
  },[open]);
  useLayoutEffect(()=>{
    if(!expanded){setPosition(undefined);return;}
    const list=popup.current,anchor=root.current?.querySelector<HTMLElement>('.choice-trigger,.choice-edit');
    if(!list||!anchor)return;
    let frame=0;
    function place(){
      if(!list||!anchor)return;
      if(!anchor.getClientRects().length){setOpen(false);return;}
      const rect=anchor.getBoundingClientRect(),viewport=window.visualViewport;
      for(let parent=anchor.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
        if(!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))continue;
        const clip=parent.getBoundingClientRect();if(rect.bottom<=clip.top||rect.top>=clip.bottom){setOpen(false);return;}
      }
      const viewportLeft=viewport?.offsetLeft||0,viewportTop=viewport?.offsetTop||0;
      const viewportRight=viewportLeft+(viewport?.width||innerWidth),viewportBottom=viewportTop+(viewport?.height||innerHeight);
      const boundary=anchor.closest('[role=dialog],dialog')?.getBoundingClientRect();
      const leftLimit=Math.max(viewportLeft,boundary?.left??viewportLeft)+8,rightLimit=Math.min(viewportRight,boundary?.right??viewportRight)-8;
      const topLimit=Math.max(viewportTop,boundary?.top??viewportTop)+8,bottomLimit=Math.min(viewportBottom,boundary?.bottom??viewportBottom)-8;
      const width=Math.max(1,Math.min(Math.max(rect.width,menuMinWidth),rightLimit-leftLimit));
      list.style.width=width+'px';
      const style=getComputedStyle(list),borders=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
      const natural=Math.min(224,list.scrollHeight+borders),below=Math.max(0,bottomLimit-rect.bottom-6),above=Math.max(0,rect.top-topLimit-6);
      const side=placement==='up'?'up':placement==='down'?'down':below>=natural||below>=above?'down':'up';
      const maxHeight=Math.max(1,Math.min(224,side==='up'?above:below));
      list.style.maxHeight=maxHeight+'px';
      const height=list.getBoundingClientRect().height;
      setPosition({left:Math.max(leftLimit,Math.min(rect.left,rightLimit-width)),top:side==='up'?rect.top-6-height:rect.bottom+6,width,maxHeight,side});
    }
    if(supportsPopover&&!list.matches(':popover-open'))list.showPopover();
    place();
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place);};
    const onScroll=(event:Event)=>{if(!(event.target instanceof Node)||!list.contains(event.target))update();};
    const observer=new ResizeObserver(update);observer.observe(anchor);observer.observe(list);
    const boundary=anchor.closest('[role=dialog],dialog');if(boundary)observer.observe(boundary);
    document.addEventListener('scroll',onScroll,true);window.addEventListener('resize',update);
    window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);if(supportsPopover&&list.matches(':popover-open'))list.hidePopover();};
  },[expanded,rows.length,placement,supportsPopover,menuMinWidth]);
  useEffect(()=>{
    if (!expanded) return;
    const row=optionRows.current[cursor];
    const list=row?.parentElement;
    if (!row || !list) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop=row.offsetTop;
    else if (row.offsetTop+row.offsetHeight > list.scrollTop+list.clientHeight) list.scrollTop=row.offsetTop+row.offsetHeight-list.clientHeight;
  },[cursor,expanded]);
  const combobox = {
    role:'combobox',
    'aria-label':label,
    'aria-haspopup':'listbox' as const,
    'aria-expanded':expanded,
    'aria-controls':expanded?id:undefined,
    'aria-activedescendant':expanded?id+'-'+cursor:undefined,
    disabled,onKeyDown,onFocus,
  };
  const list=expanded&&<div ref={popup} className="choice-options" id={id} role="listbox" aria-label={label}
    popover={supportsPopover?'manual':undefined} data-placement={position?.side||'down'}
    style={{position:'fixed',left:position?.left,top:position?.top,width:position?.width,maxHeight:position?.maxHeight,visibility:position?'visible':'hidden'}}>
    {rows.map((item,index)=><button ref={node=>{optionRows.current[index]=node;}} type="button" role="option" key={item.value}
      id={id+'-'+index} aria-selected={item.value===value} data-active={index===cursor} tabIndex={-1}
      onPointerDown={event=>event.preventDefault()} onClick={()=>choose(index)}>
      <span className="choice-value">{item.leading}<span>{item.label}</span></span>{item.value===value&&<Check size={15}/>}
    </button>)}
  </div>;
  return <div ref={root} className={'choice-picker'+(className?' '+className:'')}
    onBlur={event=>{if (!outsidePointer.current && !inside(event.relatedTarget)) setOpen(false);}}>
    {editable
      ? <div className="choice-edit" data-expanded={expanded}>
          <input {...combobox} ref={input} aria-autocomplete="list" value={value} placeholder={placeholder} maxLength={maxLength}
            onChange={event=>{const text=event.target.value;onChange(text);setFilter(text);setCursor(0);setOpen(true);}} />
          <button type="button" className="choice-chevron" aria-label={label+' 선택 목록'} disabled={disabled}
            onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus();if(expanded)setOpen(false);else show();}}>
            <ChevronDown size={16}/>
          </button>
        </div>
      : <button {...combobox} ref={trigger} type="button" className="choice-trigger" onClick={()=>open?setOpen(false):show()}>
          <span className="choice-value">{selected?.leading}<span>{triggerLabel??(selected?.label || placeholder || value)}</span></span><ChevronDown size={16}/>
        </button>}
    {supportsPopover?list:list&&createPortal(list,document.body)}
  </div>;
}
