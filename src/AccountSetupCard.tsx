import {useEffect,useState} from 'react';
import {CalendarDays,Check,MessageSquare} from 'lucide-react';
export default function AccountSetupCard({chatConnected,onChat,onCalendar}:{chatConnected:boolean;onChat():void;onCalendar():void}){
 const [googleConnected,setGoogleConnected]=useState(false),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{let alive=true;window.flowrium?.googleStatus().then(value=>{if(alive)setGoogleConnected(value.connected)}).catch(()=>{});return()=>{alive=false}},[]);
 if(dismissed||chatConnected&&googleConnected)return null;
 return <section className="account-setup-card" aria-label="처음 계정 연결"><header><div><h2>내 계정으로 시작하세요</h2><p>대화와 개인 일정을 연결하면 이 작업 공간에서 함께 확인할 수 있습니다.</p></div><button onClick={()=>setDismissed(true)}>나중에</button></header><div><article><MessageSquare size={20}/><span><strong>ChatGPT</strong><small>본인 계정으로 프로젝트 대화와 AI 업무를 실행합니다.</small></span><button className="button subtle" onClick={onChat}>{chatConnected?<><Check size={14}/>연결됨</>:'계정 연결'}</button></article><article><CalendarDays size={20}/><span><strong>Google 일정</strong><small>본인 캘린더를 조회하고 일정 변경을 검토합니다.</small></span><button className="button subtle" onClick={onCalendar}>{googleConnected?'일정 열기':'Google 연결'}</button></article></div></section>
}
