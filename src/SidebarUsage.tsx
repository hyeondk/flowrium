import { Coins, Gauge, RefreshCw } from 'lucide-react';
import { creditBalance, type AccountUsage } from './account-usage';

const remainingPercent = (used: number) => Math.max(0, Math.min(100, 100 - used));

export default function SidebarUsage({usage, expanded}: {usage: AccountUsage; expanded: boolean}) {
  const {value, error, busy, connected, refresh} = usage;
  const windows = value?.buckets.flatMap(bucket => bucket.windows.map(win => ({...win, name: bucket.name}))) ?? [];
  const primary = windows[0];
  const remaining = primary && remainingPercent(primary.usedPercent);
  const resetAt = primary?.resetsAt ? new Date(primary.resetsAt).toLocaleString('ko-KR') : '';
  const summary = windows.map((win, index) => {
    const kind = win.key === 'primary' ? '현재 한도' : '추가 한도';
    const reset = win.resetsAt ? '\n(' + new Date(win.resetsAt).toLocaleString('ko-KR') + ' 초기화)' : '';
    const context = index ? win.name + ' / ' + kind + '\n' : '';
    return context + Math.round(remainingPercent(win.usedPercent)) + '% 남음' + reset;
  }).join('\n\n');
  const status = error || (busy ? '확인 중' : connected ? '한도 미제공' : '로그인 필요');
  const credits = value ? creditBalance(value.credits) : error ? '조회 실패' : '확인 중';

  return <div className="side-usage" data-connected={connected} aria-label="계정 사용량">
    <button type="button" className="side-usage-refresh" aria-label="사용량 새로고침"
      title={summary || status} onClick={() => void refresh()} disabled={busy || !connected}>
      {busy ? <RefreshCw className="spin" aria-hidden="true"/> : <Gauge aria-hidden="true"/>}
      <span>사용량</span>
      {remaining !== undefined ? <>
        <progress max={100} value={remaining} aria-label="계정의 남은 사용량"/>
        <strong>{Math.round(remaining)}%</strong>
        <span className="side-usage-suffix">남음</span>
      </> : <small>{status}</small>}
    </button>
    {resetAt && <small className="side-usage-reset">({resetAt} 초기화)</small>}
    {expanded && connected && <div className="side-credit-row" aria-label="남은 크레딧">
      <Coins size={13} aria-hidden="true"/><span>크레딧</span><strong>{credits}</strong>
    </div>}
  </div>;
}
