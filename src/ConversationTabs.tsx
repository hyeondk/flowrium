import {useLayoutEffect,useRef,type KeyboardEvent} from 'react';
import {Folder,MessageCircle,Plus,X} from 'lucide-react';
import type {Session} from '../shared/types';
import {executionLabels,type ExecutionState} from '../shared/execution-state';
import {isImeKey} from './ime';
import './conversation-tabs.css';

export type ConversationTab = Pick<Session,'id'|'title'|'scope'> & {
  context?: string;
  state: ExecutionState | null;
};

type Props = {
  tabs: ConversationTab[];
  selected?: string;
  browsing: boolean;
  disabled?: boolean;
  panelId: string;
  tabId(id:string):string;
  onSelect(id:string):void;
  onClose(id:string):void;
  onBrowse():void;
  onEmpty():void;
};

export default function ConversationTabs({tabs,selected,browsing,disabled,panelId,tabId,onSelect,onClose,onBrowse,onEmpty}:Props) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string,HTMLButtonElement>());
  const focusAfterClose = useRef<string|undefined>(undefined);
  const tabOrder = tabs.map(tab=>tab.id).join(' ');

  useLayoutEffect(()=>{
    if (focusAfterClose.current) {
      buttons.current.get(focusAfterClose.current)?.focus();
      focusAfterClose.current = undefined;
    }
    const viewport = list.current;
    const active = selected && buttons.current.get(selected)?.parentElement;
    if (!viewport || !active) return;
    const reveal = () => {
      const bounds = active.getBoundingClientRect(), visible = viewport.getBoundingClientRect();
      if (bounds.left < visible.left) viewport.scrollLeft -= visible.left - bounds.left;
      else if (bounds.right > visible.right) viewport.scrollLeft += bounds.right - visible.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(viewport);
    observer.observe(active);
    return ()=>observer.disconnect();
  },[tabOrder,selected]);

  function dismiss(index:number) {
    focusAfterClose.current = selected&&selected!==tabs[index].id ? selected : tabs[index+1]?.id || tabs[index-1]?.id;
    onClose(tabs[index].id);
    if (tabs.length===1) onEmpty();
  }

  function keyboard(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    if (disabled || event.altKey || event.metaKey || event.ctrlKey || isImeKey(event.nativeEvent)) return;
    if (!['ArrowLeft','ArrowRight','Home','End','Delete'].includes(event.key)) return;
    event.preventDefault();
    if (event.key==='Delete') return dismiss(index);
    const step = event.key==='ArrowRight'?1:-1;
    const next = event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+step+tabs.length)%tabs.length;
    const {id} = tabs[next];
    onSelect(id);
    buttons.current.get(id)?.focus();
  }

  return <div className="dock-conversation-tabs">
    <div ref={list} role="tablist" aria-label="열린 대화" className="dock-conversation-list">
      {tabs.map((tab,index)=>{
        const active = selected===tab.id;
        const Icon = tab.scope ? MessageCircle : Folder;
        return <div role="presentation" className="dock-conversation-tab" data-active={active} key={tab.id}>
          <button ref={node=>{if(node)buttons.current.set(tab.id,node);else buttons.current.delete(tab.id);}}
            type="button" className="dock-conversation-select" role="tab" id={tabId(tab.id)}
            aria-selected={active} aria-controls={selected?panelId:undefined} aria-disabled={disabled||undefined}
            aria-description={[tab.context,tab.state&&executionLabels[tab.state]].filter(Boolean).join(' / ')||undefined}
            tabIndex={active||(!selected&&index===0)?0:-1}
            title={tab.context?`${tab.title}\n${tab.context}`:tab.title}
            onClick={()=>{if(!disabled)onSelect(tab.id);}} onKeyDown={event=>keyboard(event,index)}>
            <Icon size={13} aria-hidden="true"/>
            <span>{tab.title}</span>
            {tab.state&&<i data-state={tab.state} aria-hidden="true"/>}
          </button>
          <button type="button" className="dock-conversation-close" aria-label={`${tab.title} 탭 닫기`}
            title="탭 닫기" disabled={disabled} tabIndex={-1} onClick={()=>dismiss(index)}>
            <X size={13} aria-hidden="true"/>
          </button>
        </div>;
      })}
    </div>
    <button type="button" className="dock-conversation-add" aria-label="대화 탭 추가" title="대화 탭 추가"
      aria-expanded={browsing} disabled={disabled} onClick={onBrowse}>
      <Plus size={17} aria-hidden="true"/>
    </button>
  </div>;
}
