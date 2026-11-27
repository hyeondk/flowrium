import {useId, useRef, useState, type CSSProperties, type KeyboardEvent} from 'react';
import {RotateCcw, Zap} from 'lucide-react';
import ChoicePicker from './ChoicePicker';
import type {AIProvider, ChatPreferences, Effort, Model, Speed} from '../shared/types';
import {modelDisplayName} from '../shared/model-display';
import {effortOptions, effectiveEffort, supportedEffort} from '../shared/model-options';
import {isImeKey} from './ime';
import {providerNames} from './ProviderSelect';
import './chat-model-picker.css';

const speedLabels: Record<Speed,string> = {standard:'Standard',fast:'Fast',ultrafast:'Ultrafast'};
const speedOrder: Speed[] = ['standard','fast','ultrafast'];
const effortLabels: Record<Effort,string> = {none:'None',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'XHigh',max:'Max',ultra:'Ultra'};
const sliderKeys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown']);
type EffortChoice = Effort | '';

function speedAvailable(speed:Speed,model?:Model,pro=false) {
  return speed==='standard'||(speed!=='ultrafast'||pro)&&(model?.supportedSpeeds?.includes(speed)??true);
}

export function AccountSpeedPreference({model,speed,pro,onChange}: {model?:Model;speed?:Speed;pro:boolean;onChange(speed:Speed):void}) {
  return <label className="field-label">
    속도
    <span>새 작업의 실행 속도입니다. Ultrafast는 지원 모델을 사용하는 Pro 계정에서 선택할 수 있습니다.</span>
    <select className="text-input" aria-label="기본 실행 속도" value={speed&&speedAvailable(speed,model,pro)?speed:'standard'}
      onChange={event=>onChange(event.target.value as Speed)}>
      {speedOrder.map(value=><option key={value} value={value} disabled={!speedAvailable(value,model,pro)}>{speedLabels[value]}</option>)}
    </select>
  </label>;
}

export type ChatModelSelection = {provider?:AIProvider; model?:string; effort?:Effort|''; speed?:Speed|''};
type Props = {
  provider: AIProvider;
  showProvider: boolean;
  providerLocked: boolean;
  claudeEnabled: boolean;
  models: Model[];
  preferences?: ChatPreferences;
  defaultModel?: string;
  defaultEffort?: Effort;
  defaultSpeed?: Speed;
  conversationKey: string;
  disabled: boolean;
  pro: boolean;
  onOpen?(): void;
  onChange(selection: ChatModelSelection): void;
};

function ChatPerformance({provider, model, preferences, defaultEffort, defaultSpeed, disabled, pro, onChange, onOpen}: {
  provider: AIProvider;
  model?: Model;
  preferences?: ChatPreferences;
  defaultEffort?: Effort;
  defaultSpeed?: Speed;
  disabled: boolean;
  pro: boolean;
  onChange(selection: ChatModelSelection): void;
  onOpen?(): void;
}) {
  const id=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useRef<HTMLDivElement>(null);
  const [showSpeed,setShowSpeed]=useState(false);
  const [preview,setPreview]=useState<EffortChoice>();
  const pending=useRef<EffortChoice>(undefined);
  const moving=useRef(false);
  const hasSpeed=provider==='codex';
  const availableEfforts=new Set(effortOptions(model).map(row=>row.reasoningEffort));
  const efforts=(Object.keys(effortLabels) as Effort[]).filter(effort=>availableEfforts.has(effort));
  const choices:EffortChoice[]=hasSpeed?efforts:['',...efforts];
  const savedChoice=hasSpeed?effectiveEffort(model,preferences?.effort??defaultEffort):supportedEffort(model,preferences?.effort)??'';
  const position=Math.max(0,choices.indexOf(preview??savedChoice??efforts[0]));
  const effort=choices[position],label=effort?effortLabels[effort]:'Default';
  const inheritedEffort=!hasSpeed&&effort===''?effectiveEffort(model,defaultEffort):undefined;
  const displayLabel=inheritedEffort?effortLabels[inheritedEffort]:label;
  const sliderLabel=inheritedEffort?`Default (${displayLabel})`:label;
  const requestedSpeed=preferences?.speed??defaultSpeed??'standard';
  const speed=hasSpeed&&speedAvailable(requestedSpeed,model,pro)?requestedSpeed:'standard';

  function clearPreview() {
    moving.current=false;
    pending.current=undefined;
    setPreview(undefined);
  }

  function commit() {
    const next=pending.current;
    clearPreview();
    if (!disabled&&next!==undefined&&next!==savedChoice) onChange({effort:next});
  }

  function closeOnEscape(event:KeyboardEvent<HTMLElement>) {
    if(event.key!=='Escape'||isImeKey(event.nativeEvent)||!popup.current?.matches(':popover-open'))return;
    event.preventDefault();
    event.stopPropagation();
    popup.current.hidePopover();
    trigger.current?.focus({preventScroll:true});
  }

  return <>
    <span className="chat-performance-slot">
      <button className="chat-performance-trigger" type="button" ref={trigger} popoverTarget={id} disabled={disabled}
        aria-label={hasSpeed?'Reasoning and speed':'Reasoning effort'} title={hasSpeed?speedLabels[speed]+' / '+label:sliderLabel} data-speed={speed} onKeyDown={closeOnEscape}>
        {speed!=='standard'&&<Zap size={12} aria-hidden="true"/>}<span>{displayLabel}</span>
      </button>
    </span>
    <div id={id} ref={popup} className="chat-performance-popup" popover="auto" role="group" aria-label="Model controls"
      onKeyDown={closeOnEscape} onToggle={event=>{if(event.newState==='closed')clearPreview();else{setShowSpeed(false);onOpen?.();}}}>
      <div className="chat-performance-heading">
        {hasSpeed?<button type="button" className="chat-performance-icon" aria-label="Speed" title="Speed" aria-expanded={showSpeed} aria-controls={id+'-speed'}
          data-fast={speed!=='standard'} onClick={()=>setShowSpeed(value=>!value)}><Zap size={16}/></button>:<span aria-hidden="true"/>}
        <div><span>Reasoning</span><strong>{sliderLabel}</strong></div>
        <span className="chat-performance-reset" data-local-tooltip>
          <button type="button" className="chat-performance-icon" aria-label="기본값으로 복구" aria-describedby={id+'-reset-tip'} data-local-tooltip
            disabled={disabled||(!preferences?.effort&&(!hasSpeed||!preferences?.speed))} onClick={()=>onChange(hasSpeed?{effort:'',speed:''}:{effort:''})}><RotateCcw size={14}/></button>
          <span id={id+'-reset-tip'} className="chat-performance-tooltip" role="tooltip">{hasSpeed?'속도와 추론 수준을 계정 기본값으로 복구합니다':'계정에서 정한 추론 수준이나 모델 기본값을 따릅니다'}</span>
        </span>
      </div>
      {choices.length > 1 ? <input className="chat-effort-slider" type="range" aria-label="Reasoning effort" aria-valuetext={sliderLabel}
        aria-disabled={disabled} min={0} max={choices.length-1} step={1} value={position}
        style={{'--effort-progress':`${100*position/(choices.length-1)}%`} as CSSProperties}
        onPointerDown={event=>{if(disabled)event.preventDefault();else moving.current=true;}}
        onPointerUp={commit} onPointerCancel={clearPreview}
        onKeyDown={event=>{if(sliderKeys.has(event.key)){if(disabled)event.preventDefault();else moving.current=true;}}}
        onKeyUp={event=>{if(sliderKeys.has(event.key))commit();}}
        onBlur={()=>{if (pending.current!==undefined) commit();}}
        onChange={event=>{
          if(disabled)return;
          const next=choices[Number(event.target.value)];
          pending.current=next;
          setPreview(next);
          if(!moving.current)commit();
        }}/> : <p className="chat-performance-note">{efforts.length ? 'One level available' : 'Model default'}</p>}
      {hasSpeed&&showSpeed&&<div id={id+'-speed'} className="chat-speeds" role="group" aria-label="Execution speed">
        {speedOrder.map(value=><button key={value} type="button" disabled={disabled||!speedAvailable(value,model,pro)} aria-pressed={value===speed}
          onClick={()=>onChange({speed:value})}>{speedLabels[value]}</button>)}
      </div>}
    </div>
  </>;
}

export default function ChatModelPicker({provider, showProvider, providerLocked, claudeEnabled, models, preferences, defaultModel, defaultEffort, defaultSpeed, conversationKey, disabled, pro, onChange, onOpen}: Props) {
  const model=preferences?.model;
  const available = (id: string) => modelDisplayName(models.find(item => item.id === id) || id);
  const inherited = defaultModel || models.find(item => item.isDefault)?.id;
  const defaultLabel = inherited ? `기본 설정 따르기 (${available(inherited)})` : '기본 설정 따르기';
  const label = model ? available(model) : inherited ? available(inherited) : '계정 기본 모델';
  const active=models.find(item=>item.id===(model||inherited));
  return <div className="chat-model-controls">
    {showProvider&&(claudeEnabled||provider==='claude')&&<div className="chat-model-picker chat-provider-picker" title={providerLocked?'이 대화에서 사용하는 AI 서비스':undefined}>
      <ChoicePicker label="이 채팅의 AI 서비스" value={provider} triggerLabel={providerNames[provider]} disabled={disabled||providerLocked}
        placement="up" menuMinWidth={140} options={[
          {value:'codex',label:providerNames.codex},
          ...(claudeEnabled?[{value:'claude',label:providerNames.claude}]:[]),
        ]} onChange={value=>onChange({provider:value as AIProvider,model:'',effort:'',speed:''})}/>
    </div>}
    <div className="model-select chat-model-picker" data-model={model||''} title={model ? `이 대화의 모델 (${label})` : defaultLabel}>
      <ChoicePicker label="이 채팅의 모델" value={model || ''} triggerLabel={label} disabled={disabled} placement="up" menuMinWidth={240} onOpen={onOpen} onFocus={onOpen}
        onChange={model=>{
          const selected=models.find(row=>row.id===(model||inherited));
          const clearEffort=provider==='claude'&&selected&&preferences?.effort&&!supportedEffort(selected,preferences.effort);
          onChange({model,...(clearEffort&&{effort:''})});
        }} options={[
          {value:'',label:defaultLabel},
          ...(model&&!models.some(item=>item.id===model)?[{value:model,label}]:[]),
          ...models.map(item=>({value:item.id,label:modelDisplayName(item)})),
        ]}/>
    </div>
    <ChatPerformance key={`${conversationKey}:${provider}`} provider={provider} model={active} preferences={preferences} defaultEffort={defaultEffort} defaultSpeed={defaultSpeed}
      disabled={disabled} pro={pro} onChange={onChange} onOpen={onOpen}/>
  </div>;
}
