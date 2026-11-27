import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Sparkles } from 'lucide-react';
import type { ClaudeConnection, FlowriumAPI } from '../shared/types';
import { AnimatedSwitch } from './ui-motion';

type Configure = Parameters<FlowriumAPI['configureClaude']>[0];

export function useClaudeConnection(api: FlowriumAPI | undefined, enabled: boolean) {
  const [status, setStatus] = useState<ClaudeConnection>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const available = typeof api?.readClaudeConnection === 'function' && typeof api?.configureClaude === 'function' && typeof api?.checkClaudeConnection === 'function';

  const run = useCallback(async (request: () => Promise<ClaudeConnection>) => {
    if (!enabled || !available) return;
    const revision = ++generation.current;
    setBusy(true);
    try {
      const result = await request();
      if (generation.current === revision) setStatus(result);
    } catch {
      if (generation.current === revision) setStatus(previous => ({
        configured: previous?.configured ?? false,
        connected: false,
        models: [],
        error: 'Claude 연결을 확인하지 못했습니다. 연결을 다시 확인해 주세요.',
      }));
    } finally {
      if (generation.current === revision) setBusy(false);
    }
  }, [available, enabled]);

  useEffect(() => {
    if (!enabled || !available || !api) {
      setStatus(undefined);
      setBusy(false);
      return;
    }
    void run(async () => {
      const saved = await api.readClaudeConnection();
      return saved.configured && !saved.connected ? api.checkClaudeConnection() : saved;
    });
    return () => { generation.current++; };
  }, [api, available, enabled, run]);

  const refresh = useCallback(() => run(() => api!.checkClaudeConnection()), [api, run]);
  const configure = useCallback((input: Configure) => run(() => api!.configureClaude(input)), [api, run]);
  return { available, status, busy, refresh, configure };
}

export default function ClaudeConnectionPanel({ enabled, onEnable, connection, onConsole }: {
  enabled: boolean;
  onEnable(value: boolean): Promise<boolean>;
  connection: ReturnType<typeof useClaudeConnection>;
  onConsole(): void;
}) {
  const [key, setKey] = useState('');
  const [pendingEnabled, setPendingEnabled] = useState<boolean>();
  const { status, available, busy, configure, refresh } = connection;

  async function changeEnabled(value: boolean) {
    setPendingEnabled(value);
    try {
      if (await onEnable(value) && !value) setKey('');
    } finally { setPendingEnabled(undefined); }
  }

  return <section className="settings-section claude-connection-settings" aria-labelledby="claude-connection-title">
    <h3 id="claude-connection-title"><Sparkles size={17} />Claude 연결</h3>
    <p>Claude를 켜면 대화와 보고서에서 AI 서비스를 고를 수 있습니다.</p>
    <label>
      Claude 사용
      <AnimatedSwitch checked={pendingEnabled??enabled} onChange={event => void changeEnabled(event.target.checked)} disabled={!available || pendingEnabled!==undefined} />
    </label>
    {!available && <p className="field-hint">Claude 연결은 데스크톱 앱에서 설정할 수 있습니다.</p>}
    {enabled && available && <>
      <p className="field-hint">Anthropic 콘솔에서 발급한 API 키를 사용합니다. Claude 요청은 연결한 Anthropic 계정의 API 사용량으로 계산됩니다.</p>
      <div className="connection-state" role="status">
        <span aria-hidden="true" className={`status-dot ${status?.connected ? 'online' : ''}`} />
        <span>{status?.connected ? 'Claude에 연결됨' : busy ? '연결 확인 중' : status?.configured ? '저장한 API 키 확인 필요' : 'API 키 연결 필요'}</span>
        {busy && <LoaderCircle size={15} className="spin" aria-hidden="true" />}
      </div>
      {status?.error && <p className="settings-error" role="alert">{status.error}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        if (!busy && key.trim()) { void configure({ apiKey: key.trim() }); setKey(''); }
      }}>
        <label className="field-label">
          Anthropic API 키
          <input className="text-input" type="password" value={key} autoComplete="off" autoCapitalize="none" spellCheck={false}
            disabled={busy} maxLength={512} onChange={event => setKey(event.target.value)} />
        </label>
        <div className="settings-buttons">
          <button type="button" className="button secondary" onClick={onConsole}>API 키 발급 <ExternalLink size={13} /></button>
          {status?.configured && <>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void refresh()}>Claude 연결 확인</button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setKey(''); void configure({ remove: true }); }}>API 키 삭제</button>
          </>}
          <button type="submit" className="button primary" disabled={busy || !key.trim()}>API 키 연결</button>
        </div>
      </form>
    </>}
  </section>;
}
