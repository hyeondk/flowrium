import {useEffect,useId,useRef,useState,type KeyboardEvent,type RefObject} from 'react';
import {AtSign,ExternalLink,Plug,Plus,RefreshCw,X} from 'lucide-react';
import type {CodexPlugin,CodexPluginApp,CodexPluginList,CodexReference} from '../shared/codex-plugins';
import {useSettingsSection} from './SettingsLayout';
import './codex-plugins.css';

const message = (error:unknown) => error instanceof Error ? error.message.replace(/^.*?Error: /,'') : '플러그인 상태를 확인하지 못했습니다.';
const referenceKey = (row:CodexReference) => row.kind+':'+row.id;

export function CodexReferenceList({value,onRemove}:{value?:CodexReference[];onRemove?:(ref:CodexReference)=>void}) {
  if(!value?.length)return null;
  return <ul className="codex-reference-list" aria-label="선택한 연결 도구">
    {value.map(row=><li key={referenceKey(row)}><span><AtSign size={12} aria-hidden="true"/>{row.name}</span>
      {onRemove&&<button type="button" aria-label={row.name+' 연결 도구 제거'} onClick={()=>onRemove(row)}><X size={13}/></button>}
    </li>)}
  </ul>;
}

type Token={start:number;end:number;query:string};
function activeToken(input:HTMLTextAreaElement) {
  const at=input.selectionStart;
  if(at!==input.selectionEnd)return null;
  const current=input.value.slice(Math.max(0,at-90),at);
  const match=/(?:^|[\s([{])@([\p{L}\p{N}._-]{0,48})$/u.exec(current);
  return match ? {start:at-match[1].length-1,end:at,query:match[1]} : null;
}

type ReferenceMenuOptions={
  textareaRef:RefObject<HTMLTextAreaElement|null>; enabled:boolean; active:boolean;
  authenticated:boolean; busy:boolean; value:CodexReference[];
  onSelect:(ref:CodexReference)=>void; onManage:()=>void;
};
export function useCodexReferenceMenu({textareaRef,enabled,active,authenticated,busy,value,onSelect,onManage}:ReferenceMenuOptions) {
  const api=window.flowrium;
  const id=useId();
  const [token,setToken]=useState<Token|null>(null);
  const [rows,setRows]=useState<CodexPlugin[]>();
  const [error,setError]=useState('');
  const [position,setPosition]=useState(0);
  const dismissed=useRef<Token|null>(null);
  const pending=Boolean(token&&active&&!busy);
  const visible=pending&&Boolean(api?.readCodexPlugins);
  useEffect(()=>{
    if(!api||!visible||!enabled||!authenticated)return;
    let alive=true;
    setRows(undefined);setError('');
    api.readCodexPlugins({view:'suggestions'}).then(result=>{
      if(!alive)return;
      setRows(result.rows);
      if(result.unsupported)setError('현재 Codex에서 연결 도구 목록을 지원하지 않습니다.');
      else if(result.partial&&!result.rows.length)setError('연결 도구 목록을 다시 조회해 주세요.');
    }).catch(error=>{if(alive)setError(message(error));});
    return ()=>{alive=false;};
  },[api,visible,enabled,authenticated]);
  const q=token?.query.toLocaleLowerCase()||'';
  const exact=new Set(value.map(referenceKey));
  const names=new Set<string>();
  const matches=(rows||[]).filter(row=>[row.name,row.id].some(text=>text.toLocaleLowerCase().includes(q)))
    .filter(row=>{
      if(exact.has(referenceKey(row))||names.has(row.name))return false;
      names.add(row.name);return true;
    }).slice(0,10);
  function inspect(input:HTMLTextAreaElement) {
    if(!active||busy)return;
    const next=activeToken(input);
    const prior=dismissed.current;
    if(prior && next && prior.start===next.start && prior.end===next.end && prior.query===next.query)return;
    dismissed.current=null;
    setToken(current=>{
      if(current&&next&&current.start===next.start&&current.end===next.end&&current.query===next.query)return current;
      return next;
    });
    if(token?.query!==next?.query)setPosition(0);
  }
  function choose(row:CodexPlugin) {
    const input=textareaRef.current;
    if(!input||!token||value.length>=8)return;
    const current=activeToken(input);
    if(!current||current.start!==token.start||current.end!==token.end||current.query!==token.query)return;
    input.setRangeText('',token.start,token.end,'end');
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText'}));
    onSelect({kind:row.kind,id:row.id,name:row.name});
    setToken(null);setPosition(0);
    input.focus();
  }
  function onKey(event:KeyboardEvent<HTMLTextAreaElement>) {
    if(!visible)return false;
    if(event.key==='Escape'){
      dismissed.current=token;setToken(null);event.preventDefault();event.stopPropagation();return true;
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!matches.length)return false;
      event.preventDefault();
      setPosition(index=>(index+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length);
      return true;
    }
    if(event.key==='Enter'&&!event.shiftKey){
      if(matches[position]&&value.length<8)choose(matches[position]);
      event.preventDefault();return true;
    }
    if(event.key==='Tab'&&!event.shiftKey&&matches[position]&&value.length<8){
      event.preventDefault();choose(matches[position]);return true;
    }
    return false;
  }
  const panel=visible&&<section className="codex-reference-menu" aria-label="연결 도구 선택">
    <div className="codex-reference-menu-heading"><strong>연결 도구</strong>
      <button type="button" className="button subtle" onMouseDown={e=>e.preventDefault()} onClick={()=>{setToken(null);onManage();}}>플러그인 관리</button>
    </div>
    {!enabled?<p>연결 도구는 프로젝트 대화에서 사용할 수 있습니다.</p>:!authenticated?<p>ChatGPT에 로그인해 주세요.</p>:value.length>=8?<p>한 요청에 연결 도구를 8개까지 추가할 수 있습니다.</p>:error?<p role="status">{error}</p>:!rows?<p role="status">연결 도구를 불러오고 있습니다.</p>:
      matches.length?<div role="listbox" id={id} aria-label="사용할 수 있는 연결 도구">
        {matches.map((row,index)=><button key={referenceKey(row)} id={id+'-'+index} type="button" role="option"
          aria-selected={position===index} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setPosition(index)}
          onClick={()=>choose(row)}><Plug size={13} aria-hidden="true"/><span>{row.name}</span><small>{row.kind==='app'?'연결 앱':'플러그인'}</small></button>)}
      </div>:<p role="status">{q?'일치하는 연결 도구가 없습니다.':'현재 사용할 수 있는 연결 도구가 없습니다.'}</p>}
  </section>;
  return {inspect,onKey,panel,close:()=>{setToken(null);setPosition(0);},listId:visible&&matches.length?id:undefined,
    activeOption:visible&&matches[position]?id+'-'+position:undefined};
}

export default function CodexPluginSettings({authenticated,reveal=false}:{authenticated:boolean;reveal?:boolean}) {
  const api=window.flowrium;
  const visible=useSettingsSection('account');
  const panel=useRef<HTMLElement>(null);
  const [tab,setTab]=useState<'catalog'|'available'>('catalog');
  const [result,setResult]=useState<CodexPluginList>();
  const [term,setTerm]=useState('');
  const [reload,setReload]=useState(0);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [preparing,setPreparing]=useState(false);
  const [working,setWorking]=useState(false);
  const [confirmation,setConfirmation]=useState<CodexPlugin>();
  const [detail,setDetail]=useState<{row:CodexPlugin; apps:CodexPluginApp[]}>();
  const force=useRef(false);
  useEffect(()=>{
    if(!visible||!reveal)return;
    const frame=requestAnimationFrame(()=>panel.current?.scrollIntoView({block:'start',behavior:'instant'}));
    return()=>cancelAnimationFrame(frame);
  },[visible,reveal]);
  useEffect(()=>{
    if(!visible||!authenticated||!api?.readCodexPlugins)return;
    let alive=true;
    setPreparing(true);setError('');
    const timer=setTimeout(()=>{
      const refresh=force.current;force.current=false;
      api.readCodexPlugins({view:tab,search:tab==='available'?term:undefined,refresh}).then(next=>{
        if(alive)setResult(next);
      }).catch(error=>{if(alive)setError(message(error));})
        .finally(()=>{if(alive)setPreparing(false);});
    },tab==='available'&&term?240:0);
    return()=>{alive=false;clearTimeout(timer);};
  },[api,visible,authenticated,tab,term,reload]);
  function refresh() {force.current=true;setReload(value=>value+1);}
  function show(next:'catalog'|'available') {
    if(tab===next)return;
    setTab(next);setResult(undefined);setConfirmation(undefined);setDetail(undefined);setError('');setNotice('');
  }
  async function perform(operation:()=>Promise<void>) {
    if(working)return;
    setWorking(true);setNotice('');setError('');
    try{await operation();}
    catch(error){setError(message(error));}
    finally{setWorking(false);}
  }
  if(!api?.readCodexPlugins)return null;
  return <section ref={panel} className="settings-section codex-plugin-settings" aria-labelledby="codex-plugin-settings">
    <header><h3 id="codex-plugin-settings">플러그인과 연결 앱</h3><button type="button" className="button secondary" disabled={!authenticated||preparing||working} onClick={refresh}><RefreshCw size={14}/>새로고침</button></header>
    <p>프로젝트 대화에서 @를 입력하면 현재 계정에서 사용할 수 있는 도구를 선택할 수 있습니다.</p>
    {authenticated?<><div className="codex-plugin-tabs" aria-label="플러그인 목록">
      <button type="button" aria-pressed={tab==='catalog'} onClick={()=>show('catalog')}>설치한 도구</button>
      <button type="button" aria-pressed={tab==='available'} onClick={()=>show('available')}>새 도구 찾기</button>
    </div>
    {tab==='available'&&<label>이름으로 찾기<input className="text-input" type="search" value={term} maxLength={120} onChange={event=>setTerm(event.target.value)}/></label>}
    {preparing&&<p role="status">플러그인 목록을 불러오고 있습니다.</p>}
    {result?.partial&&<p role="status">일부 목록을 불러오지 못했습니다. 새로고침하거나 공식 화면에서 확인할 수 있습니다.</p>}
    {result?.unsupported&&<p>현재 Codex가 목록 조회를 지원하지 않습니다.</p>}
    {result?.rows.length===0&&!preparing&&!error&&<p>{term?'검색과 일치하는 도구가 없습니다.':'표시할 도구가 없습니다.'}</p>}
    {!!result?.rows.length&&<ul className="codex-plugin-results" aria-label="플러그인 검색 결과">
      {result.rows.map(row=><li key={referenceKey(row)}>
        <div><strong>{row.name}</strong><small>{row.kind==='app'?'연결 앱':'플러그인'} / {row.enabled?'사용 가능':row.installed?'설치됨':row.install?'추가 가능':'설치 권한 없음'}</small>
        {row.description&&<p>{row.description}</p>}</div>
        {row.installed?<button type="button" className="button secondary" disabled={working} onClick={()=>void perform(async()=>{
          const response=await api.manageCodexPlugin({action:'details',kind:row.kind,id:row.id});
          setDetail({row,apps:response.apps||[]});setConfirmation(undefined);
        })}>연결 상태</button>:row.install==='direct'?<button type="button" className="button primary" disabled={working}
          onClick={()=>{setConfirmation(row);setDetail(undefined);}}><Plus size={14}/>설치</button>:row.install==='official'&&
          <button type="button" className="button secondary" disabled={working} onClick={()=>void perform(async()=>{
            if(row.kind==='app')await api.manageCodexPlugin({action:'connect',kind:row.kind,id:row.id,appId:row.id});
            else await api.manageCodexPlugin({action:'directory'});
          })}><ExternalLink size={14}/>공식 화면에서 연결</button>}
      </li>)}
    </ul>}
    {confirmation&&<div className="codex-plugin-review" aria-label="플러그인 설치 확인">
      <strong>{confirmation.name} 플러그인을 설치할까요?</strong>
      <p>현재 ChatGPT 계정에 설치합니다. 외부 서비스가 필요하면 설치 후 서비스 권한을 확인해 주세요.</p>
      <div><button type="button" className="button secondary" disabled={working} onClick={()=>setConfirmation(undefined)}>취소</button>
      <button type="button" className="button primary" disabled={working} onClick={()=>void perform(async()=>{
        const installed=await api.manageCodexPlugin({action:'install',id:confirmation.id,kind:confirmation.kind,confirmed:true});
        if(!installed.installed)return;
        setConfirmation(undefined);setTab('catalog');setResult(undefined);refresh();
        setNotice(installed.authRequired?'플러그인을 설치했습니다. 연결 상태에서 서비스 권한을 확인해 주세요.':'플러그인을 설치했습니다.');
      })}>{working?'설치 중':'확인하고 설치'}</button></div>
    </div>}
    {detail&&<div className="codex-plugin-review" aria-label="서비스 연결 상태"><strong>{detail.row.name} 연결 상태</strong>
      {detail.apps.length?detail.apps.map(app=><div key={app.id}><span>{app.name} / {app.connected?'사용 가능':'연결 확인 필요'}</span>
        {!app.connected&&<button type="button" className="button secondary" disabled={working} onClick={()=>void perform(async()=>{
          await api.manageCodexPlugin({action:'connect',id:detail.row.id,kind:detail.row.kind,appId:app.id});
          setNotice('공식 화면에서 연결한 뒤 새로고침해 주세요.');
        })}><ExternalLink size={14}/>계정 연결</button>}</div>):<p>별도로 확인할 연결 앱이 없습니다. 서비스별 연결은 공식 화면에서 확인할 수 있습니다.</p>}
    </div>}</>:<p>ChatGPT 계정으로 로그인하면 설치한 도구를 확인할 수 있습니다.</p>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    <button type="button" className="button secondary" disabled={working} onClick={()=>void perform(async()=>{await api.manageCodexPlugin({action:'directory'});})}><ExternalLink size={14}/>공식 플러그인 화면</button>
  </section>;
}
