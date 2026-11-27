import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {ArrowRight, Check, LoaderCircle, Sparkles} from 'lucide-react';
import type {AIProvider,Session} from '../shared/types';
import {awaitsContinuation,continuationAnswer} from '../shared/execution-state';
import ResizableComposerInput from './ResizableComposerInput';
import {CodexReferenceList,useCodexReferenceMenu} from './CodexPlugins';
import type {CodexReference} from '../shared/codex-plugins';
import {canOfferFollowup, prepareAnswerFollowup, latestFollowupAnswer} from './answer-followup';
import {providerNames} from './ProviderSelect';
import './chat-continuation.css';

type Props = {
  session?: Session;
  provider: AIProvider;
  running: boolean;
  authenticated: boolean;
  aiFollowups: boolean;
  busy: boolean;
  active: boolean;
  draft: string;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange(text: string): void;
  onSend(): void;
  onChoose(prompt: string): void;
  onContinue(messageId: string, suggested?: string): Promise<void>;
  references:CodexReference[];
  referencesEnabled:boolean;
  onReferencesChange:(value:CodexReference[])=>void;
  onManagePlugins:()=>void;
};

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : '응답을 가져오지 못했습니다. 다시 시도해 주세요.';
}

export default function ChatContinuation({
  session, provider, running, authenticated, aiFollowups, busy, active, draft, placeholder, textareaRef,
  onChange, onSend, onChoose, onContinue,references,referencesEnabled,onReferencesChange,onManagePlugins,
}: Props) {
  const last = latestFollowupAnswer(session);
  const eligible = Boolean(session && last?.role === 'assistant' && last.text.trim() && !session.compacting
    && !running
    && !session.queuedMessages?.some(row => row.status === 'queued' || row.status === 'sending'));
  const sessionId = session?.id;
  const waiting = eligible && Boolean(session && awaitsContinuation(session));
  const messageId = waiting && session ? continuationAnswer(session)?.id : last?.id;
  const key = messageId && sessionId ? sessionId + ':' + messageId : '';
  const answerId = last?.id;
  const requestModel = aiFollowups && authenticated && Boolean(window.flowrium?.readChatRecommendation);
  const [action, setAction] = useState<'continue'|'complete'|null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState('');
  const [generation, setGeneration] = useState<{
    key: string;
    model: boolean;
    messages: Session['messages'];
    percent: number;
    done?: true;
    result?: NonNullable<Awaited<ReturnType<typeof prepareAnswerFollowup>>>;
  }>();
  const finished = useRef<typeof generation>(undefined);
  const composing = useRef(false);
  const referenceMenu=useCodexReferenceMenu({textareaRef,enabled:referencesEnabled,active,authenticated,busy,value:references,
    onSelect:ref=>onReferencesChange([...references,ref]),onManage:onManagePlugins});
  const revision = useRef(0);
  const continuingFlight = useRef(false);
  useEffect(() => {
    revision.current++;
    continuingFlight.current = false;
    setAction(null); setError('');
  }, [key]);
  const canShowRecommendation = useMemo(() => eligible && canOfferFollowup(session), [eligible, session]);
  const messages = session?.messages;
  useEffect(() => {
    if (!canShowRecommendation || !active || !messages || !key) return;
    if (finished.current?.key === key && finished.current.messages === messages && finished.current.model === requestModel) {
      setGeneration(finished.current);
      return;
    }
    const controller = new AbortController();
    const local = prepareAnswerFollowup(session, percent => setGeneration({key,messages,model:requestModel,percent:requestModel ? percent / 2 : percent}), controller.signal);
    const generated = requestModel && sessionId && answerId
      ? window.flowrium!.readChatRecommendation(sessionId, answerId).catch(() => null)
      : null;
    if(requestModel)void local.then(result=>{
      if(result&&!controller.signal.aborted)setGeneration({key,messages,model:requestModel,percent:50,result});
    });
    void Promise.all([local, generated]).then(([localResult, modelResult]) => {
        if (controller.signal.aborted) return;
        const state = {key, messages, model:requestModel, percent: 100, result:modelResult ?? localResult, done: true as const};
        finished.current = state;
        setGeneration(state);
      });
    return () => controller.abort();
    // 같은 답변이라도 동기화된 이전 요청이 바뀌면 전체 맥락을 다시 읽는다.
  }, [canShowRecommendation, active, key, messages, requestModel, sessionId, answerId]);
  const current = active && canShowRecommendation && generation?.key === key && generation.messages === messages && generation.model === requestModel ? generation : undefined;
  const suggestion = current?.result;
  const candidate = suggestion && (!draft || key !== accepted) ? suggestion : undefined;
  const preview = candidate && !draft && !busy ? candidate.prompt : undefined;
  const preparing = canShowRecommendation && active && key !== accepted && !current?.done;
  const percent = current?.percent ?? 0;
  function accept() {
    if (candidate && !composing.current && !busy && (draft || !textareaRef.current?.value)) {
      setAccepted(key); onChoose(candidate.prompt);
    }
  }
  async function resolveWaiting(choice: 'continue'|'complete') {
    if (!messageId || !sessionId || busy || (choice==='continue' && !authenticated) || continuingFlight.current) return;
    continuingFlight.current = true;
    const current = revision.current;
    setAction(choice); setError('');
    try {
      if (choice==='continue') await onContinue(messageId, preview);
      else await window.flowrium!.workflowAction({action:'completeContinuation', sessionId, messageId});
    }
    catch (error) { if (current === revision.current) setError(errorText(error)); }
    finally { if (current === revision.current) { continuingFlight.current = false; setAction(null); } }
  }

  return <>
    <ResizableComposerInput textareaRef={textareaRef} aria-label={`${providerNames[provider]}에 보낼 작업 요청`} value={draft}
      placeholder={preview || placeholder} data-inline-suggestion={Boolean(preview)}
      onTextChange={onChange}
      onCompositionStart={()=>{composing.current=true;}}
      aria-controls={referenceMenu.listId} aria-activedescendant={referenceMenu.activeOption}
      onInput={event=>{if(!composing.current)referenceMenu.inspect(event.currentTarget);}}
      onSelect={event=>{if(!composing.current)referenceMenu.inspect(event.currentTarget);}}
      onBlur={referenceMenu.close}
      onCompositionEnd={event=>{composing.current=false;referenceMenu.inspect(event.currentTarget);}}
      onKeyDown={e => {
        if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if(referenceMenu.onKey(e))return;
        if (e.key === 'Tab' && preview && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault(); accept();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); onSend();
        }
      }}
    />
    {referenceMenu.panel}
    <CodexReferenceList value={references} onRemove={ref=>onReferencesChange(references.filter(row=>row.kind!==ref.kind||row.id!==ref.id))}/>
    {(candidate || preparing || waiting || error) && <section className="chat-continuation" aria-label="다음 작업">
      {candidate
        ? <button type="button" className="followup-accept" data-source="conversation" onClick={accept} disabled={busy}
            title={candidate.prompt} aria-label={candidate.title + ' 입력창에 추가'}>
            <Sparkles size={13}/><small>다음 작업 추천</small><span>{candidate.title}</span>{preview && <kbd>Tab</kbd>}
          </button>
        : preparing &&
          <div className="followup-progress" role="progressbar" aria-label="작업 추천 중"
            aria-valuenow={percent} aria-valuemax={100} title="완료한 추천 생성 단계의 비율">
            <Sparkles size={13}/><span>작업 추천 중 ({percent.toFixed(1)}%)</span>
          </div>}
      {waiting && <div className="chat-continuation-actions">
        <button type="button" className="followup-proceed" disabled={busy || action!==null || !authenticated}
          onClick={() => void resolveWaiting('continue')}>{action==='continue' ? <LoaderCircle size={13} className="spin"/> : <ArrowRight size={13}/>}진행하기</button>
        <button type="button" className="followup-complete" title="이 답변의 후속 대기를 완료로 표시"
          disabled={busy || action!==null} onClick={() => void resolveWaiting('complete')}>
          {action==='complete' ? <LoaderCircle size={13} className="spin"/> : <Check size={13}/>}완료</button>
      </div>}
      {error && <p role="alert">{error}</p>}
    </section>}
  </>;
}
