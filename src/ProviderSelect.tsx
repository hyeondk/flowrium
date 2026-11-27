import { createContext, useContext } from 'react';
import type { AIProvider, Effort, Model, ProviderMode, Session } from '../shared/types';

export const providerNames = { codex: 'Codex', claude: 'Claude' } as const;

type ProviderModels = {
  claudeEnabled: boolean;
  claudeConnected: boolean;
  claudeModels: Model[];
  claudeError?: string;
  defaultProvider: AIProvider;
  providerMode: ProviderMode;
  claudeModel?: string;
  claudeEffort?: Effort;
  refreshClaude?(): Promise<void>;
};

export const ProviderModelsContext = createContext<ProviderModels>({
  claudeEnabled: false,
  claudeConnected: false,
  claudeModels: [],
  defaultProvider: 'codex',
  providerMode: 'sync',
});

export function useProviderModels() {
  return useContext(ProviderModelsContext);
}

export function savedConversationProvider(session?: Session): AIProvider | undefined {
  if (!session) return;
  if (session.preferences?.provider || session.provider) return session.preferences?.provider ?? session.provider;
  if (session.codexLink || session.threadId || session.desktopThread || session.sourceThreadId) return 'codex';
  if (session.messages.some(message => message.role === 'user' || message.role === 'assistant')) return 'codex';
}

export function conversationOwnerProvider(session: Session): AIProvider | undefined {
  if (session.codexLink || session.threadId || session.desktopThread || session.sourceThreadId) return 'codex';
  const first = session.messages.find(message => message.role === 'user' || message.role === 'assistant');
  if (first) return first.provider ?? 'codex';
  const pending = session.queuedMessages?.find(message => message.status === 'queued' || message.status === 'sending');
  return pending ? pending.provider ?? 'codex' : undefined;
}

export function conversationTabProvider(session: Session): AIProvider {
  return conversationOwnerProvider(session) ?? savedConversationProvider(session) ?? 'codex';
}

export function ProviderSelect({ value, claudeEnabled, disabled, onChange, label = 'AI 서비스' }: {
  value: AIProvider;
  claudeEnabled?: boolean;
  disabled?: boolean;
  onChange(provider: AIProvider): void;
  label?: string;
}) {
  if (!claudeEnabled && value !== 'claude') return null;
  return <label className="field-label">
    {label}
    <select aria-label={label} className="text-input" value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as AIProvider)}>
      <option value="codex">Codex</option>
      <option value="claude" disabled={!claudeEnabled}>{claudeEnabled ? 'Claude' : 'Claude (꺼짐)'}</option>
    </select>
  </label>;
}
