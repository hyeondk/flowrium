import {useEffect,useState} from "react";
import type {RepoChange,PullRequest,RepoAction} from "../shared/repository";
import type {Project} from "../shared/types";
export default function RepositoryPanel({project}:{project:Project}) {
  const [files,setFiles]=useState<RepoChange[]>([]),[selected,select]=useState<string[]>([]),[prs,setPRs]=useState<PullRequest[]>([]);
  const [title,setTitle]=useState(""),[base,setBase]=useState("main"),[body,setBody]=useState(""),[output,setOutput]=useState(""),[busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState<{label:string;action:RepoAction}>();
  const api=window.flowrium;
  async function action(input:RepoAction) {
    if (!api || busy) return;
    setBusy(true);setConfirm(undefined);
    try {
      if(input.action==="changes") {setFiles(await api.repositoryAction(project.id,{action:"changes"})); select([]);setOutput("");}
      else if(input.action==="prs") {const list=await api.repositoryAction(project.id,{action:"prs"});setPRs(list);setOutput(list.length?"":"열린 변경 요청이 없습니다.");}
      else {setOutput(await api.repositoryAction(project.id,input)); if (input.action==="commit") { setFiles(await api.repositoryAction(project.id,{action:"changes"})); select([]); } if (input.action==="merge" || input.action==="createPR") setPRs(await api.repositoryAction(project.id,{action:"prs"}));}
    } catch(e) {setOutput(e instanceof Error ? e.message : String(e));}
    finally {setBusy(false);}
  }
  useEffect(()=>{ void action({action:"changes"}); },[project.id]);
  const review=(label:string,action:RepoAction)=>setConfirm({label,action});
  return <div className="page-scroll"><div className="page-inner repo-actions"><h1>형상관리</h1><p>{project.name}</p>
    <fieldset disabled={busy}><div className="wb-tools"><button className="wb-secondary" onClick={()=>action({action:"terminal"})}>프로젝트 터미널 열기</button><button className="wb-secondary" onClick={()=>action({action:"changes"})}>변경 파일 새로 고침</button></div>
    <h2>변경 파일</h2>{files.length===0 && <p>선택할 변경 파일이 없습니다.</p>}
    {files.map(f=><label className="repo-file" key={f.file}><input type="checkbox" checked={selected.includes(f.file)} onChange={e=>select(e.target.checked?[...selected,f.file]:selected.filter(v=>v!==f.file))}/><code>{f.code}</code>{f.file}</label>)}
    <label>커밋 또는 변경 요청 제목<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <div className="wb-tools"><button className="wb-secondary" disabled={!selected.length} onClick={()=>action({action:"diff",files:selected})}>차이 보기</button><button className="wb-secondary" disabled={!selected.length||!title.trim()} onClick={()=>review(`파일 ${selected.length}개 커밋`,{action:"commit",files:selected,message:title})}>선택한 파일 커밋</button>
    <button className="wb-secondary" onClick={()=>review("현재 브랜치를 origin으로 푸시",{action:"push"})}>브랜치 푸시</button></div>
    <h2>GitHub 변경 요청</h2><button className="wb-secondary" onClick={()=>action({action:"prs"})}>열린 요청 조회</button>
    {prs.map(pr=><div className="repo-pr" key={pr.number}><span>#{pr.number} / {pr.title} / {pr.headRefName} → {pr.baseRefName}</span><button className="wb-secondary" onClick={()=>review(`#${pr.number} 요청을 ${pr.baseRefName}에 병합`,{action:"merge",number:pr.number,head:pr.headRefOid})}>병합</button></div>)}
    <label>대상 브랜치<input value={base} onChange={e=>setBase(e.target.value)}/></label><label>변경 요청 설명<textarea value={body} onChange={e=>setBody(e.target.value)}/></label>
    <button className="wb-secondary" disabled={!base.trim()||!body.trim()||!title.trim()} onClick={()=>review(`${base} 브랜치로 변경 요청 생성`,{action:"createPR",base,body,title})}>변경 요청 만들기</button>
    {confirm && <section role="alert"><strong>{confirm.label}</strong><div className="wb-tools"><button className="wb-primary" onClick={()=>action(confirm.action)}>확인하고 실행</button><button className="wb-secondary" onClick={()=>setConfirm(undefined)}>취소</button></div></section>}
    </fieldset>{output && <pre role="status">{output}</pre>}</div></div>
}
