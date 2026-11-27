import { useState } from 'react';
import type { ProviderMode } from '../shared/types';

const modes = [
  { id: 'sync', name: '양방향 동기화', description: '같은 프로젝트에서 Codex와 Claude 대화를 각각 엽니다. Codex 대화는 연결한 Codex 앱에서도 이어갈 수 있습니다.' },
  { id: 'mixed', name: '별도 구성', description: 'Flowrium 대화 하나에서 Codex와 Claude를 골라 이어서 보냅니다. Claude 답변은 Flowrium에 보관됩니다.' },
] as const;

export function ProviderModeSetting({ value, onChange }: {
  value: ProviderMode;
  onChange(mode: ProviderMode): void;
}) {
  return <label className="field-label">
    AI 대화 구성
    <select className="text-input" aria-label="AI 대화 구성" value={value} onChange={event => onChange(event.target.value as ProviderMode)}>
      {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
    </select>
    <span>{modes.find(mode => mode.id === value)?.description}</span>
  </label>;
}

export default function ProviderModeDialog({ open, onChoose }: {
  open: boolean;
  onChoose(mode: ProviderMode): Promise<boolean>;
}) {
  const [busy, setBusy] = useState<ProviderMode>();
  const [error, setError] = useState('');
  async function choose(mode: ProviderMode) {
    if (busy) return;
    setBusy(mode);
    setError('');
    try {
      if (!await onChoose(mode)) setError('설정을 저장하지 못했습니다. 다시 선택해 주세요.');
    } finally { setBusy(undefined); }
  }

  if (!open) return null;
  return <section className="provider-mode-setup" aria-labelledby="provider-mode-setup-title">
      <h2 id="provider-mode-setup-title">AI 대화 구성 선택</h2>
      <p>설정의 계정과 모델에서 구성을 바꿀 수 있습니다.</p>
      <div className="provider-mode-choices">
        {modes.map(mode => <button type="button" key={mode.id} className="button secondary" disabled={Boolean(busy)}
          onClick={()=>void choose(mode.id)}>
          <strong>{mode.name}</strong><span>{mode.description}</span>
        </button>)}
      </div>
      {error && <p role="alert">{error}</p>}
  </section>;
}
