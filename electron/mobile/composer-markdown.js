import {markdownRanges} from './composer-syntax.js';

const pasteHistory=new WeakMap();
const formats=[
  ['bold','굵게','B','Control+B Meta+B'],
  ['italic','기울임','I','Control+I Meta+I'],
  ['bullets','글머리표','•','Control+Shift+8 Meta+Shift+8'],
  ['numbers','번호 목록','1.','Control+Shift+7 Meta+Shift+7'],
];
const listMarker=/^([ \t]*)(?:(\d{1,9})([.)])|[-+*])[ \t]+/;
const lineStartAt=(source,offset)=>offset===0?0:source.lastIndexOf('\n',offset-1)+1;

function starRun(source,index,direction) {
  let length=0;
  while(source[index+length*direction]==='*')length++;
  return length;
}

function inlineEdit(source,start,end,marker) {
  const selected=source.slice(start,end);
  const width=marker.length;
  const active=count=>width===1?count%2===1:count>=2;
  if(!selected.includes('\n') && active(starRun(source,start-1,-1)) && active(starRun(source,end,1))) {
    const from=start-width;
    return {start:from,end:end+width,text:selected,selection:[from,from+selected.length]};
  }
  if(!selected)return {start,end,text:marker+marker,selection:[start+width,start+width]};
  const text=selected.replace(/\S(?:.*\S)?/g,line=>
    line.length>width*2 && active(starRun(line,0,1)) && active(starRun(line,line.length-1,-1))
      ?line.slice(width,-width):marker+line+marker);
  if(text!==selected)return {start,end,text,selection:[start,start+text.length]};
}

function listEdit(source,start,end,ordered) {
  const from=lineStartAt(source,start);
  const nextLine=source.indexOf('\n',end>start && source[end-1]==='\n'?end-1:end);
  const to=nextLine===-1?source.length:nextLine;
  const lines=source.slice(from,to).split('\n');
  const matches=lines.map(line=>listMarker.exec(line));
  const remove=matches.every((match,index)=>!lines[index].trim() || match && Boolean(match[2])===ordered) &&
    matches.some(Boolean);
  let number=0;
  const updated=lines.map((line,index)=>{
    if(!line.trim() && lines.length>1)return line;
    const marker=matches[index];
    const indent=marker?.[1]??line.match(/^[ \t]*/)[0];
    const body=line.slice(marker?.[0].length??indent.length);
    return indent+(remove?'':ordered?`${++number}. `:'- ')+body;
  });
  const text=updated.join('\n');
  const caret=Math.max(from+(updated[0].match(listMarker)?.[0].length??0),start+updated[0].length-lines[0].length);
  return {start:from,end:to,text,selection:start===end?[caret,caret]:[from,from+text.length]};
}

// The editing surface is always the native textarea. The ink layer uses identical
// line and glyph metrics, leaving selection, dictation and composition to the OS.
export function attachComposerMarkdown(input, ink, scope=input, toolbar) {
  const frame=ink.parentElement;
  const typography=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','tabSize','textIndent','textTransform','textAlign','direction','wordBreak','overflowWrap','whiteSpace','fontKerning','fontVariantLigatures'];
  let last, composing=false, timer=0, revision=0, worker, pasteEdit=pasteHistory.get(scope);
  const decorationLimit=256000;
  const compactForm=toolbar?.parentElement?.matches('.chat-compose')?toolbar.parentElement:undefined;
  const controls=formats.map(([format,label,symbol,shortcut])=>{
    const button=document.createElement('button');
    button.type='button';
    button.dataset.format=format;
    button.textContent=symbol;
    button.setAttribute('aria-label',label);
    button.setAttribute('aria-keyshortcuts',shortcut);
    button.title=label;
    // Keep the textarea selection when a pointer activates a formatting control.
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>formatSelection(format));
    return button;
  });
  if(toolbar){
    toolbar.setAttribute('role','group');
    toolbar.setAttribute('aria-label','입력 서식');
    toolbar.replaceChildren(...controls);
  }
  function showTools(){toolbar.dataset.active='';}
  function leaveTools(event){
    if(!compactForm.contains(event.relatedTarget))delete toolbar.dataset.active;
  }
  if(compactForm){
    if(input===document.activeElement)showTools();
    input.addEventListener('focus',showTools);
    compactForm.addEventListener('focusout',leaveTools);
  }
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
        if(style==='bullet' && /[-+*]/.test(source[end]))span.dataset.unordered='';
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
    if(toolbar)toolbar.hidden=Boolean(input.dataset.draftWindowed || input.disabled || input.readOnly);
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
  function nativeEdit({start,end,text,selection}) {
    input.focus({preventScroll:true});
    input.setSelectionRange(start,end);
    const before=input.value;
    // Chromium keeps these changes on the same undo stack as native typing.
    const changed=document.execCommand(text?'insertText':'delete',false,text);
    if(!changed && input.value===before){
      input.setRangeText(text,start,end,'end');
      notifyInput('insertText');
    }
    input.setSelectionRange(...selection);
  }
  function canFormat() {
    return !(composing || input.dataset.draftWindowed || input.disabled || input.readOnly);
  }
  function formatSelection(format) {
    if(!canFormat())return;
    const source=input.value,start=input.selectionStart,end=input.selectionEnd;
    const edit=format==='bold'||format==='italic'
      ?inlineEdit(source,start,end,format==='bold'?'**':'*')
      :listEdit(source,start,end,format==='numbers');
    if(edit && edit.text!==source.slice(edit.start,edit.end))nativeEdit(edit);
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
    if(composing||event.isComposing||event.keyCode===229)return;
    if(!(event.metaKey||event.ctrlKey) || event.altKey)return;
    const key=event.key.toLowerCase();
    if(key==='z'||(key==='y'&&!event.shiftKey))history(event,event.shiftKey||key==='y');
    const format=event.shiftKey
      ?{Digit7:'numbers',Digit8:'bullets'}[event.code]
      :{b:'bold',i:'italic'}[key];
    if(format && canFormat()){
      event.preventDefault();
      formatSelection(format);
    }
  }
  function beforeinput(event) {
    if(composing||event.isComposing)return;
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo')history(event,event.inputType==='historyRedo');
    if(!['insertLineBreak','insertParagraph'].includes(event.inputType) || !event.cancelable || !canFormat())return;
    const source=input.value,start=input.selectionStart;
    const lineStart=lineStartAt(source,start);
    const row=source.slice(lineStart,start),marker=listMarker.exec(row);
    if(!marker)return;
    const nextLine=source.indexOf('\n',start);
    const empty=!source.slice(lineStart+marker[0].length,nextLine===-1?source.length:nextLine).trim();
    const number=marker[2]===undefined?0:Number(marker[2])+1;
    const text=empty?marker[1]:'\n'+marker[1]+(number?`${number}${marker[3]} `:'- ');
    const from=empty?lineStart:start;
    event.preventDefault();
    nativeEdit({start:from,end:input.selectionEnd,text,selection:[from+text.length,from+text.length]});
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
    if(compactForm){
      delete toolbar.dataset.active;
      input.removeEventListener('focus',showTools);
      compactForm.removeEventListener('focusout',leaveTools);
    }
    delete frame.dataset.formatted;
  }};
}
