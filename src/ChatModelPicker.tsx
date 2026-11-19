import {useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent} from 'react';
import {RotateCcw, Zap} from 'lucide-react';
import ChoicePicker from './ChoicePicker';
import type {ChatPreferences, Effort, Model, Speed} from '../shared/types';
import {modelDisplayName} from '../shared/model-display';
import {effortOptions, effectiveEffort} from '../shared/model-options';
import {isImeKey} from './ime';
import './chat-model-picker.css';

const speedLabels: Record<Speed,string> = {standard:'Standard',fast:'Fast',ultrafast:'Ultrafast'};
const speedOrder: Speed[] = ['standard','fast','ultrafast'];
const effortLabels: Record<Effort,string> = {none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'XHigh',max:'Max',ultra:'Ultra'};
const sliderKeys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);

function speedOptions(model?: Model) {
  const advertised=model?.supportedSpeeds;
  return advertised ? speedOrder.filter(speed=>speed==='standard'||advertised.includes(speed)) : speedOrder;
}

export function AccountSpeedPreference({model,speed,onChange}: {model?:Model;speed?:Speed;onChange(speed:Speed):void}) {
  const speeds=speedOptions(model);
  return <label className="field-label">
    속도
    <span>새 작업의 실행 속도입니다. 사용 가능한 속도는 모델과 계정에 따라 달라집니다.</span>
    <select className="text-input" aria-label="기본 실행 속도" value={speed&&speeds.includes(speed)?speed:'standard'}
      onChange={event=>onChange(event.target.value as Speed)}>
      {speeds.map(value=><option key={value} value={value}>{speedLabels[value]}</option>)}
    </select>
  </label>;
}

export type ChatModelSelection = {model?:string; effort?:Effort|''; speed?:Speed|''};
type Props = {
  models: Model[];
  preferences?: ChatPreferences;
  defaultModel?: string;
  defaultEffort?: Effort;
  defaultSpeed?: Speed;
  conversationKey: string;
  disabled: boolean;
  onOpen?(): void;
  onChange(selection: ChatModelSelection): void;
};

function ChatPerformance({model, preferences, defaultEffort, defaultSpeed, disabled, onChange, onOpen}: {
  model?: Model;
  preferences?: ChatPreferences;
  defaultEffort?: Effort;
  defaultSpeed?: Speed;
  disabled: boolean;
  onChange(selection: ChatModelSelection): void;
  onOpen?(): void;
}) {
  const id=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  const [showSpeed,setShowSpeed]=useState(false);
  const [preview,setPreview]=useState<Effort>();
  const pending=useRef<Effort>(undefined);
  const moving=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const availableEfforts=new Set(effortOptions(model).map(row=>row.reasoningEffort));
  const efforts=(Object.keys(effortLabels) as Effort[]).filter(effort=>availableEfforts.has(effort));
  const savedEffort=effectiveEffort(model,preferences?.effort??defaultEffort) as Effort|undefined;
  const position=Math.max(0,efforts.indexOf(preview??savedEffort??efforts[0]));
  const label=effortLabels[efforts[position]]||'Default';
  const speeds=speedOptions(model);
  const requestedSpeed=preferences?.speed??defaultSpeed??'standard';
  const speed=speeds.includes(requestedSpeed)?requestedSpeed:'standard';

  function clearPreview() {
    clearTimeout(timer.current);
    moving.current=false;
    pending.current=undefined;
    setPreview(undefined);
  }

  function commit() {
    const next=pending.current;
    clearPreview();
    if (!disabled&&next&&next!==savedEffort) onChange({effort:next});
  }

  function closeOnEscape(event:KeyboardEvent<HTMLElement>) {
    if(event.key!=='Escape'||isImeKey(event.nativeEvent)||!popup.current?.matches(':popover-open'))return;
    event.preventDefault();
    event.stopPropagation();
    popup.current.hidePopover();
    trigger.current?.focus({preventScroll:true});
  }

  useEffect(()=>()=>clearTimeout(timer.current),[]);
  return <>
    <button className="chat-performance-trigger" type="button" ref={trigger} popoverTarget={id} disabled={disabled}
      aria-label="Reasoning and speed" title="Reasoning and speed" onKeyDown={closeOnEscape}>{label}</button>
    <div id={id} ref={popup} className="chat-performance-popup" popover="auto" role="group" aria-label="Model controls"
      onKeyDown={closeOnEscape} onToggle={event=>{if(event.newState==='closed')clearPreview();else{setShowSpeed(false);onOpen?.();}}}>
      <div className="chat-performance-heading">
        <button type="button" className="chat-performance-icon" aria-label="Speed" title="Speed" aria-expanded={showSpeed} aria-controls={id+'-speed'}
          data-fast={speed!=='standard'} onClick={()=>setShowSpeed(value=>!value)}><Zap size={16}/></button>
        <div><span>Reasoning</span><strong>{label}</strong></div>
        <button type="button" className="chat-performance-icon" aria-label="Restore defaults" title="Restore defaults"
          disabled={disabled||(!preferences?.effort&&!preferences?.speed)} onClick={()=>onChange({effort:'',speed:''})}><RotateCcw size={14}/></button>
      </div>
      {efforts.length > 1 ? <input className="chat-effort-slider" type="range" aria-label="Reasoning effort" aria-valuetext={label}
        aria-disabled={disabled} min={0} max={efforts.length-1} step={1} value={position}
        style={{'--effort-progress':`${100*position/(efforts.length-1)}%`} as CSSProperties}
        onPointerDown={event=>{if(disabled)event.preventDefault();else moving.current=true;}}
        onPointerUp={commit} onPointerCancel={clearPreview}
        onKeyDown={event=>{if(sliderKeys.has(event.key)){if(disabled)event.preventDefault();else moving.current=true;}}}
        onKeyUp={event=>{if(sliderKeys.has(event.key))commit();}}
        onBlur={()=>{if (pending.current) commit();}}
        onChange={event=>{
          if(disabled)return;
          const next=efforts[Number(event.target.value)];
          pending.current=next;
          setPreview(next);
          clearTimeout(timer.current);
          if(!moving.current)timer.current=setTimeout(commit,180);
        }}/> : <p className="chat-performance-note">{efforts.length ? 'One level available' : 'Model default'}</p>}
      {showSpeed&&<div id={id+'-speed'} className="chat-speeds" role="group" aria-label="Execution speed">
        {speeds.map(value=><button key={value} type="button" disabled={disabled} aria-pressed={value===speed}
          onClick={()=>onChange({speed:value})}>{speedLabels[value]}</button>)}
      </div>}
    </div>
  </>;
}

export default function ChatModelPicker({models, preferences, defaultModel, defaultEffort, defaultSpeed, conversationKey, disabled, onChange, onOpen}: Props) {
  const model=preferences?.model;
  const available = (id: string) => modelDisplayName(models.find(item => item.id === id) || id);
  const inherited = defaultModel || models.find(item => item.isDefault)?.id;
  const defaultLabel = inherited ? `기본 설정 따르기 (${available(inherited)})` : '기본 설정 따르기';
  const label = model ? available(model) : inherited ? available(inherited) : '계정 기본 모델';
  const active=models.find(item=>item.id===(model||inherited));
  return <div className="chat-model-controls">
    <div className="model-select chat-model-picker" data-model={model||''} title={model ? `이 대화의 모델 (${label})` : defaultLabel}>
      <ChoicePicker label="이 채팅의 모델" value={model || ''} triggerLabel={label} disabled={disabled} placement="up" menuMinWidth={240} onOpen={onOpen} onFocus={onOpen}
        onChange={model=>onChange({model})} options={[
          {value:'',label:defaultLabel},
          ...(model&&!models.some(item=>item.id===model)?[{value:model,label}]:[]),
          ...models.map(item=>({value:item.id,label:modelDisplayName(item)})),
        ]}/>
    </div>
    <ChatPerformance key={conversationKey} model={active} preferences={preferences} defaultEffort={defaultEffort} defaultSpeed={defaultSpeed}
      disabled={disabled} onChange={onChange} onOpen={onOpen}/>
  </div>;
}
