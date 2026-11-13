import { useEffect, useState } from "react";
import { Smartphone, Copy, RefreshCw } from "lucide-react";
import type { RemoteAccess, WebPushState, PushKind } from "../shared/remote";
export default function RemotePanel() {
  const [state, setState] = useState<RemoteAccess>({ enabled: false }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [push,setPush]=useState<WebPushState>();
  const [deviceKinds,setDeviceKinds]=useState<Record<string,PushKind[]>>({});
  const pushLabels:Record<PushKind,string>={decision:"결정 / 승인",done:"작업 완료",error:"오류",report:"보고서",reminder:"예약 알림",message:"업무 메시지"};
  async function refreshPush(){const next=await api?.webPushState();setPush(next);setDeviceKinds(Object.fromEntries((next?.devices||[]).map(d=>[d.id,d.kinds])));}
  async function pushAction(action:()=>Promise<unknown>){setBusy(true);try{await action();await refreshPush()}catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const api = window.flowrium;
  async function perform(action: () => Promise<RemoteAccess>) {
    setBusy(true);
    setMessage("");
    try {
      setState(await action());
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
        이 컴퓨터를 켜 둔 상태에서 연결 주소를 휴대폰에 열면
        프로젝트 / 첨부 대화 / 팀 업무 배정과 중단 / 결정 / 비서 / 사용량을 확인하고 작업을 이어갈 수 있습니다.
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
      {state.url && (
        <label>
          이 주소를 가진 사람이 내 프로젝트를 제어할 수 있습니다.
          <input readOnly value={state.url} aria-label="휴대폰 연결 주소" />
          <button
            className="button subtle"
            onClick={() => {
              void api
                ?.copyText(state.url!)
                .then(() =>
                  setMessage("휴대폰에서 열 연결 주소를 복사했습니다."),
                );
            }}
          >
            <Copy size={14} />
            연결 주소 복사
          </button>
        </label>
      )}
      {state.enabled&&<div className="mobile-device-settings">
        <h4>휴대폰 알림 기기</h4>
        <p>휴대폰의 설정에서 알림을 켜세요. 연결 종료 / 계정 변경 후에는 새 연결에서 다시 등록합니다.</p>
        {push?.available===false&&<p>{push.message}</p>}
        {!push?.devices.length&&<p>현재 연결에 등록된 기기가 없습니다.</p>}
        {push?.devices.map(device=><div key={device.id} className="settings-card">
          <strong>{device.label}</strong>
          <div className="settings-buttons">{(Object.keys(pushLabels) as PushKind[]).map(kind=><label key={kind} style={{display:"flex",alignItems:"center",gap:6}}><input type="checkbox" style={{width:"auto"}} checked={(deviceKinds[device.id]||[]).includes(kind)} onChange={event=>setDeviceKinds(old=>({...old,[device.id]:event.target.checked?[...(old[device.id]||[]),kind]:(old[device.id]||[]).filter(k=>k!==kind)}))}/>{pushLabels[kind]}</label>)}</div>
          <div className="settings-buttons">
            <button className="button secondary" disabled={busy} onClick={()=>void pushAction(()=>api!.webPushAction({action:"preferences",id:device.id,kinds:deviceKinds[device.id]||[]}))}>알림 종류 저장</button>
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
