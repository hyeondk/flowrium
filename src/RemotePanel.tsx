import { useEffect, useState } from "react";
import { Smartphone, Copy, RefreshCw } from "lucide-react";
import type { RemoteAccess } from "../shared/remote";
export default function RemotePanel() {
  const [state, setState] = useState<RemoteAccess>({ enabled: false }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const api = window.flowrium;
  async function perform(action: () => Promise<RemoteAccess>) {
    setBusy(true);
    setMessage("");
    try {
      setState(await action());
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
        프로젝트·대화·승인과 팀 상태를 확인할 수 있습니다.
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
      {state.message && <p>{state.message}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
