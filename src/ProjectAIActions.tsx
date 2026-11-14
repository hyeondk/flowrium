import {modelDisplayName} from '../shared/model-display';
import { useEffect, useState } from 'react';
import type { Model, Project, Session } from '../shared/types';
type Purpose='goals'|'rules'|'design'|'meetings'|'docs';
const labels:Record<Purpose,string>={goals:'목표 진척 정리',rules:'프로젝트 규칙 작성',design:'디자인 검토 작성',meetings:'회의록 작성과 요약',docs:'문서 작성과 자료 요약'};
const prompts:Record<Purpose,string>={
  goals:'현재 프로젝트의 실제 업무와 완료 기록, 기간 목표를 확인하고 목표 진척을 정리하세요. flowrium_project_read로 최신 개정을 읽고 확인한 근거만으로 목표를 제안하거나 갱신하세요. 계획을 완료한 일처럼 표시하지 마세요. 결과와 근거를 산출물로 저장하세요.',
  rules:'프로젝트의 기존 규칙과 코드 구조를 확인해 요청한 프로젝트 규칙 문서를 완성하세요. 기존 원본을 덮어쓰지 말고 flowrium_project_note 도구로 새 규칙 문서를 저장하세요.',
  design:'프로젝트 자료와 사용자의 요청을 확인해 디자인 검토 또는 시안 설명을 완성하고 flowrium_project_note로 디자인 문서를 저장하세요. 확인하지 못한 화면은 미확인으로 구분하세요.',
  meetings:'사용자가 제공한 회의 내용과 프로젝트 자료에서 결정 사항 / 담당자 / 기한 / 후속 작업을 정리하고 flowrium_project_note로 회의록을 저장하세요. 자료에 없는 발언이나 결정을 만들지 마세요.',
  docs:'프로젝트 자료를 확인해 사용자가 요청한 완성 문서나 요약을 작성하고 flowrium_project_artifact_create로 저장하세요. HTML 보고서는 실제 문서 형태로 구성하고 발표자료 요청은 section.slide 요소로 만드세요. 근거가 없는 숫자와 실적은 만들지 마세요.',
};
export default function ProjectAIActions({project,purpose,onOpen}:{project:Project;purpose:Purpose;onOpen(s:Session):void}){
  const [open,setOpen]=useState(false),[models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[instruction,setInstruction]=useState(''),[error,setError]=useState(''),[authenticated,setAuthenticated]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!open)return;let alive=true;window.flowrium?.connect().then(v=>{if(alive){setModels(v.models);setAuthenticated(v.status.authenticated);if(!v.status.authenticated)setError('ChatGPT 계정 연결이 필요합니다.');}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[open]);
  async function start(){if(busy||!authenticated)return;setBusy(true);setError('');try{
    const kind=purpose==='docs'?'document':'task',request=[prompts[purpose],instruction&&'사용자 요청 / '+instruction].filter(Boolean).join('\n\n');
    const session=await window.flowrium!.startWork({projectId:project.id,kind,title:labels[purpose],role:'프로젝트 자료 작성 담당자',brief:request,audience:'프로젝트 사용자',from:'',to:'',...(model?{model}:{})});
    await window.flowrium!.send({sessionId:session.id,text:request,mode:'build',...(model?{model}:{})});onOpen(session);
  }catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false);}}
  return <details className="pf-panel project-ai-actions" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>ChatGPT로 {labels[purpose]}</summary><p>AI가 자료를 읽고 결과를 작성해 프로젝트에 저장합니다. 필요한 조건이나 참고 내용을 덧붙이세요.</p><label>사용할 ChatGPT 모델<select value={model} onChange={e=>setModel(e.target.value)}><option value="">계정 기본 모델</option>{models.map(m=><option key={m.id} value={m.id}>{modelDisplayName(m)}</option>)}</select></label><label>AI에게 요청할 내용<textarea rows={3} maxLength={10000} value={instruction} onChange={e=>setInstruction(e.target.value)}/></label><button className="pf-primary" disabled={busy||!authenticated} onClick={()=>void start()}>{busy?'AI 업무 시작 중…':'ChatGPT로 작성하고 저장'}</button>{error&&<p role="alert">{error}</p>}</details>;
}
