import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';
import {ArrowRight, Check, ChevronRight, Expand, LoaderCircle, Sparkles, X} from 'lucide-react';
import type {Session} from '../shared/types';
import type {FollowupSuggestions} from '../shared/chat-continuation';
import {awaitsContinuation} from '../shared/execution-state';
import ResizableComposerInput from './ResizableComposerInput';
import {MotionOverlay} from './ui-motion';
import './chat-continuation.css';

export type SuggestionCache = Map<string, Promise<FollowupSuggestions>>;
type Props = {
  session?: Session;
  running: boolean;
  authenticated: boolean;
  model?: string;
  busy: boolean;
  active: boolean;
  draft: string;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  cache: SuggestionCache;
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
  session, running, authenticated, model, busy, active, draft, placeholder, textareaRef, cache,
  onChange, onSend, onChoose, onContinue,
}: Props) {
  const last = session?.messages.at(-1);
  const eligible = Boolean(session && last?.role === 'assistant' && last.text.trim() && !session.compacting
    && !running && session.workflow?.status !== 'done' && session.completedContinuationId !== last.id
    && !session.queuedMessages?.some(row => row.status === 'queued' || row.status === 'sending'));
  const sessionId = session?.id;
  const messageId = eligible ? last?.id : undefined;
  const key = sessionId && messageId ? JSON.stringify([sessionId, messageId, model, session?.preferences?.effort]) : '';
  const waiting = Boolean(session && awaitsContinuation(session));
  const [focused, setFocused] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const displayedPreview = useRef<FollowupSuggestions['suggestions'][number] | undefined>(undefined);
  useEffect(() => { if (!active) setPreviewOpen(false); }, [active]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'continue'|'complete'|null>(null);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<FollowupSuggestions['suggestions']>();
  const [index, setIndex] = useState(0);
  const revision = useRef(0);
  const flight = useRef(false);
  const continuingFlight = useRef(false);
  const attempted = useRef(false);
  useEffect(() => {
    revision.current++;
    flight.current = false;
    continuingFlight.current = false;
    attempted.current = false;
    setPreviewOpen(false);
    setLoading(false); setAction(null); setRows(undefined); setIndex(0); setError('');
    return () => { revision.current++; };
  }, [key, authenticated]);

  const requestSuggestions = useCallback((background = false) => {
    const cached = cache.get(key);
    if (cached) return cached;
    const request = window.flowrium!.workflowAction({action:'followupSuggestions', sessionId:sessionId!, messageId:messageId!, background}) as Promise<FollowupSuggestions>;
    cache.set(key, request);
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
    request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
    return request;
  }, [cache, key, sessionId, messageId]);

  // Prepare only after a turn the reader actually saw running in this chat.
  const visibleRun = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!active || !authenticated || visibleRun.current !== sessionId) visibleRun.current = undefined;
    if (running && active && authenticated) visibleRun.current = sessionId;
    if (!running && !busy && key && visibleRun.current === sessionId && sessionId) {
      visibleRun.current = undefined;
      if (!draft && !document.hidden) void requestSuggestions(true).catch(() => {});
    }
  }, [key, active, authenticated, sessionId, running, busy, draft, requestSuggestions]);

  const recommend = useCallback(async () => {
    if (!messageId || !sessionId || !authenticated || !active || busy || flight.current) return;
    const current = revision.current;
    flight.current = true;
    attempted.current = true;
    setLoading(true); setError('');
    try {
      const value = await requestSuggestions();
      if (current !== revision.current) return;
      if (value.source !== 'model' || value.sessionId !== sessionId || value.messageId !== messageId || !Array.isArray(value.suggestions))
        throw Error('추천 결과와 현재 대화가 일치하지 않습니다.');
      setRows(value.suggestions); setIndex(0);
    } catch (error) {
      if (current === revision.current) setError(errorText(error));
    } finally {
      if (current === revision.current) { flight.current = false; setLoading(false); }
    }
  }, [messageId, sessionId, authenticated, active, busy, requestSuggestions]);

  useEffect(() => {
    if (!focused || draft || attempted.current || !active || !authenticated || busy || !key) return;
    void recommend();
  }, [focused, draft, active, authenticated, busy, key, recommend]);

  const candidate = rows?.[index];
  const preview = active && authenticated && !draft ? candidate?.prompt : undefined;
  const dismiss = () => { setRows(undefined); setError(''); };
  function accept() {
    if (!candidate || !key || busy || !authenticated) return;
    onChoose(candidate.prompt);
    dismiss();
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
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Tab' && preview && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault(); accept();
        } else if (e.key === 'Escape' && candidate) {
          e.preventDefault(); dismiss();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); onSend();
        }
      }}
    />
    {key && <section className="chat-continuation" aria-label="다음 작업">
      <div className="chat-continuation-actions">
        {candidate
          ? <>
            <button type="button" className="followup-accept" onClick={accept} disabled={busy || !authenticated} title={candidate.reason}
              aria-label={candidate.title + ' 입력창에 추가'}><Sparkles size={13}/><span>{candidate.title}</span>{preview && <kbd>Tab</kbd>}</button>
            <button type="button" className="followup-preview" aria-label="추천 전문 보기" title="추천 전문 보기"
              aria-haspopup="dialog" onClick={() => {displayedPreview.current = candidate; setPreviewOpen(true);}}><Expand size={13}/></button>
            {rows && rows.length > 1 && <button type="button" className="followup-cycle" aria-label="다른 추천 보기"
              onClick={() => setIndex((index + 1) % rows.length)}>{index + 1}/{rows.length}<ChevronRight size={12}/></button>}
            <button type="button" className="followup-dismiss" aria-label="추천 닫기" onClick={dismiss}><X size={13}/></button>
          </>
          : <button type="button" className="followup-request" aria-label="다음 작업 추천받기" onClick={() => void recommend()}
              disabled={busy || loading || !authenticated}>{loading ? <LoaderCircle size={13} className="spin"/> : <Sparkles size={13}/>}
              <span>{loading ? '추천 작성 중' : error ? '추천 다시 받기' : '다음 작업 추천'}</span></button>}
        {waiting && <>
          <button type="button" className="followup-proceed" disabled={busy || action!==null || !authenticated}
            onClick={() => void resolveWaiting('continue')}>{action==='continue' ? <LoaderCircle size={13} className="spin"/> : <ArrowRight size={13}/>}진행하기</button>
          <button type="button" className="followup-complete" title="이 답변의 후속 대기를 완료로 표시"
            disabled={busy || action!==null} onClick={() => void resolveWaiting('complete')}>
            {action==='complete' ? <LoaderCircle size={13} className="spin"/> : <Check size={13}/>}완료</button>
        </>}
      </div>
      {error && <p role="alert">{error}</p>}
      {rows?.length === 0 && <p role="status">지금 이어서 추천할 작업이 없습니다.</p>}
    </section>}
    <MotionOverlay open={Boolean(previewOpen && candidate && active)} label="다음 작업 추천 전문"
      onClose={() => setPreviewOpen(false)} className="followup-preview-dialog">
      <header><h2>{displayedPreview.current?.title}</h2><button className="icon-button" type="button" aria-label="추천 전문 닫기" onClick={() => setPreviewOpen(false)}><X size={16}/></button></header>
      <p>{displayedPreview.current?.prompt}</p>
      <footer><button type="button" className="button primary" disabled={busy || !authenticated} onClick={() => {setPreviewOpen(false); accept();}}>입력창에 추가</button></footer>
    </MotionOverlay>
  </>;
}
