import {useEffect,useRef,useState} from 'react';
import {Gauge,RefreshCw} from 'lucide-react';
import type {UsageSnapshot} from '../shared/security';
export default function SidebarUsage({connected}:{connected:boolean}){
 const [value,setValue]=useState<UsageSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),alive=useRef(true),loading=useRef(false);
 async function refresh(){if(!connected||!window.flowrium||loading.current)return;loading.current=true;setBusy(true);try{const next=await window.flowrium.readAccountUsage();if(alive.current){setValue(next);setError('')}}catch{if(alive.current)setError('사용량을 불러오지 못했습니다. 다시 확인해 주세요.')}finally{loading.current=false;if(alive.current)setBusy(false)}}
 useEffect(()=>{alive.current=true;setValue(undefined);setError('');void refresh();const timer=setInterval(()=>void refresh(),120000);const focus=()=>void refresh();window.addEventListener('focus',focus);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',focus)}},[connected]);
 const windows=value?.buckets.flatMap(bucket=>bucket.windows.map(win=>({...win,name:bucket.name})))||[];
 const label=(minutes:number|null,key:string)=>minutes===300?'5시간':minutes===10080?'주간':minutes?`${minutes/60}시간`:key==='primary'?'현재 한도':'추가 한도';
 const primary=windows[0],remaining=primary?Math.max(0,Math.min(100,100-primary.usedPercent)):undefined;
 return <div className="side-usage" data-connected={connected} aria-label="계정 사용량">
  <button className="side-usage-refresh" title={busy?'사용량 조회 중':windows.length?windows.map(win=>label(win.minutes,win.key)+' '+Math.round(Math.max(0,100-win.usedPercent))+'% 남음').join(', '):'사용량 새로고침'} aria-label="사용량 새로고침" onClick={()=>void refresh()} disabled={busy||!connected}>{busy?<RefreshCw size={17} className="spin"/>:<Gauge size={19}/>}<span>{connected?'남은 사용량':'계정 연결 전'}</span>{remaining!==undefined&&<strong>{Math.round(remaining)}%</strong>}</button>
  <div className="side-usage-details">{windows.slice(0,2).map((win,i)=><div key={i} title={win.resetsAt?new Date(win.resetsAt).toLocaleString('ko-KR')+' 초기화':'초기화 시각 미제공'}><span>{label(win.minutes,win.key)}</span><progress max={100} value={Math.max(0,100-win.usedPercent)} aria-label={label(win.minutes,win.key)+' 남은 사용량'}/><strong>{Math.round(Math.max(0,100-win.usedPercent))}%</strong></div>)}{!windows.length&&<small>{error||(busy?'확인 중입니다.':connected?'계정에서 제공한 한도를 확인합니다.':'로그인 후 사용량을 확인할 수 있습니다.')}</small>}</div>
 </div>
}
