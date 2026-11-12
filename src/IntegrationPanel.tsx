import { useEffect, useState } from "react";
import {
  CalendarDays,
  FileText,
  Mail,
  RefreshCw,
  ExternalLink,
  Download,
} from "lucide-react";
import type { GoogleStatus, RemoteItem } from "../shared/integrations";
export default function IntegrationPanel({
  projectId,
}: {
  projectId?: string;
}) {
  const [status, setStatus] = useState<GoogleStatus>(),
    [client, setClient] = useState(""),
    [secret, setSecret] = useState(""),
    [kind, setKind] = useState<"calendar" | "drive" | "mail">("calendar"),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<RemoteItem[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const api = window.flowrium;
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (api) setStatus(await api.googleStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    api
      ?.googleStatus()
      .then((v) => {
        if (active) setStatus(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function read(next = kind) {
    if (api) {
      setKind(next);
      setItems(await api.readGoogle({ kind: next, query }));
    }
  }
  return (
    <section className="integration-panel settings-section">
      <h3>메일 / 일정 / 드라이브</h3>
      <p>본인의 Google 계정을 연결해 자료를 확인하고 프로젝트로 가져옵니다.</p>
      <div className="connection-state">
        <span className={"status-dot " + (status?.connected ? "online" : "")} />
        {status?.connected
          ? status.account || "Google 연결됨"
          : status?.authorizing
            ? "브라우저에서 승인 대기 중"
            : status?.configured
              ? "계정 연결 대기"
              : "연결 설정 전"}
      </div>
      {(
        <details>
          <summary>Google 연결 설정</summary>
          <p>
            Google Cloud에서 만든 데스크톱 앱 OAuth 클라이언트를 입력합니다.
            Calendar / Drive / Gmail API를 활성화해 주세요.
          </p>
          <label>
            클라이언트 ID
            <input
              autoComplete="off"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </label>
          <label>
            클라이언트 보안 비밀
            <input
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !client.trim()}
            onClick={() =>
              void perform(async () => {
                await api?.configureGoogle({
                  clientId: client.trim(),
                  clientSecret: secret.trim(),
                });
                setClient("");
                setSecret("");
              })
            }
          >
            연결 설정 저장
          </button>
        </details>
      )}
      <div className="settings-buttons">
        {!status?.connected && (
          <button
            className="button secondary"
            disabled={busy || !status?.configured || status?.authorizing}
            onClick={() => void perform(() => api!.connectGoogle())}
          >
            Google 계정으로 연결
          </button>
        )}
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => void perform(() => api!.googleStatus())}
        >
          <RefreshCw size={14} />
          연결 확인
        </button>
        {status?.connected && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api?.disconnectGoogle();
                setItems([]);
              })
            }
          >
            Google 연결 해제
          </button>
        )}
      </div>
      {status?.connected && (
        <>
          <nav className="integration-tabs">
            {(
              [
                ["calendar", "일정", CalendarDays],
                ["drive", "드라이브", FileText],
                ["mail", "메일", Mail],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                className="button subtle"
                key={id}
                aria-pressed={kind === id}
                disabled={busy}
                onClick={() => void perform(() => read(id))}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>
          <form
            className="integration-search"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(() => read());
            }}
          >
            <input
              aria-label="연동 자료 검색"
              placeholder={
                kind === "calendar"
                  ? "일주일 일정 검색"
                  : kind === "drive"
                    ? "파일 이름 검색"
                    : "메일 검색"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="button secondary" disabled={busy}>
              조회
            </button>
          </form>
          {!items.length && (
            <p className="empty-hint">
              조회 결과가 없습니다. 검색어를 바꾸거나 조회를 눌러 주세요.
            </p>
          )}
          {items.map((item) => (
            <article className="integration-item" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.at ? new Date(item.at).toLocaleString("ko-KR") : ""}
                </small>
                <p>{item.detail}</p>
              </div>
              <div>
                {item.url && (
                  <a
                    href={item.url}
                    onClick={(e) => {
                      e.preventDefault();
                      void perform(() => api!.openGoogleItem(item.url!));
                    }}
                  >
                    <ExternalLink size={14} />
                    원본
                  </a>
                )}
                {kind === "drive" && projectId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await api!.importGoogleDocument(
                          projectId,
                          item.id,
                        );
                        setNotice("프로젝트에 저장했습니다 / " + result.path);
                      })
                    }
                  >
                    <Download size={14} />
                    가져오기
                  </button>
                )}
              </div>
            </article>
          ))}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
