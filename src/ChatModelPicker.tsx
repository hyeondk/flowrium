import {ChevronDown} from 'lucide-react';
import type {Model} from '../shared/types';
import {modelDisplayName} from '../shared/model-display';
import './chat-model-picker.css';

type Props = {
  models: Model[];
  model?: string;
  defaultModel?: string;
  disabled: boolean;
  onChange(model: string): void;
};

export default function ChatModelPicker({models, model, defaultModel, disabled, onChange}: Props) {
  const available = (id: string) => modelDisplayName(models.find(item => item.id === id) || id);
  const inherited = defaultModel || models.find(item => item.isDefault)?.id;
  const defaultLabel = inherited ? `기본 설정 따르기 (${available(inherited)})` : '기본 설정 따르기';
  const label = model ? available(model) : inherited ? available(inherited) : '계정 기본 모델';
  return <label className="model-select chat-model-picker" title={model ? `이 대화의 모델 (${label})` : defaultLabel}>
    <span aria-hidden="true">{label}</span><ChevronDown aria-hidden="true" size={12}/>
    <select aria-label="이 채팅의 모델" value={model || ''} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{defaultLabel}</option>
      {model && !models.some(item => item.id === model) && <option value={model}>{label}</option>}
      {models.map(item => <option key={item.id} value={item.id}>{modelDisplayName(item)}</option>)}
      {!models.length && <option disabled>계정 연결 후 모델을 선택할 수 있습니다</option>}
    </select>
  </label>;
}
