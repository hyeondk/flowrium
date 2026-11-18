import {draftWindow,draftWindowSize,largeDraftThreshold,shouldWindowDraft} from './large-draft-editor.js';

// Keep the original draft intact. Browsers only need to shape the visible part.
export function attachDraftEditor(input,{read,change,render}) {
  let source=read(), view=draftWindow(source,0), selectedAll=false, edit, composition, compositionFrame;
  const controller=new AbortController();
  const listen=(type,action)=>input.addEventListener(type,action,{capture:true,signal:controller.signal});
  let reported='';
  function show(page,caret) {
    view=draftWindow(source,page);
    const value=source.slice(view.start,view.end);
    if(input.value!==value)input.value=value;
    if(caret!==undefined) {
      const position=Math.max(0,Math.min(value.length,caret-view.start));
      input.setSelectionRange(position,position);
    }
    if(view.count>1)input.dataset.draftWindowed='true';
    else delete input.dataset.draftWindowed;
    input.dataset.draftLength=String(source.length);
    const key=view.page+':'+view.count;
    if(key!==reported){reported=key;render({page:view.page,count:view.count});}
    input.dispatchEvent(new Event('flowrium-draft-window'));
  }
  function apply(next,caret,remember=false) {
    selectedAll=false;
    if(remember)edit={before:source,beforePage:view.page,after:next,afterCaret:caret};
    source=next;
    const page=Math.floor(Math.max(0,caret-1)/draftWindowSize);
    show(page,caret);
    change(next);
  }
  function replace(start,end,text,remember) {
    apply(source.slice(0,start)+text+source.slice(end),start+text.length,remember);
  }
  function updateComposition() {
    if(!composition)return;
    const {before,start,end}=composition;
    source=before.slice(0,start)+input.value+before.slice(end);
    input.dataset.draftLength=String(source.length);
    edit=undefined;change(source);
  }
  function finishComposition() {
    if(!composition)return;
    updateComposition();
    const caret=composition.start+input.selectionStart, windowed=view.count>1||shouldWindowDraft(source);
    composition=undefined;compositionFrame=undefined;selectedAll=false;
    // Native IME owns the value and selection until its final input has arrived.
    // Short drafts need no value/selection write even after composition commits.
    if(windowed)show(Math.floor(Math.max(0,caret-1)/draftWindowSize),caret);
    else view=draftWindow(source,0);
  }
  function settleCommittedComposition() {
    // A page button may be clicked in the same frame as the blur/commit event.
    if(compositionFrame){cancelAnimationFrame(compositionFrame);finishComposition();}
  }
  listen('compositionstart',()=>{
    if(compositionFrame){cancelAnimationFrame(compositionFrame);finishComposition();}
    composition={before:source,start:selectedAll?0:view.start,end:selectedAll?source.length:view.end};
  });
  listen('compositionend',()=>{
    if(compositionFrame)cancelAnimationFrame(compositionFrame);
    compositionFrame=requestAnimationFrame(finishComposition);
  });
  listen('input',()=>{
    if(composition){updateComposition();return;}
    const nextView=view.count===1?draftWindow(input.value,0):undefined;
    if(nextView?.count===1) {
      // Leave normal typing, selection and undo entirely with the native editor.
      source=input.value;view=nextView;input.dataset.draftLength=String(source.length);
      edit=undefined;change(source);return;
    }
    const selecting=selectedAll;
    const offset=selecting?0:view.start;
    const replacement=input.value;
    const next=selecting?replacement:source.slice(0,offset)+replacement+source.slice(view.end);
    apply(next,offset+input.selectionStart,selecting);
  });
  listen('paste',event=>{
    if(composition)return;
    if(event.defaultPrevented||event.clipboardData?.files.length)return;
    const raw=event.clipboardData?.getData('text/plain');
    if(!raw)return;
    const start=selectedAll?0:view.start+input.selectionStart;
    const end=selectedAll?source.length:view.start+input.selectionEnd;
    if(view.count===1 && source.length-end+start+raw.length<=largeDraftThreshold
      && !shouldWindowDraft(source.slice(0,start)+raw+source.slice(end)))return;
    event.preventDefault();
    const text=raw.includes('\r')?raw.replace(/\r\n?/g,'\n'):raw;
    replace(start,end,text,true);
  });
  function history(redo,event) {
    if(!edit || source!==(redo?edit.before:edit.after))return false;
    event.preventDefault();event.stopImmediatePropagation();selectedAll=false;
    source=redo?edit.after:edit.before;
    show(redo?Math.floor(Math.max(0,edit.afterCaret-1)/draftWindowSize):edit.beforePage,redo?edit.afterCaret:undefined);
    change(source);return true;
  }
  listen('keydown',event=>{
    if(composition||event.isComposing||event.keyCode===229)return;
    const command=(event.metaKey||event.ctrlKey)&&!event.altKey;
    const key=event.key.toLowerCase();
    if(command&&(key==='z'||key==='y')&&history(key==='y'||event.shiftKey,event))return;
    if(view.count===1)return;
    if(command&&key==='a'){event.preventDefault();selectedAll=true;input.select();return;}
    if(selectedAll&&key==='escape'){
      event.preventDefault();event.stopPropagation();selectedAll=false;
      input.setSelectionRange(input.selectionEnd,input.selectionEnd);return;
    }
    if(selectedAll&&(key==='backspace'||key==='delete')){
      event.preventDefault();apply('',0,true);return;
    }
    if(!command&&key!=='shift'&&key.length>1)selectedAll=false;
  });
  listen('beforeinput',event=>{
    if(composition||event.isComposing)return;
    if(event.inputType==='historyUndo'||event.inputType==='historyRedo')history(event.inputType==='historyRedo',event);
    else if(selectedAll&&event.inputType?.startsWith('delete')&&event.cancelable){
      event.preventDefault();apply('',0,true);
    }
  });
  for(const eventName of ['copy','cut'])listen(eventName,event=>{
    if(!selectedAll || view.count===1 || !event.clipboardData)return;
    event.preventDefault();event.clipboardData.setData('text/plain',source);
    if(eventName==='cut')apply('',0,true);
  });
  listen('pointerdown',()=>{selectedAll=false;});
  listen('blur',()=>{selectedAll=false;});
  show(0);
  return {
    refresh(){
      if(composition)return;
      const next=read();
      if(next===source)return;
      source=next;selectedAll=false;edit=undefined;show(0);
    },
    go(page){
      settleCommittedComposition();
      if(composition)return;
      selectedAll=false;show(page);
      input.focus();input.setSelectionRange(0,0);input.scrollTop=0;
    },
    selectAll(){settleCommittedComposition();if(composition)return;input.focus();selectedAll=view.count>1;input.select();},
    dispose(){if(compositionFrame)cancelAnimationFrame(compositionFrame);controller.abort();}
  };
}
