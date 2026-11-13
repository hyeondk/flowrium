import { AnimatedSwitch } from './ui-motion';
import {useEffect,useState} from 'react';
import type {LinkDeliveryState,LinkDeliveryInput} from '../shared/link-delivery';

export default function LinkDeliveryPanel(){
 const [state,setState]=useState<LinkDeliveryState>(),[restKey,setRestKey]=useState(''),[secret,setSecret]=useState(''),[senders,setSenders]=useState(''),[phrase,setPhrase]=useState('Flowrium 링크'),[provider,setProvider]=useState<'google'|'mac'>('google'),[enabled,setEnabled]=useState(false),[to,setTo]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const api=window.flowrium;
 function accept(value:LinkDeliveryState){setState(value);setSenders(value.mail.senders.join('\n'));setPhrase(value.mail.phrase);setProvider(value.mail.provider);setEnabled(value.mail.enabled);}
 useEffect(()=>{let live=true;void api?.linkDeliveryState().then(value=>{if(live)accept(value)}).catch(()=>{});return()=>{live=false}},[]);
 async function act(run:()=>Promise<unknown>,message='설정을 반영했습니다.'){
  if(busy||!api)return;setBusy(true);setError('');setNotice('');try{await run();accept(await api.linkDeliveryState());setNotice(message)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
 }
 const save=(input:LinkDeliveryInput)=>api!.configureLinkDelivery(input);
 return <section className="integration-panel settings-section link-delivery-panel" aria-label="연결 주소 전달">
  <h3>모바일 연결 주소 전달</h3>
  <p>열려 있는 데스크톱에 연결할 일회용 주소를 본인 카카오톡이나 허용한 메일 주소로 보냅니다. 주소는 한 번만 교환되며 데스크톱 연결을 종료하면 접근도 끝납니다.</p>
  <label>주소 유효 시간<select aria-label="주소 유효 시간" value={state?.ttlMinutes||15} disabled={busy} onChange={e=>void act(()=>save({ttlMinutes:Number(e.target.value) as 5|15|60}))}><option value="5">5분</option><option value="15">15분</option><option value="60">60분</option></select></label>
  <details><summary>카카오톡 연결</summary>
   <p>본인의 카카오 개발자 앱에서 카카오 로그인 / 나에게 보내기를 켜고 아래 주소를 등록해 주세요.</p>
   <label>로그인 반환 주소<input readOnly value={state?.redirectUri||''}/></label>
   <label>웹 도메인<input readOnly value={state?.webDomain||''}/></label>
   <label>REST API 키<input autoComplete="off" value={restKey} placeholder={state?.configured?'저장됨 / 바꿀 때만 입력':''} onChange={e=>setRestKey(e.target.value)}/></label>
   <label>클라이언트 보안 비밀<input type="password" autoComplete="off" value={secret} placeholder={state?.hasSecret?'저장됨 / 바꿀 때만 입력':'사용하는 경우 입력'} onChange={e=>setSecret(e.target.value)}/></label>
   <div className="button-row"><button className="button secondary" disabled={busy||!restKey.trim()} onClick={()=>void act(async()=>{await save({restKey:restKey.trim(),clientSecret:secret.trim()});setRestKey('');setSecret('')})}>카카오 설정 저장</button>
   <button className="button secondary" disabled={busy||!state?.configured||state.authorizing} onClick={()=>void act(()=>api!.connectKakao(),'브라우저에서 카카오 로그인을 마친 뒤 연결 확인을 눌러 주세요.')}>카카오 로그인</button>
   <button className="button secondary" disabled={busy} onClick={()=>void act(async()=>{},'연결 상태를 확인했습니다.')}>연결 확인</button>
   {state?.connected&&<><button className="button" disabled={busy} onClick={()=>void act(()=>api!.sendKakaoLink(),'나와의 채팅으로 일회용 주소를 보냈습니다.')}>나에게 연결 주소 보내기</button><button className="button secondary" disabled={busy} onClick={()=>void act(()=>api!.disconnectKakao())}>카카오 연결 해제</button></>}</div>
   <label><AnimatedSwitch checked={state?.autoKakao||false} disabled={busy||!state?.connected} onChange={e=>void act(()=>save({autoKakao:e.target.checked}))}/> 데스크톱 연결 주소가 바뀌면 나에게 자동 전송</label>
  </details>
  <details><summary>메일로 연결 주소 요청</summary>
   <p>허용한 발신자가 지정한 문구를 제목에 넣어 새 메일을 보내면 일회용 주소로 답장합니다. 이 설정을 켜는 것은 해당 메일 요청에 자동으로 답장하도록 허용하는 것입니다. 이전 메일 / 다른 발신자 / 이미 처리한 요청에는 답장하지 않습니다.</p>
   <label>메일 계정<select value={provider} onChange={e=>setProvider(e.target.value as 'google'|'mac')}><option value="google">연결한 Google 메일</option>{state?.nativeAvailable&&<option value="mac">이 Mac의 메일 앱</option>}</select></label>
   <label>허용할 발신 주소 / 최대 5개<textarea rows={3} value={senders} placeholder="주소마다 줄을 바꿔 입력" onChange={e=>setSenders(e.target.value)}/></label>
   <label>요청 제목에 들어갈 문구<input value={phrase} maxLength={80} onChange={e=>setPhrase(e.target.value)}/></label>
   <label><AnimatedSwitch checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> 허용한 메일 요청에 자동으로 연결 주소 답장</label>
   <div className="button-row"><button className="button secondary" disabled={busy} onClick={()=>void act(()=>save({mail:{enabled,provider,senders:senders.split(/[\n,;]/).map(v=>v.trim()).filter(Boolean),phrase}}))}>메일 요청 설정 저장</button>
   <button className="button secondary" disabled={busy||!state?.mail.enabled} onClick={()=>void act(()=>api!.checkLinkMail(),'새 요청을 확인했습니다.')}>새 요청 확인</button></div>
   <label>허용한 주소로 시험 전송<select aria-label="허용한 주소로 시험 전송" value={to} onChange={e=>setTo(e.target.value)}><option value="">주소 선택</option>{state?.mail.senders.map(value=><option key={value}>{value}</option>)}</select></label>
   <button className="button secondary" disabled={busy||!state?.mail.enabled||!to} onClick={()=>void act(()=>api!.sendLinkMail(to),'선택한 주소로 일회용 주소를 보냈습니다.')}>시험 전송</button>
  </details>
  {state&&<p>오늘 전달 {state.sentToday} / {state.dailyMax}회{state.last&&' / 최근 '+new Date(state.last.at).toLocaleTimeString('ko-KR')+' / '+(state.last.ok?'전달 완료':state.last.error||'전달 실패')}</p>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="settings-error">{error}</p>}
 </section>
}
