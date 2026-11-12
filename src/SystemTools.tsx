import { useEffect, useState } from "react";
import type { Project } from "../shared/types";
import type {
  ContainerInfo,
  ServiceInfo,
  SystemProcess,
} from "../shared/system-tools";
export default function SystemTools({ projects }: { projects: Project[] }) {
  const [tab, setTab] = useState("services"),
    [projectId, setProject] = useState(projects[0]?.id || ""),
    [scripts, setScripts] = useState<string[]>([]),
    [script, setScript] = useState(""),
    [services, setServices] = useState<ServiceInfo[]>([]),
    [processes, setProcesses] = useState<SystemProcess[]>([]),
    [containers, setContainers] = useState<ContainerInfo[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState<{
      label: string;
      run: () => Promise<unknown>;
    }>();
  const api = window.flowrium;
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmation(undefined);
    }
  }
  async function refresh() {
    if (!api) return;
    if (tab === "services") setServices(await api.listServices());
    if (tab === "processes") setProcesses(await api.systemProcesses());
    if (tab === "docker") {
      const v = await api.dockerContainers();
      setContainers(v.containers);
      if (v.message) setMessage(v.message);
    }
  }
  useEffect(() => {
    let alive = true;
    api
      ?.projectScripts(projectId)
      .then((v) => {
        if (alive) {
          setScripts(v);
          setScript(v[0] || "");
        }
      })
      .catch(() => {
        setScripts([]);
        setScript("");
      });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (alive) await refresh();
      } catch (e) {
        if (alive) setMessage(String(e));
      }
      if (alive) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tab]);
  return (
    <section className="system-tools">
      <h2>시스템 / 프로젝트 서비스</h2>
      <nav className="wb-tabs">
        {[
          ["services", "프로젝트 서비스"],
          ["processes", "프로세스"],
          ["docker", "Docker"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "services" && (
        <>
          <form
            className="system-service-form"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmation({
                label: "선택한 프로젝트 명령을 실행합니다 / " + script,
                run: async () => {
                  await api!.runService(projectId, script);
                  await refresh();
                },
              });
            }}
          >
            <select
              aria-label="서비스 프로젝트"
              value={projectId}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="프로젝트 실행 명령"
              value={script}
              onChange={(e) => setScript(e.target.value)}
            >
              {scripts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="button secondary" disabled={!script || busy}>
              실행
            </button>
          </form>
          {!scripts.length && (
            <p>선택한 프로젝트에 package.json 실행 명령이 없습니다.</p>
          )}
          {services.map((s) => (
            <article className="system-service" key={s.id}>
              <strong>
                {projects.find((p) => p.id === s.projectId)?.name} / {s.script}
              </strong>
              <span>
                {s.state === "running" ? "실행 중" : "종료 / " + s.code}
              </span>
              {s.state === "running" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api!.stopService(s.id);
                      await refresh();
                    })
                  }
                >
                  중단
                </button>
              )}
              <pre>{s.output || "출력을 기다리는 중입니다."}</pre>
            </article>
          ))}
        </>
      )}
      {tab === "processes" && (
        <>
          <p>
            메모리 사용량 순서로 표시합니다. 개발 프로세스는 종료 버튼에서
            내용을 확인하고 중단할 수 있습니다.
          </p>
          {processes.map((p) => (
            <div className="system-process" key={p.pid}>
              <span>
                {p.name} / {p.pid}
              </span>
              <small>
                {Math.round(p.memoryBytes / 1024 / 1024)}MB / CPU {p.cpu === null ? "측정 중" : p.cpu + "%"}
              </small>
              <button
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    label: p.name + " 프로세스를 종료합니다 / " + p.pid,
                    run: () => api!.stopSystemProcess(p.pid),
                  })
                }
              >
                종료
              </button>
            </div>
          ))}
        </>
      )}
      {tab === "docker" &&
        containers.map((c) => (
          <article className="system-process" key={c.id}>
            <span>
              <strong>{c.name}</strong>
              <small>
                {c.image} / {c.status}
              </small>
            </span>
            <div>
              {(["start", "stop", "restart"] as const).map((action) => (
                <button
                  key={action}
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      label:
                        c.name +
                        " / " +
                        { start: "시작", stop: "중지", restart: "재시작" }[
                          action
                        ],
                      run: async () => {
                        await api!.controlContainer(c.id, action);
                        await refresh();
                      },
                    })
                  }
                >
                  {{ start: "시작", stop: "중지", restart: "재시작" }[action]}
                </button>
              ))}
            </div>
          </article>
        ))}
      {confirmation && (
        <div role="alert" className="system-confirm">
          <strong>{confirmation.label}</strong>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void perform(confirmation.run)}
          >
            확인하고 실행
          </button>
          <button
            className="button subtle"
            onClick={() => setConfirmation(undefined)}
          >
            취소
          </button>
        </div>
      )}
      {message && (
        <p role="alert" className="settings-error">
          {message}
        </p>
      )}
    </section>
  );
}
