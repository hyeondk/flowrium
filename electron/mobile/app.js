const content = document.querySelector("#content");
const navigation = document.querySelector("#nav");
const connection = document.querySelector("#status");
const notice = document.querySelector("#notice");
const keyStorage = "flowrium.mobile.key";
const rememberedKeyStorage="flowrium.mobile.rememberedKey",rememberFlag="flowrium.mobile.remember";
let rememberDevice=false;
const fragment = new URLSearchParams(location.hash.slice(1));
let handoff = fragment.get("handoff");
let key = fragment.get("key");
try {
  rememberDevice=localStorage.getItem(rememberFlag)==="1";
  if (key) {sessionStorage.setItem(keyStorage, key);if(rememberDevice)localStorage.setItem(rememberedKeyStorage,key);}
  else key = sessionStorage.getItem(keyStorage)||(rememberDevice?localStorage.getItem(rememberedKeyStorage):null);
} catch {
  /* 새 연결 주소의 키는 이 탭 메모리에서 사용할 수 있다. */
}
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);

const kinds = {
  task: "자유 업무",
  research: "리서치",
  briefing: "브리핑",
  document: "문서 작성",
  weekly: "주간업무보고",
  pause: "업무 마감",
};
const phases = {
  waiting: "대기",
  running: "실행 중",
  question: "결정 대기",
  done: "완료",
  completed: "완료",
  failed: "실패",
  interrupted: "중단",
  stopped: "종료",
  planning: "계획 중",
  draft: "계획 검토",
  decisions: "결정 대기",
  paused: "일시 중지",
  review: "검토",
  reporting: "보고 중",
};
let data,
  route = "projects",
  selectedProject = "",
  selectedSession = "",
  detailTab = "work";
let teamBoard,
  files,
  preview,
  assetRequest = 0,
  polling = false,
  signature = "",
  errorTimer;
let busy = false,
  gate = "",
  accessEpoch = 0;
let historyPage,
  historyBusy = false,
  historyError = "",
  historyEpoch = 0;
function resetHistory() {
  historyEpoch++;
  historyPage = undefined;
  historyBusy = false;
  historyError = "";
}
const drafts = new Map();
const questionDrafts = new Map();
const attachedDrafts = new Map(), attachmentPreviews = new Map();
let queueItems=[],workflowData,mobileSettings,usageData,pushData,extrasBusy=false,extrasEpoch=0;
let workflowTab='decisions',editingTeam=null;
let teamDraft={name:'',roles:[{name:'',instruction:'',mode:'plan'},{name:'',instruction:'',mode:'review'}]};
const pushLabels={decision:'결정 / 승인',done:'작업 완료',error:'오류',report:'보고서',reminder:'예약 알림',message:'업무 메시지'};

const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
const action = (text, callback, className) => {
  const button = node("button", text, className);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
};
let noticeExitTimer;
const hideNotice = () => {
  clearTimeout(errorTimer);
  clearTimeout(noticeExitTimer);
  if (notice.hidden) return;
  notice.dataset.phase = "exit";
  noticeExitTimer = setTimeout(() => { notice.hidden = true; }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 240);
};
const showNotice = (message) => {
  clearTimeout(errorTimer);
  clearTimeout(noticeExitTimer);
  notice.textContent = message;
  notice.hidden = false;
  notice.dataset.phase = "enter";
  errorTimer = setTimeout(hideNotice, 6000);
};
const ownSessions = () =>
  (data?.sessions ?? []).filter((s) => s.projectId === selectedProject);
const project = (id) => data?.projects.find((p) => p.id === id);
const session = (id) => data?.sessions.find((s) => s.id === id);
const date = (text) =>
  text
    ? new Date(text).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const running = (id) => (data?.running ?? []).includes(id);
const label = (name, field) => {
  const box = node("label", name);
  field.setAttribute("aria-label", name);
  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    const control = node("span", undefined, "ui-checkbox-control");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    for (const [key, value] of Object.entries({x:1,y:1,width:18,height:18,rx:5})) rect.setAttribute(key, String(value));
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M5 10.2 8.3 13.4 15 6.8"); path.setAttribute("pathLength", "1");
    svg.append(rect, path); control.append(field, svg); box.append(control);
  } else box.append(field);
  return box;
};
function select(options, initial) {
  const element = node("select");
  for (const [value, title] of options) {
    const option = node("option", title);
    option.value = value;
    element.append(option);
  }
  element.value = initial;
  return element;
}
function row(title, description, callback, badge) {
  const item = action("", callback, "row");
  const text = node("span");
  text.append(node("strong", title));
  if (description) text.append(node("small", description));
  item.append(text);
  if (badge) item.append(node("i", badge));
  return item;
}
async function request(path, body) {
  const headers = { Authorization: "Bearer " + key };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(18000),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "연결 상태를 확인해 주세요.");
    error.status = response.status;
    error.gate =
      response.status === 401
        ? "expired"
        : response.status === 403 && value.locked
          ? "locked"
          : "";
    throw error;
  }
  return value;
}
const call = (method, ...args) =>
  request("/api/mobile/call", { method, args }).then((r) => r.result);
function clearPrivateState(nextGate) {
  accessEpoch++;
  resetHistory();
  gate = nextGate;
  data = undefined;
  teamBoard = files = preview = undefined;
  assetRequest++;
  signature = "";
  drafts.clear();
  questionDrafts.clear();
  attachedDrafts.clear();attachmentPreviews.clear();queueItems=[];workflowData=mobileSettings=usageData=pushData=undefined;extrasEpoch++;
  selectedSession = selectedProject = "";
  route = "projects";
  notice.hidden = true;
  if (gate === "expired") {
    key = null;
    try {
      sessionStorage.removeItem(keyStorage);
      localStorage.removeItem(rememberedKeyStorage);localStorage.removeItem(rememberFlag);rememberDevice=false;
    } catch {}
  }
  render();
}
async function poll() {
  if (polling || !key || document.hidden) return;
  polling = true;
  const epoch = accessEpoch;
  try {
    const next = await request("/api/mobile/state");
    if (epoch !== accessEpoch) return;
    next.approvals = (next.approvals || []).filter(
      (event) =>
        (event.type === "approval" || event.type === "input") &&
        event.requestId,
    );
    const openQuestions = new Set(
      next.approvals
        .filter((e) => e.type === "input" && !e.desktopOnly)
        .map((e) => e.requestId),
    );
    for (const id of questionDrafts.keys())
      if (!openQuestions.has(id)) questionDrafts.delete(id);
    const fresh = JSON.stringify(next);
    const changed = gate || fresh !== signature;
    data = next;
    signature = fresh;
    gate = "";
    connection.textContent = data.connection?.authenticated
      ? "데스크톱 연결됨"
      : "계정 연결 필요";
    if (changed) render();
    if (["assistant","settings"].includes(route)) void loadExtras(false);
    if (route === "chat") {
      void loadQueue();
      const current = session(selectedSession);
      if (!current) go("projects");
      else if (
        !historyError &&
        (!historyPage ||
          current.messageCount !== historyPage.total ||
          current.lastMessageId !== historyPage.lastMessageId ||
          current.updatedAt !== historyPage.updatedAt)
      )
        void loadMessages();
    }
    if (route === "project" && detailTab === "team" && !busy)
      await loadAssets(false);
  } catch (error) {
    if (error.gate) clearPrivateState(error.gate);
    else {
      connection.textContent = "연결 재시도 중";
      if (!data) {
        gate = "offline";
        render();
      }
    }
  } finally {
    polling = false;
  }
}
async function run(callback) {
  if (busy) return;
  busy = true;
  render();
  try {
    await callback();
    await poll();
  } catch (error) {
    if (error.gate) clearPrivateState(error.gate);
    else showNotice(error.message);
  } finally {
    busy = false;
    render();
  }
}
function go(view, id) {
  assetRequest++;
  route = view;
  resetHistory();
  preview = undefined;
  hideNotice();
  if (view === "project") {
    selectedProject = id;
    detailTab = "work";
    teamBoard = files = undefined;
  }
  if (view === "chat") {
    selectedSession = id;
    queueItems=[];
    selectedProject = session(id)?.projectId || selectedProject;
  }
  window.scrollTo(0, 0);
  render();
  if (view === "chat") {void loadMessages();void loadQueue();}
  if (["assistant","settings"].includes(view)) void loadExtras();
}
async function loadMessages(older = false) {
  if (historyBusy || gate || route !== "chat") return;
  const id = selectedSession,
    epoch = historyEpoch,
    previous = historyPage;
  if (older && !previous?.before) return;
  historyBusy = true;
  historyError = "";
  render();
  const query = new URLSearchParams({ limit: "50" });
  if (older) query.set("before", previous.before);
  let refresh = false;
  try {
    const page = await request(
      "/api/mobile/sessions/" + encodeURIComponent(id) + "?" + query.toString(),
    );
    if (
      historyEpoch !== epoch ||
      route !== "chat" ||
      gate ||
      selectedSession !== id
    )
      return;
    if (older) {
      historyPage = {
        ...previous,
        before: page.before,
        start: page.start,
        messages: [...page.messages, ...previous.messages],
      };
    } else {
      const shared = previous?.messages.find((m) => m.index >= page.start);
      const connected =
        previous &&
        page.total >= previous.total &&
        previous.start < page.start &&
        page.start <= previous.end &&
        shared &&
        page.messages.some(
          (m) => m.index === shared.index && m.id === shared.id,
        );
      historyPage = connected
        ? {
            ...page,
            start: previous.start,
            before: previous.before,
            messages: [
              ...previous.messages.filter((m) => m.index < page.start),
              ...page.messages,
            ],
          }
        : page;
    }
  } catch (error) {
    if (epoch !== historyEpoch) return;
    if (error.gate) {
      clearPrivateState(error.gate);
      return;
    }
    if (error.status === 409 && older) {
      historyPage = undefined;
      refresh = true;
    } else historyError = error.message;
  } finally {
    if (epoch === historyEpoch) {
      historyBusy = false;
      render();
      if (refresh) void loadMessages();
    }
  }
}
async function loadAssets(announce = true) {
  const id = ++assetRequest,
    tab = detailTab;
  try {
    if (tab === "team") {
      const result = await call("readTeams", selectedProject);
      if (
        id !== assetRequest ||
        JSON.stringify(result) === JSON.stringify(teamBoard)
      )
        return;
      teamBoard = result;
    } else if (tab === "files") {
      const result = await call("readWorkbench", selectedProject);
      if (id !== assetRequest) return;
      files = result;
    }
    render();
  } catch (error) {
    if (id !== assetRequest) return;
    if (error.gate) clearPrivateState(error.gate);
    else if (announce) showNotice(error.message);
  }
}
function openTab(tab) {
  detailTab = tab;
  preview = undefined;
  render();
  if (tab === "team" || tab === "files") void loadAssets();
}
function sessionRow(s) {
  return row(
    s.title,
    [kinds[s.workflow?.kind] || "대화", date(s.updatedAt)].join(" / "),
    () => go("chat", s.id),
    running(s.id) ? "실행 중" : undefined,
  );
}
function inputCard(entry) {
  const card = node("section", undefined, "box mobile-question");
  card.setAttribute("aria-label", "추가 질문");
  card.append(
    node("h2", "추가 질문"),
    node("p", session(entry.sessionId)?.title || "실행 중인 대화", "hint"),
  );
  if (entry.desktopOnly || !entry.questions?.length) {
    card.append(
      node(
        "p",
        "이 질문은 데스크톱 Flowrium에서 확인하고 답해 주세요.",
        "body",
      ),
    );
    return card;
  }
  if (entry.isBlocking)
    card.append(node("p", "답변을 보내면 작업이 이어집니다.", "hint"));
  let fields = questionDrafts.get(entry.requestId);
  if (!fields) {
    fields = new Map();
    questionDrafts.set(entry.requestId, fields);
  }
  const form = node("form");
  for (const q of entry.questions) {
    const fieldset = node("fieldset");
    fieldset.append(node("legend", q.header || "질문"));
    const draft = fields.get(q.id) || { selection: "", text: "" };
    fields.set(q.id, draft);
    const options = q.options || [];
    if (options.length) {
      const choices = [
        ["", "보기 선택"],
        ...options.map((o, i) => [String(i), o.label]),
      ];
      if (q.isOther) choices.push(["other", "직접 입력"]);
      const picker = select(choices, draft.selection);
      picker.required = true;
      picker.disabled = busy;
      picker.dataset.field = JSON.stringify([entry.requestId, q.id, "choice"]);
      picker.addEventListener("change", () => {
        draft.selection = picker.value;
        render();
      });
      fieldset.append(label(q.question, picker));
      const chosen =
        draft.selection !== "" &&
        draft.selection !== "other" &&
        options[Number(draft.selection)];
      if (chosen?.description)
        fieldset.append(node("p", chosen.description, "hint"));
    }
    if (!options.length || draft.selection === "other") {
      const text = node("textarea");
      text.maxLength = 16000;
      text.required = true;
      text.disabled = busy;
      text.value = draft.text;
      text.dataset.field = JSON.stringify([entry.requestId, q.id, "text"]);
      text.addEventListener("input", () => {
        draft.text = text.value;
      });
      fieldset.append(
        label(options.length ? q.question + " / 직접 입력" : q.question, text),
      );
    }
    form.append(fieldset);
  }
  const submit = node("button", "질문 답변 보내기", "main-action");
  submit.type = "submit";
  submit.disabled = busy;
  form.append(submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answers = [];
    for (const q of entry.questions) {
      const draft = fields.get(q.id),
        options = q.options || [];
      const answer =
        options.length && draft.selection !== "other"
          ? options[Number(draft.selection)]?.label
          : draft.text.trim();
      if (!answer || (options.length && draft.selection === "")) {
        showNotice("각 질문에 답해 주세요.");
        return;
      }
      answers.push([q.id, { answers: [answer] }]);
    }
    const epoch = accessEpoch;
    void run(async () => {
      try {
        await call("answerInput", {
          requestId: entry.requestId,
          answers: Object.fromEntries(answers),
        });
        if (epoch === accessEpoch && data) {
          data.approvals = data.approvals.filter(
            (e) => e.requestId !== entry.requestId,
          );
          showNotice("질문에 답했습니다.");
        }
      } finally {
        questionDrafts.delete(entry.requestId);
      }
    });
  });
  card.append(form);
  return card;
}
function approvals(list, root) {
  if (!list.length)
    root.append(node("p", "대기 중인 승인 요청이 없습니다.", "hint"));
  for (const entry of list) {
    if (entry.type === "input") {
      root.append(inputCard(entry));
      continue;
    }
    const card = node("section", undefined, "box");
    card.append(
      node("h2", session(entry.sessionId)?.title || "작업 승인 요청"),
      node("p", entry.details || entry.method || "작업 실행 요청", "body"),
    );
    const buttons = node("div", undefined, "actions");
    for (const [title, decision] of [
      ["이번 작업 승인", "accept"],
      ["거절", "decline"],
    ]) {
      const b = action(title, () =>
        run(async () => {
          await call("approval", { requestId: entry.requestId, decision });
          data.approvals = data.approvals.filter(
            (a) => a.requestId !== entry.requestId,
          );
          showNotice(decision === "accept" ? "승인했습니다." : "거절했습니다.");
        }),
      );
      b.disabled = busy;
      buttons.append(b);
    }
    card.append(buttons);
    root.append(card);
  }
}
function projects(root) {
  root.append(
    node("h1", "프로젝트"),
    node("p", "데스크톱에서 연결한 프로젝트의 업무와 문서를 여세요.", "hint"),
  );
  if (!data.projects.length)
    root.append(
      node(
        "p",
        "데스크톱의 프로젝트 추가에서 작업할 폴더를 지정하세요.",
        "box",
      ),
    );
  for (const p of data.projects) {
    const list = data.sessions.filter((s) => s.projectId === p.id);
    root.append(
      row(
        p.name,
        "업무 " + list.length + "개",
        () => go("project", p.id),
        list.some((s) => running(s.id)) ? "실행 중" : undefined,
      ),
    );
  }
}
function team(root) {
  const reset = action("팀 상태 새로 고침", () => loadAssets());
  root.append(reset);
  if (!teamBoard) return;
  root.append(action('새 팀 만들기',()=>{editingTeam='new';teamDraft={name:'',roles:[{name:'',instruction:'',mode:'plan'},{name:'',instruction:'',mode:'review'}]};render()}));
  if(editingTeam) teamEditor(root);
  for (const t of teamBoard.teams){
    const card=node('section',undefined,'box');
    card.append(node('p',t.name+' / '+t.roles.map(r=>r.name).join(' / ')),action(t.name+' 편집',()=>{editingTeam=t.id;teamDraft=structuredClone(t);render()}));
    const form=node('form'),goal=bindDraft(node('textarea'),'teamGoal/'+t.id,''),strategy=bindDraft(select([['plan','AI가 역할별 계획 배정'],['manual','역할 지시로 직접 배정']],'plan'),'teamStrategy/'+t.id,'plan');goal.required=true;goal.maxLength=12000;
    const isolate=node('input');isolate.type='checkbox';isolate.checked=drafts.get('teamIsolate/'+t.id)===true;isolate.addEventListener('change',()=>drafts.set('teamIsolate/'+t.id,isolate.checked));form.append(label(t.name+'의 목표',goal),label('배정 방식',strategy),label('역할별 Git 작업 공간 분리',isolate));
    const start=node('button','팀 업무 시작','main-action');start.type='submit';start.disabled=busy;form.append(start);
    form.addEventListener('submit',e=>{e.preventDefault();const prompt=goal.value.trim(),method=strategy.value;void run(async()=>{const options={strategy:method,isolate:isolate.checked,autoReport:true,autoDispatch:method==='plan',autoPM:true,autoQA:true,autoIntegrate:false};if(method==='manual'){options.assignments=t.roles.map((r,index)=>({index,title:r.name,task:prompt+'\n'+r.instruction,steps:[]}));if(options.assignments.some(a=>a.task.length>6000))throw Error('직접 배정할 목표와 역할 지시를 합해 6,000자 이내로 입력하세요.');}await call('directTeam',selectedProject,t.id,prompt,crypto.randomUUID(),options);drafts.delete('teamGoal/'+t.id);await loadAssets();showNotice('팀 업무를 시작했습니다.')})});card.append(form);root.append(card);
  }
  for (const runEntry of teamBoard.runs) {
    const card = node("section", undefined, "box");
    card.append(node("h2", runEntry.name), node("p", runEntry.prompt, "body"));
    if (runEntry.directed)
      card.append(
        node(
          "span",
          phases[runEntry.directed.phase] || runEntry.directed.phase,
          "badge",
        ),
      );
    if(runEntry.directed) teamControls(card,runEntry);
    for (const r of runEntry.directed?.nodes ?? runEntry.roles) {
      const title = r.title || r.name || "역할 대화";
      if (r.sessionId && session(r.sessionId))
        card.append(
          row(
            title,
            r.summary,
            () => go("chat", r.sessionId),
            phases[r.status] || r.status,
          ),
        );
      else
        card.append(
          node("p", title + " / " + (phases[r.status] || r.status), "hint"),
        );
    }
    root.append(card);
  }
  if (!teamBoard.teams.length && !teamBoard.runs.length)
    root.append(
      node(
        "p",
        "데스크톱에서 팀을 만들면 역할과 진행 상태가 표시됩니다.",
        "hint",
      ),
    );
}
function artifacts(root) {
  if (preview) {
    root.append(
      action("문서 목록으로", () => {
        preview = undefined;
        render();
      }),
      node("h2", preview.name),
      node("pre", preview.body, "body box"),
    );
    return;
  }
  root.append(action("문서 새로 고침", () => loadAssets()));
  if (!files) return;
  if (!files.artifacts.length)
    root.append(node("p", "아직 저장한 문서가 없습니다.", "hint"));
  for (const file of files.artifacts) {
    const item = row(
      file.path.split("/").pop(),
      file.path,
      () =>
        run(async () => {
          const id = ++assetRequest,
            body = await call("readWorkArtifact", selectedProject, file.path);
          if (id === assetRequest) preview = { name: file.path, body };
        }),
      file.preview ? "미리보기" : "데스크톱에서 열기",
    );
    item.disabled = !file.preview || busy;
    root.append(item);
  }
}
function projectPage(root) {
  const p = project(selectedProject);
  if (!p) return projects(root);
  root.append(
    action("프로젝트 목록으로", () => go("projects")),
    node("h1", p.name),
  );
  const tabs = node("div", undefined, "tabs");
  for (const [tab, name] of [
    ["work", "업무"],
    ["team", "팀"],
    ["files", "문서"],
  ]) {
    const b = action(name, () => openTab(tab));
    if (tab === detailTab) b.setAttribute("aria-current", "page");
    tabs.append(b);
  }
  root.append(tabs);
  if (detailTab === "team") return team(root);
  if (detailTab === "files") return artifacts(root);
  const list = ownSessions()
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  root.append(action("새 업무 대화", () => go("new"), "main-action"));
  if (!list.length)
    root.append(node("p", "이 프로젝트에서 맡길 첫 업무를 고르세요.", "hint"));
  for (const s of list) root.append(sessionRow(s));
}
function bindDraft(el, id, initial) {
  el.dataset.field = id;
  el.value = drafts.has(id) ? drafts.get(id) : initial;
  el.addEventListener("input", () => drafts.set(id, el.value));
  return el;
}
function newWork(root) {
  const p = project(selectedProject);
  if (!p) return projects(root);
  root.append(
    action("프로젝트로", () => go("project", p.id)),
    node("h1", "새 업무 대화"),
  );
  const form = node("form"),
    prefix = "new/" + p.id + "/";
  const kind = bindDraft(
    select(Object.entries(kinds), "task"),
    prefix + "kind",
    "task",
  );
  const title = bindDraft(node("input"), prefix + "title", "");
  title.required = true;
  title.maxLength = 160;
  const brief = bindDraft(node("textarea"), prefix + "brief", "");
  brief.maxLength = 12000;
  form.append(
    label("업무 유형", kind),
    label("업무 이름", title),
    label("목표와 요청", brief),
  );
  const b = node("button", "대화 만들기", "main-action");
  b.type = "submit";
  b.disabled = busy;
  form.append(b);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = {
      projectId: p.id,
      kind: kind.value,
      title: title.value.trim(),
      brief: brief.value.trim(),
    };
    if (!values.title) return;
    void run(async () => {
      const s = await call("startWork", values);
      data.sessions = [s, ...data.sessions.filter((v) => v.id !== s.id)];
      if (values.brief) drafts.set("chat/" + s.id, values.brief);
      for (const k of ["kind", "title", "brief"]) drafts.delete(prefix + k);
      go("chat", s.id);
    });
  });
  root.append(form);
}
function chat(root) {
  const s = session(selectedSession);
  if (!s) return projects(root);
  root.append(
    action("프로젝트로", () => go("project", s.projectId)),
    node("h1", s.title),
    node(
      "p",
      project(s.projectId)?.name + " / " + (kinds[s.workflow?.kind] || "대화"),
      "hint",
    ),
  );
  const pending = data.approvals.filter((a) => a.sessionId === s.id);
  if (pending.length) approvals(pending, root);
  if (historyError) {
    root.append(
      node("p", historyError, "hint"),
      action("기록 다시 불러오기", () => loadMessages()),
    );
  } else if (historyBusy && !historyPage)
    root.append(node("p", "최근 메시지를 불러오는 중입니다.", "hint"));
  if (historyPage?.before) {
    const more = action("이전 메시지 더 보기", () => loadMessages(true));
    more.disabled = historyBusy;
    root.append(more);
  }
  for (const m of historyPage?.messages || []) {
    const block = node("article", undefined, "message");
    block.dataset.role = m.role;
    block.append(
      node(
        "small",
        (m.role === "user" ? "나" : "답변") + " / " + date(m.createdAt),
      ),
      node("div", m.text, "body"),
    );
    for(const a of m.attachments||[]) block.append(attachmentCard(a,s.projectId));
    root.append(block);
  }
  if (running(s.id)) {
    const stop = action("작업 중단", () => run(() => call("interrupt", s.id)));
    stop.disabled = busy;
    root.append(node("p", "데스크톱에서 실행 중입니다.", "hint"), stop);
  }
  if(queueItems.length){const queue=node("section",undefined,"box");queue.append(node("h2","추가 지시 대기열"));for(const item of queueItems){const line=node("div",undefined,"queue-line");line.append(node("p",item.text||"첨부 요청","body"),node("small",({queued:"대기",sending:"전송 중",sent:"전송 완료",cancelled:"취소"})[item.status]||item.status));if(item.error)line.append(node("p",item.error,"hint"));if(item.status==="queued")line.append(action("이 지시 취소",()=>run(async()=>{await call("cancelQueuedMessage",s.id,item.id);await loadQueue()})));queue.append(line)}queue.append(action("대기 지시 이어 보내기",()=>run(async()=>{await call("resumeQueuedMessages",s.id);await loadQueue()})));root.append(queue)}
  const form = node("form"),
    draftId = "chat/" + s.id,
    text = bindDraft(node("textarea"), draftId, "");
  text.maxLength = 120000;
  const initialMode =
    s.workflow?.teamSlot?.mode ||
    (s.workflow?.kind === "task" ? "build" : "plan");
  const mode = bindDraft(
    select(
      [
        ["plan", "계획"],
        ["build", "구현"],
        ["review", "검토"],
      ],
      initialMode,
    ),
    "mode/" + s.id,
    initialMode,
  );
  const submit = node("button", running(s.id) ? "추가 지시 대기열에 넣기" : "요청 보내기", "main-action");
  submit.type = "submit";
  submit.disabled = busy || !data.connection?.authenticated;
  form.append(label("요청", text), label("작업 모드", mode));
  attachmentComposer(form,s);form.append(submit);
  if (!data.connection?.authenticated)
    form.append(
      node("p", "데스크톱 설정에서 본인의 ChatGPT 계정을 연결하세요.", "hint"),
    );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = text.value.trim();
    const attachments=attachedDrafts.get(s.id)||[];
    if (!value && !attachments.length) return;
    void run(async () => {
      const result=await call("send", {
        sessionId: s.id,
        text: value,
        attachments:attachments.map(a=>a.id),
        mode: mode.value,
        model: s.preferences?.model || data.settings.model,
        effort: s.preferences?.effort || data.settings.effort,
      });
      drafts.delete(draftId);attachedDrafts.delete(s.id);await loadQueue();
      showNotice(result.queued ? "추가 지시를 대기열에 넣었습니다." : "요청을 보냈습니다.");
    });
  });
  root.append(form);
}
async function loadQueue(){
  const id=selectedSession,epoch=accessEpoch;if(route!=='chat'||gate||!id)return;
  try{const rows=await call('listQueuedMessages',id);if(epoch!==accessEpoch||id!==selectedSession)return;if(JSON.stringify(rows)!==JSON.stringify(queueItems)){queueItems=rows;render()}}catch{}
}
function attachmentCard(a,projectId,remove){
  const box=node('div',undefined,'attachment');const cached=attachmentPreviews.get(a.id);
  if(cached){const img=node('img');img.src=cached;img.alt=a.name;box.append(img)}
  box.append(node('span',a.name+' / '+Math.ceil(a.size/1024)+'KB'));
  if(!cached&&a.type?.startsWith('image/'))box.append(action('이미지 보기',()=>run(async()=>{const result=await call('readChatAttachment',projectId,a.id);if(result.dataUrl)attachmentPreviews.set(a.id,result.dataUrl);else showNotice('이 이미지는 데스크톱에서 확인해 주세요.')})));
  if(remove)box.append(action(a.name+' 첨부 해제',remove));return box;
}
function attachmentComposer(form,s){
  const box=node('section',undefined,'attachments'),picker=node('input');picker.type='file';picker.multiple=true;picker.disabled=busy;picker.setAttribute('aria-label','파일 첨부');
  picker.addEventListener('change',()=>{const files=[...picker.files];void uploadAttachments(s,files)});
  box.append(label('파일 첨부',picker),node('p','사진을 붙여 넣거나 파일을 끌어 놓으세요.','hint'));
  for(const a of attachedDrafts.get(s.id)||[])box.append(attachmentCard(a,s.projectId,()=>{attachedDrafts.set(s.id,(attachedDrafts.get(s.id)||[]).filter(x=>x.id!==a.id));render()}));
  form.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
  form.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();void uploadAttachments(s,[...e.dataTransfer.files])}});
  form.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void uploadAttachments(s,files)}});
  form.append(box);
}
let uploadTail=Promise.resolve();
function uploadAttachments(s,files){
  if(!files.length)return;
  const epoch=accessEpoch;
  uploadTail=uploadTail.catch(()=>{}).then(async()=>{
    if(epoch!==accessEpoch||gate)return;
    const current=attachedDrafts.get(s.id)||[];
    if(current.length+files.length>10||current.reduce((n,a)=>n+a.size,0)+files.reduce((n,a)=>n+a.size,0)>50*1024*1024)throw Error('첨부는 10개 / 합계 50MB까지 가능합니다.');
    for(const file of files){
      if(!file.size||file.size>20*1024*1024)throw Error('파일 한 개는 20MB까지 첨부할 수 있습니다.');
      const query=new URLSearchParams({projectId:s.projectId,name:file.name,type:file.type||'application/octet-stream'});
      const response=await fetch('/api/mobile/attachments?'+query,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/octet-stream'},body:file,credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'첨부 업로드에 실패했습니다.');
      if(epoch!==accessEpoch||gate)return;
      attachedDrafts.set(s.id,[...(attachedDrafts.get(s.id)||[]),...result.result]);render();
    }
  }).catch(e=>{if(epoch===accessEpoch)showNotice(e.message)});
  return uploadTail;
}
function teamEditor(root){
  const form=node('form'),name=node('input');name.value=teamDraft.name;name.required=true;name.maxLength=80;name.dataset.field='team/name';name.addEventListener('input',()=>teamDraft.name=name.value);form.append(node('h2','팀 구성'),label('팀 이름',name));
  teamDraft.roles.forEach((role,index)=>{
    const row=node('fieldset'),title=node('input'),instruction=node('textarea'),mode=select([['plan','계획'],['build','구현'],['review','검토']],role.mode||'plan');title.value=role.name;instruction.value=role.instruction;title.required=instruction.required=true;title.maxLength=80;instruction.maxLength=2000;
    title.dataset.field='team/role/'+index;instruction.dataset.field='team/instruction/'+index;
    title.addEventListener('input',()=>role.name=title.value);instruction.addEventListener('input',()=>role.instruction=instruction.value);mode.addEventListener('change',()=>role.mode=mode.value);
    row.append(node('legend','역할 '+(index+1)),label('역할 이름 '+(index+1),title),label('역할 지시 '+(index+1),instruction),label('역할 모드 '+(index+1),mode));
    if(teamDraft.roles.length>2)row.append(action('역할 '+(index+1)+' 제거',()=>{teamDraft.roles.splice(index,1);render()}));form.append(row);
  });
  const save=node('button','팀 저장','main-action');save.type='submit';save.disabled=busy;
  const add=action('역할 추가',()=>{teamDraft.roles.push({name:'',instruction:'',mode:'plan'});render()});add.disabled=teamDraft.roles.length>=8;
  form.append(add,save,action('팀 편집 닫기',()=>{editingTeam=null;render()}));form.addEventListener('submit',e=>{e.preventDefault();const value=structuredClone(teamDraft);void run(async()=>{await call('saveTeam',selectedProject,value);editingTeam=null;await loadAssets();showNotice('팀을 저장했습니다.')})});root.append(form);
}
function teamControls(card,entry){
  const d=entry.directed,buttons=node('div',undefined,'actions');
  const change=change=>run(async()=>{await call('changeTeamRun',selectedProject,entry.id,change,d.revision);await loadAssets()});
  for(const [name,act]of (d.phase==='stopped'||d.phase==='done'?[['팀 다시 열기','reopen']]:d.phase==='paused'?[['다시 시작','resume'],['팀 중단','stop']]:[['일시 중지','pause'],['팀 중단','stop'],['결과 보고','report']])){const b=action(name,()=>change({action:act}));b.disabled=busy;buttons.append(b)}card.append(buttons);
  if(d.phase==='draft'){
    const form=node('form'),assignments=[];card.append(node('h3','역할별 업무 배정'));
    for(const r of(d.nodes||[])){const index=r.index;
      const title=bindDraft(node('input'),'assign/title/'+entry.id+'/'+index,r.title||entry.roles[index]?.name||'역할 '+(index+1));
      const task=bindDraft(node('textarea'),'assign/task/'+entry.id+'/'+index,r.task||entry.roles[index]?.instruction||'');title.required=task.required=true;
      form.append(label('배정 이름 '+(index+1),title),label('배정 업무 '+(index+1),task));assignments.push({index,title,task});
    }
    const submit=node('button','배정하고 실행');submit.type='submit';submit.disabled=busy;form.append(submit);
    form.addEventListener('submit',e=>{e.preventDefault();void change({action:'dispatch',assignments:assignments.map(r=>({index:r.index,title:r.title.value,task:r.task.value,steps:[]}))})});card.append(form);
  }
  for(const decision of d.decisions||[]){if(decision.answer)continue;const form=node('form'),answer=bindDraft(node('textarea'),'teamDecision/'+decision.id,'');answer.required=true;form.append(node('h3',decision.question),node('p',decision.why||'','hint'),label('팀 결정 답변',answer));const send=node('button','팀 결정 보내기');send.type='submit';form.append(send);form.addEventListener('submit',e=>{e.preventDefault();void change({action:'answer',decisionId:decision.id,text:answer.value})});card.append(form)}
  const form=node('form'),role=select((d.nodes||[]).map(r=>[String(r.index),r.title||entry.roles[r.index]?.name||'역할 '+(r.index+1)]),'0'),text=bindDraft(node('textarea'),'teamInstruction/'+entry.id,'');text.required=true;
  form.append(label('지시할 역할',role),label('추가 지시 / 피드백',text));const send=node('button','역할에 지시 보내기');send.type='submit';send.disabled=busy;form.append(send);form.addEventListener('submit',e=>{e.preventDefault();void change({action:'instruct',index:Number(role.value),text:text.value})});card.append(form);
}
async function loadExtras(announce=true){
  if(extrasBusy||gate||!['assistant','settings'].includes(route))return;
  extrasBusy=true;const epoch=accessEpoch,target=route;
  try{
    if(target==='assistant'){
      const result=await call('mobileWorkflowState');if(epoch!==accessEpoch||target!==route)return;
      if(JSON.stringify(result)!==JSON.stringify(workflowData)){workflowData=result;render()}
    }else if(!mobileSettings||announce){
      const [settings,usage,push]=await Promise.all([call('mobileSettings'),call('readAccountUsage').catch(()=>null),data.pushAvailable?call('webPushState').catch(()=>null):null]);
      if(epoch!==accessEpoch||target!==route)return;mobileSettings=settings;usageData=usage;pushData=push;render();
    }
  }catch(e){if(e.gate)clearPrivateState(e.gate);else if(announce)showNotice(e.message)}finally{extrasBusy=false;}
}
function workflowDo(input){return run(async()=>{await call('workflowAction',input);await loadExtras();showNotice('반영했습니다.')})}
function assistantPage(root){
  root.append(node('h1','업무 연결 / 비서'),action('비서 상태 새로 고침',()=>loadExtras()));
  if(!workflowData){root.append(node('p','비서 상태를 불러오는 중입니다.','hint'));return}
  const tabs=node('div',undefined,'tabs');for(const [id,title]of [['decisions','결정'],['messages','대화 연결'],['reminders','예약 알림'],['reports','보고'],['preferences','비서 설정']]){const b=action(title,()=>{workflowTab=id;render()});if(workflowTab===id)b.setAttribute('aria-current','page');tabs.append(b)}root.append(tabs);
  if(workflowTab==='decisions'){
    const visible=workflowData.proposals.filter(p=>!p.hidden),selected=new Set(),bulk=node('div',undefined,'actions');
    bulk.append(action('선택 승인',()=>workflowDo({action:'bulk',operation:'approve',items:visible.filter(p=>selected.has(p.id)).map(p=>({id:p.id,revision:p.revision}))})),action('선택 거절',()=>workflowDo({action:'bulk',operation:'reject',items:visible.filter(p=>selected.has(p.id)).map(p=>({id:p.id,revision:p.revision}))})));root.append(bulk);
    if(!visible.length)root.append(node('p','확인할 결정이 없습니다.','hint'));
    for(const p of visible){const card=node('section',undefined,'box');card.append(node('h2',p.title),node('p',p.body,'body'),node('small',p.status));if(p.preview)card.append(node('p',[p.preview.action,p.preview.calendarName,p.preview.event?.title,p.preview.event?.at].filter(Boolean).join(' / '),'hint'));
      if(p.status==='pending'){const check=node('input');check.type='checkbox';check.addEventListener('change',()=>check.checked?selected.add(p.id):selected.delete(p.id));card.append(label(p.title+' 선택',check));const buttons=node('div',undefined,'actions');for(const [title,act]of [['승인','approve'],['거절','reject'],['숨기기','hide']])buttons.append(action(title,()=>workflowDo({action:act,id:p.id,revision:p.revision})));buttons.append(action('한 시간 뒤 확인',()=>workflowDo({action:'snooze',id:p.id,revision:p.revision,minutes:60})));card.append(buttons)}if(p.result)card.append(node('p',p.result,'body'));root.append(card)}
    const events=node('section',undefined,'box');events.append(node('h2','최근 알림'));
    for(const n of workflowData.notifications.slice(0,40)){const line=node('div',undefined,'queue-line');line.append(node('strong',n.title),node('p',n.body,'body'));if(!n.readAt)line.append(action('확인한 알림',()=>workflowDo({action:'read',ids:[n.id]})));if(n.sessionId&&session(n.sessionId))line.append(action('알림 대화 열기',()=>go('chat',n.sessionId)));events.append(line)}root.append(events);
  }else if(workflowTab==='messages'){
    const form=node('form'),target=select(data.sessions.map(s=>[s.id,s.title]),data.sessions[0]?.id),text=bindDraft(node('textarea'),'workflow/send','');text.required=true;const title=bindDraft(node('input'),'workflow/title','');
    form.append(label('대상 대화',target),label('요청 제목',title),label('보낼 내용',text));const mode=select([['send','기존 대화에 메시지'],['request','업무 요청 제안']],'send');form.append(label('연결 방식',mode));const submit=node('button','업무 연결 보내기','main-action');submit.type='submit';submit.disabled=busy||!data.sessions.length;form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();void workflowDo(mode.value==='send'?{action:'send',targetId:target.value,text:text.value}:{action:'request',targetId:target.value,title:title.value||'업무 요청',text:text.value})});root.append(form);
    for(const d of workflowData.deliveries.slice(0,30)){const card=node('section',undefined,'box');card.append(node('p',d.text,'body'),node('small',d.status));if(['failed','held'].includes(d.status))card.append(action('메시지 다시 전달',()=>workflowDo({action:'retryDelivery',id:d.id})));root.append(card)}
  }else if(workflowTab==='reminders'){
    const form=node('form'),text=bindDraft(node('textarea'),'reminder/text',''),at=bindDraft(node('input'),'reminder/at',''),repeat=select([['0','반복 안 함'],['1','매일'],['7','매주']],'0');text.required=at.required=true;at.type='datetime-local';form.append(label('예약 알림 내용',text),label('알림 시간',at),label('반복',repeat));const submit=node('button','예약 알림 추가','main-action');submit.type='submit';form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();void workflowDo({action:'reminderAdd',text:text.value,when:new Date(at.value).toISOString(),repeatDays:Number(repeat.value)})});root.append(form);
    for(const r of workflowData.reminders.filter(r=>!r.cancelled)){const card=node('section',undefined,'box');card.append(node('p',r.text),node('small',date(r.nextAt)),action('예약 취소',()=>workflowDo({action:'reminderCancel',id:r.id})));root.append(card)}
  }else if(workflowTab==='reports'){
    root.append(action('AI 업무 보고 생성',()=>workflowDo({action:'reportNow'})),action('결정 추천 생성',()=>workflowDo({action:'recommend'})),action('프로젝트 현황 수집',()=>workflowDo({action:'collect'})));
    for(const report of workflowData.reports.slice(0,20)){const card=node('section',undefined,'box');card.append(node('h2',date(report.at)+' / '+(report.status||'보고')),node('p',report.body||report.error||'AI가 보고서를 작성하고 있습니다.','body'));if(report.sessionId&&session(report.sessionId))card.append(action('보고 대화 열기',()=>go('chat',report.sessionId)));root.append(card)}
  }else{
    const form=node('form'),prefs=workflowData.preferences,enabled=node('input'),ai=node('input'),interval=select([['15','15분'],['30','30분'],['60','1시간'],['120','2시간'],['240','4시간']],String(prefs.intervalMinutes));enabled.type=ai.type='checkbox';enabled.checked=prefs.enabled;ai.checked=prefs.aiReports;
    const start=select(Array.from({length:24},(_,i)=>[String(i),i+'시']),String(prefs.startHour)),end=select(Array.from({length:24},(_,i)=>[String(i),i+'시']),String(prefs.endHour));
    form.append(label('자동 비서 사용',enabled),label('ChatGPT로 보고 생성',ai),label('확인 주기',interval),label('업무 시작 시간',start),label('업무 종료 시간',end));const submit=node('button','비서 설정 저장');submit.type='submit';form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();void workflowDo({action:'preferences',value:{enabled:enabled.checked,aiReports:ai.checked,intervalMinutes:Number(interval.value),startHour:Number(start.value),endHour:Number(end.value)}})});root.append(form);
  }
}
function settingsPage(root){
  root.append(node('h1','설정 / 사용량'),node('p',data.connection.accountLabel||'ChatGPT','hint'),action('설정과 사용량 새로 고침',()=>loadExtras()));
  const remember=node('input');remember.type='checkbox';remember.checked=rememberDevice;remember.addEventListener('change',()=>{try{rememberDevice=remember.checked;if(rememberDevice){localStorage.setItem(rememberFlag,'1');localStorage.setItem(rememberedKeyStorage,key)}else{localStorage.removeItem(rememberFlag);localStorage.removeItem(rememberedKeyStorage)}showNotice(rememberDevice?'이 기기에 연결을 보관했습니다.':'탭을 닫으면 연결 정보를 보관하지 않습니다.')}catch{rememberDevice=false;remember.checked=false;showNotice('이 브라우저에서 연결을 보관할 수 없습니다.')}});root.append(label('이 기기에서 연결 유지',remember),node('p','개인 기기에서만 켜세요. 알림으로 새 창을 열 때도 연결하며 데스크톱의 연결 종료로 언제든 취소할 수 있습니다.','hint'));
  if(!mobileSettings){root.append(node('p','설정을 불러오는 중입니다.','hint'));return}
  const form=node('form'),models=mobileSettings.models||[],model=select(models.map(m=>[m.id,m.displayName||m.id]),mobileSettings.model||models[0]?.id||''),effort=select([['low','낮음'],['medium','보통'],['high','높음'],['xhigh','매우 높음']],mobileSettings.effort||'medium'),answer=select([['short','짧게'],['normal','보통'],['detailed','자세히']],mobileSettings.chatDefaults?.answerLength||'normal');
  const tests=node('input'),ask=node('input'),compact=node('input');tests.type=ask.type=compact.type='checkbox';tests.checked=mobileSettings.chatDefaults?.testing!==false;ask.checked=mobileSettings.chatDefaults?.askNext===true;compact.checked=mobileSettings.chatDefaults?.autoCompact!==false;
  form.append(label('기본 ChatGPT 모델',model),label('추론 수준',effort),label('답변 길이',answer),label('작업 후 검증',tests),label('필요한 다음 질문',ask),label('문맥 자동 압축',compact));const save=node('button','기본 설정 저장','main-action');save.type='submit';save.disabled=busy||!models.length;form.append(save);form.addEventListener('submit',e=>{e.preventDefault();const value={model:model.value,effort:effort.value,chatDefaults:{answerLength:answer.value,testing:tests.checked,askNext:ask.checked,autoCompact:compact.checked}};void run(async()=>{await call('saveMobileSettings',value);await loadExtras();showNotice('기본 설정을 저장했습니다.')})});root.append(form);
  const usage=node('section',undefined,'box');usage.append(node('h2','계정 사용량'));if(!usageData)usage.append(node('p','현재 사용량을 읽지 못했습니다.','hint'));for(const b of usageData?.buckets||[]){usage.append(node('strong',[b.name,b.plan].filter(Boolean).join(' / ')));for(const w of b.windows){const progress=node('progress');progress.max=100;progress.value=w.usedPercent;progress.setAttribute('aria-label',b.name+' 사용량');usage.append(node('p',(w.minutes?Math.round(w.minutes/60)+'시간':'사용 구간')+' / '+Math.round(w.usedPercent)+'% 사용','hint'),progress);if(w.resetsAt)usage.append(node('small','초기화 '+date(w.resetsAt*1000)))}}root.append(usage);
  pushSettings(root);
}
function pushSettings(root){
  const box=node('section',undefined,'box');box.append(node('h2','이 기기 알림'),node('p','완료 / 결정 / 예약 알림을 받습니다. 작업 내용과 연결 키는 알림에 넣지 않습니다.','hint'));
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){box.append(node('p','이 브라우저는 웹 알림을 지원하지 않습니다. 아이폰에서는 홈 화면에 추가한 뒤 여세요.','hint'));root.append(box);return}
  const localId=sessionStorage.getItem('flowrium.mobile.pushId'),device=pushData?.devices.find(d=>d.id===localId);
  if(!device){const name=bindDraft(node('input'),'push/label','내 휴대폰');name.maxLength=80;box.append(label('알림 기기 이름',name));const subscribe=action('이 기기에서 알림 켜기',()=>{
    const permission=Notification.requestPermission();void run(async()=>{
      if(await permission!=='granted')throw Error('브라우저에서 알림을 허용해 주세요.');
      const prepared=await call('webPushAction',{action:'prepare'}),registration=await navigator.serviceWorker.ready;
      let existing=await registration.pushManager.getSubscription();if(existing)await existing.unsubscribe();
      const bytes=Uint8Array.from(atob(prepared.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
      try{const result=await call('webPushAction',{action:'subscribe',subscription:subscription.toJSON(),label:name.value,kinds:Object.keys(pushLabels)});sessionStorage.setItem('flowrium.mobile.pushId',result.id)}catch(e){await subscription.unsubscribe();throw e}
      await loadExtras();showNotice('이 기기의 알림을 등록했습니다.');
    });});subscribe.disabled=busy||pushData?.available===false;box.append(subscribe);
  }else{
    box.append(node('p',device.label));const chosen=new Set(device.kinds);
    for(const [kind,title]of Object.entries(pushLabels)){const check=node('input');check.type='checkbox';check.checked=chosen.has(kind);check.addEventListener('change',()=>check.checked?chosen.add(kind):chosen.delete(kind));box.append(label(title,check))}
    box.append(action('알림 종류 저장',()=>run(async()=>{await call('webPushAction',{action:'preferences',id:device.id,kinds:[...chosen]});await loadExtras()})),action('이 기기에 시험 알림 보내기',()=>run(async()=>{const result=await call('webPushAction',{action:'test',id:device.id});showNotice(result.sent?'알림 서버에 발송했습니다.':'발송을 확인하지 못했습니다.');await loadExtras()})),action('이 기기 알림 해제',()=>run(async()=>{await call('webPushAction',{action:'unsubscribe',id:device.id});const registration=await navigator.serviceWorker.ready;await(await registration.pushManager.getSubscription())?.unsubscribe();sessionStorage.removeItem('flowrium.mobile.pushId');await loadExtras();showNotice('기기 알림을 해제했습니다.')})));
    if(device.lastError)box.append(node('p',device.lastError,'hint'));
  }
  box.append(node('p','연결을 종료하거나 계정을 바꾸면 알림도 중지됩니다. 새 연결 주소에서는 기기를 다시 등록하세요.','hint'));root.append(box);
}

function render() {
  const active = document.activeElement,
    field = active?.dataset?.field;
  const start =
      field && "selectionStart" in active ? active.selectionStart : null,
    end = field && "selectionEnd" in active ? active.selectionEnd : null;
  const root = document.createDocumentFragment();
  navigation.hidden = !data || !!gate;
  for (const btn of navigation.querySelectorAll("button")) {
    const current =
      (["project", "new", "chat"].includes(route) ? "projects" : route) ===
      btn.dataset.view;
    if (current) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  if (!data || gate) {
    const title =
      gate === "locked"
        ? "작업 공간이 잠겼습니다"
        : !key
          ? "새 연결 주소가 필요합니다"
          : gate === "offline"
            ? "데스크톱에 연결할 수 없습니다"
            : "데스크톱 연결 중";
    const hint =
      gate === "locked"
        ? "데스크톱 Flowrium에서 잠금을 해제하면 이 화면이 다시 열립니다."
        : !key
          ? "데스크톱 설정에서 모바일 연결을 켜고 새 주소를 여세요."
          : "데스크톱의 모바일 연결과 네트워크를 확인하세요.";
    connection.textContent =
      gate === "locked" ? "잠김" : !key ? "연결 필요" : "연결 중";
    root.append(node("h1", title), node("p", hint, "hint"));
    if (key) root.append(action("다시 확인", () => poll()));
  } else if (route === "projects") projects(root);
  else if (route === "running") {
    root.append(node("h1", "실행 중인 업무"));
    const list = data.sessions.filter((s) => running(s.id));
    for (const s of list) root.append(sessionRow(s));
    if (!list.length)
      root.append(node("p", "실행 중인 업무가 없습니다.", "hint"));
  } else if (route === "approvals") {
    root.append(node("h1", "승인함"));
    approvals(data.approvals, root);
  } else if (route === "assistant") assistantPage(root);
  else if (route === "settings") settingsPage(root);
  else if (route === "project") projectPage(root);
  else if (route === "new") newWork(root);
  else if (route === "chat") chat(root);
  content.replaceChildren(root);
  if (field) {
    const next = [...content.querySelectorAll("[data-field]")].find(
      (el) => el.dataset.field === field,
    );
    if (next) {
      next.focus({ preventScroll: true });
      if (start !== null && typeof next.setSelectionRange === "function")
        next.setSelectionRange(start, end);
    }
  }
}
document.querySelector("#home").addEventListener("click", () => go("projects"));
for (const btn of navigation.querySelectorAll("button"))
  btn.addEventListener("click", () => go(btn.dataset.view));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll();
});
render();
async function initialize(){
  if(handoff){
    try{
      const response=await fetch('/api/mobile/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handoff}),credentials:'omit',referrerPolicy:'no-referrer'});
      const result=await response.json();if(!response.ok)throw Error(result.error||'연결 주소가 만료됐습니다.');
      key=result.key;try{sessionStorage.setItem(keyStorage,key);if(rememberDevice)localStorage.setItem(rememberedKeyStorage,key)}catch{}
    }catch(e){key=null;showNotice(e.message)}finally{handoff=null;render();}
  }
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
  void poll();
}
void initialize();
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='flowrium:notification'){go('assistant');void poll();}});
setInterval(() => void poll(), 2000);
