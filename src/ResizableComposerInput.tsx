import {attachComposerMarkdown} from '../electron/mobile/composer-markdown.js';
import {attachDraftEditor} from '../electron/mobile/draft-editor-events.js';
import {draftWindow} from '../electron/mobile/large-draft-editor.js';
import '../electron/mobile/composer-markdown.css';
import {useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject, type TextareaHTMLAttributes} from 'react';

const storageKey = 'flowrium.composer.height.v1';
const minimum = 42;
const maximum = 420;
type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>,'value'|'onChange'> & {
  value:string; onTextChange:(text:string)=>void; textareaRef:RefObject<HTMLTextAreaElement|null>;
};

function storedHeight() {
  try {
    const height = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(height) && height >= minimum && height <= maximum) return height;
  } catch {}
  return undefined;
}

export default function ResizableComposerInput({textareaRef,value,onTextChange, ...props}: Props) {
  const id = useId();
  const ink = useRef<HTMLSpanElement>(null);
  const editor = useRef<ReturnType<typeof attachComposerMarkdown> | null>(null);
  const draftEditor=useRef<ReturnType<typeof attachDraftEditor>|null>(null);
  const current=useRef({value,onTextChange});
  current.current={value,onTextChange};
  const [view,setView]=useState<{page:number;count:number}>(()=>draftWindow(value,0));
  useLayoutEffect(() => {
    if (!textareaRef.current || !ink.current) return;
    draftEditor.current=attachDraftEditor(textareaRef.current,{
      read:()=>current.current.value,
      change:next=>current.current.onTextChange(next),
      render:next=>setView(previous=>previous.page===next.page&&previous.count===next.count?previous:next),
    });
    editor.current=attachComposerMarkdown(textareaRef.current,ink.current);
    return () => {draftEditor.current?.dispose();draftEditor.current=null;editor.current?.dispose();editor.current=null;};
  },[textareaRef]);
  useLayoutEffect(() => {draftEditor.current?.refresh();editor.current?.refresh();},[value]);
  const [preferred, setPreferred] = useState(storedHeight);
  const [bounds, setBounds] = useState({max: maximum, actual: minimum});
  const drag = useRef<{pointer: number; y: number; height: number; last: number} | null>(null);
  const actual = preferred === undefined ? undefined : Math.min(bounds.max, preferred);
  const largeDraft = view.count>1;

  useLayoutEffect(() => {
    const input = textareaRef.current;
    const area = input?.closest<HTMLElement>('.composer-area');
    const main = area?.closest<HTMLElement>('.workspace-main');
    if (!input || !area || !main) return;
    const measure = () => {
      if (!input.offsetHeight) return;
      const otherControls = Math.max(0, area.scrollHeight - input.offsetHeight);
      const messages = main.querySelector<HTMLElement>('.messages');
      const available = messages?.offsetHeight
        ? main.getBoundingClientRect().bottom - messages.getBoundingClientRect().top
        : window.innerHeight * .7;
      const max = Math.max(minimum, Math.min(maximum, Math.floor(available * .58 - otherControls)));
      const height = input.offsetHeight;
      setBounds(old => old.max === max && old.actual === height ? old : {max, actual: height});
    };
    const observer = new ResizeObserver(measure);
    [main, area, input, main.querySelector('.messages')].forEach(element => element && observer.observe(element));
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      if (drag.current) document.documentElement.removeAttribute('data-composer-resizing');
    };
  }, [textareaRef]);

  function save(height: number | undefined) {
    setPreferred(height);
    try {
      if (height === undefined) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(height));
    } catch {}
  }

  function stop(pointer: number) {
    if (drag.current?.pointer !== pointer) return;
    save(drag.current.last);
    drag.current = null;
    document.documentElement.removeAttribute('data-composer-resizing');
  }

  return <>
    <div role="separator" className="composer-resize-handle" tabIndex={0}
      aria-label="입력창 높이 조절" aria-controls={id} aria-orientation="horizontal"
      aria-valuemin={minimum} aria-valuemax={bounds.max} aria-valuenow={Math.min(bounds.max, bounds.actual)}
      title="위아래로 끌어 높이 조절 / 두 번 눌러 자동 높이"
      onDoubleClick={() => save(undefined)}
      onPointerDown={event => {
        if (event.button !== 0 || !textareaRef.current) return;
        event.preventDefault();
        const height = textareaRef.current.offsetHeight;
        drag.current = {pointer: event.pointerId, y: event.clientY, height, last: height};
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.dataset.composerResizing = 'true';
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || event.pointerId !== current.pointer) return;
        const height = Math.round(Math.max(minimum, Math.min(bounds.max, current.height + current.y - event.clientY)));
        current.last = height;
        setPreferred(height);
      }}
      onPointerUp={e => stop(e.pointerId)} onPointerCancel={e => stop(e.pointerId)} onLostPointerCapture={e => stop(e.pointerId)}
      onKeyDown={event => {
        if (event.key === 'Enter') {event.preventDefault(); save(undefined); return;}
        if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 64 : 16;
        const next = event.key === 'Home' ? minimum : event.key === 'End' ? bounds.max
          : bounds.actual + (event.key === 'ArrowUp' ? step : -step);
        save(Math.max(minimum, Math.min(bounds.max, next)));
      }}><span aria-hidden="true"/></div>
    {largeDraft&&<nav className="composer-draft-pages" aria-label="긴 입력 편집 범위">
      <button type="button" disabled={!view.page} onClick={()=>draftEditor.current?.go(0)}>처음</button>
      <button type="button" disabled={!view.page} onClick={()=>draftEditor.current?.go(view.page-1)}>이전</button>
      <span>{view.page+1} / {view.count}</span>
      <button type="button" disabled={view.page+1===view.count} onClick={()=>draftEditor.current?.go(view.page+1)}>다음</button>
      <button type="button" disabled={view.page+1===view.count} onClick={()=>draftEditor.current?.go(view.count-1)}>마지막</button>
    </nav>}
    <div className="markdown-input"><textarea {...props} ref={textareaRef} id={id} rows={1} className="composer-input"
      data-large-draft={largeDraft || undefined} spellCheck={largeDraft ? false : props.spellCheck}
      data-height-mode={actual === undefined ? 'auto' : 'manual'}
      style={{height: actual === undefined ? undefined : actual, '--composer-limit': bounds.max + 'px'} as CSSProperties}/><span ref={ink} className="markdown-input-ink" aria-hidden="true"/></div>
  </>;
}
