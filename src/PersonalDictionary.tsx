import {useEffect, useId, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {BookOpen, Pencil, Plus, RefreshCw, Search, Trash2} from 'lucide-react';
import {dictionaryLimits, type DictionaryAction, type DictionaryEntry, type DictionaryState} from '../shared/dictionary';
import LoadingProgress from './LoadingProgress';
import {AnimatedSwitch, CloseButton, MotionOverlay} from './ui-motion';
import './personal-dictionary.css';

const dictionaryDate = new Intl.DateTimeFormat('ko-KR', {year:'numeric', month:'2-digit', day:'2-digit'});
const collator = new Intl.Collator('ko-KR', {numeric:true, sensitivity:'base'});
type Editor = {kind:'edit'; entry:DictionaryEntry; term:string} | {kind:'delete'; entry:DictionaryEntry};
type Changes = { [Action in DictionaryAction as Action['action']]: Omit<Action, 'revision'> };
type Change = Changes[keyof Changes];

function cleanError(error:unknown, fallback:string) {
  if (!(error instanceof Error)) return fallback;
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') || fallback;
}

function DictionaryPage({children}: {children:ReactNode}) {
  return <div className="page-scroll">
    <section className="page-inner personal-dictionary" aria-label="개인 사전">
      <header className="dictionary-heading"><h1><BookOpen size={22} aria-hidden="true"/>개인 사전</h1></header>
      {children}
    </section>
  </div>;
}

function ConnectedDictionary({api}: {api:NonNullable<typeof window.flowrium>}) {
  const [state,setState]=useState<DictionaryState>();
  const [loadError,setLoadError]=useState('');
  const [retry,setRetry]=useState(0);
  const [query,setQuery]=useState('');
  const [newTerm,setNewTerm]=useState('');
  const [editor,setEditor]=useState<Editor>();
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const writing=useRef(false);
  const helpId=useId();

  useEffect(()=>{
    let current=true;
    api.dictionaryState().then(value=>{if(current)setState(value);})
      .catch(reason=>{if(current)setLoadError(cleanError(reason,'사전을 불러오지 못했습니다.'));});
    return ()=>{current=false;};
  },[api,retry]);

  async function mutate(change:Change) {
    if (!state || writing.current) return;
    writing.current=true;
    setBusy(true);setError('');setNotice('');
    try {
      setState(await api.dictionaryAction({...change,revision:state.revision}));
      setEditor(undefined);
      if(change.action==='save'){
        if(!change.entry.id)setNewTerm('');
        setNotice('단어를 저장했습니다.');
      }
      if(change.action==='delete')setNotice('단어를 삭제했습니다.');
    } catch(reason) {
      setError(cleanError(reason,'사전을 변경하지 못했습니다.'));
      // 다른 곳에서 바뀐 목록과 입력 중인 단어를 함께 보존합니다.
      await api.dictionaryState().then(setState).catch(()=>{});
    } finally {
      writing.current=false;
      setBusy(false);
    }
  }

  function submitNew(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term=newTerm.trim();
    if(term)void mutate({action:'save',entry:{term}});
  }

  function submitEdit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(editor?.kind==='edit'&&editor.term.trim())void mutate({action:'save',entry:{id:editor.entry.id,term:editor.term.trim()}});
  }

  const needle=query.trim().normalize('NFKC').toLowerCase();
  const rows=(state?.entries ?? []).filter(entry=>entry.term.normalize('NFKC').toLowerCase().includes(needle))
    .sort((left,right)=>right.createdAt.localeCompare(left.createdAt)||collator.compare(left.term,right.term));
  const full=Boolean(state&&state.entries.length>=dictionaryLimits.entries);
  const dialogTitle=editor?.kind==='delete'?'단어를 삭제할까요?':'단어 수정';
  function begin(change:Editor){setError('');setNotice('');setEditor(change);}

  return <DictionaryPage>
    {state ? <>
      <label className="dictionary-chat-setting">
        <span><strong>대화에서 사전 참고</strong><small id={helpId}>새 요청에서 일치하는 단어를 참고합니다.</small></span>
        <AnimatedSwitch aria-label="대화에서 사전 참고" aria-describedby={helpId} checked={state.includeInChat} disabled={busy}
          onChange={event=>void mutate({action:'settings',includeInChat:event.currentTarget.checked})}/>
      </label>
      <form className="dictionary-add-form" onSubmit={submitNew}>
        <input aria-label="단어 입력" placeholder="기록할 단어" value={newTerm} disabled={busy||full} required maxLength={dictionaryLimits.term}
          onChange={event=>setNewTerm(event.target.value)}/>
        <button type="submit" className="button primary" disabled={busy||full||!newTerm.trim()}><Plus size={15} aria-hidden="true"/>추가</button>
      </form>
      {full&&<p className="dictionary-muted">사전에 최대 {dictionaryLimits.entries}개를 저장할 수 있습니다.</p>}
      <label className="dictionary-search"><Search size={16} aria-hidden="true"/>
        <input type="search" aria-label="사전 검색" placeholder="단어 검색" value={query} onChange={event=>setQuery(event.target.value)}/>
      </label>
      {error&&!editor&&<p className="dictionary-error" role="alert">{error}</p>}
      {notice&&<p className="dictionary-notice" role="status">{notice}</p>}
      {rows.length ? <section className="dictionary-list" aria-label="기록한 단어">
        {rows.map(entry=><article className="dictionary-entry" key={entry.id} aria-label={entry.term}>
          <div className="dictionary-entry-content"><h2>{entry.term}</h2><time dateTime={entry.createdAt}>
            {dictionaryDate.format(new Date(entry.createdAt))}
          </time></div>
          <footer className="dictionary-entry-actions">
            <button type="button" disabled={busy} onClick={()=>begin({kind:'edit',entry,term:entry.term})}><Pencil size={14} aria-hidden="true"/>수정</button>
            <button type="button" disabled={busy} onClick={()=>begin({kind:'delete',entry})}><Trash2 size={14} aria-hidden="true"/>삭제</button>
          </footer>
        </article>)}
      </section> : <p className="dictionary-empty">{state.entries.length?'검색 조건에 맞는 단어가 없습니다.':'기록한 단어가 없습니다.'}</p>}
    </> : loadError ? <div className="dictionary-empty" role="alert"><p>{loadError}</p>
      <button type="button" className="button secondary" onClick={()=>{setLoadError('');setRetry(count=>count+1);}}>
        <RefreshCw size={15} aria-hidden="true"/>다시 불러오기</button></div> : <LoadingProgress label="사전을 불러오는 중입니다."/>}

    <MotionOverlay open={Boolean(editor)} onClose={busy?undefined:()=>setEditor(undefined)} label={dialogTitle}
      className="personal-dictionary-dialog" initialFocus={editor?.kind==='edit'?'input[name="term"]':'.dictionary-cancel'}>
      <header className="dictionary-dialog-head"><h2>{dialogTitle}</h2><CloseButton disabled={busy} onClick={()=>setEditor(undefined)}/></header>
      {editor?.kind==='edit' ? <form className="dictionary-form" onSubmit={submitEdit}>
        <input name="term" aria-label="단어 입력" required disabled={busy} maxLength={dictionaryLimits.term}
          value={editor.term} onChange={event=>setEditor({...editor,term:event.target.value})}/>
        {error&&<p className="dictionary-error" role="alert">{error}</p>}
        <footer className="dictionary-dialog-actions">
          <button type="button" className="button secondary dictionary-cancel" disabled={busy} onClick={()=>setEditor(undefined)}>취소</button>
          <button type="submit" className="button primary" disabled={busy||!editor.term.trim()}>{busy?'저장 중':'저장'}</button>
        </footer>
      </form> : editor?.kind==='delete' && <>
        <p className="dictionary-delete-text">‘{editor.entry.term}’ 단어를 사전에서 삭제합니다.</p>
        {error&&<p className="dictionary-error" role="alert">{error}</p>}
        <footer className="dictionary-dialog-actions">
          <button type="button" className="button secondary dictionary-cancel" disabled={busy} onClick={()=>setEditor(undefined)}>취소</button>
          <button type="button" className="dictionary-delete" disabled={busy} onClick={()=>void mutate({action:'delete',id:editor.entry.id})}>
            <Trash2 size={14} aria-hidden="true"/>{busy?'삭제 중':'삭제'}</button>
        </footer>
      </>}
    </MotionOverlay>
  </DictionaryPage>;
}

export default function PersonalDictionary({authenticated}: {authenticated:boolean}) {
  const api=window.flowrium;
  if (!authenticated || !api) return <DictionaryPage>
    <p className="dictionary-empty">{api?'ChatGPT 계정을 연결하면 사전을 사용할 수 있습니다.':'Flowrium 데스크톱에서 사전을 사용할 수 있습니다.'}</p>
  </DictionaryPage>;
  return <ConnectedDictionary api={api}/>;
}
