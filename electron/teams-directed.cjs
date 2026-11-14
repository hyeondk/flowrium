const { relativePath } = require('./path-boundary.cjs');
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const {
  UUID,
  readJSON,
  createJSON,
  projectDirectory,
} = require("./project-store.cjs");
const { startWork, saveArtifact } = require("./workbench.cjs");
const { publicMessage } = require("./errors.cjs");
const empty = () => new Error("팀 업무 입력을 확인해 주세요.");
const stale = () =>
  new Error(
    "팀 기록이 다른 곳에서 변경됐습니다. 새로 고친 뒤 다시 시도해 주세요.",
  );
const maxNodes = 8;
const written = (v, max, optional = false) => {
  if (optional && (v == null || v === "")) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) throw empty();
  return v.trim();
};
function integer(v, max) {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw empty();
  return v;
}
function strings(v, count, width) {
  if (!Array.isArray(v) || v.length > count) throw empty();
  return v.map((s) => written(s, width));
}
function assignments(input, roles, allowEmpty = false) {
  if (
    !Array.isArray(input) ||
    (!allowEmpty && !input.length) ||
    input.length > roles.length
  )
    throw empty();
  const entries = input.map((a) => {
    const index = integer(a.index, roles.length - 1);
    const target =
      a.targetIndex == null ? null : integer(a.targetIndex, roles.length - 1);
    if (
      target != null &&
      (target === index ||
        roles[index].mode === "build" ||
        roles[target].mode !== "build")
    )
      throw empty();
    return {
      index,
      title: written(a.title, 140),
      task: written(a.task, 6000),
      steps: strings(a.steps || [], 12, 300),
      ...(target != null ? { targetIndex: target } : {}),
    };
  });
  const indices = new Set(entries.map((a) => a.index));
  if (
    indices.size !== entries.length ||
    entries.some((a) => a.targetIndex != null && !indices.has(a.targetIndex))
  )
    throw new Error(
      "같은 역할은 한 번만 배정하고 검수할 구현 역할을 함께 선택해 주세요.",
    );
  return entries;
}
const newNode = (a) => ({
  ...a,
  status: "waiting",
  summary: "",
  tokens: 0,
  stepsDone: 0,
});
const time = () => new Date().toISOString();
const stages = [
  "planning",
  "draft",
  "running",
  "decisions",
  "paused",
  "stopped",
  "review",
  "reporting",
  "done",
];
function note(r, from, to, type, text) {
  r.directed.notes.push({
    at: time(),
    from,
    to,
    type,
    text: String(text).slice(0, 2400),
  });
}
function decision(r, index, q) {
  const item = {
    id: randomUUID(),
    node: index,
    question: written(q.question, 1000),
    why: written(q.why, 1600, true),
    options: strings(q.options || [], 8, 200),
  };
  r.directed.decisions.push(item);
  note(
    r,
    index === -1 ? "팀장" : r.roles[index]?.name || "시스템",
    "사용자",
    "결정 요청",
    item.question,
  );
  return item;
}
const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assignments", "question", "why", "options"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "title", "task", "steps", "targetIndex"],
        properties: {
          index: { type: "integer" },
          title: { type: "string" },
          task: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          targetIndex: { type: ["integer", "null"] },
        },
      },
    },
    question: { type: "string" },
    why: { type: "string" },
    options: { type: "array", items: { type: "string" } },
  },
};
const coordinationSchema={...planSchema,required:[...planSchema.required,"complete"],properties:{...planSchema.properties,complete:{type:"boolean"}}};
function coordinationPrompt(r){
  return ["[팀 추가 배정] 완료한 담당자의 실제 결과를 검토하고 공동 목표에 남은 일이 있는지 판단하세요.",
    "더 진행할 일이 없으면 complete=true와 빈 assignments를 답하세요. 필요할 때만 완료된 역할이나 아직 배정하지 않은 역할에 추가 과업을 배정하세요.",
    "실행 중인 역할을 바꾸지 마세요. 없는 역할은 만들지 마세요. 추가 배정의 완료 기준과 검증 단계를 적으세요. 사용자 결정이 필요한 변경은 question/why/options에 남기세요.",
    planPrompt(r),...r.directed.nodes.map(n=>`${n.index} / ${n.title} / ${n.status}\n${n.summary}`)].join("\n\n");
}
function planPrompt(r) {
  return [
    "[팀 배정안] 사용자가 등록한 팀원 중 필요한 담당자만 선택해 서로 다른 세부 업무를 배정하세요.",
    "index는 아래 역할 번호입니다. 각 단계의 검증 기준을 구체화하세요. 구현 결과를 검수하는 역할만 targetIndex에 구현 담당 번호를 지정하세요.",
    "사용자 결정이 먼저 필요하면 question/why/options를 작성하세요. 없으면 빈 문자열과 배열로 답하세요. 등록하지 않은 역할과 파일은 만들지 마세요.",
    "공동 목표 / " + r.prompt,
    ...r.roles.map(
      (a, i) => i + " / " + a.name + " / " + a.mode + " / " + a.instruction,
    ),
    "참고 자료 / " + (r.directed.attachments.join("\n") || "없음"),
  ].join("\n");
}
function nodePrompt(r, n) {
  const qa = r.directed.nodes.find((x) => x.index === n.targetIndex);
  return [
    "[팀원 배정] " + n.title,
    "공동 목표 / " + r.prompt,
    "당신이 맡은 일 / " + n.task,
    ...n.steps.map((s, i) => i + 1 + ") " + s),
    qa && "검수할 구현 결과 / " + qa.summary,
    r.directed.attachments.length &&
      "참고 파일이나 링크 / " + r.directed.attachments.join("\n"),
    "중요한 결정 항목 / " +
      (r.directed.decideOn.join(" / ") || "사용자가 판단할 쟁점"),
    "직접 진행할 수 있으면 수행 결과와 검증 근거를 마크다운으로 보고하세요. 반드시 사용자의 결정이 필요하면 답변 마지막에 다음 형식의 단일 JSON 블록을 남기고 기다리세요.",
    '```flowrium-decision\n{"question":"결정할 사항","why":"이유","options":["선택 1","선택 2"]}\n```',
    qa &&
      '검수에서 수정이 필요하면 마지막에 ```flowrium-review 블록으로 {"passed":false,"feedback":"구체적인 수정 사항"}을 기록하세요.',
  ]
    .filter(Boolean)
    .join("\n");
}
function block(text, tag) {
  const match = text.match(
    new RegExp("```" + tag + "\\s*\\n([\\s\\S]*?)\\n```\\s*$"),
  );
  return match ? JSON.parse(match[1]) : undefined;
}
function reportPrompt(r) {
  const d = r.directed;
  return [
    "[팀 종합 보고] 역할 대화의 다음 실제 결과와 결정으로 한글 마크다운 보고서를 작성하세요.",
    "결론 / 수행한 일 / 실제 근거와 파일 / 검증 / 남은 사항 순서로 쓰세요. 보고되지 않은 완료나 배포를 주장하지 마세요.",
    "요청 / " + r.prompt,
    ...d.nodes.map(
      (n) =>
        r.roles[n.index].name +
        " / " +
        n.title +
        " / " +
        n.status +
        "\n" +
        n.summary,
    ),
    ...d.decisions.map((q) => q.question + " / " + (q.answer || "보류")),
    ...d.notes
      .filter((n) => n.type === "팀원 전달")
      .slice(-12)
      .map((n) => n.text),
  ].join("\n\n");
}
async function projectDir(parent, name) {
  const filename = path.join(parent, name);
  await projectDirectory(filename);
  if (relativePath(await fs.realpath(filename), filename) !== "")
    throw stale();
  return filename;
}
async function readRecord(dir, runId) {
  if (!UUID.test(runId)) throw empty();
  const folder = path.join(dir, runId);
  const stat = await fs.lstat(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw stale();
  const files = (await fs.readdir(folder))
    .filter((f) => !f.startsWith("."))
    .sort();
  if (!files.length)
    throw Object.assign(new Error("팀 업무 기록이 없습니다."), {
      code: "ENOENT",
    });
  if (files.some((f, i) => f !== String(i + 1).padStart(8, "0") + ".json"))
    throw stale();
  const r = await readJSON(path.join(folder, files.at(-1)));
  if (
    r.version !== 2 ||
    r.id !== runId ||
    !UUID.test(r.teamId) ||
    r.directed?.revision !== files.length ||
    !stages.includes(r.directed.phase) ||
    !Array.isArray(r.roles) ||
    !Array.isArray(r.directed.nodes)
  )
    throw stale();
  for(const key of ["autoDispatch","autoPM","autoQA","autoIntegrate"])if(r.directed[key]!==undefined&&typeof r.directed[key]!=="boolean")throw stale();
  for(const key of ["maxQaRounds","maxPMRounds"])if(r.directed[key]!==undefined&&(!Number.isInteger(r.directed[key])||r.directed[key]<1||r.directed[key]>10))throw stale();
  assignments(r.directed.nodes, r.roles, true);
  return r;
}
async function write(dir, r) {
  const folder = await projectDir(dir, r.id);
  const seq = r.directed.revision + 1;
  if (seq > 100000) throw new Error("팀 기록의 최대 개정 횟수에 도달했습니다.");
  r.directed.revision = seq;
  try {
    await createJSON(
      path.join(folder, String(seq).padStart(8, "0") + ".json"),
      r,
    );
  } catch (error) {
    r.directed.revision--;
    if (error.code === "EEXIST") throw stale();
    throw error;
  }
}
function nodeOf(r, index) {
  const n =
    index === -1
      ? r.directed.lead
      : r.directed.nodes.find((x) => x.index === index);
  if (!n) throw new Error("배정한 팀원을 찾을 수 없습니다.");
  return n;
}
function publicRun(r) {
  const d = r.directed;
  return {
    id: r.id,
    name: r.name,
    teamId: r.teamId,
    createdAt: r.createdAt,
    prompt: r.prompt,
    directed: structuredClone(d),
    roles: r.roles.map((role, index) => {
      const n = d.nodes.find((v) => v.index === index);
      return {
        ...role,
        status:
          n?.status === "done"
            ? "completed"
            : n?.status === "failed"
              ? "failed"
              : ["interrupted", "stopped"].includes(n?.status)
                ? "interrupted"
                : "running",
        summary: n?.summary || "",
        ...(n?.sessionId && { sessionId: n.sessionId }),
      };
    }),
  };
}

function registerDirected(
  register,
  {
    store,
    controller,
    canRun,
    serial: queue,
    folders,
    readDefinitions,
    definition,
    worktreeState,
    worktreeAction,
  },
) {
  const active = new Map(),
    alarms = new Map();
  const dirFor = async (projectId) =>
    projectDir(
      path.dirname((await folders(store, projectId)).runs),
      "directed",
    );
  let transitions = 0, schedulingStopped = false;
  function serial(projectId, work) {
    transitions += 1;
    return queue(projectId, work).finally(() => {
      transitions -= 1;
    });
  }
  const requireReady = () => {
    if (!canRun())
      throw new Error(
        "현재 팀을 실행할 수 없습니다. 앱 작업을 마친 뒤 다시 시도해 주세요.",
      );
  };
  function restore(r) {
    let lost = false;
    for (const n of [r.directed.lead, ...r.directed.nodes]) {
      if (
        n.status !== "running" ||
        active.has(n.sessionId) ||
        controller.runs.has(n.sessionId)
      )
        continue;
      n.status = "interrupted";
      n.summary =
        "앱 종료 또는 기기 변경으로 실행이 중단됐습니다. 요청을 확인한 뒤 재개하세요.";
      lost = true;
    }
    if (lost && !["stopped", "done", "paused"].includes(r.directed.phase)) {
      r.directed.resumePhase = r.directed.phase;
      r.directed.phase = "paused";
    }
    return r;
  }
  function clearAlarm(runId) {
    clearTimeout(alarms.get(runId));
    alarms.delete(runId);
  }
  function schedule(projectId, r) {
    clearAlarm(r.id);
    if(schedulingStopped)return;
    if (
      !r.directed.minutes ||
      !r.directed.startedAt ||
      !["planning", "reporting", "running", "decisions"].includes(
        r.directed.phase,
      )
    )
      return;
    const deadline =
      Date.parse(r.directed.startedAt) + r.directed.minutes * 60000;
    const alarm = setTimeout(
      () => {
        void serial(projectId, async () => {
          const dir = await dirFor(projectId);
          const latest = await readRecord(dir, r.id);
          if (
            ["planning", "reporting", "running", "decisions"].includes(
              latest.directed.phase,
            )
          )
            await hold(projectId, dir, latest, "시간 한도");
        }).catch(() => {});
      },
      Math.max(1, deadline - Date.now()),
    );
    alarm.unref?.();
    alarms.set(r.id, alarm);
  }
  async function hold(projectId, dir, r, why, stop = false) {
    const d = r.directed;
    d.resumePhase = d.phase;
    d.pausedAt = time();
    d.phase = stop ? "stopped" : "paused";
    const ids = [];
    for (const n of [d.lead, ...d.nodes]) {
      if (n.status !== "running") continue;
      ids.push(n.sessionId);
      n.status = stop ? "stopped" : "interrupted";
      n.summary = why;
      const job = active.get(n.sessionId);
      if (job) {
        n.tokens += job.usage || 0;
        d.tokens += job.usage || 0;
      }
      active.delete(n.sessionId);
    }
    if (why.includes("한도")) {
      d.limit = why;
      decision(r, -2, {
        question: why + "에 도달했습니다. 계속할까요?",
        why: "현재 팀 실행을 일시정지했습니다.",
        options: ["한도 50% 늘리기", "보류", "중단"],
      });
    }
    note(r, "시스템", "팀", stop ? "중단" : "일시정지", why);
    clearAlarm(r.id);
    await write(dir, r);
    await Promise.allSettled(
      ids
        .filter((s) => controller.runs.has(s))
        .map((s) => controller.interrupt(s)),
    );
  }
  async function session(projectId, r, n, purpose) {
    const integration=purpose==="integrate";
    const savedId=integration?n.integrationSessionId:n.roleSessionId||n.sessionId;
    if (savedId) {
      const saved = store.session(savedId);
      if (saved.projectId !== projectId) throw stale();
      if(!!saved.workflow?.teamSlot?.integration===integration){n.sessionId=saved.id;return saved;}
    }
    const lead = n.index === -1,
      role = r.roles[n.index];
    const s = await startWork(
      store,
      {
        projectId,
        kind: lead ? "document" : "task",
        role: lead ? "팀장" : role.name,
        brief: lead
          ? "팀의 요청을 분석하고 담당자에게 배정하며 결과를 검토하고 보고합니다."
          : [role.instruction, role.persona].filter(Boolean).join("\n"),
        title: (r.name + " / " + (lead ? "팀장" : role.name)+(integration?" / 통합":"")).slice(0, 160),
      },
      lead
        ? undefined
        : {
            runId: r.id,
            index: n.index,
            mode: integration?"build":role.mode,
            ...(r.directed.isolate && { isolated: true }),
            ...(integration&&{integration:true}),
          },
    );
    n.sessionId = s.id;
    if(integration)n.integrationSessionId=s.id;else n.roleSessionId=s.id;
    return s;
  }
  async function launchNode(projectId, dir, r, n, purpose, prompt) {
    requireReady();
    const s = await session(projectId, r, n, purpose);
    if (controller.runs.has(s.id))
      throw new Error("해당 역할 대화가 이미 응답 중입니다.");
    const model =
      n.index === -1 ? r.directed.leadModel : r.roles[n.index].model;
    const mode = purpose==="integrate"?"build":n.index === -1 ? "plan" : r.roles[n.index].mode;
    if (n.queue?.length) {
      prompt +=
        "\n대기 중에 받은 추가 지시와 팀 메시지:\n" +
        n.queue
          .map((m) => m.from + " / " + m.text)
          .join("\n")
          .slice(0, 36000);
      note(
        r,
        "팀",
        n.index < 0 ? "팀장" : r.roles[n.index].name,
        "대기 메시지 전달",
        n.queue.map((m) => m.text).join(" / "),
      );
      n.queue = [];
    }
    n.status = "running";
    n.purpose = purpose;
    n.lastRequest = prompt;
    n.before = s.messages.length;
    // 재실행 시 연결할 세션·요청을 먼저 원자적으로 보관한다.
    await write(dir, r);
    const job = {
      projectId,
      runId: r.id,
      index: n.index,
      before: n.before,
      usage: 0,
      budget: r.directed.budget,
      previousTokens: r.directed.tokens,
    };
    active.set(s.id, job);
    try {
      await controller.send(
        { sessionId: s.id, text: prompt, mode, ...(model && { model }) },
        purpose === "plan" ? { outputSchema: planSchema } : purpose==="coordinate"?{outputSchema:coordinationSchema}:{},
      );
    } catch (error) {
      active.delete(s.id);
      n.status = "failed";
      n.summary = publicMessage(error, "역할 대화를 시작하지 못했습니다.");
      note(
        r,
        "시스템",
        n.index === -1 ? "팀장" : r.roles[n.index].name,
        "실패",
        n.summary,
      );
      if (n.index === -1)
        r.directed.phase = purpose === "plan" ? "draft" : "review";
      await write(dir, r);
    }
  }
  async function startEligible(projectId, dir, r) {
    const d = r.directed;
    if (d.phase !== "running") return;
    for (const n of d.nodes) {
      if (n.status !== "waiting") continue;
      const target = d.nodes.find((x) => x.index === n.targetIndex);
      if (target && target.status !== "done") continue;
      await launchNode(projectId, dir, r, n, "work", nodePrompt(r, n));
    }
    // 각 send는 실행 수락 즉시 반환한다. 실제 Codex 턴은 독립 스레드에서 병렬 진행된다.
    if (d.nodes.some((n) => n.status === "running")) return;
    if (
      d.nodes.some((n) => n.status === "question") ||
      d.decisions.some((q) => !q.answer)
    ) {
      d.phase = "decisions";
      await write(dir, r);
      return;
    }
    if(d.autoPM&&!d.pmComplete&&d.nodes.length&&d.nodes.every(n=>n.status==="done")){
      if((d.pmRounds||0)>=(d.maxPMRounds||2)){
        if(!d.decisions.some(q=>q.node===-3&&!q.answer))decision(r,-3,{question:"팀장의 추가 배정 횟수에 도달했습니다. 결과를 확인한 뒤 계속할지 정해 주세요.",why:"무한 반복을 막기 위한 한도입니다.",options:["추가 배정 한도 늘리기","현재 결과로 마무리"]});
        d.phase="decisions";await write(dir,r);return;
      }
      d.pmRounds=(d.pmRounds||0)+1;d.phase="planning";
      await launchNode(projectId,dir,r,d.lead,"coordinate",coordinationPrompt(r));schedule(projectId,r);return;
    }
    if(d.autoIntegrate&&d.isolate&&!d.integrationDone&&d.nodes.length&&d.nodes.every(n=>n.status==="done")){
      try{await integrate(projectId,dir,r);}catch(error){
        d.phase="decisions";decision(r,-4,{question:"통합 작업을 확인해 주세요.",why:publicMessage(error),options:["통합 담당자에게 맡기기","변경 검토에서 직접 해결"]});await write(dir,r);
      }
      return;
    }
    d.phase = "review";
    await write(dir, r);
    clearAlarm(r.id);
    if (
      d.autoReport &&
      d.nodes.length &&
      d.nodes.every((n) => n.status === "done")
    )
      await report(projectId, dir, r);
  }
  async function integrate(projectId,dir,r){
    requireReady();if(!worktreeState||!worktreeAction)throw new Error("통합 작업 연결을 확인해 주세요.");
    const d=r.directed;note(r,"시스템","통합","통합 시작","선택한 자동 통합 설정에 따라 역할 변경을 커밋하고 통합합니다.");await write(dir,r);
    let board=await worktreeState(projectId,r.id);
    for(const n of d.nodes){
      if(r.roles[n.index].mode!=="build")continue;
      let role=board.roles[n.index];if(!role||role.owner!==n.index)continue;
      if(role.conflicts.length||role.mergeHead)throw new Error("역할 작업 폴더에 해결할 충돌이 있습니다.");
      if(role.files.length){
        await worktreeAction(projectId,r.id,{action:"commit",index:n.index,head:role.head,files:role.files.map(f=>f.file),message:(r.name+" / "+r.roles[n.index].name+" 작업").slice(0,240)});
        board=await worktreeState(projectId,r.id);role=board.roles[n.index];
      }
      await worktreeAction(projectId,r.id,{action:"integrate",index:n.index,head:role.head,integrationHead:board.integration.head||board.base});
      board=await worktreeState(projectId,r.id);
      if(board.integration.conflicts.length||board.integration.mergeHead)throw new Error("통합 폴더의 충돌을 보존했습니다. 파일을 검토해 해결해 주세요.");
    }
    if(d.integrationRoleIndex!==null&&d.integrationRoleIndex!==undefined){
      const n=nodeOf(r,d.integrationRoleIndex);d.phase="running";
      await launchNode(projectId,dir,r,n,"integrate",`[통합 담당 위임] 역할별 결과를 통합한 실제 Git 폴더에서 변경과 검증을 확인하고 필요한 보완을 수행하세요.\n공동 목표 / ${r.prompt}\n통합 폴더 / ${board.integration.directory}\n${d.nodes.map(v=>`${r.roles[v.index].name}\n${v.summary}`).join("\n\n")}\n외부 푸시나 배포는 사용자 결정 없이 수행하지 마세요.`);schedule(projectId,r);
    }else{
      d.integrationDone=true;d.phase="running";note(r,"시스템","사용자","통합 완료","역할의 검증한 커밋을 통합 브랜치에 모았습니다. 외부 푸시는 실행하지 않았습니다.");await write(dir,r);await startEligible(projectId,dir,r);
    }
  }
  async function report(projectId, dir, r) {
    if (
      r.directed.nodes.some((n) => n.status === "running") ||
      r.directed.lead.status === "running"
    )
      throw new Error("진행 중인 역할 대화를 먼저 마쳐 주세요.");
    if (!r.directed.nodes.length)
      throw new Error("종합할 역할 업무가 없습니다.");
    if (r.directed.decisions.some((q) => !q.answer))
      throw new Error("팀이 기다리는 결정에 답한 뒤 보고서를 작성해 주세요.");
    r.directed.phase = "reporting";
    note(r, "사용자", "팀장", "보고 요청", "역할별 수행 결과를 종합합니다.");
    await launchNode(
      projectId,
      dir,
      r,
      r.directed.lead,
      "report",
      reportPrompt(r),
    );
    schedule(projectId, r);
  }
  async function recordAnswer(projectId, dir, r, n, message) {
    const d = r.directed,
      body = message.text.trim();
    if (!body) throw new Error("팀 응답의 본문이 비어 있습니다.");
    n.summary = body.slice(0, 12000);
    n.status = "done";
    if (n.purpose === "plan") {
      const parsed = JSON.parse(
        body.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""),
      );
      const proposed = assignments(
        parsed.assignments,
        r.roles,
        Boolean(parsed.question),
      );
      d.nodes = proposed.map(newNode);
      if (parsed.question) {
        decision(r, -1, parsed);
        n.status = "question";
        d.phase = "decisions";
      } else d.phase = "draft";
      n.summary =
        parsed.question ||
        "역할별 배정안을 작성했습니다. 실행할 담당자와 내용을 확인해 주세요.";
      note(r, "팀장", "사용자", "배정안", n.summary);
      clearAlarm(r.id);
      if(d.autoDispatch&&!parsed.question){await write(dir,r);await command(projectId,dir,r,{action:"dispatch",assignments:proposed});return;}
    } else if(n.purpose==="coordinate"){
      const parsed=JSON.parse(body.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g,""));
      if(typeof parsed.complete!=="boolean")throw empty();
      if(parsed.question){decision(r,-1,parsed);n.status="question";d.phase="decisions";}
      else if(parsed.complete){d.pmComplete=true;d.phase="running";note(r,"팀장","사용자","추가 배정 검토","공동 목표의 담당 결과를 검토해 추가 과업이 없다고 판단했습니다.");}
      else{
        if(!Array.isArray(parsed.assignments)||!parsed.assignments.length)throw new Error("추가 업무 또는 완료 여부를 확인할 수 없습니다.");
        const combined=[...d.nodes.filter(old=>!parsed.assignments.some(a=>a.index===old.index)),...parsed.assignments];
        const normalized=assignments(combined,r.roles);
        for(const patch of parsed.assignments){
          const old=d.nodes.find(n=>n.index===patch.index);if(old&&old.status!=="done")throw new Error("완료되지 않은 담당자에게 새 업무를 덮어쓰지 않았습니다.");
          const next=normalized.find(n=>n.index===patch.index);
          if(d.isolate&&next.targetIndex!==(d.worktreeRoles?.[patch.index]?.targetIndex??undefined))throw new Error("격리된 검수 대상은 최초 배정을 유지해 주세요.");
          if(old)note(r,r.roles[old.index].name,"팀장","이전 과업 보존",old.summary);
          const node={...newNode(next),...(old?.sessionId&&{sessionId:old.sessionId,roleSessionId:old.roleSessionId||old.sessionId})};
          d.nodes=d.nodes.filter(n=>n.index!==next.index);d.nodes.push(node);note(r,"팀장",r.roles[next.index].name,"추가 배정",next.task);
        }
        if(d.isolate)await require("./team-worktrees.cjs").prepareTeamWorktrees(store,projectId,r.id,d.worktreeRoles,{indices:parsed.assignments.map(a=>a.index)});
        d.phase="running";
      }
    } else if(n.purpose==="integrate"){
      const board=await worktreeState(projectId,r.id);
      if(board.integration.conflicts.length){
        n.status="question";d.phase="decisions";decision(r,-4,{question:"통합 폴더의 충돌이 남아 있습니다.",why:board.integration.conflicts.join(" / "),options:["통합 담당자에게 맡기기","변경 검토에서 직접 해결"]});
      }else{
        if(board.integration.mergeHead)await worktreeAction(projectId,r.id,{action:"finish",index:-1,head:board.integration.head});
        else if(board.integration.files.length)await worktreeAction(projectId,r.id,{action:"commit",index:-1,head:board.integration.head,files:board.integration.files.map(f=>f.file),message:(r.name+" / 통합 보완").slice(0,240)});
        d.integrationDone=true;d.phase="running";note(r,r.roles[n.index].name,"사용자","통합 담당 보고",n.summary);
      }
    } else if (n.purpose === "report") {
      const artifact = await saveArtifact(store, n.sessionId, message.id, "md");
      d.artifactPath = artifact.path;
      d.phase = "done";
      clearAlarm(r.id);
      note(r, "팀장", "사용자", "완료 보고", artifact.path);
    } else if (n.purpose === "explain") {
      n.summary = body.slice(0, 12000);
      note(r, "팀장", "사용자", "업무 설명", n.summary);
      d.phase = d.explainReturn || "review";
      delete d.explainReturn;
    } else {
      const q = block(body, "flowrium-decision");
      const verdict = block(body, "flowrium-review");
      if (q) {
        decision(r, n.index, q);
        n.status = "question";
        n.summary = q.question;
      } else if (verdict?.passed === false && n.targetIndex != null) {
        const target = nodeOf(r, n.targetIndex);
        const automate=d.autoQA&&(n.qaRounds||0)<(d.maxQaRounds||3);
        target.status = automate?"waiting":"interrupted";
        target.summary = written(verdict.feedback, 2000);
        n.status = "waiting";
        n.summary = "구현 담당자가 보완한 뒤 다시 검수합니다.";
        note(
          r,
          r.roles[n.index].name,
          r.roles[target.index].name,
          "검수 반려",
          target.summary,
        );
        if(automate){
          n.qaRounds=(n.qaRounds||0)+1;target.queue||=[];target.queue.push({from:r.roles[n.index].name,text:"검수 보완 요청 / "+target.summary});
          note(r,"시스템",r.roles[target.index].name,"자동 보완",`${n.qaRounds} / ${d.maxQaRounds||3}회 / ${target.summary}`);d.phase="running";
        }else decision(r, target.index, {question:"검수에서 발견된 사항을 보완할까요?",why:target.summary,
          options:["보완 후 재검수","범위 조정"]});
      } else {
        n.stepsDone = n.steps.length;
        note(
          r,
          r.roles[n.index].name,
          "팀장",
          n.targetIndex != null ? "검수 통과" : "결과 보고",
          n.summary,
        );
      }
    }
    await write(dir, r);
  }
  controller.on("event", (event) => {
    if (event.type !== "done") return;
    const job = active.get(event.sessionId);
    if (!job) return;
    void serial(job.projectId, async () => {
      if (active.get(event.sessionId) !== job) return;
      const dir = await dirFor(job.projectId),
        r = await readRecord(dir, job.runId),
        n = nodeOf(r, job.index);
      active.delete(event.sessionId);
      if (n.status !== "running" || n.sessionId !== event.sessionId) return;
      const messages = store
        .session(event.sessionId)
        .messages.slice(job.before);
      n.tokens += job.usage;
      r.directed.tokens += job.usage;
      try {
        if (event.status !== "completed")
          throw new Error(
            messages.findLast((m) => m.role === "system")?.text ||
              "팀 작업이 중단됐습니다.",
          );
        const response = messages.findLast((m) => m.role === "assistant");
        if (!response) throw new Error("팀 응답을 찾지 못했습니다.");
        await recordAnswer(job.projectId, dir, r, n, response);
      } catch (error) {
        n.status = event.status === "interrupted" ? "interrupted" : "failed";
        n.summary = publicMessage(
          error,
          "팀 응답 형식을 확인하지 못했습니다. 대화 내용을 확인하고 재시도해 주세요.",
        );
        if (n.index === -1)
          r.directed.phase = n.purpose === "plan" ? "draft" : "review";
        note(r, "시스템", "팀장", "실패", n.summary);
        await write(dir, r);
      }
      if (
        r.directed.budget &&
        r.directed.tokens >= r.directed.budget &&
        !["done", "stopped", "paused"].includes(r.directed.phase)
      ) {
        await hold(job.projectId, dir, r, "토큰 한도");
        return;
      }
      if (
        n.index >= 0 &&
        n.status === "done" &&
        n.queue?.length &&
        r.directed.phase === "running"
      )
        await launchNode(
          job.projectId,
          dir,
          r,
          n,
          "work",
          "앞선 업무 결과를 기준으로 추가 지시를 수행해 주세요.",
        );
      if (r.directed.phase === "running")
        await startEligible(job.projectId, dir, r);
    }).catch((error) =>
      controller.emitEvent({
        type: "error",
        sessionId: event.sessionId,
        text: publicMessage(error, "팀 기록을 갱신하지 못했습니다."),
      }),
    );
  });
  controller.client?.on("notification", ({ method, params }) => {
    if (!["thread/tokenUsage/updated", "turn/plan/updated"].includes(method))
      return;
    const current = controller.findRun(params?.threadId, params?.turnId),
      job = current && active.get(current.sessionId);
    if (method === "turn/plan/updated" && job && Array.isArray(params.plan)) {
      const progress = params.plan
        .slice(0, 30)
        .filter((p) => typeof p.step === "string")
        .map((p) => ({
          step: p.step.slice(0, 300),
          status: String(p.status).slice(0, 20),
        }));
      void serial(job.projectId, async () => {
        if (active.get(current.sessionId) !== job) return;
        const dir = await dirFor(job.projectId),
          r = await readRecord(dir, job.runId),
          n = nodeOf(r, job.index);
        if (JSON.stringify(n.progress) === JSON.stringify(progress)) return;
        n.progress = progress;
        n.stepsDone = n.steps.filter((s) =>
          progress.some((p) => p.step === s && p.status === "completed"),
        ).length;
        await write(dir, r);
      }).catch(() => {});
      return;
    }
    const used = params?.tokenUsage?.last?.totalTokens;
    if (job && Number.isFinite(used) && used >= 0) {
      job.usage = Math.max(job.usage, used);
      if (!job.budget) return;
      const currentUsage = Array.from(active.values())
        .filter((j) => j.runId === job.runId)
        .reduce((sum, j) => sum + j.usage, 0);
      if (job.previousTokens + currentUsage < job.budget) return;
      void serial(job.projectId, async () => {
        if (active.get(current.sessionId) !== job) return;
        const dir = await dirFor(job.projectId),
          r = await readRecord(dir, job.runId);
        await hold(job.projectId, dir, r, "토큰 한도");
      }).catch(() => {});
    }
  });
  register("directTeam", (projectId, teamId, goal, runId, o) =>
    serial(projectId, async () => {
      if (
        !UUID.test(teamId) ||
        !UUID.test(runId) ||
        !o ||
        !["manual", "plan"].includes(o.strategy)
      )
        throw empty();
      const prompt = written(goal, 12000);
      const { teams } = await folders(store, projectId);
      const dir = await dirFor(projectId);
      let old;
      try {
        old = await readRecord(dir, runId);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (old) {
        if (
          old.prompt !== prompt ||
          old.teamId !== teamId ||
          old.directed.strategy !== o.strategy
        )
          throw stale();
        return publicRun(restore(old));
      }
      const template = (await readDefinitions(teams)).get(teamId);
      if (!template?.team) throw new Error("실행할 팀을 찾을 수 없습니다.");
      const team = definition(template),
        date = time();
      if (o.strategy === "plan") requireReady();
      const d = {
        revision: 0,
        strategy: o.strategy,
        phase: o.strategy === "plan" ? "planning" : "draft",
        lead: newNode({ index: -1, title: "팀장", task: prompt, steps: [] }),
        nodes: assignments(o.assignments || [], team.roles, true).map(newNode),
        decisions: [],
        notes: [],
        isolate: o.isolate === true,
        autoReport: o.autoReport === true,
        autoDispatch:o.autoDispatch===true,autoPM:o.autoPM===true,autoQA:o.autoQA===true,autoIntegrate:o.autoIntegrate===true,
        maxQaRounds:integer(o.maxQaRounds??3,10),maxPMRounds:integer(o.maxPMRounds??2,10),
        integrationRoleIndex:o.integrationRoleIndex==null?null:integer(o.integrationRoleIndex,team.roles.length-1),
        budget: integer(o.budget || 0, 100000000),
        minutes: integer(o.minutes || 0, 10080),
        tokens: 0,
        attachments: strings(o.attachments || [], 10, 1200),
        decideOn: strings(o.decideOn || [], 6, 180),
        leadModel: written(o.leadModel, 200, true),
      };
      const r = {
        version: 2,
        id: runId,
        teamId,
        name: team.name,
        roles: team.roles,
        createdAt: date,
        prompt,
        directed: d,
      };
      if(d.maxQaRounds<1||d.maxPMRounds<1)throw empty();
      if(d.integrationRoleIndex!==null&&(!d.isolate||r.roles[d.integrationRoleIndex].mode!=="build"))throw new Error("통합 담당자는 격리 작업을 사용하는 구현 역할에서 골라 주세요.");
      note(r, "사용자", "팀", "업무 등록", prompt);
      if (o.strategy === "plan") d.startedAt = date;
      await write(dir, r);
      if (o.strategy === "plan") {
        await launchNode(projectId, dir, r, d.lead, "plan", planPrompt(r));
        schedule(projectId, r);
      }
      return publicRun(r);
    }),
  );
  async function resume(projectId, dir, r) {
    const d = r.directed;
    if (d.limit)
      throw new Error("한도를 늘리거나 실행을 중단할지 먼저 선택해 주세요.");
    if (d.pausedAt && d.startedAt)
      d.startedAt = new Date(
        Date.parse(d.startedAt) + Date.now() - Date.parse(d.pausedAt),
      ).toISOString();
    delete d.pausedAt;
    d.phase = d.resumePhase || "running";
    if (["paused", "stopped", "done"].includes(d.phase)) d.phase = "review";
    for (const n of [d.lead, ...d.nodes]) {
      if (n.status === "interrupted" && n.lastRequest)
        await launchNode(projectId, dir, r, n, n.purpose, n.lastRequest);
    }
    await write(dir, r);
    schedule(projectId, r);
    if (d.phase === "running") await startEligible(projectId, dir, r);
  }
  async function command(projectId, dir, r, c) {
    const d = r.directed;
    if (!c || typeof c !== "object") throw empty();
    if (
      ["done", "stopped"].includes(d.phase) &&
      !["reopen", "explain", "finishStopped", "deleteRun"].includes(c.action)
    )
      throw new Error("팀 업무를 재개한 뒤 변경해 주세요.");
    switch (c.action) {
      case "automation":{
        for(const key of ["autoDispatch","autoPM","autoQA","autoIntegrate"]){if(c[key]!==undefined){if(typeof c[key]!=="boolean")throw empty();d[key]=c[key];}}
        for(const key of ["maxQaRounds","maxPMRounds"]){if(c[key]!==undefined){const count=integer(c[key],10);if(count<1)throw empty();d[key]=count;}}
        if(c.integrationRoleIndex!==undefined){
          const index=c.integrationRoleIndex===null?null:integer(c.integrationRoleIndex,r.roles.length-1);
          if(index!==null&&(!d.isolate||r.roles[index].mode!=="build"))throw empty();d.integrationRoleIndex=index;
        }
        note(r,"사용자","팀","자동 운영 설정","사용자가 선택한 자동 운영 범위를 갱신했습니다.");await write(dir,r);return;
      }
      case "dispatch": {
        if (d.phase !== "draft")
          throw new Error("배정안 검토 단계에서 실행해 주세요.");
        requireReady();
        const picked = assignments(c.assignments, r.roles);
        if (d.isolate) {
          const bound = r.roles.map((role, index) => ({
            ...role,
            targetIndex: picked.find((n) => n.index === index)?.targetIndex,
          }));
          d.worktreeRoles=bound;
          await require("./team-worktrees.cjs").prepareTeamWorktrees(
            store,
            projectId,
            r.id,
            bound,
            { indices: picked.map((n) => n.index) },
          );
        }
        d.nodes = picked.map(newNode);
        d.phase = "running";
        d.startedAt ||= time();
        for (const n of d.nodes)
          note(r, "사용자", r.roles[n.index].name, "배정", n.task);
        await write(dir, r);
        await startEligible(projectId, dir, r);
        schedule(projectId, r);
        return;
      }
      case "pause":
        if (
          !["running", "planning", "reporting", "decisions"].includes(d.phase)
        )
          throw empty();
        d.pausedAt = time();
        await hold(projectId, dir, r, "사용자가 일시정지했습니다.");
        return;
      case "resume":
        if (d.phase !== "paused") throw empty();
        requireReady();
        note(r, "사용자", "팀", "재개", "중단된 업무를 이어갑니다.");
        await resume(projectId, dir, r);
        return;
      case "finishStopped":
        if (d.phase !== "stopped") throw empty();
        d.phase = "done";
        note(
          r,
          "사용자",
          "팀",
          "직접 완료",
          "중단한 업무를 완료 칸으로 옮겼습니다.",
        );
        await write(dir, r);
        return;
      case "deleteRun":
        if (d.phase !== "done")
          throw new Error("완료한 팀 업무만 목록에서 삭제할 수 있습니다.");
        d.deleted = true;
        note(
          r,
          "사용자",
          "팀",
          "기록 삭제",
          "팀 보드에서 실행 기록을 삭제했습니다.",
        );
        await write(dir, r);
        return;
      case "stop":
        await hold(projectId, dir, r, "사용자가 팀 업무를 중단했습니다.", true);
        return;
      case "reopen":
        if (!["done", "stopped"].includes(d.phase)) throw empty();
        d.phase = d.nodes.length ? "review" : "draft";
        delete d.limit;
        note(
          r,
          "사용자",
          "팀",
          "다시 열기",
          "기존 대화와 보고서를 유지합니다.",
        );
        await write(dir, r);
        return;
      case "report":
        requireReady();
        await report(projectId, dir, r);
        return;
      case "raiseLimit": {
        if (!d.limit) throw empty();
        if (d.limit === "토큰 한도")
          d.budget = Math.ceil(Math.max(d.tokens, d.budget) * 1.5);
        else d.minutes = Math.max(d.minutes + 1, Math.ceil(d.minutes * 1.5));
        for (const q of d.decisions)
          if (q.node === -2 && !q.answer) q.answer = "한도 50% 늘리기";
        delete d.limit;
        note(r, "사용자", "팀", "한도 변경", "한도를 늘리고 재개합니다.");
        requireReady();
        await resume(projectId, dir, r);
        return;
      }
      case "answer": {
        const q = d.decisions.find((x) => x.id === c.decisionId);
        if (!q || q.answer)
          throw new Error("응답할 결정 항목을 찾지 못했습니다.");
        const answer = written(c.text, 5000);
        if(q.node===-3){
          if(!["추가 배정 한도 늘리기","현재 결과로 마무리"].includes(answer))throw empty();q.answer=answer;
          if(answer==="현재 결과로 마무리")d.pmComplete=true;else{d.maxPMRounds=Math.min(10,(d.maxPMRounds||2)+1);if(d.pmRounds>=10)throw new Error("추가 배정은 최대 10회까지 자동 진행합니다.");}
          d.phase="running";await write(dir,r);await startEligible(projectId,dir,r);return;
        }
        if(q.node===-4){
          if(!["통합 담당자에게 맡기기","변경 검토에서 직접 해결"].includes(answer))throw empty();q.answer=answer;
          if(answer==="통합 담당자에게 맡기기"){
            if(d.integrationRoleIndex==null)throw new Error("팀 실행 설정에서 통합 담당자를 먼저 골라 주세요.");
            const board=await worktreeState(projectId,r.id),n=nodeOf(r,d.integrationRoleIndex);d.phase="running";
            await launchNode(projectId,dir,r,n,"integrate",`[통합 담당 위임] 다음 통합 폴더의 충돌을 분석하고 사용자가 승인한 변경을 보존하며 해결하세요.\n${board.integration.directory}\n${board.integration.conflicts.join("\n")}\n${q.why}\n충돌을 해결하고 검증한 뒤 결과와 남은 사항을 보고하세요.`);schedule(projectId,r);
          }else{d.phase="review";d.autoIntegrate=false;await write(dir,r);}return;
        }
        if (q.node === -2) {
          if (answer === "한도 50% 늘리기")
            return command(projectId, dir, r, { action: "raiseLimit" });
          if (!["보류", "중단"].includes(answer)) throw empty();
          q.answer = answer;
          await write(dir, r);
          if (answer === "중단")
            await hold(
              projectId,
              dir,
              r,
              "한도 초과로 팀 업무를 중단했습니다.",
              true,
            );
          return;
        }
        if (d.phase === "paused")
          throw new Error("팀 업무를 재개한 뒤 답변해 주세요.");
        requireReady();
        const n = nodeOf(r, q.node);
        if (controller.runs.has(n.sessionId))
          throw new Error("해당 역할의 응답을 기다려 주세요.");
        q.answer = answer;
        note(
          r,
          "사용자",
          q.node === -1 ? "팀장" : r.roles[q.node].name,
          "결정",
          answer,
        );
        d.phase = q.node === -1 ? "planning" : "running";
        const coordinating=q.node===-1&&n.purpose==="coordinate";
        const previous = q.node === -1 ? coordinating?coordinationPrompt(r):planPrompt(r) : nodePrompt(r, n);
        await launchNode(
          projectId,
          dir,
          r,
          n,
          q.node === -1 ? coordinating?"coordinate":"plan" : "work",
          previous + "\n사용자의 결정 / " + q.question + "\n" + answer,
        );
        schedule(projectId, r);
        return;
      }
      case "stopNode":
      case "completeNode": {
        const n = nodeOf(r, c.index);
        if (n.index < 0) throw empty();
        const id = n.sessionId;
        if (id && active.has(id)) {
          active.delete(id);
          await controller.interrupt(id);
        }
        n.status = c.action === "stopNode" ? "stopped" : "done";
        n.summary =
          c.action === "stopNode"
            ? "사용자가 개별 업무를 중단했습니다."
            : "사용자가 업무를 완료 처리했습니다.";
        if (n.status === "done") n.stepsDone = n.steps.length;
        for (const q of d.decisions)
          if (q.node === n.index && !q.answer) q.answer = n.summary;
        note(r, "사용자", r.roles[n.index].name, "상태 변경", n.summary);
        await write(dir, r);
        if (d.phase === "decisions") d.phase = "running";
        if (d.phase === "running") await startEligible(projectId, dir, r);
        return;
      }
      case "retry":
      case "instruct":
      case "message":
      case "explain": {
        requireReady();
        const original = nodeOf(r, c.index),
          n =
            c.action === "explain"
              ? d.lead
              : c.action === "message"
                ? nodeOf(r, c.toIndex)
                : original;
        if (
          (n.status === "running" || d.phase === "paused") &&
          ["instruct", "message"].includes(c.action) &&
          n.index >= 0
        ) {
          const from =
            c.action === "message"
              ? original.index === -1
                ? "팀장"
                : r.roles[original.index].name
              : "사용자";
          n.queue ||= [];
          if (n.queue.length >= 32)
            throw new Error("전달 대기 중인 메시지가 많습니다.");
          n.queue.push({ from, text: written(c.text, 6000) });
          note(r, from, r.roles[n.index].name, "전달 대기", c.text);
          await write(dir, r);
          return;
        }
        if (
          n.status === "running" ||
          d.phase === "reporting" ||
          d.phase === "paused"
        )
          throw new Error(
            "대상 역할의 작업을 마치거나 팀을 재개한 뒤 요청해 주세요.",
          );
        let purpose = n.index === -1 ? "plan" : "work",
          prompt;
        if (c.action === "retry") {
          if (!["failed", "interrupted", "stopped"].includes(n.status))
            throw new Error("실패하거나 중단된 역할을 선택해 주세요.");
          purpose = n.purpose || purpose;
          prompt =
            n.lastRequest ||
            (n.index === -1 ? planPrompt(r) : nodePrompt(r, n));
        } else if (c.action === "explain") {
          d.explainReturn = d.phase;
          purpose = "explain";
          prompt =
            "이 업무와 진행 기록을 사용자에게 쉬운 한국어로 설명하세요.\n" +
            original.title +
            "\n" +
            original.task +
            "\n" +
            original.summary;
        } else {
          const extra = written(c.text, 6000);
          if (n.index === -1 && d.phase !== "draft")
            throw new Error("역할을 선택해 추가 지시를 보내 주세요.");
          note(
            r,
            c.action === "message"
              ? original.index === -1
                ? "팀장"
                : r.roles[original.index].name
              : "사용자",
            n.index === -1 ? "팀장" : r.roles[n.index].name,
            c.action === "message" ? "팀원 전달" : "추가 지시",
            extra,
          );
          prompt =
            (n.index === -1 ? planPrompt(r) : nodePrompt(r, n)) +
            "\n" +
            (c.action === "message"
              ? "다른 담당자로부터 전달받은 내용 / "
              : "사용자의 추가 지시 / ") +
            extra;
        }
        if (purpose === "plan") d.phase = "planning";
        else if (purpose === "report") d.phase = "reporting";
        else if (purpose === "work") d.phase = "running";
        await launchNode(projectId, dir, r, n, purpose, prompt);
        schedule(projectId, r);
        return;
      }
      case "reassign": {
        requireReady();
        if (!["running", "decisions", "review"].includes(d.phase))
          throw empty();
        const old = nodeOf(r, c.index),
          to = integer(c.toIndex, r.roles.length - 1);
        if (old.index < 0 || to === old.index) throw empty();
        const existing = d.nodes.find((n) => n.index === to);
        if (old.status === "running" || existing?.status === "running")
          throw new Error("실행 중인 역할을 먼저 중단한 뒤 재배정해 주세요.");
        if (
          d.isolate &&
          d.nodes.some(
            (n) =>
              n.targetIndex === old.index ||
              (n.index === to && n.targetIndex != null),
          )
        )
          throw new Error(
            "격리된 검수 대상 폴더를 바꾸는 재배정은 새 팀 업무에서 설정해 주세요.",
          );
        if (d.isolate && !existing)
          throw new Error("격리 폴더를 준비한 담당자 중에서 선택해 주세요.");
        if (
          d.nodes.some((n) => n.targetIndex === old.index) &&
          r.roles[to].mode !== "build"
        )
          throw new Error("검수 대상 업무는 구현 역할에 재배정해 주세요.");
        const extra = written(c.text, 6000),
          n =
            existing ||
            newNode({
              index: to,
              title: old.title,
              task: old.task,
              steps: [...old.steps],
            });
        n.title = old.title;
        n.task = extra;
        n.steps = [...old.steps];
        n.stepsDone = 0;
        delete n.targetIndex;
        if (!existing) d.nodes.push(n);
        old.status = "stopped";
        old.summary = r.roles[to].name + "에게 재배정했습니다.";
        for (const target of d.nodes)
          if (target.targetIndex === old.index) target.targetIndex = to;
        for (const q of d.decisions)
          if (q.node === old.index && !q.answer) q.answer = old.summary;
        note(
          r,
          "사용자",
          r.roles[to].name,
          "재배정",
          old.title + " / " + extra,
        );
        d.phase = "running";
        await launchNode(projectId, dir, r, n, "work", nodePrompt(r, n));
        schedule(projectId, r);
        return;
      }
      case "ask": {
        const n = nodeOf(r, c.index);
        if (n.index < 0) throw empty();
        decision(r, n.index, {
          question: written(c.text, 1000),
          why: "사용자가 등록한 중간 결정입니다.",
          options: [],
        });
        if (n.sessionId && active.has(n.sessionId)) {
          active.delete(n.sessionId);
          await controller.interrupt(n.sessionId);
        }
        n.status = "question";
        d.phase = d.nodes.some((v) => v.status === "running")
          ? "running"
          : "decisions";
        await write(dir, r);
        return;
      }
      default:
        throw empty();
    }
  }
  register("changeTeamRun", (projectId, runId, change, revision) =>
    serial(projectId, async () => {
      const dir = await dirFor(projectId),
        r = restore(await readRecord(dir, runId));
      if (r.directed.deleted || revision !== r.directed.revision) throw stale();
      await command(projectId, dir, r, change);
      return publicRun(r);
    }),
  );
  register("openTeamNode", (projectId, runId, index) =>
    serial(projectId, async () => {
      const r = await readRecord(await dirFor(projectId), runId);
      const n = nodeOf(r, index);
      if (!n.sessionId) throw new Error("아직 실행되지 않은 역할입니다.");
      const s = store.session(n.sessionId);
      if (s.projectId !== projectId) throw stale();
      return structuredClone(s);
    }),
  );
  async function list(projectId, runs) {
    const dir = await projectDir(path.dirname(runs), "directed");
    const result = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (!UUID.test(entry.name) || !entry.isDirectory()) throw stale();
      try {
        const row = restore(await readRecord(dir, entry.name));
        if (!row.directed.deleted) result.push(publicRun(row));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
    return result;
  }
  return { list, isBusy: () => active.size > 0 || transitions > 0,
    stopScheduling(){schedulingStopped=true;for(const runId of [...alarms.keys()])clearAlarm(runId);},
  };
}
module.exports = { registerDirected };
