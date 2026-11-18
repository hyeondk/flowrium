import ChoicePicker from './ChoicePicker';
import type {Model} from '../shared/types';
import {modelDisplayName} from '../shared/model-display';
import './chat-model-picker.css';

type Props = {
  models: Model[];
  model?: string;
  defaultModel?: string;
  disabled: boolean;
  onOpen?(): void;
  onChange(model: string): void;
};

export default function ChatModelPicker({models, model, defaultModel, disabled, onChange, onOpen}: Props) {
  const available = (id: string) => modelDisplayName(models.find(item => item.id === id) || id);
  const inherited = defaultModel || models.find(item => item.isDefault)?.id;
  const defaultLabel = inherited ? `기본 설정 따르기 (${available(inherited)})` : '기본 설정 따르기';
  const label = model ? available(model) : inherited ? available(inherited) : '계정 기본 모델';
  return <div className="model-select chat-model-picker" data-model={model||''} title={model ? `이 대화의 모델 (${label})` : defaultLabel}>
    <ChoicePicker label="이 채팅의 모델" value={model || ''} triggerLabel={label} disabled={disabled} placement="up" menuMinWidth={240} onOpen={onOpen} onFocus={onOpen}
      onChange={onChange} options={[
        {value:'',label:defaultLabel},
        ...(model&&!models.some(item=>item.id===model)?[{value:model,label}]:[]),
        ...models.map(item=>({value:item.id,label:modelDisplayName(item)})),
      ]}/>
  </div>;
}
