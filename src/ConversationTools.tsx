import {Download, ExternalLink, MoreHorizontal, Plus} from 'lucide-react';
import {modelDisplayName, effortDisplayName} from '../shared/model-display';
import { AnimatedSwitch,CloseButton,MotionOverlay } from './ui-motion';
import {effortOptions} from '../shared/model-options';
import {useEffect,useState} from 'react';
import type {Session,ConversationEdit,Model,Effort,ChatPreferences,ChatAttachment} from '../shared/types';
const initial={answerLength:'normal',testing:true,askNext:false,autoCompact:true,compactAt:80} as const;
export function ConversationTools({session,models,running,onOpen,onChange,notify,fail,defaults,defaultModel,onDefaults,onRewind,onDelete,onExport,onHandoff,onNew}:{
 session:Session;models:Model[];running:boolean;onOpen:(s:Session)=>void;onChange:(s:Session)=>void;notify:(s:string)=>void;fail:(e:unknown)=>void;
 defaults?:ChatPreferences;defaultModel?:string;onDefaults?:(p:ChatPreferences)=>void;onRewind?:(draft:{text:string;attachments:ChatAttachment[]})=>void;onDelete?:()=>void;onExport?:()=>void|Promise<void>;onHandoff?:()=>void;onNew?:()=>void;
}) {
 const linked=session.codexLink?.mode==='linked';
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[title,setTitle]=useState(session.title);
 const [model,setModel]=useState(session.preferences?.model||''),[effort,setEffort]=useState(session.preferences?.effort||''),[address,setAddress]=useState(session.preferences?.chatGptUrl||'');
 const [messageId,select]=useState(''),[confirm,setConfirm]=useState(false);
 const efforts=effortOptions(models.find(row=>row.id===(model||defaultModel))||(!model&&!defaultModel?models.find(row=>row.isDefault):undefined));
 useEffect(()=>{setEffort(value=>value&&!efforts.some(row=>row.reasoningEffort===value)?'':value);},[model,models,defaultModel]);
 const [inherit,setInherit]=useState(!(session.preferences?.answerLength || session.preferences?.approval)),[prefs,setPrefs]=useState<ChatPreferences>({...initial,...defaults,...session.preferences});
 const set=<K extends keyof ChatPreferences>(key:K,value:ChatPreferences[K])=>setPrefs(old=>({...old,[key]:value}));
 const behavior=():ChatPreferences=>({answerLength:prefs.answerLength,testing:prefs.testing,askNext:prefs.askNext,autoCompact:prefs.autoCompact,compactAt:prefs.compactAt,approval:prefs.approval,networkAccess:prefs.networkAccess});
 async function apply(change:ConversationEdit){
  if(!window.flowrium||busy)return;setBusy(true);
  try{const {restoredDraft,...value}=await window.flowrium.editConversation(session.id,change);
   if(change.action==='branch')onOpen(value);else onChange(value);
   if(change.action==='rewind'&&restoredDraft)onRewind?.(restoredDraft);
   notify(change.action==='preferences'?'대화 동작 설정을 저장했습니다.':change.action==='compact'?'Codex 문맥 압축을 시작했습니다.':change.action==='rewind'?'Codex 기록을 되감고 선택한 요청을 입력창에 복원했습니다.':change.action==='branch'?'Codex 내부 문맥을 보존한 분기 대화를 열었습니다.':'대화 이름을 변경했습니다.');
   setOpen(false);setConfirm(false);select('');
  }catch(e){fail(e);}finally{setBusy(false);}
 }
 return <div className="conversation-tools"><button className="button subtle conversation-menu-trigger" aria-label="대화 관리" title="대화 관리" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setOpen(!open);setTitle(session.title);setModel(session.preferences?.model||'');setEffort(session.preferences?.effort||'');setAddress(session.preferences?.chatGptUrl||'');setInherit(!(session.preferences?.answerLength || session.preferences?.approval));setPrefs({...initial,...defaults,...session.preferences});}}><MoreHorizontal size={17}/></button>
 <MotionOverlay open={open} onClose={()=>setOpen(false)} label="대화 관리" className="conversation-management"><header><h2>대화 관리</h2><CloseButton onClick={()=>setOpen(false)}/></header><div className="conversation-utility-actions">{onHandoff&&<button type="button" onClick={()=>{setOpen(false);onHandoff();}}><ExternalLink size={15}/>ChatGPT로 이어가기</button>}{onExport&&<button type="button" onClick={()=>{setOpen(false);void onExport();}}><Download size={15}/>대화 내보내기</button>}{onNew&&<button type="button" onClick={()=>{setOpen(false);onNew();}}><Plus size={15}/>새 작업</button>}</div><fieldset disabled={busy} className="conversation-popover">
  <label>대화 이름<input aria-label="대화 이름" maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
  <small className="field-hint">{session.codexLink?.mode==='copy'?'이 이름은 독립 사본에 적용됩니다.':session.threadId && (linked || session.desktopThread)?'같은 기기의 Codex 대화와 제목을 공유합니다.':'이 제목은 첫 작업을 보내 Codex 대화에 연결하면 반영됩니다.'}</small>
  <div className="dialog-actions">
   <button type="button" className="button secondary" disabled={!title.trim()} onClick={()=>apply({action:'rename',title})}>이름 저장</button>
  </div>
 </fieldset><fieldset disabled={running||busy||session.compacting} className="conversation-popover">
  <label>이 대화의 모델<select aria-label="이 대화의 모델" value={model} onChange={e=>{setModel(e.target.value);setEffort('')}}><option value="">앱 기본 설정</option>{model&&!models.some(m=>m.id===model)&&<option value={model}>{modelDisplayName(model)}</option>}{models.map(m=><option key={m.id} value={m.id}>{modelDisplayName(m)}</option>)}</select></label>
  <label>이 대화의 추론 강도<select aria-label="이 대화의 추론 강도" value={effort} onChange={e=>setEffort(e.target.value)}><option value="">앱 기본 설정</option>{efforts.map(row=><option key={row.reasoningEffort} value={row.reasoningEffort}>{effortDisplayName(row.reasoningEffort)}</option>)}</select></label>
  <label>이어갈 ChatGPT 대화 주소<input type="url" placeholder="https://chatgpt.com/c/…" value={address} onChange={e=>setAddress(e.target.value)}/></label>
  {linked&&<p className="field-hint">연결한 대화는 원래 지침을 유지합니다. 이 앱에서 모델과 추론 강도를 선택할 수 있습니다.</p>}
  <label className="preference-check"><AnimatedSwitch disabled={linked} checked={inherit} onChange={e=>setInherit(e.target.checked)}/>대화 동작은 앱 기본 설정 따르기</label>
  <fieldset disabled={inherit||linked}>
   <label>답변 길이<select aria-label="답변 길이" value={prefs.answerLength} onChange={e=>set('answerLength',e.target.value as ChatPreferences['answerLength'])}><option value="short">짧게</option><option value="normal">보통</option><option value="detailed">자세히</option></select></label>
   <label className="preference-check"><AnimatedSwitch checked={!!prefs.testing} onChange={e=>set('testing',e.target.checked)}/>구현 뒤 테스트까지 수행</label>
   <label className="preference-check"><AnimatedSwitch checked={!!prefs.askNext} onChange={e=>set('askNext',e.target.checked)}/>끝나면 다음 작업을 계속할지 질문</label>
   <label className="preference-check"><AnimatedSwitch disabled={linked} checked={!linked&&!!prefs.autoCompact} onChange={e=>set('autoCompact',e.target.checked)}/>문맥 자동 압축</label>
   <label>자동 압축 시작 기준<select disabled={linked} value={prefs.compactAt} onChange={e=>set('compactAt',Number(e.target.value))}>{[50,60,70,80,90,95].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
   {!session.scope&&<>
   <label>범위 밖 실행 승인<select value={prefs.approval||'on-request'} onChange={e=>set('approval',e.target.value as ChatPreferences['approval'])}><option value="on-request">나 대신 승인</option><option value="manual">직접 승인</option><option value="never">범위 밖 실행 거절</option></select></label>
   <label className="preference-check"><AnimatedSwitch checked={!!prefs.networkAccess} onChange={e=>set('networkAccess',e.target.checked)}/>명령의 네트워크 사용 허용</label>
</>}
  </fieldset>
  <div className="dialog-actions">
   <button type="button" className="button secondary" onClick={()=>apply({action:'preferences',preferences:{...(!inherit?behavior():{}),model:model||undefined,effort:(effort||undefined) as Effort|undefined,speed:session.preferences?.speed,chatGptUrl:address.trim()||undefined}})}>대화 연결 설정 저장</button>
   <button type="button" className="button secondary" disabled={linked} onClick={async()=>{try{const value=await window.flowrium!.saveSettings({chatDefaults:behavior()});onDefaults?.(value.chatDefaults||{});notify('새 대화와 기본 설정을 따르는 대화에 적용했습니다.');}catch(e){fail(e);}}}>이 동작을 앱 기본값으로 저장</button>
  </div>
  {session.scope&&<p>이 대화의 프로젝트 파일 접근과 명령 실행은 제한됩니다.</p>}
  {linked&&<p className="field-hint">이 대화는 원래 앱과 연결되어 있습니다. 원본의 분기와 되감기, 압축은 원래 앱에서 수행하거나, 독립 사본에서 사용하세요.</p>}
  <label>기준 요청<select disabled={linked} aria-label="기준 요청" value={messageId} onChange={e=>{select(e.target.value);setConfirm(false);}}><option value="">대화 끝</option>{session.messages.filter(m=>m.role==='user').map((m,i)=><option key={m.id} value={m.id}>{i+1}. {m.text.slice(0,48)}</option>)}</select></label>
  <div className="dialog-actions">
   <button type="button" className="button secondary" disabled={linked||!session.threadId} onClick={()=>apply({action:'branch',messageId:messageId||undefined})}>여기까지 새 대화로 분기</button>
   {!linked&&messageId&&<button type="button" className="button secondary" onClick={()=>setConfirm(true)}>이 요청 전으로 되감기</button>}
   <button type="button" className="button secondary" disabled={linked||!session.threadId} onClick={()=>apply({action:'compact'})}>Codex 문맥 압축</button>
   {onDelete&&<button type="button" className="button danger" onClick={()=>{setOpen(false);onDelete();}}>대화 삭제</button>}
  </div>
  {confirm&&<div><p>Codex 내부 대화도 선택한 요청 전으로 되감습니다. 프로젝트 파일은 보존되며 원래 대화 상태의 사본을 유지합니다.</p><div className="dialog-actions"><button type="button" className="button primary" onClick={()=>apply({action:'rewind',messageId})}>되감기 확인</button></div></div>}
 </fieldset></MotionOverlay>
 </div>;
}
