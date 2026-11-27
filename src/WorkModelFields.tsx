import { useEffect, useState } from 'react';
import type { AIProvider, Effort, Model } from '../shared/types';
import { effortDisplayName, modelDisplayName } from '../shared/model-display';
import { effortOptions } from '../shared/model-options';
import { ProviderSelect, useProviderModels } from './ProviderSelect';
import './work-model-fields.css';

type Choice = { provider?: AIProvider; model: string; effort: Effort | '' };
type CodexStatus = { models: Model[]; ready: boolean; loading: boolean; error?: string };
const emptyChoice: Choice = { model: '', effort: '' };
const pendingCodex: CodexStatus = { models: [], ready: false, loading: true };

export function useWorkModel(active = true) {
  const catalog = useProviderModels();
  const [choice, setChoice] = useState<Choice>(emptyChoice);
  const [codex, setCodex] = useState(pendingCodex);
  const [request, setRequest] = useState(0);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const provider = catalog.claudeEnabled ? choice.provider ?? catalog.defaultProvider : 'codex';

  useEffect(() => {
    if (!active || provider !== 'codex') return;
    let current = true;
    const api = window.flowrium;
    setCodex(pendingCodex);
    if (!api) {
      setCodex({ models: [], ready: false, loading: false, error: '데스크톱 앱에서 ChatGPT 계정을 연결하세요.' });
      return;
    }
    api.connect().then(result => {
      if (current) setCodex({ models: result.models, ready: result.status.authenticated, loading: false, error: result.status.error });
    }).catch(error => {
      if (current) setCodex({ models: [], ready: false, loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { current = false; };
  }, [active, provider, request]);

  const claude = provider === 'claude';
  const models = claude ? catalog.claudeModels : codex.models;
  const model = choice.provider === provider && models.some(row => row.id === choice.model) ? choice.model : '';
  const selected = models.find(row => row.id === (model || (claude ? catalog.claudeModel : undefined))) || models.find(row => row.isDefault);
  const efforts = effortOptions(selected);
  const effort = choice.provider === provider && efforts.some(row => row.reasoningEffort === choice.effort) ? choice.effort : '';
  const ready = claude ? catalog.claudeConnected : codex.ready;
  const loading = claude ? checkingClaude : codex.loading;
  const connectionHint = claude ? '설정의 Claude 연결에서 Anthropic API 키를 등록하세요.' : 'ChatGPT 계정을 연결한 뒤 AI 업무를 시작하세요.';
  const connectionError = loading || ready ? '' : (claude ? catalog.claudeError : codex.error) || connectionHint;

  async function refresh() {
    if (!claude) { setRequest(value => value + 1); return; }
    if (!catalog.refreshClaude) return;
    setCheckingClaude(true);
    try { await catalog.refreshClaude(); }
    finally { setCheckingClaude(false); }
  }

  return {
    provider, providerName: claude ? 'Claude' : 'ChatGPT', claudeEnabled: catalog.claudeEnabled,
    ready, loading, connectionError, connectionHint, models, model, efforts, effort, refresh,
    request: { ...(catalog.claudeEnabled && { provider }), ...(model && { model }), ...(effort && { effort }) },
    selectProvider: (value: AIProvider) => setChoice({ provider: value, model: '', effort: '' }),
    selectModel: (value: string) => setChoice({ provider, model: value, effort: '' }),
    selectEffort: (value: Effort | '') => setChoice({ provider, model, effort: value }),
  };
}

type Props = {
  selection: ReturnType<typeof useWorkModel>;
  className?: string;
  providerLabel?: string;
  modelLabel?: string;
  effortLabel?: string;
  disabled?: boolean;
};
export default function WorkModelFields({ selection, className, providerLabel, modelLabel, effortLabel, disabled }: Props) {
  return <div className={['work-model-fields', className].filter(Boolean).join(' ')}>
    <ProviderSelect value={selection.provider} claudeEnabled={selection.claudeEnabled} onChange={selection.selectProvider} label={providerLabel} disabled={disabled}/>
    <label>사용할 {selection.providerName} 모델<select aria-label={modelLabel} value={selection.model} disabled={disabled || selection.loading} onChange={event => selection.selectModel(event.target.value)}>
      <option value="">계정 기본 모델</option>
      {selection.models.map(model => <option key={model.id} value={model.id}>{modelDisplayName(model)}</option>)}
    </select></label>
    <label>추론 수준<select aria-label={effortLabel} value={selection.effort} disabled={disabled || selection.loading} onChange={event => selection.selectEffort(event.target.value as Effort | '')}>
      <option value="">모델 기본값</option>
      {selection.efforts.map(row => <option key={row.reasoningEffort} value={row.reasoningEffort}>{effortDisplayName(row.reasoningEffort)}</option>)}
    </select></label>
  </div>;
}
