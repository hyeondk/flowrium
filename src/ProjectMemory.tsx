import { useEffect, useRef, useState } from "react";
import { BookMarked, MessagesSquare, RotateCcw, X } from "lucide-react";
import type { MemoryNote, MemoryScope } from "../shared/memory";
import type { Project, Session } from "../shared/types";
import "./memory.css";

type Draft = Pick<
  MemoryNote,
  "scope" | "title" | "body" | "role" | "link" | "linked"
>;
const blank: Draft = {
  scope: "project",
  title: "",
  body: "",
  role: "",
  link: "",
  linked: false,
};
const labelScope = (s: MemoryScope) =>
  s === "personal" ? "이 기기 전체" : "이 프로젝트";
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^.*?Error: /, "");
export function ProjectMemory({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [editing, setEditing] = useState<MemoryNote | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [history, setHistory] = useState<MemoryNote[]>([]);
  const [revision, setRevision] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const api = window.flowrium;
  useEffect(() => {
    if (!api) return;
    let live = true;
    setEditing(null);
    setHistory([]);
    setError("");
    api
      .listMemory(projectId)
      .then((rows) => {
        if (live) setNotes(rows);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [projectId, api, reload]);
  if (!api) return null;
  const selected = editing && editing !== "new" ? editing : null;
  function edit(note: MemoryNote | "new") {
    setDraft(note === "new" ? { ...blank } : { ...note });
    setEditing(note);
    setHistory([]);
    setRevision("");
    setError("");
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function update(note: MemoryNote) {
    setNotes((prev) => [note, ...prev.filter((m) => m.id !== note.id)]);
    setEditing(null);
    setHistory([]);
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  const historical = history.find((h) => h.rev === revision);
  return (
    <section className="pf-panel memory-panel" aria-label="연결 메모">
      <header>
        <div>
          <h2>
            <BookMarked size={17} />
            연결 메모
          </h2>
          <p>
            연결한 메모의 내용을 다음 Codex 요청부터 전달합니다. 프로젝트 메모는
            프로젝트 폴더에 함께 저장됩니다.
          </p>
        </div>
        <button disabled={busy} onClick={() => edit("new")}>
          메모 추가
        </button>
      </header>
      <label className="memory-check">
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(e) => setShowDeleted(e.target.checked)}
        />
        삭제한 메모 표시
      </label>
      <div className="memory-list">
        {notes
          .filter((n) => !n.deleted || showDeleted)
          .map((note) => (
            <button
              key={note.id}
              disabled={busy}
              onClick={() => edit(note)}
              aria-pressed={selected?.id === note.id}
            >
              <strong>{note.title}</strong>
              <small>
                {labelScope(note.scope)} /{" "}
                {note.deleted
                  ? "삭제됨"
                  : note.linked
                    ? "Codex 연결됨"
                    : "연결 해제"}
                {note.role && " / " + note.role}
              </small>
            </button>
          ))}
      </div>
      {!notes.some((n) => !n.deleted || showDeleted) && (
        <p>저장한 메모가 없습니다.</p>
      )}
      {editing && (
        <form
          className="memory-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              update(
                await api.changeMemory(projectId, {
                  action: "save",
                  ...draft,
                  id: selected?.id,
                  revision: selected?.rev || null,
                }),
              );
            });
          }}
        >
          <div className="memory-section-title">
            <h3>
              {selected?.deleted
                ? "삭제한 메모"
                : selected
                  ? "메모 편집"
                  : "새 메모"}
            </h3>
            <button
              type="button"
              aria-label="메모 편집 닫기"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              <X size={15} />
            </button>
          </div>
          <label>
            보관 범위
            <select
              disabled={!!selected || busy}
              value={draft.scope}
              onChange={(e) => change("scope", e.target.value as MemoryScope)}
            >
              <option value="project">
                이 프로젝트 / 프로젝트 폴더에 보관
              </option>
              <option value="personal">
                이 기기 전체 / 이 컴퓨터에만 보관
              </option>
            </select>
          </label>
          <label>
            메모 제목
            <input
              required
              maxLength={120}
              value={draft.title}
              disabled={busy || selected?.deleted}
              onChange={(e) => change("title", e.target.value)}
            />
          </label>
          <label>
            지시와 메모
            <textarea
              required
              maxLength={16000}
              rows={5}
              value={draft.body}
              disabled={busy || selected?.deleted}
              onChange={(e) => change("body", e.target.value)}
            />
          </label>
          <label>
            적용할 담당 역할
            <input
              placeholder="비워 두면 모든 대화에 적용"
              maxLength={120}
              value={draft.role}
              disabled={busy || selected?.deleted}
              onChange={(e) => change("role", e.target.value)}
            />
          </label>
          <label>
            참고 주소
            <input
              type="url"
              placeholder="https://"
              maxLength={2000}
              value={draft.link}
              disabled={busy || selected?.deleted}
              onChange={(e) => change("link", e.target.value)}
            />
          </label>
          <label className="memory-check">
            <input
              type="checkbox"
              checked={draft.linked}
              disabled={busy || selected?.deleted}
              onChange={(e) => change("linked", e.target.checked)}
            />
            Codex 요청에 연결
          </label>
          <div className="pf-actions">
            {!selected?.deleted && <button disabled={busy}>메모 저장</button>}
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const rows = await api.memoryVersions(
                        projectId,
                        selected.scope,
                        selected.id,
                      );
                      setHistory(rows);
                      setRevision(rows[1]?.rev || rows[0]?.rev || "");
                    })
                  }
                >
                  이전 버전
                </button>
                {!selected.deleted && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        update(
                          await api.changeMemory(projectId, {
                            action: "delete",
                            scope: selected.scope,
                            id: selected.id,
                            revision: selected.rev,
                          }),
                        ),
                      )
                    }
                  >
                    메모 삭제
                  </button>
                )}
              </>
            )}
          </div>
          {selected && history.length > 0 && (
            <div className="memory-history">
              <label>
                복원할 버전
                <select
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                >
                  {history.map((h, i) => (
                    <option key={h.rev} value={h.rev}>
                      {new Date(h.at).toLocaleString("ko-KR")} /{" "}
                      {h.deleted ? "삭제됨" : h.title}
                      {!i ? " / 현재" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {historical && <p>{historical.body}</p>}
              <button
                type="button"
                disabled={busy || revision === selected.rev}
                onClick={() =>
                  void run(async () =>
                    update(
                      await api.changeMemory(projectId, {
                        action: "restore",
                        scope: selected.scope,
                        id: selected.id,
                        revision: selected.rev,
                        target: revision,
                      }),
                    ),
                  )
                }
              >
                <RotateCcw size={14} />이 버전 복원
              </button>
            </div>
          )}
        </form>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setReload((n) => n + 1)}>다시 불러오기</button>
        </p>
      )}
    </section>
  );
}

export function AssistantShortcut({
  projects,
  onOpen,
  onCreateProject,
}: {
  projects: Project[];
  onOpen(session: Session): unknown;
  onCreateProject?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [project, setProject] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const api = window.flowrium;
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  if (!api) return null;
  async function enter(id?: string) {
    const record = await api!.openAssistant(id);
    setOpen(false);
    await onOpen(record);
  }
  async function access() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const home = await api!.assistantHome();
      if (home.connected) await enter();
      else {
        setProject(projects.length === 1 ? projects[0].id : "");
        setOpen(true);
      }
    } catch (e) {
      setOpen(true);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="button subtle assistant-entry"
        aria-label="개인 비서"
        disabled={busy}
        onClick={() => void access()}
      >
        <MessagesSquare size={16} />
        <span>개인 비서</span>
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="assistant-dialog"
          onCancel={() => setOpen(false)}
          aria-label="개인 비서 연결"
        >
          <h2>개인 비서</h2>
          <p>
            비서 대화를 보관할 프로젝트를 선택하세요. 이후 어느 화면에서든 같은
            대화를 이어갈 수 있습니다.
          </p>
          {projects.length > 0 && (
            <label>
              비서 대화 보관 프로젝트
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">프로젝트 선택</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="pf-actions">
            <button onClick={() => setOpen(false)}>닫기</button>
            {projects.length ? (
              <button
                disabled={!project || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await enter(project);
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                비서 대화 열기
              </button>
            ) : (
              onCreateProject && (
                <button
                  onClick={() => {
                    setOpen(false);
                    onCreateProject();
                  }}
                >
                  프로젝트 추가
                </button>
              )
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
