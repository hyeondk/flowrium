import {workDuration} from './work-time.js';
import {activityText,agentActivityText,describeActivity,sameWorkActivity} from './work-activity.js';
import MarkdownIt from './markdown-engine.js';
import {parseQuestionReply} from './question-reply.js';

const markdown=new MarkdownIt({html:false,linkify:true,breaks:true}).disable('strikethrough');
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'이미지');
markdown.renderer.rules.link_open=(tokens,index,options,env,renderer)=>{
  tokens[index].attrSet('rel','noopener noreferrer');
  tokens[index].attrSet('target','_blank');
  return renderer.renderToken(tokens,index,options);
};
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
export function messageBody(text) {
  const answers=parseQuestionReply(text);
  if (!answers) return markdownBody(text);
  const body=element('section'),label=element('div','응답 보냄'),list=element('dl');
  body.className='mobile-question-reply';body.setAttribute('aria-label','보낸 질문 답변');
  label.className='mobile-question-reply-label';
  for(const row of answers){
    const item=element('div');item.append(element('dt',row.question),element('dd',row.answer));list.append(item);
  }
  body.append(label,list);return body;
}
export function groupMobileHistory(messages,session,running) {
  const rows=[],groups=new Map(),owners=new Map(),timing=new Map(),commentaries=new Map();
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
    if(step.commentary) {
      const seen=commentaries.get(id)||new Set(), normalized=step.label.replace(/\r\n/g,'\n').trim();
      if(seen.has(normalized))return;
      seen.add(normalized);commentaries.set(id,seen);
    }
    if(step.id){
      const previous=group.steps.find(item=>item.id===step.id);
      if(previous){Object.assign(previous,step);return;}
    }
    group.steps.push({...step});
  }
  for(const message of messages) {
    if(message.role==='user')owner=owners.get(message.turnId)||message.id;
    const key=owners.get(message.turnId)||message.turnId||owner;
    if(message.role==='system' || message.progressCommentary){
      if(message.workSteps?.length && !message.progressCommentary) {
        for(const step of message.workSteps)add(key,step);
      } else add(key,{id:message.id,label:message.text,createdAt:message.createdAt,commentary:message.progressCommentary});
    }else{
      if(message.role==='user')rows.push({message});
      for(const step of message.workSteps||[])add(key,step);
      if(message.role!=='user')rows.push({message});
    }
  }
  if(running && session.activity && !groups.get(owner)?.steps.some(step=>step.label===session.activity||activityText(step)===session.activity))
    add(owner,{label:session.activity,state:'running'});
  if(groups.has(owner))groups.get(owner).running=running;
  for(const group of groups.values())group.steps.sort((a,b)=>(Date.parse(a.createdAt)||Infinity)-(Date.parse(b.createdAt)||Infinity));
  return {rows,groups};
}
const choices=new Map();
export function clearProgressChoices() { choices.clear(); }
export function progressButton(group) {
  const wrap=element('div'),button=element('button'),list=element('ol');
  wrap.className='mobile-work';wrap.dataset.messageId='work:'+group.id;
  button.type='button';button.dataset.workGroup=group.id;
  button.textContent=workDuration(group.start,group.end)||(group.running?'작업 진행 중':'작업 내역 보기');
  button.setAttribute('aria-label',button.textContent);
  list.id='work-'+group.id;list.setAttribute('aria-label','작업 과정');button.setAttribute('aria-controls',list.id);
  const entries=[];
  for(const step of group.steps){
    const previous=entries.at(-1);
    if(previous&&sameWorkActivity(step,previous.step))previous.count++;
    else entries.push({step,count:1});
  }
  const agentNames=new Map(),agentStates=new Map();
  for(const {step,count} of entries){
    const item=element('li');
    if(step.commentary)item.append(markdownBody(step.label));
    else if(step.agents?.length){
      for(const agent of step.agents){
        const name=agent.name||agentNames.get(agent.id)||`하위 에이전트 ${agentNames.size+1}`;
        agentNames.set(agent.id,name);
        if(agentStates.get(agent.id)===agent.state)continue;
        agentStates.set(agent.id,agent.state);
        item.append(element('strong',`${name}: ${agentActivityText[agent.state]}`));
      }
      if(!item.hasChildNodes())continue;
    }else {
      const view=describeActivity(step);
      item.append(element('strong',view.label));
      if(view.target)item.append(element('span',view.target));
      if(view.result)item.append(element('span',view.result));
    }
    if(count>1)item.append(element('span','×'+count));
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
