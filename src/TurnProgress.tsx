import {useState} from 'react';
import {Activity, ChevronRight, X} from 'lucide-react';
import type {Message, WorkStep} from '../shared/types';
import {MotionOverlay} from './ui-motion';
import MessageContent from './MessageContent';

type Record = {message:Message} | {step:WorkStep};
type Progress = {key:string; records:Record[]};
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
  const add=(key:string, record:Record)=>{
    let group=groups.get(key);
    if(!group) {
      group={key,records:[]};
      groups.set(key,group);
      rows.push({progress:group});
    }
    group.records.push(record);
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
export function TurnProgress({progress}:{progress:Progress}) {
  const [open,setOpen]=useState(false);
  const live=progress.records.some(record=>'step' in record && record.step.state==='running');
  return <div className="turn-progress" data-message-id={'work:'+progress.key}>
    <button className="turn-progress-trigger" type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={'작업 과정 보기 ('+progress.records.length+'건)'} onClick={()=>setOpen(true)}>
      <Activity size={13} aria-hidden="true"/><span aria-hidden="true">작업 과정</span><small>{progress.records.length}건</small>
      {live&&<span className="turn-progress-live">실행 중</span>}<ChevronRight size={13} aria-hidden="true"/>
    </button>
    <MotionOverlay open={open} label="작업 과정" onClose={()=>setOpen(false)} className="turn-progress-dialog">
      <header><h2>작업 과정</h2><button type="button" className="icon-button" aria-label="작업 과정 닫기" onClick={()=>setOpen(false)}><X size={16}/></button></header>
      <ol>{open&&progress.records.map(record=>{
        const instant='step' in record?record.step.createdAt:record.message.createdAt;
        return <li key={'step' in record?'step:'+record.step.id:record.message.id}>
          <div className="turn-progress-line"><strong>{'step' in record?record.step.label:logLabel(record.message.text)}</strong>
            {'step' in record&&<span data-step-state={record.step.state}>{labels[record.step.state]}</span>}
            <time dateTime={instant}>{clock.format(new Date(instant))}</time>
          </div>
          {'message' in record&&<MessageContent role="system" text={record.message.text}/>}
        </li>;
      })}</ol>
    </MotionOverlay>
  </div>;
}
