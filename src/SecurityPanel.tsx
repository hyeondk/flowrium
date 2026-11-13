import { AnimatedCheckbox } from './ui-motion';
import { useCallback, useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import type {
  SecurityPreferences,
  SecurityState,
  UsageSnapshot,
} from "../shared/security";
import "./security.css";

const initial: SecurityState = {
  loaded: false,
  locked: true,
  reason: "",
  retryAt: 0,
  hasPin: false,
  accountRevision: 0,
};
const failure = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(
    /^.*?Error: /,
    "",
  );

export function useSecurity() {
  const [state, setState] = useState<SecurityState>(initial);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!window.flowrium) {
      setState({ ...initial, loaded: true, locked: false });
      return;
    }
    const next = await window.flowrium.securityState();
    setState(next);
    setError("");
  }, []);
  useEffect(() => {
    const api = window.flowrium;
    if (!api) {
      void refresh();
      return;
    }
    let alive = true,
      received = false;
    const stop = api.onSecurity((next) => {
      received = true;
      if (alive) {
        setState(next);
        setError("");
      }
    });
    api
      .securityState()
      .then((next) => {
        if (alive && !received) setState(next);
      })
      .catch((e) => {
        if (alive) setError(failure(e));
      });
    return () => {
      alive = false;
      stop();
    };
  }, [refresh]);
  const lock = useCallback(async () => {
    await window.flowrium!.lockSecurity();
  }, []);
  const unlock = useCallback(async (pin: string) => {
    await window.flowrium!.unlockSecurity(pin);
  }, []);
  const logout = useCallback(async () => {
    await window.flowrium!.logoutSecurity();
  }, []);
  return { state, error, refresh, lock, unlock, logout };
}

type Props = { security: ReturnType<typeof useSecurity> };
export function LockScreen({ security }: Props) {
  const { state } = security;
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (state.retryAt <= Date.now()) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= state.retryAt) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [state.retryAt]);
  const remaining = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const reasons: Record<string, string> = {
    idle: "자리를 비운 동안 화면을 잠갔습니다.",
    workday: "업무 마감 기록을 저장하고 화면을 잠갔습니다.",
    suspend: "기기가 잠기거나 절전 상태로 전환됐습니다.",
    logout: "ChatGPT에서 로그아웃했습니다.",
  };
  return (
    <main className="security-screen">
      <form
        className="security-unlock"
        onSubmit={async (e) => {
          e.preventDefault();
          if (waiting || remaining) return;
          setWaiting(true);
          setError("");
          try {
            if (!state.loaded) await security.refresh();
            else await security.unlock(pin);
          } catch (e) {
            setError(failure(e));
          } finally {
            setWaiting(false);
            setPin("");
          }
        }}
      >
        <LockKeyhole size={28} />
        <h1>{state.loaded ? "화면 잠금" : "작업 공간 열기"}</h1>
        <p>
          {!state.loaded
            ? "이 기기의 잠금 설정을 확인하고 있습니다."
            : reasons[state.reason] || "계속하려면 화면 잠금을 해제하세요."}
        </p>
        {state.loaded && state.hasPin && (
          <label>
            잠금 번호
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              required
              disabled={waiting || remaining > 0}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
        )}
        {(error || security.error) && (
          <p role="alert">{error || security.error}</p>
        )}
        {remaining > 0 && (
          <p role="status">{remaining}초 뒤에 다시 입력할 수 있습니다.</p>
        )}
        {(state.loaded || security.error) && (
          <button
            className="button primary"
            disabled={
              waiting ||
              remaining > 0 ||
              (state.loaded && state.hasPin && pin.length !== 4)
            }
          >
            {state.loaded ? "잠금 해제" : "다시 시도"}
          </button>
        )}
      </form>
    </main>
  );
}

function windowName(minutes: number | null, key: string) {
  if (!minutes) return key === "primary" ? "기본 한도" : "추가 한도";
  if (minutes % (7 * 1440) === 0)
    return String(minutes / (7 * 1440)) + "주 한도";
  if (minutes % 1440 === 0) return String(minutes / 1440) + "일 한도";
  if (minutes % 60 === 0) return String(minutes / 60) + "시간 한도";
  return String(minutes) + "분 한도";
}
const choices = [0, 5, 10, 15, 30, 60];
const switches = [
  ["lockAfterPause", "업무 마감 대화 완료 시 잠금"],
  ["lockOnSuspend", "컴퓨터 잠금 또는 절전 전환 시 잠금"],
  ["notifyApproval", "승인 요청을 데스크톱 알림으로 받기"],
  ["notifyDone", "작업 완료와 실패를 데스크톱 알림으로 받기"],
  ["preventSleep", "Codex 작업 중 자동 절전 방지"],
] as const;

export function SecurityPanel({ security }: Props) {
  const { state } = security,
    prefs = state.preferences;
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSnapshot>();
  const api = window.flowrium;
  if (!api || !prefs) return null;
  async function run(action: () => Promise<unknown>, message = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(message);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  function change(input: Partial<SecurityPreferences>) {
    void run(() => api!.setSecurityPreferences(input));
  }
  function clearPinInputs() {
    setCurrent("");
    setNext("");
    setRepeat("");
  }
  return (
    <section
      className="settings-section security-panel"
      aria-label="보안과 계정"
    >
      <header>
        <div>
          <h3>
            <ShieldCheck size={17} />
            화면 잠금
          </h3>
          <p>
            {state.hasPin
              ? "잠금 해제와 앱을 다시 열 때 숫자 4자리를 확인합니다."
              : "잠금 번호를 설정하면 이 기기에서 프로젝트 화면을 보호할 수 있습니다."}
          </p>
        </div>
        <button
          className="button subtle"
          disabled={busy || !state.hasPin}
          onClick={() => void run(security.lock)}
        >
          지금 잠금
        </button>
      </header>
      <form
        className="security-pin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (next !== repeat)
              throw new Error("새 잠금 번호와 확인 번호가 다릅니다.");
            await api.setSecurityPin(current, next);
            clearPinInputs();
          }, "잠금 번호를 저장했습니다.");
        }}
      >
        {state.hasPin && (
          <label>
            현재 잠금 번호
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]{4}"
              autoComplete="off"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
        )}
        <label>
          새 잠금 번호
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            autoComplete="new-password"
            placeholder="숫자 4자리"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          새 번호 확인
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        <div>
          <button className="button subtle" disabled={busy}>
            {state.hasPin ? "잠금 번호 변경" : "잠금 번호 설정"}
          </button>
          {state.hasPin && (
            <button
              className="button subtle"
              type="button"
              disabled={busy || current.length !== 4}
              onClick={() =>
                void run(async () => {
                  await api.setSecurityPin(current, null);
                  clearPinInputs();
                }, "잠금 번호를 해제했습니다.")
              }
            >
              번호 사용 해제
            </button>
          )}
        </div>
      </form>
      <label className="security-row">
        <span>자리 비움 자동 잠금</span>
        <select
          value={prefs.idleMinutes}
          disabled={busy}
          onChange={(e) => change({ idleMinutes: Number(e.target.value) })}
        >
          {choices.map((n) => (
            <option key={n} value={n}>
              {n ? n + "분 후" : "사용 안 함"}
            </option>
          ))}
        </select>
      </label>
      {switches.map(([key, label]) => (
        <label className="security-row" key={key}>
          <span>{label}</span>
          <AnimatedCheckbox
            checked={prefs[key]}
            disabled={busy}
            onChange={(e) => change({ [key]: e.target.checked })}
          />
        </label>
      ))}
      <header>
        <div>
          <h3>Codex 사용량과 한도</h3>
          <p>로그인한 계정의 사용 비율과 다음 초기화 시각을 확인합니다.</p>
        </div>
        <button
          className="button subtle"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await api.readAccountUsage();
              setUsage(next);
            })
          }
        >
          사용량 조회
        </button>
      </header>
      {usage && (
        <div className="security-usage">
          {usage.allowed === false && (
            <p>현재 계정에서 기본 사용량을 이용할 수 없습니다.</p>
          )}
          {usage.buckets.map((bucket, i) => (
            <div key={i}>
              <strong>
                {bucket.name}
                {bucket.plan ? " / " + bucket.plan : ""}
              </strong>
              {bucket.windows.map((win) => (
                <div className="security-quota" key={win.key}>
                  <span>
                    {windowName(win.minutes, win.key)} / {win.usedPercent}% 사용
                  </span>
                  <progress
                    aria-label={windowName(win.minutes, win.key)}
                    max={100}
                    value={win.usedPercent}
                  />
                  <small>
                    {win.resetsAt
                      ? new Date(win.resetsAt).toLocaleString("ko-KR") +
                        " 초기화"
                      : "초기화 시각 미제공"}
                  </small>
                </div>
              ))}
              {bucket.credits && (
                <p>
                  크레딧 /{" "}
                  {bucket.credits.unlimited
                    ? "무제한"
                    : (bucket.credits.balance ?? "잔액 미제공")}
                </p>
              )}
              {!bucket.windows.length && (
                <p>계정에서 시간대별 수치를 제공하지 않았습니다.</p>
              )}
            </div>
          ))}
          {!usage.buckets.length && (
            <p>계정에서 사용 한도 정보를 제공하지 않았습니다.</p>
          )}
          <small>
            조회 시각 / {new Date(usage.checkedAt).toLocaleString("ko-KR")}
          </small>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
