import {markdownRanges} from './composer-syntax.js';

const pasteHistory=new WeakMap();

// The editing surface is always the native textarea. The ink layer uses identical
// line and glyph metrics, leaving selection, dictation and composition to the OS.
export function attachComposerMarkdown(input, ink, scope=input) {
  const frame=ink.parentElement;
  const typography=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','tabSize','textIndent','textTransform','textAlign','direction','wordBreak','overflowWrap','whiteSpace','fontKerning','fontVariantLigatures'];
  let last, composing=false, timer=0, revision=0, worker, pasteEdit=pasteHistory.get(scope);
  const decorationLimit=256000;
  function align() {
    if(!frame.dataset.formatted || !input.isConnected)return;
    const computed=getComputedStyle(input);
    for(const key of typography) ink.style[key]=computed[key];
    for(const side of ['Top','Right','Bottom','Left'])ink.style['padding'+side]=computed['padding'+side];
    ink.style.left=(input.offsetLeft+input.clientLeft)+'px';
    ink.style.top=(input.offsetTop+input.clientTop)+'px';
    ink.style.width=input.clientWidth+'px';
    ink.style.height=input.clientHeight+'px';
    scroll();
  }
  function scroll() {
    ink.scrollTop=input.scrollTop;
    ink.scrollLeft=input.scrollLeft;
  }
  function paint(source,ranges) {
    if(!ranges.length){
      delete frame.dataset.formatted;
      ink.replaceChildren();
      return;
    }
    const fragment=document.createDocumentFragment();
    let parent=fragment, offset=0;
    for(const [end,style] of ranges){
      if(end>offset)parent.append(source.slice(offset,end));
      if(style){
        const span=document.createElement('span');
        span.className='md-'+style;
        parent.append(span);parent=span;
      }else parent=parent.parentNode;
      offset=end;
    }
    parent.append(source.slice(offset),document.createElement('br'));
    ink.replaceChildren(fragment);
    frame.dataset.formatted='true';
    align();
  }
  function plain(){
    delete frame.dataset.formatted;
    ink.replaceChildren();
  }
  function stopWorker(){
    clearTimeout(timer);
    worker?.terminate();worker=undefined;
  }
  function refresh(event) {
    const source=input.value;
    if(composing || last===source)return;
    if(!event && last!==undefined)pasteEdit=undefined;
    last=source;revision++;
    stopWorker();
    if(input.dataset.draftWindowed){plain();return;}
    if(source.length<4096){
      try{paint(source,markdownRanges(source));}catch{plain();}
      return;
    }
    // Leave very large pasted conversations entirely in the OS text control.
    // Decoration must never truncate the draft or compete with typing.
    plain();
    if(source.length>decorationLimit)return;
    timer=setTimeout(()=>{
      const current=revision;
      try{
        worker=new Worker(new URL('./composer-parse-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(current!==revision || data.revision!==current || input.value!==source)return;
          stopWorker();
          if(data.ranges.length)paint(source,data.ranges);
        };
        worker.onerror=stopWorker;
        worker.postMessage({revision:current,source});
      }catch{stopWorker();}
    },180);
  }
  function notifyInput(inputType) {
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType}));
  }
  // A native edit command can insert tens of thousands of clipboard lines one at
  // a time. Replace the selected range in one operation for very large pastes.
  function paste(event) {
    if(composing || event.defaultPrevented || event.clipboardData?.files.length)return;
    const value=event.clipboardData?.getData('text/plain');
    if(!value || value.length<=decorationLimit)return;
    event.preventDefault();
    const before=input.value,start=input.selectionStart,end=input.selectionEnd;
    const inserted=value.replace(/\r\n?/g,'\n');
    input.setRangeText(inserted,start,end,'end');
    pasteEdit={before,after:input.value,start,end,insertedEnd:start+inserted.length,undone:false};
    notifyInput('insertFromPaste');
  }
  // setRangeText is outside native undo history. Only handle the exact paste
  // boundary. Ordinary typing, IME and their undo stack remain browser-owned.
  function history(event,redo) {
    if(!pasteEdit || composing || redo!==pasteEdit.undone)return;
    const edit=pasteEdit;
    if(input.value!==(redo?edit.before:edit.after))return;
    event.preventDefault();
    if(redo){
      input.setRangeText(edit.after.slice(edit.start,edit.insertedEnd),edit.start,edit.end,'end');
    }else{
      input.setRangeText(edit.before.slice(edit.start,edit.end),edit.start,edit.insertedEnd,'select');
    }
    edit.undone=!redo;
    notifyInput(redo?'historyRedo':'historyUndo');
  }
  function keydown(event) {
    if(!(event.metaKey||event.ctrlKey) || event.altKey)return;
    const key=event.key.toLowerCase();
    if(key==='z'||(key==='y'&&!event.shiftKey))history(event,event.shiftKey||key==='y');
  }
  function beforeinput(event) {
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo')history(event,event.inputType==='historyRedo');
  }
  function startComposition(){composing=true;revision++;stopWorker();plain();}
  function finishComposition(){composing=false;last=undefined;refresh();}
  input.addEventListener('input',refresh);
  input.addEventListener('flowrium-draft-window',refresh);
  input.addEventListener('paste',paste);
  input.addEventListener('keydown',keydown);
  input.addEventListener('beforeinput',beforeinput);
  input.addEventListener('scroll',scroll);
  input.addEventListener('compositionstart',startComposition);
  input.addEventListener('compositionend',finishComposition);
  const observer=new ResizeObserver(align);
  observer.observe(input);observer.observe(frame);
  const theme=new MutationObserver(align);
  theme.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
  refresh();
  return {refresh,dispose(){
    if(pasteEdit)pasteHistory.set(scope,pasteEdit);
    else pasteHistory.delete(scope);
    revision++;stopWorker();observer.disconnect();theme.disconnect();
    input.removeEventListener('input',refresh);input.removeEventListener('scroll',scroll);
    input.removeEventListener('flowrium-draft-window',refresh);
    input.removeEventListener('paste',paste);input.removeEventListener('keydown',keydown);input.removeEventListener('beforeinput',beforeinput);
    input.removeEventListener('compositionstart',startComposition);input.removeEventListener('compositionend',finishComposition);
    delete frame.dataset.formatted;
  }};
}
