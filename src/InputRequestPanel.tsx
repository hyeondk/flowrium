import { useId, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import type { FlowriumEvent, InputQuestion } from "../shared/types";
import "./input-request.css";

type Draft = { choice?: number; text?: string };

export default function InputRequestPanel({
  event,
  title,
  onOpen,
  onResolved,
}: {
  event: FlowriumEvent;
  title?: string;
  onOpen?: () => void;
  onResolved?: () => void;
}) {
  const group = useId();
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false);
  const [answered,setAnswered]=useState(false);
  const questions = event.questions || [];
  function update(id: string, change: Draft) {
    setDrafts((prev) => new Map(prev).set(id, { ...prev.get(id), ...change }));
  }
  function value(q: InputQuestion) {
    const draft = drafts.get(q.id);
    if (!q.options.length || draft?.choice === -1) return draft?.text || "";
    return draft?.choice === undefined
      ? ""
      : q.options[draft.choice]?.label || "";
  }
  const valid = questions.length > 0 && questions.every((q) => value(q).trim());
  return (
    <form
      className="input-request"
      aria-label="Codex 질문"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || sending.current || answered || !event.requestId) return;
        sending.current = true;
        setBusy(true);
        setError("");
        try {
          const answers = Object.fromEntries(
            questions.map((q) => [q.id, { answers: [value(q)] }]),
          );
          await window.flowrium!.answerInput({
            requestId: event.requestId,
            answers,
          });
          setDrafts(new Map());setAnswered(true);onResolved?.();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "답변을 전송하지 못했습니다.",
          );
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <header>
        <h3>
          <MessageSquareText size={16} />
          {title || "Codex 질문"}
        </h3>
        {onOpen && (
          <button type="button" className="button subtle" onClick={onOpen}>
            대화 열기
          </button>
        )}
      </header>
      <p>
        {event.isBlocking
          ? "작업을 계속하려면 질문에 답해 주세요."
          : "진행 중인 작업에 답변을 전달할 수 있습니다."}
      </p>
      {questions.map((q, i) => {
        const draft = drafts.get(q.id),
          direct = !q.options.length || draft?.choice === -1;
        return (
          <fieldset key={q.id} disabled={busy||answered}>
            <legend>{q.header || "질문 " + (i + 1)}</legend>
            <p>{q.question}</p>
            {q.options.map((option, j) => (
              <label className="input-option" key={j}>
                <input
                  type="radio"
                  name={group + "-" + i}
                  checked={draft?.choice === j}
                  onChange={() => update(q.id, { choice: j })}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            {q.options.length > 0 && q.isOther && (
              <label className="input-option">
                <input
                  type="radio"
                  name={group + "-" + i}
                  checked={draft?.choice === -1}
                  onChange={() => update(q.id, { choice: -1 })}
                />
                직접 입력
              </label>
            )}
            {direct && (
              <label className="input-free">
                {q.isSecret ? "비밀 답변" : "직접 답변"}
                {q.isSecret ? (
                  <input
                    type="password"
                    autoComplete="off"
                    maxLength={16000}
                    value={draft?.text || ""}
                    onChange={(e) => update(q.id, { text: e.target.value })}
                  />
                ) : (
                  <textarea
                    rows={2}
                    maxLength={16000}
                    value={draft?.text || ""}
                    onChange={(e) => update(q.id, { text: e.target.value })}
                  />
                )}
              </label>
            )}
          </fieldset>
        );
      })}
      {error && <p role="alert">{error}</p>}
      <button className="button primary" disabled={busy || answered || !valid}>
        {answered?'답변을 전달했습니다':'답변 보내기'}
      </button>
    </form>
  );
}
