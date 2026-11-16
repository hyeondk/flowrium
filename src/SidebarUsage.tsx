import {Gauge, RefreshCw, Coins} from 'lucide-react';
import {creditBalance, type AccountUsage} from './account-usage';
export default function SidebarUsage({usage,expanded}:{usage:AccountUsage;expanded:boolean}){
 const {value,error,busy,connected,refresh}=usage;
 const windows=value?.buckets.flatMap(bucket=>bucket.windows.map(win=>({...win,name:bucket.name})))||[];
 const label=(minutes:number|null,key:string)=>minutes===300?'5시간':minutes===10080?'주간':minutes?`${minutes/60}시간`:key==='primary'?'현재 한도':'추가 한도';
 const primary=windows[0],remaining=primary?Math.max(0,Math.min(100,100-primary.usedPercent)):undefined;
 return <div className="side-usage" data-connected={connected} aria-label="계정 사용량">
  <button className="side-usage-refresh" title={busy?'사용량 조회 중':windows.length?windows.map(win=>label(win.minutes,win.key)+' '+Math.round(Math.max(0,100-win.usedPercent))+'% 남음').join(', '):'사용량 새로고침'} aria-label="사용량 새로고침" onClick={()=>void refresh()} disabled={busy||!connected}>{busy?<RefreshCw size={17} className="spin"/>:<Gauge size={19}/>}<span>{connected?'남은 사용량':'계정 연결 전'}</span>{remaining!==undefined&&<strong>{Math.round(remaining)}%</strong>}</button>
  <div className="side-usage-details">{windows.slice(0,2).map((win,i)=><div key={i} title={win.resetsAt?new Date(win.resetsAt).toLocaleString('ko-KR')+' 초기화':'초기화 시각 미제공'}><span>{label(win.minutes,win.key)}</span><progress max={100} value={Math.max(0,100-win.usedPercent)} aria-label={label(win.minutes,win.key)+' 남은 사용량'}/><strong>{Math.round(Math.max(0,100-win.usedPercent))}%</strong></div>)}{!windows.length&&<small>{error||(busy?'확인 중입니다.':connected?'계정에서 제공한 한도를 확인합니다.':'로그인 후 사용량을 확인할 수 있습니다.')}</small>}</div>
  {expanded && connected && <div className="side-credit-row" aria-label="남은 크레딧">
    <Coins size={13} aria-hidden="true"/><span>크레딧</span>
    <strong title={value ? creditBalance(value.credits) : undefined}>{value ? creditBalance(value.credits) : error ? '조회 실패' : '확인 중'}</strong>
  </div>}
 </div>
}
