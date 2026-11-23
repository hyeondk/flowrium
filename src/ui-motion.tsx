import {isImeKey} from './ime';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type RefObject, type ReactNode } from 'react';
import {ThumbsUp} from 'lucide-react';
import {createPortal} from 'react-dom';

export type MotionPhase = 'enter' | 'idle' | 'exit';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    change();
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** 닫힘 동작이 끝난 뒤 언마운트합니다. 열림 상태가 빠르게 바뀌면 이전 타이머를 취소합니다. */
export function usePresence(open: boolean, durationMs = 240, exitElement?: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const duration = reduced ? 1 : Math.max(200, Math.min(400, durationMs));
  const [state, setState] = useState<{ present: boolean; phase: MotionPhase }>(() => ({ present: open, phase: open ? 'enter' : 'exit' }));
  useLayoutEffect(() => {
    if (open) setState({ present: true, phase: 'enter' });
    else setState(previous => previous.present ? { present: true, phase: 'exit' } : previous);
    // CSS의 마지막 프레임까지 그린 뒤 배치에서 제거한다. 백그라운드 창의 rAF는 멈출 수 있다.
    let frame=0, timer=0, fallback=0;
    const finish=()=>setState(open ? {present:true,phase:'idle'} : {present:false,phase:'exit'});
    if(!open && !reduced && exitElement?.current){
      // 잠금막은 창이 실제로 그린 마지막 애니메이션 프레임까지 보존한다.
      let cancelled=false;
      const onVisibility=()=>{
        clearTimeout(timer);
        if(document.hidden) timer=window.setTimeout(finish,duration);
      };
      onVisibility();
      document.addEventListener('visibilitychange',onVisibility);
      frame=requestAnimationFrame(()=>{
        const animations=exitElement.current?.getAnimations() || [];
        Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{
          if(!cancelled) frame=requestAnimationFrame(finish);
        });
      });
      return ()=>{
        cancelled=true;cancelAnimationFrame(frame);clearTimeout(timer);
        document.removeEventListener('visibilitychange',onVisibility);
      };
    }
    if(reduced||document.hidden)timer=window.setTimeout(finish,reduced?0:duration);
    else{
      fallback=window.setTimeout(finish,duration+100);
      frame=requestAnimationFrame(()=>{timer=window.setTimeout(()=>{clearTimeout(fallback);finish()},duration+16)});
    }
    return ()=>{cancelAnimationFrame(frame);window.clearTimeout(timer);window.clearTimeout(fallback)};
  }, [open, duration, reduced, exitElement]);
  return state;
}

export function MotionPresence({ open, durationMs = 240, children }: { open: boolean; durationMs?: number; children: (phase: MotionPhase) => ReactNode }) {
  const { present, phase } = usePresence(open, durationMs);
  return present ? children(phase) : null;
}

export function ModalPortal({children}:{children:ReactNode}){return createPortal(children,document.body);}

export function CloseButton({children = '닫기', className = '', ...props}: ComponentPropsWithRef<'button'>) {
  return <button type="button" {...props} className={`popup-close-button ${className}`}>{children}</button>;
}

export function MotionOverlay({ open, onClose, children, label, className = '', kind = 'popup', durationMs = 240, initialFocus, persist=false }: {
  open: boolean; onClose?: () => void; children: ReactNode; label: string; className?: string; kind?: 'popup' | 'sheet'; durationMs?: number; initialFocus?:string; persist?:boolean;
}) {
  const { present, phase } = usePresence(open, durationMs);
  const surface = useRef<HTMLElement>(null);
  const lastOpen = useRef({children, label}), previousOpen=useRef(open);
  useLayoutEffect(() => {
    if (open) lastOpen.current = {children, label};
    const changed=previousOpen.current!==open;
    previousOpen.current=open;
    const element=surface.current;
    if (!element || kind !== 'popup' || !changed) return;
    const interrupted=present && (open ? phase==='exit' : phase==='enter');
    const prefix=open?'--popup-enter-':'--popup-start-';
    if(interrupted){
      const style=getComputedStyle(element);
      const transform=style.transform,opacity=style.opacity;
      element.style.setProperty(prefix+'transform',transform);
      element.style.setProperty(prefix+'opacity',opacity);
    }else{
      element.style.removeProperty(prefix+'transform');
      element.style.removeProperty(prefix+'opacity');
    }
  }, [open, children, label, present, phase, kind]);
  const frame = !open && present ? lastOpen.current : {children, label};
  const callback = useRef(onClose); callback.current = onClose;
  useEffect(() => {
    if (!present || !open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = surface.current;
    const targets = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])].filter(node => node.getClientRects().length > 0);
    (initialFocus && root?.querySelector<HTMLElement>(initialFocus) || targets()[0] || root)?.focus();
    const key = (event: KeyboardEvent) => {
      if(isImeKey(event))return;
      if (event.key === 'Escape' && callback.current) { event.preventDefault(); callback.current(); }
      if (event.key !== 'Tab') return;
      const rows = targets();
      if (!rows.length) { event.preventDefault(); root?.focus(); return; }
      if (event.shiftKey && (document.activeElement === rows[0] || document.activeElement === root)) { event.preventDefault(); rows.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === rows.at(-1)) { event.preventDefault(); rows[0].focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (before?.isConnected) before.focus(); };
  }, [present, open, initialFocus]);
  if (!present && !persist) return null;
  return <ModalPortal><div className={`motion-overlay ${className}`} data-phase={phase} data-kind={kind} hidden={!present} aria-hidden={!present} style={{ display:present?undefined:'none', '--motion-duration': `${Math.max(200, Math.min(400, durationMs))}ms` } as CSSProperties} onMouseDown={event => { if (open && event.target === event.currentTarget) onClose?.(); }}>
    <section className="motion-surface" data-motion={kind} data-phase={phase} role={present?"dialog":undefined} aria-modal={present?true:undefined} aria-label={frame.label} tabIndex={-1} ref={surface} inert={phase === 'exit'}>{frame.children}</section>
  </div></ModalPortal>;
}

export const toastLifetime = 5000;
type NoticeProps = { message: string; onClose?: () => void; tone?: 'success' | 'error' | 'info'; action?: ReactNode; className?: string; revision?: number };
function Notice({ message, onClose, tone = 'info', action, className = '', revision, kind }: NoticeProps & { kind: 'toast' | 'snackbar' }) {
  const last = useRef(message); if (message) last.current = message;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (kind !== 'toast' || !message || !close.current) return;
    const timer = window.setTimeout(() => close.current?.(), toastLifetime);
    return () => window.clearTimeout(timer);
  }, [kind, message, revision]);
  const { present, phase } = usePresence(Boolean(message));
  if (!present) return null;
  return <div className={`ui-notification ui-${kind} ${className}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} data-tone={tone} data-phase={phase}>
    <div className="ui-notification-surface" data-motion={kind} data-phase={phase} inert={phase === 'exit'}>
      <span className="ui-notice-indicator" aria-hidden="true">{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</span>
      <span className="ui-notice-message">{last.current}</span>{action}
      {kind === 'snackbar' && onClose && <CloseButton aria-label="알림 닫기" onClick={onClose}/>}
    </div>
  </div>;
}
export function Toast(props: NoticeProps) { return <Notice {...props} kind="toast"/>; }
export function Snackbar(props: NoticeProps) { return <Notice {...props} kind="snackbar"/>; }

export function AnimatedCheckbox({ className = '', ...props }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <span className="ui-checkbox-control"><input {...props} type="checkbox" className={className}/><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="1" y="1" width="18" height="18" rx="5"/><path d="M5 10.2 8.3 13.4 15 6.8" pathLength="1"/></svg></span>;
}

export function AnimatedSwitch({className='',...props}:Omit<ComponentPropsWithRef<'input'>,'type'|'role'>){
  return <span className="ui-switch-control"><input {...props} className={className} type="checkbox" role="switch"/><span className="ui-switch-track" aria-hidden="true"><span className="ui-switch-thumb"/></span></span>;
}

export function LikeButton({active,onClick,disabled}:{active:boolean;onClick():void;disabled?:boolean}){
  const [pulse,setPulse]=useState(0);
  return <button type="button" className="ui-like-button" aria-label={active?'좋아요 취소':'좋아요'} aria-pressed={active} disabled={disabled} onClick={()=>{setPulse(value=>value+1);onClick()}}><span key={pulse} className="ui-spring-glyph" data-pulse={pulse?'true':'false'}><ThumbsUp size={14} fill={active?'currentColor':'none'}/></span><span>좋아요</span></button>;
}
