import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {ArrowRight, Check, LoaderCircle, Sparkles} from 'lucide-react';
import type {Session} from '../shared/types';
import {awaitsContinuation} from '../shared/execution-state';
import ResizableComposerInput from './ResizableComposerInput';
import {originalAnswerFollowups} from './answer-followup';
import './chat-continuation.css';

type Props = {
  session?: Session;
  running: boolean;
  authenticated: boolean;
  busy: boolean;
  active: boolean;
  draft: string;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange(text: string): void;
  onSend(): void;
  onChoose(prompt: string): void;
  onContinue(messageId: string): Promise<void>;
};

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : '응답을 가져오지 못했습니다. 다시 시도해 주세요.';
}

export default function ChatContinuation({
  session, running, authenticated, busy, active, draft, placeholder, textareaRef,
  onChange, onSend, onChoose, onContinue,
}: Props) {
  const last = session?.messages.at(-1);
  const eligible = Boolean(session && last?.role === 'assistant' && last.text.trim() && !session.compacting
    && !running && session.workflow?.status !== 'done' && session.completedContinuationId !== last.id
    && !session.queuedMessages?.some(row => row.status === 'queued' || row.status === 'sending'));
  const sessionId = session?.id;
  const messageId = eligible ? last?.id : undefined;
  const key = messageId && sessionId ? sessionId + ':' + messageId : '';
  const waiting = eligible && Boolean(session && awaitsContinuation(session));
  const [action, setAction] = useState<'continue'|'complete'|null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState('');
  const revision = useRef(0);
  const continuingFlight = useRef(false);
  useEffect(() => {
    revision.current++;
    continuingFlight.current = false;
    setAction(null); setError('');
  }, [key]);
  const candidate = useMemo(() => eligible && active && !draft && !busy && key !== accepted
    ? originalAnswerFollowups(session)[0] : undefined, [eligible, active, draft, busy, key, accepted, session]);
  const preview = candidate?.prompt;
  function accept() {
    if (candidate) { setAccepted(key); onChoose(candidate.prompt); }
  }
  async function resolveWaiting(choice: 'continue'|'complete') {
    if (!messageId || !sessionId || busy || (choice==='continue' && !authenticated) || continuingFlight.current) return;
    continuingFlight.current = true;
    const current = revision.current;
    setAction(choice); setError('');
    try {
      if (choice==='continue') await onContinue(messageId);
      else await window.flowrium!.workflowAction({action:'completeContinuation', sessionId, messageId});
    }
    catch (error) { if (current === revision.current) setError(errorText(error)); }
    finally { if (current === revision.current) { continuingFlight.current = false; setAction(null); } }
  }

  return <>
    <ResizableComposerInput textareaRef={textareaRef} aria-label="Codex에 보낼 작업 요청" value={draft}
      placeholder={preview || placeholder} data-inline-suggestion={Boolean(preview)}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Tab' && preview && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault(); accept();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); onSend();
        }
      }}
    />
    {(candidate || waiting || error) && <section className="chat-continuation" aria-label="다음 작업">
      <div className="chat-continuation-actions">
        {candidate && <button type="button" className="followup-accept" data-source="conversation" onClick={accept}
          aria-label={candidate.title + ' 입력창에 추가'}><Sparkles size={13}/><span>{candidate.title}</span><kbd>Tab</kbd></button>}
        {waiting && <>
          <button type="button" className="followup-proceed" disabled={busy || action!==null || !authenticated}
            onClick={() => void resolveWaiting('continue')}>{action==='continue' ? <LoaderCircle size={13} className="spin"/> : <ArrowRight size={13}/>}진행하기</button>
          <button type="button" className="followup-complete" title="이 답변의 후속 대기를 완료로 표시"
            disabled={busy || action!==null} onClick={() => void resolveWaiting('complete')}>
            {action==='complete' ? <LoaderCircle size={13} className="spin"/> : <Check size={13}/>}완료</button>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>}
  </>;
}
