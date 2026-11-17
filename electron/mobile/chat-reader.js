import {workDuration} from './work-time.js';
import MarkdownIt from './markdown-engine.js';

const markdown=new MarkdownIt({html:false,linkify:true,breaks:true}).disable('strikethrough');
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
  const rows=[],groups=new Map(),owners=new Map(),timing=new Map();
  let owner='start';
  for(const m of messages)if(m.role==='user'){
    if(m.turnId && !owners.has(m.turnId))owners.set(m.turnId,m.id);
    const id=owners.get(m.turnId)||m.id;
    const times=timing.get(id)||{};
    times.start ||= m.workStartedAt;times.end ||= m.workCompletedAt;timing.set(id,times);
  }
  function add(id,step) {
    if(!step.label)return;
    let group=groups.get(id);
    if(!group){group={id:session.id+'|'+id,steps:[],...timing.get(id)};groups.set(id,group);rows.push({group});}
    if(step.id){
      const previous=group.steps.find(item=>item.id===step.id);
      if(previous){Object.assign(previous,step);return;}
    }
    group.steps.push(step);
  }
  for(const message of messages) {
    if(message.role==='user')owner=owners.get(message.turnId)||message.id;
    const key=owners.get(message.turnId)||message.turnId||owner;
    if(message.role==='system' || message.progressCommentary){
      add(key,{id:message.id,label:message.text,createdAt:message.createdAt});
    }else{
      if(message.role==='user')rows.push({message});
      for(const step of message.workSteps||[])add(key,step);
      if(message.role!=='user')rows.push({message});
    }
  }
  if(running && session.activity && !groups.get(owner)?.steps.some(step=>step.label===session.activity))
    add(owner,{label:session.activity,state:'running'});
  if(groups.has(owner))groups.get(owner).running=running;
  for(const group of groups.values())group.steps.sort((a,b)=>(Date.parse(a.createdAt)||Infinity)-(Date.parse(b.createdAt)||Infinity));
  return {rows,groups};
}
const choices=new Map();
export function syncProgress(groups,reset=false) {if(reset)choices.clear();}
export function progressButton(group) {
  const wrap=element('div'),button=element('button'),list=element('ol');
  wrap.className='mobile-work';wrap.dataset.messageId='work:'+group.id;
  button.type='button';button.dataset.workGroup=group.id;
  button.textContent=workDuration(group.start,group.end)||(group.running?'작업 진행 중':'작업 내역 보기');
  button.setAttribute('aria-label',button.textContent);
  list.id='work-'+group.id;list.setAttribute('aria-label','작업 과정');button.setAttribute('aria-controls',list.id);
  for(const step of group.steps){
    const item=element('li');item.append(element('strong',step.label));
    if(stepStates[step.state])item.append(element('span',stepStates[step.state]));
    if(Number.isFinite(Date.parse(step.createdAt))){
      const time=element('time',new Date(step.createdAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}));
      time.dateTime=step.createdAt;item.append(time);
    }
    list.append(item);
  }
  const open=value=>{button.setAttribute('aria-expanded',String(!!value));list.hidden=!value;};
  open(choices.get(group.id)??group.running);
  button.addEventListener('click',()=>{
    const value=list.hidden;choices.set(group.id,value);
    if(choices.size>500)choices.delete(choices.keys().next().value);
    open(value);
  });
  wrap.append(button,list);return wrap;
}
