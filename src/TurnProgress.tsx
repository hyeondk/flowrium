import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Ref} from 'react';
import {Activity, ChevronDown, CircleHelp, FileText, Globe, Pencil, Search, ShieldCheck, Terminal, UsersRound} from 'lucide-react';
import type {Message, WorkStep} from '../shared/types';
import {estimateAnswer, expectedAnswerPercent, observeAnswerWork} from '../shared/answer-progress';
import {workDuration} from '../electron/mobile/work-time.js';
import {activityText, agentActivityText, describeActivity, sameWorkActivity} from '../electron/mobile/work-activity.js';
import {ChatAttachmentList} from './ChatAttachments';
import MessageContent from './MessageContent';
import {messagePreview} from './message-content';
import codexAvatar from '../electron/mobile/chatgpt.svg?no-inline';

type Record = {message:Message;step?:WorkStep} | {step:WorkStep;message?:Message};
type Progress = {key:string; records:Record[]; turnId?:string; startedAt?:string; endedAt?:string};
type Row = {message:Message} | {progress:Progress};

export function historyRows(messages:Message[], first:number):Row[] {
  const rows:Row[]=[];
  const groups=new Map<string,Progress>();
  const steps=new Map<string,Map<string,Record>>();
  const commentaries=new Map<string,Set<string>>();
  const owners=new Map<string,string>();
  let request='start';
  function remember(message:Message) {
    if(message.turnId&&!owners.has(message.turnId))owners.set(message.turnId,message.id);
    request=message.turnId?owners.get(message.turnId)!:message.id;
  }
  const add=(key:string, record?:Record)=>{
    let group=groups.get(key);
    if(!group) {
      group={key,records:[]};
      groups.set(key,group);
      rows.push({progress:group});
    }
    if (record?.message?.progressCommentary) {
      let seen=commentaries.get(key);
      if (!seen) {seen=new Set();commentaries.set(key,seen);}
      const normalized=record.message.text.replace(/\r\n/g,'\n').trim();
      if (seen.has(normalized)) return group;
      seen.add(normalized);
    }
    if (record?.step) {
      let seen=steps.get(key);
      if (!seen) {seen=new Map();steps.set(key,seen);}
      const previous=seen.get(record.step.id);
      if (previous && previous.step) {
        const savedNames = new Map(previous.step.agents?.map(agent=>[agent.id,agent.name]));
        previous.step={...previous.step,...record.step,...(record.step.agents && {agents:record.step.agents.map(agent=>({
          ...agent, name:agent.name || savedNames.get(agent.id),
        }))})};
        previous.message ||= record.message;
        return group;
      }
      seen.set(record.step.id,record);
    }
    if (record) group.records.push(record);
    return group;
  };
  for(let i=first-1; i>=0; i--) {
    if(messages[i].role==='user') { remember(messages[i]); break; }
  }
  for(let i=first;i<messages.length;i++) {
    const message=messages[i];
    if(message.role==='user') remember(message);
    const key=message.turnId?(owners.get(message.turnId)||message.turnId):request;
    // 완료 실패, 중단 등의 독립 안내는 대화에서 바로 확인할 수 있도록 유지한다.
    if(message.role==='system'&&!/^(작업을 완료하지 못했습니다|사용자의 요청으로 작업이 중지|답변은 보존했지만)/.test(message.text)) {
      const group=message.workSteps?.length
        ? message.workSteps.reduce((_,step)=>add(key,{step,message}),add(key))
        : add(key,{message});
      group.turnId ||= message.turnId;
    } else {
      rows.push({message});
      if (message.role === 'user' && message.workStartedAt) {
        const group=add(key);
        group.turnId ||= message.turnId;
        group.startedAt ||= message.workStartedAt;
        group.endedAt = message.workCompletedAt || group.endedAt;
      }
      for(const step of message.workSteps||[]) add(key,{step});
    }
  }
  return rows;
}

export function latestWorkProgress(messages:Message[]) {
  let last=messages.length-1;
  while (last>=0 && messages[last].role!=='user') last--;
  if (last<0) return undefined;
  const request=messages[last];
  const turnId=request.turnId;
  const first=turnId ? messages.findIndex(message=>message.role==='user' && message.turnId===turnId) : last;
  const group=historyRows(messages,first).find(row=>'progress' in row && row.progress.key===messages[first].id);
  return group && 'progress' in group ? group.progress : {key:request.id,records:[],turnId,startedAt:request.workStartedAt,endedAt:request.workCompletedAt};
}

export function workAnswerCompleted(messages:Message[], progress?:Progress) {
  if (!progress?.endedAt) return false;
  for (let index=messages.length-1; index>=0; index--) {
    const message=messages[index];
    if (message.id===progress.key) return false;
    if (message.role==='system' && /^(작업을 완료하지 못했습니다|사용자의 요청으로 작업이 중지)/.test(message.text)) return false;
    if (message.role==='assistant' && (!progress.turnId || message.turnId===progress.turnId)) return true;
  }
  return false;
}

const icons={command:Terminal,file:Pencil,search:Search,agent:UsersRound,tool:Activity,image:FileText,context:FileText,approval:ShieldCheck,question:CircleHelp};
const stamp=(record:Record)=>record.step?.createdAt || record.message!.createdAt;
const orderedRecords=(records:Record[])=>[...records].sort((a,b)=>Date.parse(stamp(a))-Date.parse(stamp(b)));
const recordId=(record:Record)=>record.step ? 'step:'+record.step.id : record.message!.id;

function agentsFor(records:Record[]) {
  const agents=new Map<string,{name:string;state:WorkStep['state']}>();
  for (const record of records) {
    for (const agent of record.step?.agents || []) {
      const name=agent.name || agents.get(agent.id)?.name || `하위 에이전트 ${agents.size+1}`;
      agents.set(agent.id,{name,state:agent.state});
    }
  }
  return agents;
}

function logLabel(text:string) {
  if(text.startsWith('실행 도구 / 명령'))return '명령 실행';
  if(text.startsWith('파일 변경 기록'))return '파일 변경';
  if(text.startsWith('도구 실행 기록'))return '도구 실행';
  return '작업 기록';
}
function WorkTimeline({records,live=false,listRef,onScroll}:{records:Record[];live?:boolean;listRef?:Ref<HTMLOListElement>;onScroll?:()=>void}) {
  const aliases=agentsFor(records);
  const previousStates=new Map<string,WorkStep['state']>();
  const entries:{record:Record;agentEvents?:NonNullable<WorkStep['agents']>;count:number}[]=[];
  for (const record of records) {
    const agentEvents=record.step?.agents?.filter(agent=>{
      const previous=previousStates.get(agent.id);
      previousStates.set(agent.id,agent.state);
      return previous!==agent.state;
    });
    if (record.step?.agents?.length && !agentEvents?.length) continue;
    const last=entries.at(-1);
    if (last && (live || !record.message && !last.record.message || record.step?.kind==='search') &&
      sameWorkActivity(record.step,last.record.step)) last.count++;
    else entries.push({record,agentEvents,count:1});
  }
  return <ol aria-label={live?'실시간 작업 과정':'작업 과정'} className={live?'composer-work-timeline':'turn-progress-list'} ref={listRef} onScroll={onScroll} tabIndex={live?0:undefined}>
    {entries.map(({record,agentEvents,count})=>{
      const {step,message}=record;
      const id=recordId(record);
      if (message?.progressCommentary) return <li key={id} data-work-entry={id} className="work-timeline-commentary">
        <MessageContent role="assistant" text={message.text}/>
      </li>;
      const Icon=step?.kind ? icons[step.kind] : Activity;
      const view=step ? describeActivity(step) : {label:logLabel(message!.text),target:undefined,result:undefined};
      const target=view.target || (step?.files?.length===1 ? step.files[0].path.split(/[/\\]/).at(-1) : undefined);
      const detail=!live && message && message.text.trim()!==(step?.label||view.label) && !/^(?:실행 도구 \/ 명령|파일 변경 기록|도구 실행 기록)(?:\n(?:진행 중|완료|실행 종료|확인 필요|거절|중단))?$/.test(message.text.trim());
      return <li key={id} data-work-entry={id} className="work-timeline-event" data-work-kind={step?.kind}>
        <div className="turn-progress-line"><Icon size={13} aria-hidden="true"/>
          {agentEvents?.length ? <div className="work-timeline-agents">{agentEvents.map(agent=><span key={agent.id} data-step-state={agent.state}>
            {aliases.get(agent.id)?.name}: {agentActivityText[agent.state]}
          </span>)}</div> : <>
            <span data-step-state={step?.state}>{view.label}</span>
            {target && <span className="work-timeline-file" title={step?.files?.length===1?step.files[0].path:undefined}>{target}</span>}
            {view.result && <small>{view.result}</small>}
            {count>1 && <small aria-label={`${count}건`}>×{count}</small>}
            {Boolean(step?.files?.length && step.files.length>2) && <small>파일 {step!.files!.length}개</small>}
          </>}
        </div>
        {detail && <WorkOriginal text={message.text}/>}
      </li>;
    })}
    {!entries.length && <li>{live?'진행 내용이 확인되면 표시됩니다.':'기록된 세부 단계가 없습니다.'}</li>}
  </ol>;
}

function WorkOriginal({text}:{text:string}) {
  const [open,setOpen]=useState(false);
  return <details className="work-timeline-original" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>실행 세부 기록</summary>
    {open && <pre aria-label="실행 세부 기록">{text}</pre>}
  </details>;
}

export function TurnProgress({progress,active,checking}:{progress:Progress;active:boolean;checking:boolean}) {
  const [open,setOpen]=useState(false);
  const contentId=useId();
  const live=active && !progress.endedAt;
  const duration=workDuration(progress.startedAt,progress.endedAt);
  const checkingCurrent=checking && !progress.endedAt;
  if (live || checkingCurrent) return <div className="turn-progress" data-message-id={'work:'+progress.key}>
    <span className="turn-progress-current"><Activity size={13} aria-hidden="true"/>{live?'요청을 처리하고 있어요':'Codex 작업 상태 확인 중'}</span>
  </div>;
  return <div className="turn-progress" data-message-id={'work:'+progress.key}>
    <button className="turn-progress-trigger" type="button" aria-expanded={open} aria-controls={contentId} onClick={()=>setOpen(!open)}>
      <Activity size={13} aria-hidden="true"/><span>{duration || '작업 내역 보기'}</span>
      {progress.records.length>0&&<small>{progress.records.length}건</small>}<ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && <div id={contentId}><WorkTimeline records={orderedRecords(progress.records)}/></div>}
  </div>;
}

function currentWork(records:Record[]) {
  const latest=records.reduce<Record|undefined>((previous,record)=>{
    const time=(row:Record)=>Date.parse(row.step?.completedAt || stamp(row));
    return !previous || time(record)>=time(previous) ? record : previous;
  },undefined);
  if(latest?.step?.agents?.length){
    const aliases=agentsFor(records);
    const agent=latest.step.agents[0];
    return `${aliases.get(agent.id)?.name}: ${agentActivityText[agent.state]}`;
  }
  if(latest?.step)return activityText(latest.step);
  if(latest?.message?.progressCommentary){
    const first=messagePreview(latest.message.text,'assistant',2000).split(/(?<=[.!?。])\s/)[0];
    return first && first.length<=140 ? first : '진행 설명이 업데이트됐습니다';
  }
  return '요청을 처리하고 있습니다';
}

export function LiveWorkTimeline({progress}:{progress?:Progress}) {
  const records=useMemo(()=>orderedRecords(progress?.records||[]),[progress]);
  const [open,setOpen]=useState(false);
  const historyId=useId();
  const list=useRef<HTMLOListElement>(null);
  const followLatest=useRef(true);
  const anchor=useRef<{id:string;offset:number}|null>(null);
  const current=useMemo(()=>currentWork(records),[records]);
  useLayoutEffect(()=>{
    const el=list.current;
    if(!el)return;
    if(followLatest.current)el.scrollTop=el.scrollHeight;
    else if(anchor.current){
      const {id,offset}=anchor.current;
      const entry=el.querySelector(`[data-work-entry="${CSS.escape(id)}"]`);
      if(entry)el.scrollTop+=entry.getBoundingClientRect().top-el.getBoundingClientRect().top-offset;
    }
  },[open,records]);
  return <section className="composer-live-work" aria-label="실시간 작업 상태" onKeyDown={event=>{
    if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);event.currentTarget.querySelector('button')?.focus();}
  }}>
    <div className="composer-live-work-heading">
      <span className="status-dot online" aria-hidden="true"/>
      <span className="composer-current-work" data-work-current aria-live="polite">{current}</span>
      <button type="button" aria-expanded={open} aria-controls={historyId} onClick={()=>setOpen(value=>!value)}>
        작업 내역 <ChevronDown size={13} aria-hidden="true"/>
      </button>
    </div>
    {open&&<div className="composer-live-work-history" id={historyId}>
      <WorkTimeline records={records} live listRef={list} onScroll={()=>{
        const el=list.current;
        if(!el)return;
        followLatest.current=el.scrollHeight-el.clientHeight-el.scrollTop<=8;
        const top=el.getBoundingClientRect().top;
        const entry=[...el.querySelectorAll<HTMLElement>('[data-work-entry]')].find(row=>row.getBoundingClientRect().bottom>top);
        anchor.current=entry?.dataset.workEntry?{id:entry.dataset.workEntry,offset:entry.getBoundingClientRect().top-top}:null;
      }}/>
    </div>}
  </section>;
}

export function AnswerProgress({active,progress,finished,messages,streamedLength,paused}:{
  active:boolean; progress?:Progress; finished:boolean; messages:Message[]; streamedLength?:number; paused:boolean;
}) {
  const [percent,setPercent]=useState(0);
  const [observed,setObserved]=useState(false);
  const [dismissed,setDismissed]=useState(false);
  const clock=useRef({started:0,pausedAt:0,pausedFor:0,streamedAt:0});
  const estimate=useMemo(()=>estimateAnswer(messages,progress?.key),[messages,progress?.key]);
  const work=useMemo(()=>observeAnswerWork(progress?.records.flatMap(record=>record.step?[record.step]:[])||[]),[progress]);
  const completing=finished&&!dismissed&&(active||observed);
  useLayoutEffect(()=>{
    if(!active || finished)return;
    setObserved(true);
    const time=clock.current, now=Date.now(), start=Date.parse(progress?.startedAt||'');
    time.started=Math.min(time.started||now,Number.isFinite(start)?start:now);
    if(paused){
      time.pausedAt ||= now;
      return;
    }
    if(time.pausedAt){
      time.pausedFor+=now-time.pausedAt;
      if(time.streamedAt)time.streamedAt+=now-time.pausedAt;
      time.pausedAt=0;
    }
    const streaming=streamedLength!==undefined;
    if(streaming)time.streamedAt ||= now;
    const update=()=>{
      const now=Date.now(), age=now-(streaming?time.streamedAt:time.started+time.pausedFor);
      setPercent(current=>Math.max(current,expectedAnswerPercent(estimate,age,work,streamedLength,now)));
    };
    update();
    const timer=window.setInterval(update,100);
    return ()=>window.clearInterval(timer);
  },[active,progress?.startedAt,estimate,work,finished,paused,streamedLength]);
  useEffect(()=>{
    if(!completing)return;
    const timer=window.setTimeout(()=>setDismissed(true),850);
    return ()=>window.clearTimeout(timer);
  },[completing]);
  if ((!active || finished) && !completing) return null;
  const shown=completing?100:percent;
  return <article className="message assistant chat-live-response"><div className="message-body">
    {!completing && <div className="message-meta"><span className="message-avatar assistant">
      <img className="codex-avatar" src={codexAvatar} width="24" height="24" alt="" draggable={false}/>
    </span><strong>Codex</strong></div>}
    <div className="message-bubble">
      <div className="answer-progress" aria-label={completing?'답변 작성 완료':'답변 작성 중 / 예상 진행률'} data-complete={completing}>
        <span className="status-dot online" aria-hidden="true"/>
        <span>{completing?'답변 작성 완료':paused?'확인을 기다리고 있습니다.':'답변 작성 중입니다.'} ({shown.toFixed(1)}%)</span>
        {!completing && <small title="이 대화의 처리 시간과 작업 단계를 바탕으로 예상한 값입니다.">예상</small>}
      </div>
    </div>
  </div></article>;
}

export function WorkToolDetails({progress,messages,projectId}:{progress?:Progress;messages:Message[];projectId:string}) {
  const records=useMemo(()=>orderedRecords(progress?.records||[]),[progress]);
  const files=records.flatMap(record=>record.step?.state==='completed'?record.step.files || []:[]);
  const agents=[...agentsFor(records)];
  const urls=[...new Set(records.flatMap(record=>record.step?.sourceUrl ? [record.step.sourceUrl] : []))];
  const attachments=useMemo(()=>[...new Map(messages.flatMap(message=>(message.attachments||[]).map(attachment=>[attachment.id,attachment] as const))).values()], [messages]);
  const [copied,setCopied]=useState('');
  const [copyError,setCopyError]=useState(false);
  const [sourcesOpen,setSourcesOpen]=useState(false);
  const hasLineCounts=files.length>0 && files.every(file=>file.added!==undefined && file.removed!==undefined);
  const added=hasLineCounts?files.reduce((sum,file)=>sum+file.added!,0):undefined;
  const removed=hasLineCounts?files.reduce((sum,file)=>sum+file.removed!,0):undefined;
  return <div className="work-tool-details">
    <details><summary><Pencil size={14} aria-hidden="true"/><span>변경 사항</span><small>{hasLineCounts?<><b className="work-added">+{added}</b> <b className="work-removed">−{removed}</b></>:`${files.length}건`}</small></summary>
      {files.length ? <ul>{files.map((file,index)=><li key={file.path+index} title={file.path}><span>{file.path.split(/[/\\]/).at(-1)}</span>
        {file.added!==undefined && file.removed!==undefined && <small><b className="work-added">+{file.added}</b> <b className="work-removed">−{file.removed}</b></small>}</li>)}</ul> : <p>기록된 파일 변경이 없습니다.</p>}
    </details>
    <details><summary><UsersRound size={14} aria-hidden="true"/><span>하위 에이전트</span><small>{agents.length}개</small></summary>
      {agents.length ? <ul>{agents.map(([id,agent])=><li key={id}><span>{agent.name}</span><small>{agentActivityText[agent.state]}</small></li>)}</ul> : <p>기록된 하위 에이전트가 없습니다.</p>}
    </details>
    <details onToggle={event=>setSourcesOpen(event.currentTarget.open)}><summary><Globe size={14} aria-hidden="true"/><span>소스</span><small>{urls.length+attachments.length}개</small></summary>
      {sourcesOpen && (urls.length+attachments.length>0 ? <>
        {urls.length>0&&<ul>{urls.map(url=><li key={url} title={url}><span>{url}</span><button type="button" onClick={async()=>{
          try {await window.flowrium!.copyText(url);setCopied(url);setCopyError(false);}
          catch {setCopyError(true);}
        }}>{copied===url?'복사됨':'주소 복사'}</button></li>)}</ul>}
        {copyError && <p role="alert">주소를 복사하지 못했습니다.</p>}
        <ChatAttachmentList projectId={projectId} items={attachments}/>
      </> : <p>기록된 웹 주소나 첨부가 없습니다.</p>)}
    </details>
  </div>;
}
