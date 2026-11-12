import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, SquareTerminal, X } from "lucide-react";
import type { TerminalSession } from "../shared/terminal";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

const api = window.flowrium;
const problem = (e: unknown) => e instanceof Error ? e.message : "터미널 요청을 처리하지 못했습니다.";
export default function TerminalPanel({ projectId }: { projectId: string }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const actionBusy = useRef(false);
  const alive = useRef(false);
  const active = sessions.find((item) => item.id === selected);
  const refresh = useCallback(async () => {
    const items = await api?.terminalList(projectId);
    if (!items || !alive.current) return;
    setSessions(items); setSelected((id) => items.some((item) => item.id === id) ? id : items[0]?.id || "");
  }, [projectId]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => { if (alive.current) setError(problem(e)); });
    return () => { alive.current = false; };
  }, [refresh]);
  useEffect(() => {
    const mount = host.current;
    if (!mount || !selected || !api) return;
    let stopped = false, ended = false, offset = 0;
    let timer: ReturnType<typeof setTimeout>;
    const term = new Terminal({ fontFamily: '"SFMono-Regular", Consolas, monospace', fontSize: 13,
      cols: 80, rows: 24, scrollback: 2500, cursorBlink: true, screenReaderMode: true, disableStdin: true,
      theme: { background: "#1b1d20", foreground: "#e8eaed", cursor: "#e8eaed",
        selectionBackground: "#49515c" } });
    const fit = new FitAddon();
    term.loadAddon(fit); term.open(mount);
    // 처음 들어올 때 보관된 화면을 재생할 때에는 터미널 조회 응답을 셸로 다시 보내지 않는다.
    let ready = false;
    const fail = (e: unknown) => { if (!stopped) setError(problem(e)); };
    let writes = Promise.resolve();
    const input = term.onData((data) => {
      if (!ready || ended || stopped) return;
      // 큰 붙여넣기도 연결 순서대로 전송한다.
      for (let i = 0; i < data.length; i += 32768) {
        const piece = data.slice(i, i + 32768);
        writes = writes.then(() => api.terminalWrite(projectId, selected, piece)).catch(fail);
      }
    });
    const resize = term.onResize(({ cols, rows }) => {
      if (!ended && !stopped) void api.terminalResize(projectId, selected, cols, rows).catch(fail);
    });
    const observer = new ResizeObserver(() => { if (!stopped && mount.clientWidth && mount.clientHeight) fit.fit(); });
    observer.observe(mount); fit.fit();
    async function read() {
      if (stopped) return;
      try {
        const chunk = await api!.terminalRead(projectId, selected, offset);
        if (stopped) return;
        if (chunk.truncated) term.reset();
        offset = chunk.offset;
        if (chunk.data) await new Promise<void>((resolve) => term.write(chunk.data, resolve));
        if (stopped) return;
        if (!ready) { ready = true; term.options.disableStdin = chunk.closed; mount?.setAttribute("aria-busy", "false"); term.focus(); }
        if (chunk.closed) {
          ended = true; term.options.disableStdin = true;
          setSessions((list) => list.map((s) => s.id === selected ? { ...s, closed: true, exitCode: chunk.exitCode } : s));
          return;
        }
        timer = setTimeout(() => void read(), chunk.data ? 35 : 120);
      } catch (e) { fail(e); }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); observer.disconnect(); resize.dispose(); input.dispose(); term.dispose(); };
  }, [projectId, selected]);
  async function action(fn: () => Promise<void>) {
    if (!api || actionBusy.current) return;
    setError(""); setBusy(true); actionBusy.current = true;
    try { await fn(); }
    catch (e) { if (alive.current) setError(problem(e)); }
    finally { actionBusy.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="terminal-panel" aria-label="내장 터미널">
    <header><div><SquareTerminal size={20}/><h2>내장 터미널</h2></div>
      <button type="button" disabled={busy} onClick={() => void action(async () => {
        const s = await api!.terminalOpen(projectId); if (!alive.current) return;
        setSessions((list) => [...list, s]); setSelected(s.id);
      })}><Plus size={15}/>터미널 추가</button></header>
    {error && <p role="alert" className="terminal-error">{error}</p>}
    {sessions.length === 0 ? <p className="terminal-empty">프로젝트 폴더에서 터미널을 열어 명령을 실행하세요.</p> :
      <><nav className="terminal-tabs" aria-label="터미널 세션">{sessions.map((s) => <button type="button" key={s.id}
        aria-pressed={s.id === selected} onClick={() => setSelected(s.id)}>{s.title}{s.closed ? " / 종료" : ""}</button>)}</nav>
      {active && <><div key={active.id} className="terminal-shell" ref={host} aria-busy="true" aria-label="셸 입력과 출력"/>
        <footer><span>{active.closed ? "종료 코드 " + active.exitCode : active.startDir}</span>
          <button type="button" disabled={busy} onClick={() => void action(async () => {
            await api!.terminalClose(projectId, active.id); await refresh();
          })}><X size={14}/>{active.closed ? "탭 닫기" : "터미널 종료"}</button></footer></>}</>}
  </section>;
}
