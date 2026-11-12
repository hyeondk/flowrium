import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateState } from "../shared/types";

export function useDesktopUpdate() {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    const api = window.flowrium;
    if (!api) return;
    let active = true;
    let received = false;
    const stop = api.onUpdate(next => { received = true; if (active) setState(next); });
    api.updateState().then(next => { if (active && !received) setState(next); }).catch(() => {});
    return () => { active = false; stop(); };
  }, []);
  return state;
}

export function UpdatePanel({ state, settings = false, fail }: {
  state?: UpdateState; settings?: boolean; fail: (error: unknown) => void;
}) {
  const api = window.flowrium;
  if (!api || !state) return null;
  const busy = ["checking", "downloading", "installing"].includes(state.status);
  const available = state.status === "available";
  const visible = available || (state.status === "error" && (!!state.latestVersion || state.launchFailed)) || ["downloading", "installing"].includes(state.status);
  if (!settings && !visible) return null;
  return <section className={settings ? "settings-section" : "update-banner"} aria-label="프로그램 업데이트">
    <div aria-live="polite">
      <strong>{available ? `Flowrium ${state.latestVersion} 업데이트` : settings ? "프로그램 업데이트" : state.status === "error" ? "업데이트 확인 필요" : "업데이트 진행 중"}</strong>
      <p>{state.message || `현재 버전 ${state.currentVersion}`}</p>
      {state.status === "downloading" && <progress aria-label="다운로드 진행률" max={100} value={state.progress} />}
    </div>
    {available ? <button className="button primary" onClick={() => api.installUpdate().catch(fail)}><Download size={15} />업데이트 후 재시작</button>
      : (settings || state.status === "error") && <button className="button subtle" disabled={busy || state.status === "unsupported"} onClick={() => api.checkUpdate().catch(fail)}><RefreshCw size={14} />새 버전 확인</button>}
    {state.status === "error" && <button className="button subtle" onClick={()=>api.openExternal("downloads").catch(fail)}>
      <Download size={14}/>수동 설치 파일 받기</button>}
  </section>;
}
