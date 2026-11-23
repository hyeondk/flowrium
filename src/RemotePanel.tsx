import { AnimatedSwitch } from './ui-motion';
import { useEffect, useRef, useState } from "react";
import { Smartphone, Copy, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { RemoteAccess, WebPushState, PushKind } from "../shared/remote";
export default function RemotePanel() {
  const [state, setState] = useState<RemoteAccess>({ enabled: false }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [qrUrl, setQrUrl] = useState<string>();
  const [confirmRelayUpdate, setConfirmRelayUpdate] = useState(false);
  const qrVisible = Boolean(state.url && state.url === qrUrl);
  const [push,setPush]=useState<WebPushState>();
  const currentPush = useRef<WebPushState | undefined>(undefined);
  const pushRevision = useRef(0);
  const pendingPreferences = useRef(0);
  const api = window.flowrium;
  const pushLabels:Record<PushKind,string>={decision:"결정과 승인",done:"작업 완료",error:"오류",report:"보고서",reminder:"예약 알림",message:"업무 메시지"};
  async function refreshPush(){
    const revision = pushRevision.current;
    const next=await api?.webPushState();
    if (revision !== pushRevision.current || pendingPreferences.current) return;
    currentPush.current = next;
    setPush(next);
  }
  async function updateDevice(id:string,field:PushKind | 'showConversationTitle',checked:boolean) {
    const previous = currentPush.current;
    const device = previous?.devices.find(row=>row.id===id);
    if (!api || !previous || !device) return;
    const updated = field === 'showConversationTitle'
      ? {...device,showConversationTitle:checked}
      : {...device,kinds:checked ? [...new Set([...device.kinds,field])] : device.kinds.filter(kind=>kind!==field)};
    const next = {...previous,devices:previous.devices.map(row=>row.id===id?updated:row)};
    currentPush.current = next;
    setPush(next);
    pushRevision.current++;
    pendingPreferences.current++;
    setMessage('');
    try {
      await api.webPushAction({action:'preferences',id,kinds:updated.kinds,showConversationTitle:updated.showConversationTitle===true});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      pendingPreferences.current--;
      if (!pendingPreferences.current) void refreshPush().catch(()=>{});
    }
  }
  async function pushAction(action:()=>Promise<unknown>){setBusy(true);try{await action();await refreshPush()}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function perform(action: () => Promise<RemoteAccess>, showNewQR = false) {
    setBusy(true);
    setMessage("");
    try {
      const next = await action();
      setState(next);
      if (showNewQR) {
        setQrUrl(next.url);
        setConfirmRelayUpdate(false);
        setMessage("새 중계를 연결했습니다. 새 QR 코드로 휴대폰을 다시 연결하세요.");
      }
      await refreshPush();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    api
      ?.remoteAccess()
      .then((v) => {
        if (live) setState(v);
      })
      .catch(() => {});
    void refreshPush().catch(()=>{});
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="settings-section remote-panel">
      <h3>
        <Smartphone size={17} />
        휴대폰에서 이어가기
      </h3>
      <p>
        컴퓨터를 켜 둔 상태에서 휴대폰 연결을 켜고, 휴대폰 카메라로 QR 코드를 스캔하세요.
        휴대폰의 설정에서 ‘홈 화면에 설치’를 누르면 다음부터 앱 아이콘으로 열 수 있습니다.
      </p>
      <div className="settings-buttons">
        {state.enabled ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void perform(() => api!.stopRemoteAccess())}
          >
            휴대폰 연결 종료
          </button>
        ) : (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void perform(() => api!.startRemoteAccess())}
          >
            휴대폰 연결 켜기
          </button>
        )}
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => void perform(() => api!.remoteAccess())}
        >
          <RefreshCw size={13} />
          상태 확인
        </button>
      </div>
      {!state.enabled && <p>이전 중계가 종료된 경우에는 새 QR 코드로 연결하세요.</p>}
      {state.url && (
        <div className="mobile-connect-card">
          {state.relay && <p>휴대폰 중계 {state.relay.version ?? '이전 설치 버전'}</p>}
          <label>휴대폰 연결 주소<input type="password" readOnly value={state.url} autoComplete="off" /></label>
          <p>이 주소와 QR 코드로 프로젝트에 접근할 수 있습니다. 연결을 종료한 뒤 다시 켜면 새 주소로 연결하세요.</p>
          <div className="settings-buttons">
            <button type="button" className={qrVisible ? 'popup-close-button' : 'button secondary'} aria-expanded={qrVisible}
              onClick={() => setQrUrl(qrVisible ? undefined : state.url)}>{!qrVisible && <QrCode size={15}/>} {qrVisible ? 'QR 코드 닫기' : 'QR 코드 보기'}</button>
            <button type="button" className="button subtle" onClick={async () => {
              try {
                await api!.copyText(state.url!);
                setMessage("휴대폰에서 열 연결 주소를 복사했습니다.");
              } catch {
                setMessage("주소를 복사하지 못했습니다. QR 코드로 연결해 주세요.");
              }
            }}><Copy size={14}/>연결 주소 복사</button>
            {state.relay?.canUpdate && !confirmRelayUpdate && <button type="button" className="button secondary" disabled={busy}
              onClick={() => setConfirmRelayUpdate(true)}><RefreshCw size={14}/>중계 업데이트</button>}
          </div>
          {state.relay?.canUpdate && confirmRelayUpdate && <section className="settings-card" aria-label="휴대폰 중계 업데이트 확인">
            <p>중계를 {state.relay.availableVersion} 버전으로 바꾸면 새 연결 주소가 생깁니다. 휴대폰에서 새 QR 코드를 한 번 스캔해 주세요.</p>
            <div className="settings-buttons">
              <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmRelayUpdate(false)}>취소</button>
              <button type="button" className="button primary" disabled={busy} onClick={() => void perform(() => api!.updateRemoteRelay(), true)}>
                <RefreshCw size={14}/>{busy ? '새 중계 연결 확인 중' : '업데이트하고 새 QR 코드 보기'}
              </button>
            </div>
          </section>}
          {qrVisible && <figure><QRCodeSVG value={state.url} title="휴대폰 연결 QR 코드" size={204} level="M" marginSize={4}/>
            <figcaption>휴대폰 카메라로 스캔해 Flowrium을 여세요.</figcaption></figure>}
        </div>
      )}
      {state.enabled&&<div className="mobile-device-settings">
        <h4>휴대폰 알림 기기</h4>
        <p>휴대폰의 설정에서 알림을 켜세요. 연결을 종료하거나 계정을 바꾸면 새 연결에서 다시 등록합니다.</p>
        {push?.available===false&&<p>{push.message}</p>}
        {!push?.devices.length&&<p>현재 연결에 등록된 기기가 없습니다.</p>}
        {push?.devices.map(device=><div key={device.id} className="settings-card">
          <strong>{device.label}</strong>
          <div className="device-preferences">{(Object.keys(pushLabels) as PushKind[]).map(kind=><label key={kind}><AnimatedSwitch style={{width:"auto"}} disabled={busy} checked={device.kinds.includes(kind)} onChange={event=>void updateDevice(device.id,kind,event.target.checked)}/>{pushLabels[kind]}</label>)}</div>
          <div className="device-preferences"><label><AnimatedSwitch style={{width:"auto"}} disabled={busy} checked={device.showConversationTitle===true} onChange={event=>void updateDevice(device.id,'showConversationTitle',event.target.checked)}/>휴대폰 알림에 대화 이름 표시</label></div>
          <div className="settings-buttons">
            <button className="button secondary" disabled={busy} onClick={()=>void pushAction(async()=>{const result=await api!.webPushAction({action:"test",id:device.id});setMessage(result.sent?"알림 서버에 시험 알림을 보냈습니다.":"시험 알림 발송을 확인하지 못했습니다.");})}>기기에 시험 알림</button>
            <button className="button subtle" disabled={busy} onClick={()=>void pushAction(()=>api!.webPushAction({action:"unsubscribe",id:device.id}))}>기기 알림 해제</button>
          </div>
          {device.lastError&&<p>{device.lastError}</p>}
        </div>)}
      </div>}
      {state.message && <p>{state.message}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
