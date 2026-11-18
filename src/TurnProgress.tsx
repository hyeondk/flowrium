import {useState} from 'react';
import {Activity, ChevronDown} from 'lucide-react';
import type {Message, WorkStep} from '../shared/types';
import {workDuration} from '../electron/mobile/work-time.js';
import MessageContent from './MessageContent';

type Record = {message:Message} | {step:WorkStep};
type Progress = {key:string; records:Record[]; turnId?:string; startedAt?:string; endedAt?:string};
type Row = {message:Message} | {progress:Progress};

export function historyRows(messages:Message[], first:number):Row[] {
  const rows:Row[]=[];
  const groups=new Map<string,Progress>();
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
      add(key,{message});
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

const labels={running:'작업 중',completed:'완료',failed:'확인 필요',interrupted:'중단'};
const clock=new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit'});
function logLabel(text:string) {
  if(text.startsWith('실행 도구 / 명령'))return '명령 실행';
  if(text.startsWith('파일 변경 기록'))return '파일 변경';
  if(text.startsWith('도구 실행 기록'))return '도구 실행';
  return '작업 기록';
}
export function TurnProgress({progress,active}:{progress:Progress;active:boolean}) {
  const [manual,setManual]=useState<boolean>();
  const live=active && Boolean(progress.startedAt && !progress.endedAt);
  const open=manual ?? live;
  const duration=workDuration(progress.startedAt,progress.endedAt);
  const stamp=(record:Record)=>'step' in record ? record.step.createdAt : record.message.createdAt;
  const ordered=[...progress.records].sort((a,b)=>Date.parse(stamp(a))-Date.parse(stamp(b)));
  const recent=[...ordered].reverse();
  const latestStep=recent.find(record=>'step' in record && record.step.state==='running');
  const latestComment=recent.find(record=>'message' in record && record.message.progressCommentary);
  const liveLabel=latestStep && 'step' in latestStep ? latestStep.step.label
    : latestComment && 'message' in latestComment ? latestComment.message.text.split(/\r?\n/,1)[0].slice(0,84)
    : '요청을 처리하고 있어요';
  const label=live ? liveLabel : duration || '작업 내역 보기';
  return <div className="turn-progress" data-message-id={'work:'+progress.key}>
    <button className="turn-progress-trigger" type="button" aria-expanded={open} onClick={()=>setManual(!open)}>
      <Activity size={13} aria-hidden="true"/><span>{label}</span><small>{ordered.length}건</small>
      {live&&<span className="turn-progress-live">실행 중</span>}<ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && <ol aria-label="작업 과정" className="turn-progress-list">{ordered.map(record=>{
      const instant=stamp(record);
      return <li key={'step' in record?'step:'+record.step.id:record.message.id}>
        <div className="turn-progress-line"><strong>{'step' in record?record.step.label:record.message.progressCommentary?'진행 설명':logLabel(record.message.text)}</strong>
          {'step' in record&&<span data-step-state={record.step.state}>{labels[record.step.state]}</span>}
          <time dateTime={instant}>{clock.format(new Date(instant))}</time>
        </div>
        {'message' in record&&<MessageContent role={record.message.progressCommentary?'assistant':'system'} text={record.message.text}/>}
      </li>;
    })}{!ordered.length&&<li>기록된 세부 단계가 없습니다.</li>}</ol>}
  </div>;
}
