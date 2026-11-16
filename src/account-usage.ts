import {useEffect, useRef, useState} from 'react';
import type {UsageSnapshot} from '../shared/security';

export {creditBalance} from '../electron/mobile/usage-credits.js';

export function useAccountUsage(connected: boolean) {
  const [value, setValue] = useState<UsageSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const action = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true, loading = false;
    setValue(undefined);
    setError('');
    setBusy(false);
    async function refresh() {
      if (!connected || !window.flowrium || loading) return;
      loading = true;
      setBusy(true);
      try {
        const next = await window.flowrium.readAccountUsage();
        if (active) { setValue(next); setError(''); }
      } catch {
        if (active) { setValue(undefined); setError('계정 사용량을 갱신하지 못했습니다.'); }
      } finally {
        loading = false;
        if (active) setBusy(false);
      }
    }
    action.current = refresh;
    void refresh();
    const timer = window.setInterval(refresh, 120000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      action.current = () => {};
    };
  }, [connected]);
  return {value: connected ? value : undefined, error, busy, connected, refresh: () => action.current()};
}
export type AccountUsage = ReturnType<typeof useAccountUsage>;
