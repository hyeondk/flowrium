import { AnimatedCheckbox } from './ui-motion';
import { useEffect, useState } from "react";
import StoragePanel from "./StoragePanel";
import "./system-tools.css";
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
    [analysis,setAnalysis]=useState<any>(),[analysisPids,setAnalysisPids]=useState<number[]>([]),
    [confirmation, setConfirmation] = useState<{
      label: string;
      run: () => Promise<unknown>;
    }>();
  const api = window.flowrium;
  const [scriptLabels,setScriptLabels]=useState<Record<string,string>>({});
  useEffect(()=>{let active=true;void (async()=>{
    try{const labels:Record<string,string>={},repos=await api!.repositoryAction(projectId,{action:'repositories'}),details=await api!.readProjectDetails(projectId);
    for(const repo of repos)for(const name of scripts.filter(s=>s.startsWith(repo.id+'::')))labels[name]=repo.name+' ('+name.split('::')[1]+')';
    for(const service of details.services||[])labels['service::'+service.id]=service.name+' ('+service.command+')';
    if(active)setScriptLabels(labels);}catch{}
  })();return()=>{active=false;};},[projectId,scripts]);
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
      <h2>시스템과 프로젝트 서비스</h2>
      <nav className="wb-tabs">
        {[
          ["services", "프로젝트 서비스"],
          ["processes", "프로세스"],
          ["docker", "Docker"],
          ["storage", "저장 공간"],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "storage" && <StoragePanel/>}
      {tab === "services" && (
        <>
          <form
            className="system-service-form"
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmation({
                label: "선택한 프로젝트 명령을 실행합니다. " + (scriptLabels[script]||script),
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
                  {scriptLabels[s]||s}
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
                {projects.find((p) => p.id === s.projectId)?.name} ({s.script})
              </strong>
              <span>
                {s.state === "running" ? "실행 중" : "종료 (코드 " + s.code + ")"}
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
          <div className="system-actions"><button className="button secondary" disabled={busy} onClick={()=>void perform(async()=>{setAnalysis(await api!.analyzeSystemProcesses());setAnalysisPids([]);})}>Codex로 종료 후보 분석</button></div>
          {analysis&&<section className="system-analysis" aria-label="AI 프로세스 분석"><h3>종료 후보와 근거</h3><p>{analysis.summary}</p>{analysis.candidates.map((p:any)=><label key={p.pid}><AnimatedCheckbox checked={analysisPids.includes(p.pid)} onChange={e=>setAnalysisPids(v=>e.target.checked?[...v,p.pid]:v.filter(id=>id!==p.pid))}/><span>{p.name} (프로세스 {p.pid})<small>{p.reason}</small></span></label>)}<div className="system-actions"><button className="button secondary" disabled={busy||!analysisPids.length} onClick={()=>setConfirmation({label:'선택한 프로세스 '+analysisPids.length+'개를 종료합니다.',run:async()=>{await api!.stopSystemProcesses({token:analysis.token,pids:analysisPids});setAnalysis(undefined);await refresh();}})}>선택한 후보 종료 검토</button></div></section>}
          <p>
            메모리 사용량 순서로 표시합니다. 개발 프로세스는 종료 버튼에서
            내용을 확인하고 중단할 수 있습니다.
          </p>
          {processes.map((p) => (
            <div className="system-process" key={p.pid}>
              <span>
                {p.name} (프로세스 {p.pid})
              </span>
              <small>
                메모리 {Math.round(p.memoryBytes / 1024 / 1024)}MB (CPU {p.cpu === null ? "측정 중" : p.cpu + "%"})
              </small>
              <button
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    label: p.name + " 프로세스를 종료합니다. (프로세스 " + p.pid + ")",
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
                {c.image} ({c.status})
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
                        " 명령: " +
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
