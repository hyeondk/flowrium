import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';

export type MotionPhase = 'enter' | 'idle' | 'exit';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** 닫힘 동작이 끝난 뒤 언마운트합니다. 열림 상태가 빠르게 바뀌면 이전 타이머를 취소합니다. */
export function usePresence(open: boolean, durationMs = 240) {
  const reduced = useReducedMotion();
  const duration = reduced ? 1 : Math.max(200, Math.min(400, durationMs));
  const [state, setState] = useState<{ present: boolean; phase: MotionPhase }>(() => ({ present: open, phase: open ? 'enter' : 'exit' }));
  useLayoutEffect(() => {
    if (open) setState({ present: true, phase: 'enter' });
    else setState(previous => previous.present ? { present: true, phase: 'exit' } : previous);
    const timer = window.setTimeout(() => setState(open ? { present: true, phase: 'idle' } : { present: false, phase: 'exit' }), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration]);
  return state;
}

export function MotionPresence({ open, durationMs = 240, children }: { open: boolean; durationMs?: number; children: (phase: MotionPhase) => ReactNode }) {
  const { present, phase } = usePresence(open, durationMs);
  return present ? children(phase) : null;
}

export function MotionOverlay({ open, onClose, children, label, className = '', kind = 'popup', durationMs = 240 }: {
  open: boolean; onClose?: () => void; children: ReactNode; label: string; className?: string; kind?: 'popup' | 'sheet'; durationMs?: number;
}) {
  const { present, phase } = usePresence(open, durationMs);
  const surface = useRef<HTMLElement>(null);
  const callback = useRef(onClose); callback.current = onClose;
  useEffect(() => {
    if (!present || !open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = surface.current;
    const targets = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])].filter(node => node.getClientRects().length > 0);
    (targets()[0] || root)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && callback.current) { event.preventDefault(); callback.current(); }
      if (event.key !== 'Tab') return;
      const rows = targets();
      if (!rows.length) { event.preventDefault(); root?.focus(); return; }
      if (event.shiftKey && (document.activeElement === rows[0] || document.activeElement === root)) { event.preventDefault(); rows.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === rows.at(-1)) { event.preventDefault(); rows[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (before?.isConnected) before.focus(); };
  }, [present, open]);
  if (!present) return null;
  return <div className={`motion-overlay ${className}`} data-phase={phase} data-kind={kind} style={{ '--motion-duration': `${Math.max(200, Math.min(400, durationMs))}ms` } as CSSProperties} onMouseDown={event => { if (open && event.target === event.currentTarget) onClose?.(); }}>
    <section className="motion-surface" data-motion={kind} data-phase={phase} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={surface} inert={phase === 'exit'}>{children}</section>
  </div>;
}

type NoticeProps = { message: string; onClose?: () => void; tone?: 'success' | 'error' | 'info'; action?: ReactNode; className?: string };
function Notice({ message, onClose, tone = 'info', action, className = '', kind }: NoticeProps & { kind: 'toast' | 'snackbar' }) {
  const last = useRef(message); if (message) last.current = message;
  const { present, phase } = usePresence(Boolean(message));
  if (!present) return null;
  return <div className={`ui-notification ui-${kind} ${className}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} data-tone={tone} data-phase={phase}>
    <div className="ui-notification-surface" data-motion={kind} data-phase={phase} inert={phase === 'exit'}>
      <span className="ui-notice-indicator" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</span>
      <span className="ui-notice-message">{last.current}</span>{action}
      {onClose && <button type="button" className="ui-notice-close" aria-label="알림 닫기" onClick={onClose}>×</button>}
    </div>
  </div>;
}
export function Toast(props: NoticeProps) { return <Notice {...props} kind="toast"/>; }
export function Snackbar(props: NoticeProps) { return <Notice {...props} kind="snackbar"/>; }

export function AnimatedCheckbox({ className = '', ...props }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <span className="ui-checkbox-control"><input {...props} type="checkbox" className={className}/><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="1" y="1" width="18" height="18" rx="5"/><path d="M5 10.2 8.3 13.4 15 6.8" pathLength="1"/></svg></span>;
}
