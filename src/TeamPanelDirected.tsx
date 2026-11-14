import { AnimatedSwitch } from './ui-motion';
import TeamWorktrees from "./TeamWorktrees";
import { useState } from "react";
import type {
  DirectOptions,
  TeamAssignment,
  TeamChange,
  TeamDefinition,
  TeamExecution,
  TeamNode,
  TeamRole,
} from "../shared/teams";
import type { Session } from "../shared/types";

export type Strategy = "manual" | "plan" | "shared";
export const phaseName = {
  planning: "팀장 계획 중",
  draft: "배정안 검토",
  running: "담당자 실행 중",
  decisions: "결정 대기",
  paused: "일시정지",
  stopped: "중단",
  review: "결과 검토",
  reporting: "종합 보고 작성 중",
  done: "완료",
};
const nodeName = {
  waiting: "대기",
  running: "실행 중",
  question: "결정 요청",
  done: "완료",
  failed: "실패",
  interrupted: "재개 대기",
  stopped: "중단",
};
export function TeamRunOptions({
  strategy,
  setStrategy,
  options,
  setOptions,
  roles=[],
}: {
  strategy: Strategy;
  setStrategy: (v: Strategy) => void;
  options: DirectOptions;
  setOptions: (v: DirectOptions) => void;
  roles?:TeamRole[];
}) {
  const set = (v: Partial<DirectOptions>) => setOptions({ ...options, ...v });
  return (
    <>
      <label>
        업무 배정 방식
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as Strategy)}
        >
          <option value="manual">담당자와 할 일을 직접 지정</option>
          <option value="plan">팀장에게 배정안 요청</option>
          <option value="shared">모든 역할에 동일한 요청 전달</option>
        </select>
      </label>
      {strategy !== "shared" && (
        <details className="team-options">
          <summary>참고 자료와 실행 설정</summary>
          <div className="team-form">
            <label>
              참고 자료 경로 또는 링크
              <textarea
                rows={2}
                placeholder="한 줄에 하나씩 입력"
                value={(options.attachments || []).join("\n")}
                onChange={(e) =>
                  set({ attachments: e.target.value.split("\n") })
                }
              />
            </label>
            <label>
              결정이 필요한 사항
              <textarea
                rows={2}
                placeholder="예산 변경, 화면 변경, 외부 공개 등"
                value={(options.decideOn || []).join("\n")}
                onChange={(e) => set({ decideOn: e.target.value.split("\n") })}
              />
            </label>
            <label>
              팀장 모델
              <input
                placeholder="계정 기본 모델"
                maxLength={200}
                value={options.leadModel || ""}
                onChange={(e) => set({ leadModel: e.target.value })}
              />
            </label>
            <div className="team-limits">
              <label>
                토큰 한도
                <select
                  value={options.budget || 0}
                  onChange={(e) => set({ budget: Number(e.target.value) })}
                >
                  {[0, 100000, 200000, 300000, 500000, 1000000].map((v) => (
                    <option key={v} value={v}>
                      {v ? v.toLocaleString("ko-KR") : "제한 없음"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                시간 한도
                <select
                  value={options.minutes || 0}
                  onChange={(e) => set({ minutes: Number(e.target.value) })}
                >
                  {[0, 30, 60, 120, 240].map((v) => (
                    <option key={v} value={v}>
                      {v ? v + "분" : "제한 없음"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="team-check">
              <AnimatedSwitch
                checked={!!options.isolate}
                onChange={(e) => set({ isolate: e.target.checked })}
              />
              역할별 Git 작업 폴더 사용
            </label>
            <label className="team-check">
              <AnimatedSwitch
                checked={!!options.autoReport}
                onChange={(e) => set({ autoReport: e.target.checked })}
              />
              모든 담당자가 마치면 팀장에게 종합 보고 요청
            </label>
            <fieldset><legend>선택한 범위의 자동 운영</legend><p>켜기 전에는 자동 배부와 보완을 진행하지 않습니다. 설정한 횟수와 시간, 토큰 한도 안에서 실제 AI 대화를 실행합니다.</p>
              {strategy==="plan"&&<label className="team-check"><AnimatedSwitch checked={!!options.autoDispatch} onChange={e=>set({autoDispatch:e.target.checked})}/>팀장 배정안이 나오면 등록한 역할에 자동 배부</label>}
              <label className="team-check"><AnimatedSwitch checked={!!options.autoPM} onChange={e=>set({autoPM:e.target.checked})}/>결과를 팀장이 검토하고 필요한 과업 추가 배정</label>
              <label>추가 배정 한도<select value={options.maxPMRounds||2} onChange={e=>set({maxPMRounds:Number(e.target.value)})}>{[1,2,3,5,10].map(n=><option key={n} value={n}>{n}회</option>)}</select></label>
              <label className="team-check"><AnimatedSwitch checked={!!options.autoQA} onChange={e=>set({autoQA:e.target.checked})}/>검수 반려 사항을 구현 담당자에게 보내 보완 후 재검수</label>
              <label>자동 보완 한도<select value={options.maxQaRounds||3} onChange={e=>set({maxQaRounds:Number(e.target.value)})}>{[1,2,3,5,10].map(n=><option key={n} value={n}>{n}회</option>)}</select></label>
              {options.isolate&&<><label className="team-check"><AnimatedSwitch checked={!!options.autoIntegrate} onChange={e=>set({autoIntegrate:e.target.checked})}/>역할의 변경을 커밋하고 통합 브랜치에 병합 (충돌 시 결정 요청)</label>
                <label>통합 보완 담당<select value={options.integrationRoleIndex??""} onChange={e=>set({integrationRoleIndex:e.target.value===""?null:Number(e.target.value)})}>
                  <option value="">통합 후 사용자가 검토</option>{roles.map((role,index)=>role.mode==="build"&&<option key={index} value={index}>{role.name}</option>)}
                </select></label></>}
            </fieldset>
          </div>
        </details>
      )}
    </>
  );
}
function AssignmentEditor({
  run,
  busy,
  act,
}: {
  run: TeamExecution;
  busy: boolean;
  act: (c: TeamChange) => void;
}) {
  const d = run.directed!;
  const [rows, setRows] = useState(() =>
    run.roles.map((role, index) => {
      const proposed = d.nodes.find((n) => n.index === index);
      return {
        enabled: !!proposed,
        index,
        title: proposed?.title || role.name + " 업무",
        task: proposed?.task || "",
        steps: proposed?.steps.join("\n") || "",
        target: proposed?.targetIndex?.toString() || "",
      };
    }),
  );
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  const picked = rows.filter((r) => r.enabled);
  const ready =
    picked.length > 0 &&
    picked.every(
      (r) =>
        r.task.trim() &&
        r.title.trim() &&
        (!r.target || picked.some((v) => v.index === Number(r.target))),
    );
  return (
    <section className="team-assignment">
      <h4>실행할 담당자와 과업</h4>
      {rows.map((r, i) => (
        <fieldset key={i}>
          <legend>
            <label className="team-check">
              <AnimatedSwitch
                checked={r.enabled}
                onChange={(e) => set(i, { enabled: e.target.checked })}
              />
              {run.roles[i].name}에게 배정
            </label>
          </legend>
          {r.enabled && (
            <div className="team-form">
              <label>
                업무 제목
                <input
                  maxLength={140}
                  value={r.title}
                  onChange={(e) => set(i, { title: e.target.value })}
                />
              </label>
              <label>
                담당 과업
                <textarea
                  rows={2}
                  maxLength={6000}
                  value={r.task}
                  onChange={(e) => set(i, { task: e.target.value })}
                />
              </label>
              <label>
                진행 단계
                <textarea
                  rows={2}
                  placeholder="한 줄에 한 단계"
                  value={r.steps}
                  onChange={(e) => set(i, { steps: e.target.value })}
                />
              </label>
              {run.roles[i].mode !== "build" &&
                run.roles.some((a) => a.mode === "build") && (
                  <label>
                    먼저 완료할 구현 담당
                    <select
                      value={r.target}
                      onChange={(e) => set(i, { target: e.target.value })}
                    >
                      <option value="">독립 실행</option>
                      {run.roles.map(
                        (v, n) =>
                          v.mode === "build" && (
                            <option key={n} value={n}>
                              {v.name}
                            </option>
                          ),
                      )}
                    </select>
                  </label>
                )}
            </div>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="team-primary"
        disabled={busy || !ready}
        onClick={() => {
          const assignments: TeamAssignment[] = picked.map((r) => ({
            index: r.index,
            title: r.title,
            task: r.task,
            steps: r.steps
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            ...(r.target && { targetIndex: Number(r.target) }),
          }));
          act({ action: "dispatch", assignments });
        }}
      >
        선택한 담당자 실행
      </button>
    </section>
  );
}
function Worker({
  n,
  run,
  busy,
  act,
  open,
}: {
  n: TeamNode;
  run: TeamExecution;
  busy: boolean;
  act: (c: TeamChange) => void;
  open: (index: number) => void;
}) {
  const [tool, setTool] = useState<
    "" | "instruct" | "ask" | "message" | "reassign"
  >("");
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const d = run.directed!,
    lead = n.index === -1,
    closed = ["done", "stopped"].includes(d.phase),
    name = lead ? "팀장" : run.roles[n.index].name;
  const destinations = run.roles
    .map((r, i) => ({ name: r.name, index: i }))
    .filter(
      (v) =>
        v.index !== n.index &&
        (tool !== "message" || d.nodes.some((a) => a.index === v.index)),
    );
  return (
    <article className="team-node">
      <div className="team-node-head">
        <b>{name}</b>
        <span>{nodeName[n.status]}</span>
        {n.tokens > 0 && <small>{n.tokens.toLocaleString("ko-KR")} 토큰</small>}
      </div>
      {!lead && (
        <>
          <strong>{n.title}</strong>
          <p>{n.task}</p>
          {n.steps.length > 0 && (
            <details>
              <summary>
                진행 단계 {n.stepsDone}개 (전체 {n.steps.length}개)
              </summary>
              <ol>
                {n.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
      {n.queue?.length ? <small>전달 대기 {n.queue.length}건</small> : null}
      {n.progress?.length ? (
        <ul>
          {n.progress.map((p, i) => (
            <li key={i}>
              {p.step} /{" "}
              {p.status === "completed"
                ? "완료"
                : p.status === "inProgress"
                  ? "진행 중"
                  : "대기"}
            </li>
          ))}
        </ul>
      ) : null}
      {n.summary && (
        <details open={n.status === "failed" || n.status === "question"}>
          <summary>{n.status === "failed" ? "실패 사유" : "최근 보고"}</summary>
          <p>{n.summary}</p>
        </details>
      )}
      <div className="team-node-actions">
        {n.sessionId && (
          <button type="button" onClick={() => open(n.index)}>
            {lead ? "팀장 대화 열기" : "담당 대화 열기"}
          </button>
        )}
        {!closed && ["failed", "interrupted", "stopped"].includes(n.status) && (
          <button
            disabled={busy}
            onClick={() => act({ action: "retry", index: n.index })}
          >
            이 업무 재시도
          </button>
        )}
        {!closed && !lead && (
          <>
            {n.status === "running" && (
              <button
                disabled={busy}
                onClick={() => act({ action: "stopNode", index: n.index })}
              >
                역할 중단
              </button>
            )}
            {n.status !== "done" && (
              <button
                disabled={busy}
                onClick={() => act({ action: "completeNode", index: n.index })}
              >
                직접 완료
              </button>
            )}
            <button
              onClick={() => setTool(tool === "instruct" ? "" : "instruct")}
            >
              {n.status === "running" ? "추가 지시 예약" : "추가 지시"}
            </button>
            <button onClick={() => setTool(tool === "ask" ? "" : "ask")}>
              결정 등록
            </button>
            {n.status !== "running" && (
              <button
                onClick={() => setTool(tool === "reassign" ? "" : "reassign")}
              >
                재배정
              </button>
            )}
            <button
              onClick={() => setTool(tool === "message" ? "" : "message")}
            >
              다른 담당자에게 전달
            </button>
            <button
              disabled={busy || d.lead.status === "running"}
              onClick={() => act({ action: "explain", index: n.index })}
            >
              쉽게 설명 요청
            </button>
          </>
        )}
      </div>
      {tool && (
        <div className="team-form">
          {(tool === "message" || tool === "reassign") && (
            <label>
              받을 담당자
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">선택</option>
                {destinations.map((v) => (
                  <option key={v.index} value={v.index}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {tool === "ask" ? "결정할 질문" : "전달 내용"}
            <textarea
              rows={2}
              maxLength={tool === "ask" ? 1000 : 6000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !text.trim() ||
              ((tool === "message" || tool === "reassign") && !to)
            }
            onClick={() => {
              if (tool === "message" || tool === "reassign")
                act({
                  action: tool,
                  index: n.index,
                  toIndex: Number(to),
                  text,
                });
              else act({ action: tool, index: n.index, text });
              setTool("");
              setText("");
              setTo("");
            }}
          >
            확인하여 전달
          </button>
        </div>
      )}
    </article>
  );
}
function Decision({
  q,
  busy,
  act,
}: {
  q: NonNullable<TeamExecution["directed"]>["decisions"][number];
  busy: boolean;
  act: (c: TeamChange) => void;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <section className="team-decision">
      <strong>{q.question}</strong>
      {q.why && <p>{q.why}</p>}
      {q.answer ? (
        <p>선택한 답: {q.answer}</p>
      ) : (
        <>
          <div className="team-node-actions">
            {q.options.map((o) => (
              <button
                key={o}
                disabled={busy}
                onClick={() =>
                  act({ action: "answer", decisionId: q.id, text: o })
                }
              >
                {o}
              </button>
            ))}
          </div>
          {q.node !== -2 && (
            <label>
              직접 답변
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={5000}
              />
              <button
                disabled={busy || !answer.trim()}
                onClick={() =>
                  act({ action: "answer", decisionId: q.id, text: answer })
                }
              >
                답변 전달
              </button>
            </label>
          )}
        </>
      )}
    </section>
  );
}
export function DirectedBoard({
  projectId,
  run,
  busy,
  perform,
  onOpen,
}: {
  projectId: string;
  run: TeamExecution;
  busy: boolean;
  perform: (fn: () => Promise<void>) => Promise<void>;
  onOpen: (s: Session) => void;
}) {
  const d = run.directed!;
  const [deleting, setDeleting] = useState(false);
  const act = (c: TeamChange) => {
    void perform(async () => {
      await window.flowrium!.changeTeamRun(projectId, run.id, c, d.revision);
    });
  };
  const open = (i: number) => {
    void perform(async () =>
      onOpen(await window.flowrium!.openTeamNode(projectId, run.id, i)),
    );
  };
  return (
    <div className="team-directed" aria-label="팀 업무 현황">
      <header>
        <h3>{phaseName[d.phase]}</h3>
        <p>{run.prompt}</p>
        <small>
          {d.tokens.toLocaleString("ko-KR")} 토큰
          {d.budget > 0 ? " (한도 " + d.budget.toLocaleString("ko-KR") + ")" : ""}
          {d.minutes > 0 ? " (" + d.minutes + "분)" : ""}
        </small>
      </header>
      <div className="team-node-actions">
        {["running", "decisions", "planning", "reporting"].includes(
          d.phase,
        ) && (
          <button disabled={busy} onClick={() => act({ action: "pause" })}>
            팀 일시정지
          </button>
        )}
        {d.phase === "paused" && (
          <button disabled={busy} onClick={() => act({ action: "resume" })}>
            팀 계속 실행
          </button>
        )}
        {d.phase === "paused" && d.decisions.some((q) => q.node === -2) && (
          <button disabled={busy} onClick={() => act({ action: "raiseLimit" })}>
            한도 늘려 계속
          </button>
        )}
        {!["done", "stopped"].includes(d.phase) && (
          <button disabled={busy} onClick={() => act({ action: "stop" })}>
            팀 중단
          </button>
        )}
        {["done", "stopped"].includes(d.phase) && (
          <button disabled={busy} onClick={() => act({ action: "reopen" })}>
            팀 업무 다시 열기
          </button>
        )}
        {d.phase === "stopped" && (
          <button
            disabled={busy}
            onClick={() => act({ action: "finishStopped" })}
          >
            완료로 옮기기
          </button>
        )}
        {d.phase === "done" && (
          <button disabled={busy} onClick={() => setDeleting(!deleting)}>
            실행 기록 삭제
          </button>
        )}
        {deleting && (
          <button disabled={busy} onClick={() => act({ action: "deleteRun" })}>
            보드에서 삭제 확인
          </button>
        )}
        {d.phase === "review" && (
          <button
            className="team-primary"
            disabled={busy}
            onClick={() => act({ action: "report" })}
          >
            종합 보고서 작성
          </button>
        )}
      </div>
      {d.attachments.length > 0 && (
        <p>참고 자료: {d.attachments.join(", ")}</p>
      )}
      {d.decisions.length > 0 && (
        <div>
          <h4>중간 결정</h4>
          {d.decisions.map((q) => (
            <Decision key={q.id} q={q} busy={busy} act={act} />
          ))}
        </div>
      )}
      {d.phase === "draft" && (
        <AssignmentEditor
          key={run.id + "-" + d.revision}
          run={run}
          act={act}
          busy={busy}
        />
      )}
      {(d.lead.sessionId || d.lead.status === "failed") && (
        <Worker n={d.lead} run={run} busy={busy} act={act} open={open} />
      )}
      {d.phase !== "draft" &&
        d.nodes.map((n) => (
          <Worker
            key={n.index}
            n={n}
            run={run}
            busy={busy}
            act={act}
            open={open}
          />
        ))}
      {d.isolate &&
        d.phase !== "draft" &&
        d.phase !== "planning" &&
        d.nodes.length > 0 && (
          <TeamWorktrees projectId={projectId} runId={run.id} />
        )}
      {d.artifactPath && (
        <div className="team-report">
          <strong>팀 종합 보고서</strong>
          <p>{d.artifactPath}</p>
          <button
            onClick={() =>
              void perform(async () =>
                window.flowrium!.revealWorkArtifact(projectId, d.artifactPath!),
              )
            }
          >
            보고서 위치 열기
          </button>
        </div>
      )}
      {d.notes.length > 0 && (
        <details>
          <summary>팀 메시지와 결정 기록 ({d.notes.length})</summary>
          {[...d.notes].reverse().map((m, i) => (
            <div className="team-log" key={i}>
              <b>
                {m.from} → {m.to} ({m.type})
              </b>
              <p>{m.text}</p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
