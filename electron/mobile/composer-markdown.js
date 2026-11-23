import {markdownRanges} from './composer-syntax.js';

const pasteHistory=new WeakMap();
const pendingFormats=new WeakMap();
const formatHistories=new WeakMap();
const listMarker=/^([ \t]*)(?:(\d{1,9})([.)])|[-+*])[ \t]+/;
const unfinishedList=/^[ ]{0,3}(?:\d{1,9}[.)]|[-+*])$/;
const lineStartAt=(source,offset)=>offset===0?0:source.lastIndexOf('\n',offset-1)+1;
const syncLimit=8192;

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

function activeInline(source,caret) {
  const width=Math.min(3,starRun(source,caret-1,-1),starRun(source,caret,1));
  return width ? {source,start:caret-width,close:caret,width} : undefined;
}

function replayInline(pending,source) {
  if(!pending || pending.source===source)return pending;
  const prefix=pending.source.slice(0,pending.start+pending.width), suffix=pending.source.slice(pending.close);
  if(source.length<prefix.length+suffix.length || !source.startsWith(prefix) || !source.endsWith(suffix))return;
  return {...pending,source,close:source.length-suffix.length};
}

function listPrefixAt(source,index) {
  return markdownRanges(source).find(([position,style])=>position===index && (style==='bullet'||style==='code'))?.[1];
}

function preserveUneditedRanges(previous,ranges,next) {
  let first=0,last=0;
  const shared=Math.min(previous.length,next.length);
  while(first<shared && previous[first]===next[first])first++;
  while(last<shared-first && previous[previous.length-1-last]===next[next.length-1-last])last++;
  const oldEnd=previous.length-last, change=next.length-previous.length;
  const stack=[], result=[];
  for(let i=0;i<ranges.length;i++){
    const [offset,style]=ranges[i];
    if(style){stack.push(i);continue;}
    const begin=stack.pop(), [start,kind]=ranges[begin];
    if(offset<=first){result[begin]=ranges[begin];result[i]=ranges[i];}
    else if(start>=oldEnd){result[begin]=[start+change,kind];result[i]=[offset+change,null];}
    else if(start<first && offset>oldEnd && kind!=='marker'){
      result[begin]=ranges[begin];result[i]=[offset+change,null];
    }
  }
  return result.filter(Boolean);
}

// Keep the native editor and its undo/caret coordinates and paint the visible
// text separately. The first line can share a negative indent on both layers.
export function attachComposerMarkdown(input, ink, scope=input) {
  const frame=ink.parentElement;
  const typography=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','tabSize','textIndent','textTransform','textAlign','direction','wordBreak','overflowWrap','whiteSpace','fontKerning','fontVariantLigatures'];
  const measure=document.createElement('canvas').getContext('2d');
  const agent=navigator.userAgent;
  // WebKit merges execCommand('insertText') into the typing transaction. Give
  // editor commands their own undo boundary without disturbing native typing.
  const webkit=/AppleWebKit\//.test(agent) && !/(?:Chrome|Chromium)\//.test(agent);
  let last, composing=false, timer=0, revision=0, worker, leadingMarker='', painted;
  let pasteEdit=pasteHistory.get(scope), pending=pendingFormats.get(scope);
  const edits=formatHistories.get(scope)||{items:[],pointer:0};
  const decorationLimit=256000;
  function align() {
    if(!frame.dataset.formatted || !input.isConnected)return;
    const computed=getComputedStyle(input);
    if(leadingMarker && measure){
      measure.font=`${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      const advance=measure.measureText(leadingMarker).width+(parseFloat(computed.letterSpacing)||0)*leadingMarker.length;
      frame.style.setProperty('--composer-marker-indent',-advance+'px');
    }else frame.style.removeProperty('--composer-marker-indent');
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
    const incomplete=pending && !ranges.some(([offset,style])=>offset===pending.start&&style==='marker') ? pending : undefined;
    if(!ranges.length&&!incomplete){plain();return;}
    painted={source,ranges};
    const fragment=document.createDocumentFragment();
    let parent=fragment, offset=0, head=0;
    const appendUntil=end=>{
      while(offset<end){
        const region=incomplete && offset>=incomplete.start && offset<incomplete.close+incomplete.width;
        const coversMarkup=parent.closest?.('.md-marker');
        let child=parent, limit=end, hidden=Boolean(coversMarkup);
        if(incomplete){
          if(offset<incomplete.start)limit=Math.min(limit,incomplete.start);
          else if(region){
            const beforeContent=offset<incomplete.start+incomplete.width;
            const inContent=!beforeContent && offset<incomplete.close;
            const edge=beforeContent?incomplete.start+incomplete.width:inContent?incomplete.close:incomplete.close+incomplete.width;
            limit=Math.min(limit,edge);
            child=document.createElement('span');
            child.className=inContent?['','md-em','md-strong','md-strong md-em'][incomplete.width]:'md-marker';
            hidden||=!inContent;
            parent.append(child);
          }
        }
        if(offset===head&&hidden)head=limit;
        child.append(source.slice(offset,limit));
        offset=limit;
      }
    };
    for(const [end,style] of ranges){
      appendUntil(end);
      if(style){
        const span=document.createElement('span');
        span.className='md-'+style;
        if(style==='bullet' && /[-+*]/.test(source[end]))span.dataset.unordered='';
        parent.append(span);parent=span;
      }else parent=parent.parentNode;
    }
    appendUntil(source.length);
    parent.append(document.createElement('br'));
    if(pending?.start===0)head=Math.min(head,pending.width);
    leadingMarker=source.slice(0,head).match(/^[*_~`]{1,8}$/)?.[0] || '';
    ink.replaceChildren(fragment);
    frame.dataset.formatted='true';
    align();
  }
  function plain(){
    delete frame.dataset.formatted;
    frame.style.removeProperty('--composer-marker-indent');
    leadingMarker='';
    painted=undefined;
    ink.replaceChildren();
  }
  function stopWorker(){
    clearTimeout(timer);
    worker?.terminate();worker=undefined;
  }
  function refresh(event) {
    const source=input.value;
    if(last===source)return;
    if((!event || event.type==='flowrium-draft-window') && last!==undefined){
      pasteEdit=undefined;
      edits.items.length=0;
      edits.pointer=0;
    }
    pending=replayInline(pending,source);
    last=source;revision++;
    stopWorker();
    if(input.dataset.draftWindowed){plain();return;}
    if(source.length<=syncLimit){
      try{paint(source,markdownRanges(source));}catch{plain();}
      return;
    }
    // Leave very large pasted conversations entirely in the OS text control.
    // Decoration must never truncate the draft or compete with typing.
    if(source.length>decorationLimit){plain();return;}
    if(painted || pending){
      const ranges=painted?preserveUneditedRanges(painted.source,painted.ranges,source):[];
      paint(source,ranges);
    }
    timer=setTimeout(()=>{
      const current=revision;
      try{
        worker=new Worker(new URL('./composer-parse-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(current!==revision || data.revision!==current || input.value!==source)return;
          stopWorker();
          paint(source,data.ranges);
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
    const before=input.value, beforeSelection=[input.selectionStart,input.selectionEnd];
    if(!webkit)input.setSelectionRange(start,end);
    const changed=!webkit && document.execCommand(text?'insertText':'delete',false,text);
    if(!changed && input.value===before){
      input.setRangeText(text,start,end,'end');
      edits.items.splice(edits.pointer);
      edits.items.push({before,after:input.value,start,end,text,beforeSelection,selection});
      if(edits.items.length>24)edits.items.shift();
      edits.pointer=edits.items.length;
      notifyInput('insertText');
    }
    input.setSelectionRange(...selection);
  }
  function formatHistory(event,redo) {
    const edit=edits.items[redo?edits.pointer:edits.pointer-1];
    if(!edit || input.value!==(redo?edit.before:edit.after))return false;
    event.preventDefault();
    if(redo){
      input.setRangeText(edit.text,edit.start,edit.end,'end');
      if(edit.selection[0]===edit.selection[1])pending=activeInline(input.value,edit.selection[0]);
    }else{
      input.setRangeText(edit.before.slice(edit.start,edit.end),edit.start,edit.start+edit.text.length,'end');
      pending=undefined;
    }
    edits.pointer+=redo?1:-1;
    notifyInput(redo?'historyRedo':'historyUndo');
    input.setSelectionRange(...(redo?edit.selection:edit.beforeSelection));
    return true;
  }
  function canFormat() {
    return !(composing || input.dataset.draftWindowed || input.disabled || input.readOnly);
  }
  function formatSelection(format) {
    if(!canFormat())return;
    const source=input.value,start=input.selectionStart,end=input.selectionEnd;
    const inline=format==='bold'||format==='italic';
    const delimiter=format==='bold'?'**':'*';
    if(inline && start===end && pending?.close===start && pending.width===delimiter.length && start>pending.start+pending.width){
      const trailing=/[ \t]+$/.exec(source.slice(pending.start+pending.width,start))?.[0]||'';
      pending=undefined;
      if(trailing)nativeEdit({start:start-trailing.length,end:start+delimiter.length,text:delimiter+trailing,selection:[start+delimiter.length,start+delimiter.length]});
      else input.setSelectionRange(start+delimiter.length,start+delimiter.length);
      return;
    }
    const edit=inline
      ?inlineEdit(source,start,end,delimiter)
      :listEdit(source,start,end,format==='numbers');
    if(edit && edit.text!==source.slice(edit.start,edit.end)){
      if(inline&&start===end){
        const next=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
        pending=activeInline(next,edit.selection[0]);
      }
      nativeEdit(edit);
    }
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
    if(!composing && formatHistory(event,redo))return;
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
    if(!event.cancelable || !canFormat() || event.defaultPrevented)return;
    const source=input.value,start=input.selectionStart;
    const lineStart=lineStartAt(source,start);
    const row=source.slice(lineStart,start),marker=listMarker.exec(row);
    if(event.inputType==='insertText' && event.data===' ' && source.length<=syncLimit && unfinishedList.test(row) && !source.slice(input.selectionEnd).split('\n',1)[0]){
      const lead=row.trimStart(), at=lineStart+row.length-lead.length;
      const attempt=source.slice(0,start)+' '+source.slice(input.selectionEnd);
      // A blank item immediately after prose needs a Markdown block boundary.
      // On the first item, write it as part of the same native edit as the space.
      if(lineStart && !listPrefixAt(attempt,at)){
        const text='\n'+row+' ';
        const next=source.slice(0,lineStart)+text+source.slice(input.selectionEnd);
        if(listPrefixAt(next,at+1)==='bullet'){
          event.preventDefault();
          nativeEdit({start:lineStart,end:input.selectionEnd,text,selection:[lineStart+text.length,lineStart+text.length]});
        }
      }
      return;
    }
    if(!['insertLineBreak','insertParagraph'].includes(event.inputType))return;
    if(!marker)return;
    const prefixStart=lineStart+marker[1].length;
    if(source.length<=syncLimit && listPrefixAt(source,prefixStart)!=='bullet')return;
    const nextLine=source.indexOf('\n',start);
    const empty=!source.slice(lineStart+marker[0].length,nextLine===-1?source.length:nextLine).trim();
    const number=marker[2]===undefined?0:Number(marker[2])+1;
    const text=empty?marker[1]:'\n'+marker[1]+(number?`${number}${marker[3]} `:`${row[marker[1].length]} `);
    const from=empty?lineStart:start;
    event.preventDefault();
    nativeEdit({start:from,end:input.selectionEnd,text,selection:[from+text.length,from+text.length]});
  }
  function startComposition(){composing=true;}
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
    if(pending)pendingFormats.set(scope,pending);
    else pendingFormats.delete(scope);
    if(edits.items.length)formatHistories.set(scope,edits);
    else formatHistories.delete(scope);
    revision++;stopWorker();observer.disconnect();theme.disconnect();
    input.removeEventListener('input',refresh);input.removeEventListener('scroll',scroll);
    input.removeEventListener('flowrium-draft-window',refresh);
    input.removeEventListener('paste',paste);input.removeEventListener('keydown',keydown);input.removeEventListener('beforeinput',beforeinput);
    input.removeEventListener('compositionstart',startComposition);input.removeEventListener('compositionend',finishComposition);
    delete frame.dataset.formatted;
    frame.style.removeProperty('--composer-marker-indent');
  }};
}
