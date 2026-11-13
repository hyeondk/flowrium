import { AnimatedCheckbox } from './ui-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeamWorktree, TeamWorktreeBoard, TeamWorktreeChange, WorktreeRemote } from '../shared/team-worktrees';
import './team-worktrees.css';

type Props = { projectId: string; runId: string };
export default function TeamWorktrees(props: Props) {
  return <RunWorktrees key={props.projectId + '/' + props.runId} {...props} />;
}
function RunWorktrees({ projectId, runId }: Props) {
  const api=window.flowrium;
  const [board,setBoard]=useState<TeamWorktreeBoard>();
  const [index,setIndex]=useState(0);
  const [chosen,setChosen]=useState<string[]>([]);
  const [message,setMessage]=useState('');
  const [preview,setPreview]=useState('');
  const [remote,setRemote]=useState<WorktreeRemote>();
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [confirm,setConfirm]=useState<{label:string;input:TeamWorktreeChange}>();
  const [title,setTitle]=useState(''),[body,setBody]=useState('');
  const alive=useRef(false), working=useRef(false);
  const refresh=useCallback(async()=>{
    if (!api) return;
    const next=await api.teamWorktrees(projectId,runId);
    if(alive.current) setBoard(next);
  },[api,projectId,runId]);
  useEffect(()=>{alive.current=true;void refresh().catch(e=>{if(alive.current)setNotice(e.message);});return()=>{alive.current=false;};},[refresh]);
  const tree=board&&(index===-1?board.integration:board.roles[index]);
  function choose(next:number){setIndex(next);setChosen([]);setConfirm(undefined);setRemote(undefined);setPreview('');setNotice('');}
  async function perform(fn:()=>Promise<void>){
    if(!api||working.current)return; working.current=true;setBusy(true);setNotice('');
    try {await fn();}catch(e){if(alive.current)setNotice(e instanceof Error?e.message:'작업 폴더 요청에 실패했습니다.');}
    finally{working.current=false;if(alive.current)setBusy(false);}
  }
  function run(input:TeamWorktreeChange){void perform(async()=>{
    const value=await api!.teamWorktreeAction(projectId,runId,input);
    if(!alive.current)return;
    if(input.action==='diff')setPreview(value);
    else{setNotice(value);setPreview('');setChosen([]);setConfirm(undefined);setRemote(undefined);await refresh();}
  });}
  function reviewMerge(){
    if (!tree || !board) return;
    const input:TeamWorktreeChange = { action:'integrate',index,head:tree.head,integrationHead:board.integration.head||board.base };
    void perform(async()=>{
      const value=await api!.teamWorktreeAction(projectId,runId,{action:'diff',index});
      if(alive.current){setPreview(value);setConfirm({label:'검토한 커밋 통합',input});}
    });
  }
  function remoteInfo(){void perform(async()=>{const info=await api!.teamWorktreeAction(projectId,runId,{action:'remote',index:-1});if(alive.current)setRemote(info);});}
  function button(label:string,input:TeamWorktreeChange){return <button type="button" disabled={busy} onClick={()=>setConfirm({label,input})}>{label}</button>;}
  function tab(t:TeamWorktree){return <button type="button" key={t.index} aria-pressed={index===t.index} onClick={()=>choose(t.index)}>{t.name}</button>;}
  return <section className="team-trees" aria-label="격리 작업 폴더"><header><h4>격리 작업 폴더</h4>
    <button type="button" disabled={busy} onClick={()=>void perform(refresh)}>변경 새로고침</button></header>
    {board&&tree&&<><p>기준 브랜치 {board.baseBranch} / {board.base.slice(0,8)}</p><nav aria-label="역할 작업 폴더">{board.roles.map(tab)}{tab(board.integration)}</nav>
      <p className="tree-path">{tree.branch}{tree.directory&&' / '+tree.directory}</p>
      {!tree.directory?<button type="button" disabled={busy} onClick={()=>run({action:'restore',index})}>{tree.archived?'보존된 커밋에서 다시 열기':'작업 폴더 열기'}</button>:<>
        {tree.owner!==tree.index&&<p>읽기 전용 검토 역할입니다. 변경 작업은 담당 역할 탭에서 진행하세요.</p>}
        <button type="button" disabled={busy} onClick={()=>run({action:'diff',index})}>기준과 커밋 차이 보기</button>
        {tree.files.length>0&&<div className="tree-files">{tree.files.map(f=><div key={f.file}>
          <label><AnimatedCheckbox disabled={busy||!!tree.mergeHead||tree.owner!==index} checked={chosen.includes(f.file)} onChange={e=>setChosen(old=>e.target.checked?[...old,f.file]:old.filter(p=>p!==f.file))}/>{f.code} / {f.file}</label>
          <button type="button" disabled={busy} onClick={()=>run({action:'diff',index,file:f.file})}>차이</button></div>)}</div>}
        {tree.owner===index&&!tree.mergeHead&&tree.files.length>0&&<div className="tree-actions"><label>커밋 제목<input value={message} maxLength={240} onChange={e=>setMessage(e.target.value)}/></label>
          <button type="button" disabled={busy||!chosen.length||!message.trim()} onClick={()=>run({action:'commit',index,head:tree.head,files:chosen,message})}>선택 파일 커밋</button></div>}
        {index!==-1&&tree.owner===index&&<button type="button" disabled={busy} onClick={reviewMerge}>검토한 커밋 통합</button>}
        {tree.mergeHead&&<div className="tree-conflicts"><h5>병합 충돌</h5>{tree.conflicts.map(f=><div key={f}><code>{f}</code>
          {(['ours','theirs','manual'] as const).map((side,i)=><button type="button" key={side} disabled={busy} onClick={()=>setConfirm({label:['통합본 선택','역할본 선택','직접 수정한 파일 사용'][i]+' / '+f,input:{action:'resolve',index,head:tree.head,file:f,side}})}>{['통합본 선택','역할본 선택','직접 수정한 파일 사용'][i]}</button>)}</div>)}
          {tree.conflicts.length===0&&button('충돌 해결 후 통합 완료',{action:'finish',index,head:tree.head})}
          {button('진행 중인 병합 취소',{action:'abort',index,head:tree.head})}</div>}
        {index===-1&&!tree.mergeHead&&<div className="tree-remote"><button type="button" disabled={busy} onClick={remoteInfo}>GitHub 변경 요청 조회</button>
          {button('통합 브랜치 푸시',{action:'publish',index,head:tree.head})}
          {remote&&<><p>{remote.repository} / {remote.pr?'#'+remote.pr.number+' '+remote.pr.title+' / '+remote.pr.state:'열린 변경 요청 없음'}</p>
            {remote.pr?.state==='OPEN'?button('검토한 변경 요청 병합',{action:'mergePR',index,head:tree.head,number:remote.pr.number}):<>
              <label>변경 요청 제목<input value={title} maxLength={250} onChange={e=>setTitle(e.target.value)}/></label>
              <label>변경 요청 설명<textarea value={body} maxLength={10000} onChange={e=>setBody(e.target.value)}/></label>
              {title.trim()&&button('변경 요청 만들기',{action:'openPR',index,head:tree.head,title,body})}</>}</>}</div>}
        {tree.owner===index&&button('로컬 작업 폴더와 브랜치 정리',{action:'cleanup',index,head:tree.head})}
      </>}
      {preview&&<pre aria-label="변경 내용">{preview}</pre>}
      {confirm&&<div className="tree-confirm"><p>{confirm.label} 작업을 실행할까요?</p><button type="button" disabled={busy} onClick={()=>setConfirm(undefined)}>취소</button>
        <button type="button" disabled={busy} onClick={()=>run(confirm.input)}>확인하고 실행</button></div>}
    </>}{notice&&<p role="status" className="tree-notice">{notice}</p>}</section>;
}
