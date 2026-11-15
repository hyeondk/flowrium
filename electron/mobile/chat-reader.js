import MarkdownIt from './markdown-engine.js';

const markdown=new MarkdownIt({html:false,linkify:true,breaks:true});
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'이미지');
markdown.renderer.rules.link_open=(tokens,index,options,env,renderer)=>{
  tokens[index].attrSet('rel','noopener noreferrer');
  tokens[index].attrSet('target','_blank');
  return renderer.renderToken(tokens,index,options);
};
const stepStates={running:'작업 중',completed:'완료',failed:'확인 필요',interrupted:'중단'};
function element(tag,text) {
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  return el;
}
export function markdownBody(text) {
  const body=element('div');
  body.className='body mobile-markdown';
  // HTML 원문은 이스케이프하고 이미지 주소는 불러오지 않는다.
  body.innerHTML=markdown.render(text||'');
  for(const li of body.querySelectorAll('li')) {
    const leading=li.firstChild?.nodeType===Node.TEXT_NODE?li.firstChild:li.firstElementChild?.firstChild;
    if(leading?.nodeType!==Node.TEXT_NODE)continue;
    const prefix=/^\[([ xX])\]\s+/.exec(leading.textContent);
    if(!prefix)continue;
    const checkbox=element('input');checkbox.type='checkbox';checkbox.disabled=true;checkbox.checked=prefix[1]!==' ';
    leading.before(checkbox);leading.textContent=leading.textContent.slice(prefix[0].length);
  }
  return body;
}
export function groupMobileHistory(messages,session,running) {
  const rows=[],groups=new Map(),owners=new Map();
  let owner='start',currentGroup;
  function add(id,step) {
    let group=groups.get(id);
    if(!group){group={id,steps:[]};groups.set(id,group);rows.push({group});}
    group.steps.push(step);
    if(id===owner)currentGroup=group;
  }
  for(const message of messages) {
    if(message.role==='user'){
      if(message.turnId&&!owners.has(message.turnId))owners.set(message.turnId,message.id);
      owner=owners.get(message.turnId)||message.id;
      currentGroup=groups.get(owner);
    }
    const key=owners.get(message.turnId)||message.turnId||owner;
    if(message.role==='system'){
      add(key,{label:message.text,createdAt:message.createdAt});
    }else{
      rows.push({message});
      for(const step of message.workSteps||[])add(key,step);
    }
  }
  // 이전 데스크톱도 현재 공개된 상태 문구를 제공한다.
  if(running&&!currentGroup)add(owner,{label:session.activity||'작업 진행',state:'running'});
  return {rows,groups};
}

let dialog,listing,activeId;
function dialogForProgress() {
  if(dialog)return dialog;
  dialog=element('dialog');dialog.className='mobile-work-dialog';dialog.setAttribute('aria-label','작업 과정');
  const header=element('header'),close=element('button','닫기');
  close.type='button';close.addEventListener('click',()=>dialog.close());
  header.append(element('h2','작업 과정'),close);
  listing=element('ol');dialog.append(header,listing);document.body.append(dialog);
  dialog.addEventListener('close',()=>{
    const id=activeId;activeId=undefined;listing.replaceChildren();
    if(id)document.querySelector('[data-work-group="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
  });
  return dialog;
}
function showProgress(group) {
  const rows=group.steps.map(step=>{
    const row=element('li');
    row.append(element('strong',step.label));
    if(stepStates[step.state])row.append(element('span',stepStates[step.state]));
    if(step.createdAt) {
      const time=element('time',new Date(step.createdAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
      time.dateTime=step.createdAt;row.append(time);
    }
    return row;
  });
  listing.replaceChildren(...rows);
}
export function progressButton(group) {
  const button=element('button','작업 과정 ('+group.steps.length+'건)');
  button.type='button';button.className='mobile-progress-trigger';button.dataset.workGroup=group.id;
  button.dataset.messageId='work:'+group.id;
  button.setAttribute('aria-haspopup','dialog');
  button.addEventListener('click',()=>{
    const window=dialogForProgress();activeId=group.id;
    showProgress(group);if(!window.open)window.showModal();
  });
  return button;
}
export function syncProgress(groups) {
  if(!dialog?.open)return;
  const group=groups?.get(activeId);
  if(group)showProgress(group);
  else dialog.close();
}
