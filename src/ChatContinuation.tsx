import {useCallback, useEffect, useRef, useState, type RefObject} from 'react';
import {ArrowRight, ChevronRight, LoaderCircle, Sparkles, X} from 'lucide-react';
import type {Session} from '../shared/types';
import type {FollowupSuggestions} from '../shared/chat-continuation';
import {awaitsContinuation} from '../shared/execution-state';
import './chat-continuation.css';

export type SuggestionCache = Map<string, Promise<FollowupSuggestions>>;
type Props = {
  session?: Session;
  running: boolean;
  authenticated: boolean;
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
  session, running, authenticated, busy, active, draft, placeholder, textareaRef, cache,
  onChange, onSend, onChoose, onContinue,
}: Props) {
  const last = session?.messages.at(-1);
  const eligible = Boolean(session && last?.role === 'assistant' && last.text.trim() && !session.compacting
    && !running && session.workflow?.status !== 'done'
    && !session.queuedMessages?.some(row => row.status === 'queued' || row.status === 'sending'));
  const sessionId = session?.id;
  const messageId = eligible ? last?.id : undefined;
  const key = sessionId && messageId ? sessionId + ':' + messageId : '';
  const waiting = Boolean(session && awaitsContinuation(session));
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [continuing, setContinuing] = useState(false);
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
    setLoading(false); setContinuing(false); setRows(undefined); setIndex(0); setError('');
    return () => { revision.current++; };
  }, [key, authenticated]);

  const recommend = useCallback(async () => {
    if (!messageId || !sessionId || !authenticated || !active || busy || flight.current) return;
    const current = revision.current;
    flight.current = true;
    attempted.current = true;
    setLoading(true); setError('');
    try {
      let request = cache.get(key);
      if (!request) {
        request = window.flowrium!.workflowAction({action:'followupSuggestions', sessionId, messageId}) as Promise<FollowupSuggestions>;
        cache.set(key, request);
        if (cache.size > 20) cache.delete(cache.keys().next().value!);
        request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
      }
      const value = await request;
      if (current !== revision.current) return;
      if (value.source !== 'model' || value.sessionId !== sessionId || value.messageId !== messageId || !Array.isArray(value.suggestions))
        throw Error('추천 결과와 현재 대화가 일치하지 않습니다.');
      setRows(value.suggestions); setIndex(0);
    } catch (error) {
      if (current === revision.current) setError(errorText(error));
    } finally {
      if (current === revision.current) { flight.current = false; setLoading(false); }
    }
  }, [messageId, sessionId, authenticated, active, busy, cache, key]);

  useEffect(() => {
    if (!focused || draft || attempted.current || !active || !authenticated || busy || !key) return;
    const timer = window.setTimeout(() => void recommend(), 550);
    return () => window.clearTimeout(timer);
  }, [focused, draft, active, authenticated, busy, key, recommend]);

  const candidate = rows?.[index];
  const preview = active && authenticated && !draft ? candidate?.prompt : undefined;
  const dismiss = () => { setRows(undefined); setError(''); };
  function accept() {
    if (!candidate || !key || busy || !authenticated) return;
    onChoose(candidate.prompt);
    dismiss();
  }

  async function proceed() {
    if (!messageId || busy || !authenticated || continuingFlight.current) return;
    continuingFlight.current = true;
    const current = revision.current;
    setContinuing(true); setError('');
    try { await onContinue(messageId); }
    catch (error) { if (current === revision.current) setError(errorText(error)); }
    finally { if (current === revision.current) { continuingFlight.current = false; setContinuing(false); } }
  }

  return <>
    <textarea ref={textareaRef} aria-label="Codex에 보낼 작업 요청" value={draft}
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
            {rows && rows.length > 1 && <button type="button" className="followup-cycle" aria-label="다른 추천 보기"
              onClick={() => setIndex((index + 1) % rows.length)}>{index + 1}/{rows.length}<ChevronRight size={12}/></button>}
            <button type="button" className="followup-dismiss" aria-label="추천 닫기" onClick={dismiss}><X size={13}/></button>
          </>
          : <button type="button" className="followup-request" aria-label="다음 작업 추천받기" onClick={() => void recommend()}
              disabled={busy || loading || !authenticated}>{loading ? <LoaderCircle size={13} className="spin"/> : <Sparkles size={13}/>}
              <span>{loading ? '추천 작성 중' : error ? '추천 다시 받기' : '다음 작업 추천'}</span></button>}
        {waiting && <button type="button" className="followup-proceed" disabled={busy || continuing || !authenticated}
          onClick={() => void proceed()}>{continuing ? <LoaderCircle size={13} className="spin"/> : <ArrowRight size={13}/>}진행하기</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {rows?.length === 0 && <p role="status">지금 이어서 추천할 작업이 없습니다.</p>}
    </section>}
  </>;
}
