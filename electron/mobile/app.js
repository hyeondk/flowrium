const content = document.querySelector("#content");
const navigation = document.querySelector("#nav");
const connection = document.querySelector("#status");
const notice = document.querySelector("#notice");
const keyStorage = "flowrium.mobile.key";
let key = new URLSearchParams(location.hash.slice(1)).get("key");
try {
  if (key) sessionStorage.setItem(keyStorage, key);
  else key = sessionStorage.getItem(keyStorage);
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
const showNotice = (message) => {
  clearTimeout(errorTimer);
  notice.textContent = message;
  notice.hidden = false;
  errorTimer = setTimeout(() => {
    notice.hidden = true;
  }, 6000);
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
  box.append(field);
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
  selectedSession = selectedProject = "";
  route = "projects";
  notice.hidden = true;
  if (gate === "expired") {
    key = null;
    try {
      sessionStorage.removeItem(keyStorage);
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
      (event) => event.type === "approval" && event.requestId,
    );
    const fresh = JSON.stringify(next);
    const changed = gate || fresh !== signature;
    data = next;
    signature = fresh;
    gate = "";
    connection.textContent = data.connection?.authenticated
      ? "데스크톱 연결됨"
      : "계정 연결 필요";
    if (changed) render();
    if (route === "chat") {
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
  notice.hidden = true;
  if (view === "project") {
    selectedProject = id;
    detailTab = "work";
    teamBoard = files = undefined;
  }
  if (view === "chat") {
    selectedSession = id;
    selectedProject = session(id)?.projectId || selectedProject;
  }
  window.scrollTo(0, 0);
  render();
  if (view === "chat") void loadMessages();
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
function approvals(list, root) {
  if (!list.length)
    root.append(node("p", "대기 중인 승인 요청이 없습니다.", "hint"));
  for (const entry of list) {
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
  for (const t of teamBoard.teams)
    root.append(
      node("p", t.name + " / " + t.roles.map((r) => r.name).join(" / "), "box"),
    );
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
    root.append(block);
  }
  if (running(s.id)) {
    const stop = action("작업 중단", () => run(() => call("interrupt", s.id)));
    stop.disabled = busy;
    root.append(node("p", "데스크톱에서 실행 중입니다.", "hint"), stop);
    return;
  }
  const form = node("form"),
    draftId = "chat/" + s.id,
    text = bindDraft(node("textarea"), draftId, "");
  text.required = true;
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
  const submit = node("button", "요청 보내기", "main-action");
  submit.type = "submit";
  submit.disabled = busy || !data.connection?.authenticated;
  form.append(label("요청", text), label("작업 모드", mode), submit);
  if (!data.connection?.authenticated)
    form.append(
      node("p", "데스크톱 설정에서 본인의 ChatGPT 계정을 연결하세요.", "hint"),
    );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = text.value.trim();
    if (!value) return;
    void run(async () => {
      await call("send", {
        sessionId: s.id,
        text: value,
        mode: mode.value,
        model: s.preferences?.model || data.settings.model,
        effort: s.preferences?.effort || data.settings.effort,
      });
      drafts.delete(draftId);
      showNotice("요청을 보냈습니다.");
    });
  });
  root.append(form);
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
  } else if (route === "project") projectPage(root);
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
void poll();
setInterval(() => void poll(), 2000);
