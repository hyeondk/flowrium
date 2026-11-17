import {maxChatInput,nativeQueueAction,nativeQueueQuestion,nativeQueueExplanation,nativeQueueNotice,queuedInputView,clearQueueAction,clearQueueQuestion,clearQueueExplanation} from './chat-input.js';
import {uploadText,discardUpload} from './request-upload.js';
import {attachDraftEditor} from './draft-editor-events.js';
import {originalAnswerFollowups} from './answer-followup.js';
import {presentCitations} from './file-citations.js';
import {projectMode} from './project-mode.js';
import {creditBalance} from './usage-credits.js';
import {attachComposerMarkdown} from './composer-markdown.js';
import {attachmentDisplayText} from './attachment-text.js';
import {markdownBody,groupMobileHistory,progressButton,clearProgressChoices} from './chat-reader.js';
import {installDatePicker} from './date-picker.js';
import {settingsGuides, reconnectForm} from './install.js';
import {mobileUpdateSection, resetUpdate, resumeUpdateSettings} from './mobile-update.js';
import {confirmationButton, reconcileConfirmation} from './confirmation.js';
import {modelDisplayName,effortDisplayName,reasoningEffortOptions} from './model-display.js';
const content = document.querySelector("#content");
const loadingTemplate = content.querySelector('.mobile-skeleton').cloneNode(true);
const navigation = document.querySelector("#nav");
const connection = document.querySelector("#status");
installDatePicker();
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
const executionNames = {running:'작업중',waiting:'대기',decision:'결정'};
let data,
  route = resumeUpdateSettings() ? "settings" : "projects",
  statusFilter = "running",
  chatOriginStatus = "",
  selectedProject = "",
  selectedSession = "",
  detailTab = "work";
let teamBoard,
  files,
  preview,
  assetRequest = 0, pendingAssetRequest,
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
const draftPages = new Map();
const questionDrafts = new Map();
const selectedProposals = new Map();
const shownFolderGuides = new Set();
const attachedDrafts = new Map(), attachmentPreviews = new Map(), attachmentFlights = new Map(), missingCitations=new Set();
let photoObserver;
let queueItems=[],workflowData,mobileSettings,usageData,pushData,extrasEpoch=0;
const pendingExtras = new Map();
const loadErrors = new Map();
let settingsDraft;
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
function loadingRegion(name, layout = 'rows') {
  const error = loadErrors.get(name);
  if (error) return node('p', error, 'hint');
  const region = loadingTemplate.cloneNode(true);
  region.dataset.layout = layout;
  region.setAttribute('aria-label', name + ' 불러오는 중');
  return region;
}
let noticeExitTimer;
const hideNotice = () => {
  clearTimeout(errorTimer);
  clearTimeout(noticeExitTimer);
  if (notice.hidden) return;
  notice.dataset.phase = "exit";
  noticeExitTimer = setTimeout(() => { notice.hidden = true; }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 240);
};
const showNotice = (message, tone = "info") => {
  notice.dataset.tone = tone;
  notice.setAttribute("role", tone === "error" ? "alert" : "status");
  clearTimeout(errorTimer);
  clearTimeout(noticeExitTimer);
  notice.textContent = message;
  notice.hidden = false;
  notice.dataset.phase = "enter";
  errorTimer = setTimeout(hideNotice, 6000);
};
const submissionReceipts=new Map();
const textUploads=new Map();
function longSubmission(sessionId,text){
  if(text.length<=maxChatInput)return {};
  const prior=submissionReceipts.get(sessionId);
  if(prior?.text===text)return {submissionId:prior.id};
  if(prior?.chunked)discardUpload(sessionId,prior.id,key);
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  const id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');submissionReceipts.set(sessionId,{id,text});
  return {submissionId:id};
}
function clearSentDraft(id,sent,files){
  const draftId='chat/'+id;
  if(drafts.get(draftId)===sent){drafts.delete(draftId);draftPages.delete(draftId);}
  const ids=new Set(files.map(file=>file.id));
  const remaining=(attachedDrafts.get(id)||[]).filter(file=>!ids.has(file.id));
  if(remaining.length)attachedDrafts.set(id,remaining);else attachedDrafts.delete(id);
  const receipt=submissionReceipts.get(id);
  if(receipt?.text===sent){if(receipt.chunked)discardUpload(id,receipt.id,key);submissionReceipts.delete(id);}
}
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
let dashboardFacts, dashboardFetched=0, dashboardRequest;
async function loadDashboard(retry=false){
  if(route!=='projects' || gate || !data || dashboardRequest || (!retry && Date.now()-dashboardFetched<15000))return;
  const epoch=accessEpoch;
  if(retry && loadErrors.delete('오늘 할 일')) render();
  const work=request('/api/mobile/dashboard');dashboardRequest=work;
  try {
    const facts=await work;
    if(accessEpoch!==epoch)return;
    const changed=loadErrors.delete('오늘 할 일') || JSON.stringify(facts)!==JSON.stringify(dashboardFacts);
    dashboardFacts=facts;
    if(changed && route==='projects')render();
  } catch(error){
    if(epoch!==accessEpoch)return;
    if(error.gate)clearPrivateState(error.gate);
    else if(!dashboardFacts){
      loadErrors.set('오늘 할 일','오늘 할 일을 불러오지 못했습니다.');
      if(route==='projects')render();
    }
  }
  finally{if(dashboardRequest===work){dashboardRequest=undefined;dashboardFetched=Date.now();}}
}
function applyAppearance(settings={}) {
  const html=document.documentElement, dark=settings.theme==='dark';
  html.dataset.theme=dark?'dark':'light';
  html.dataset.accent=['blue','green','purple'].includes(settings.accentColor)?settings.accentColor:'blue';
  document.querySelector('meta[name="theme-color"]').content=dark?'#18212b':'#ffffff';
}
function clearPrivateState(nextGate) {
  shownFolderGuides.clear();
  if(nextGate==='expired'){clearProgressChoices();applyAppearance();}

  document.querySelector('dialog.citation-zoom[open]')?.close();
  for(const flight of textUploads.values())flight.abort.abort();
  textUploads.clear();
  submissionReceipts.clear();
  resetUpdate();
  connection.removeAttribute('data-connected');
  loadErrors.clear();
  pendingExtras.clear();
  dashboardFacts=undefined;dashboardRequest=undefined;dashboardFetched=0;
  accessEpoch++;
  resetHistory();
  gate = nextGate;
  data = undefined;
  teamBoard = files = preview = undefined;
  assetRequest++;
  signature = "";
  drafts.clear();
  draftPages.clear();
  questionDrafts.clear();
  selectedProposals.clear();
  attachedDrafts.clear();missingCitations.clear();attachmentPreviews.clear();attachmentFlights.clear();queueItems=[];workflowData=mobileSettings=usageData=pushData=undefined;chatModels=chatModelRequest=undefined;extrasEpoch++;
  settingsDraft=undefined;
  selectedSession = selectedProject = "";
  statusFilter = "running";
  chatOriginStatus = "";
  route = "projects";
  routePositions.clear();
  recentRoutes.length = 0;
  browserRoutes.splice(0, browserRoutes.length, routeEntry());
  routeIndex = 0;
  history.replaceState({flowriumIndex:0},'');
  clearTimeout(errorTimer);
  clearTimeout(noticeExitTimer);
  notice.hidden = true;
  notice.textContent = '';
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
    applyAppearance(next.settings);
    signature = fresh;
    gate = "";
    connection.toggleAttribute('data-connected', Boolean(data.connection?.authenticated));
    connection.textContent = data.connection?.authenticated
      ? "데스크톱 연결됨"
      : "계정 연결 필요";
    if (changed) render();
    if(route==="projects") void loadDashboard();
    if (["assistant","settings"].includes(route)) void loadExtras(false);
    if (route === "chat") {
      void loadQueue();
      const current = session(selectedSession);
      if (!current) go("projects");
      else if (
        !historyError &&
        (!historyPage ||
          current.messageCount !== historyPage.total ||
          current.revision !== historyPage.revision ||
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
      connection.removeAttribute('data-connected');
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
    else showNotice(error.message, "error");
  } finally {
    busy = false;
    render();
  }
}
const routePositions = new Map(), recentRoutes=[],browserRoutes=[];
let routeIndex=0;
history.scrollRestoration='manual';
history.replaceState({flowriumIndex:0},'');
browserRoutes.push(routeEntry());
addEventListener('popstate',event=>{
  const index=event.state?.flowriumIndex,entry=browserRoutes[index];
  if(!entry || !data || gate || !Number.isInteger(index))return;
  const back=index<routeIndex;
  if(back)recentRoutes.splice(Math.max(0,recentRoutes.length-(routeIndex-index)));
  go(entry.view,entry.id,{back,tab:entry.tab,historyIndex:index});
});
function routeEntry() {
  return {view:route,id:route==='project'||route==='new'?selectedProject:route==='chat'?selectedSession:route==='status'?statusFilter:'',tab:detailTab};
}
const routeKey = entry => entry.view+'|'+(entry.id||'');
function goBack(fallback,id) {
  const entry=recentRoutes.pop();
  if(entry){
    if(routeIndex>0 && routeKey(browserRoutes[routeIndex-1])===routeKey(entry)){recentRoutes.push(entry);history.back();return;}
    go(entry.view,entry.id,{back:true,tab:entry.tab});
  }
  else go(fallback,id,{back:true});
}
function go(view, id, options={}) {
  const previous=routeEntry(),focus=document.activeElement?.closest('.row');
  browserRoutes[routeIndex]=previous;
  routePositions.set(routeKey(previous),{y:scrollY,row:focus?[...content.querySelectorAll('.row')].indexOf(focus):-1});
  if(['chat','project','new','status'].includes(view) && !options.replace && !options.back && routeKey(previous)!==routeKey({view,id}))recentRoutes.push(previous);
  else if(!options.back && !['chat','project','new','status'].includes(view))recentRoutes.length=0;
  if(recentRoutes.length>35)recentRoutes.shift();

  assetRequest++;
  if(view==='chat')chatOriginStatus=route==='status'?statusFilter:'';
  const previousRoute=route,previousSession=selectedSession;
  if (previousRoute==='assistant' && view!=='assistant') selectedProposals.clear();
  if(previousRoute==='settings' && view!=='settings')settingsDraft=undefined;
  route = view;
  if(view==='status') statusFilter=id;
  resetHistory();
  preview = undefined;
  hideNotice();
  if (view === "project") {
    selectedProject = id;
    detailTab = options.tab || "work";
    teamBoard = files = undefined;
    loadErrors.delete('팀'); loadErrors.delete('문서');
  }
  if (view === "chat") {
    selectedSession = id;
    queueItems=[];
    selectedProject = session(id)?.projectId || selectedProject;
  }
  if(Number.isInteger(options.historyIndex))routeIndex=options.historyIndex;
  else if(routeKey(previous)!==routeKey(routeEntry())){
    if(!options.replace)routeIndex++;
    browserRoutes.splice(routeIndex);
    history[options.replace?'replaceState':'pushState']({flowriumIndex:routeIndex},'');
  }
  browserRoutes[routeIndex]=routeEntry();
  render();
  if(['project','new','chat'].includes(view)) {
    const id=view==='chat'?session(selectedSession)?.projectId:selectedProject;
    if(id && project(id)?.trustedForFileAccess===false && !shownFolderGuides.has(id) && openFolderGuide(id))shownFolderGuides.add(id);
  }
  if(view==='project' && detailTab!=='work')void loadAssets(false);
  const restored=options.back && routePositions.get(routeKey(routeEntry()));
  window.scrollTo({top:restored?.y||0,behavior:'instant'});
  if(restored?.row>=0)content.querySelectorAll('.row')[restored.row]?.focus({preventScroll:true});
  if(previousRoute!==view || view==='chat' && previousSession!==id){
    content.getAnimations().forEach(animation=>animation.cancel());
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches) content.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'none'}],
      {duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  if (view === "chat") {void loadMessages();void loadQueue();void loadChatModels();}
  if (view === "projects") void loadDashboard();
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
  const query = new URLSearchParams({ limit: "50", progress: "1" });
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
  if (!announce && pendingAssetRequest === assetRequest) return;
  const id = ++assetRequest,
    tab = detailTab, label = tab === 'team' ? '팀' : '문서';
  pendingAssetRequest = id;
  if (announce && loadErrors.delete(label)) render();
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
    loadErrors.delete(label);
    render();
  } catch (error) {
    if (id !== assetRequest) return;
    if (error.gate) clearPrivateState(error.gate);
    else if (tab === 'team' ? !teamBoard : !files) {
      loadErrors.set(label, label + ' 정보를 불러오지 못했습니다.');
      render();
    } else if (announce) showNotice(error.message, "error");
  } finally {
    if(pendingAssetRequest===id)pendingAssetRequest=undefined;
  }
}
function openTab(tab) {
  assetRequest++;
  detailTab = tab;
  preview = undefined;
  render();
  if (tab === "team" || tab === "files") void loadAssets();
}
function sessionRow(s) {
  return row(
    s.title,
    [project(s.projectId)?.name,kinds[s.workflow?.kind] || "대화", date(s.updatedAt)].filter(Boolean).join(" / "),
    () => go("chat", s.id),
    executionNames[s.executionState],
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
        showNotice("각 질문에 답해 주세요.", "error");
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
  const today = new Date();
  const header = node('header', undefined, 'page-heading');
  const calendar = node('time', new Intl.DateTimeFormat('ko-KR', {month:'long',day:'numeric',weekday:'short'}).format(today));
  header.append(calendar,node('h1','대시보드'));
  const overview = node('section', undefined, 'workspace-overview');
  overview.append(header);
  const status=node('section',undefined,'mobile-execution');
  status.setAttribute('aria-label','프로젝트 대화 진행 상태');
  for(const [key,name] of Object.entries(executionNames)){
    const count=data.sessions.filter(s=>s.executionState===key).length;
    const button=action('',()=>go('status',key));
    button.dataset.state=key;button.setAttribute('aria-label',name+' 대화 '+count+'개');
    button.append(node('span',name),node('strong',String(count)));status.append(button);
  }
  overview.append(status);
  root.append(overview);
  const tasks=node('section',undefined,'mobile-today'),todo=data.sessions
    .filter(s=>s.workflow && s.workflow.status!=='done')
    .sort((a,b)=>Number(b.executionState==='decision')-Number(a.executionState==='decision')||b.updatedAt.localeCompare(a.updatedAt));
  tasks.append(node('h2','오늘 할 일'));
  const {due=[],goals=[],phases={}}=dashboardFacts||{};
  for(const item of due.slice(0,3))if(project(item.projectId))tasks.append(row(project(item.projectId).name,item.due,()=>go('project',item.projectId),item.due===dashboardFacts.today?'오늘 기한':'기한 경과'));
  for(const item of goals.slice(0,5))if(project(item.projectId))tasks.append(row(item.text,project(item.projectId).name,()=>go('project',item.projectId),item.target!=null?(item.current||0)+' / '+item.target:'목표'));
  for(const s of todo.slice(0,3))tasks.append(row(s.workflow.nextTask||s.title,project(s.projectId)?.name,()=>go('chat',s.id),executionNames[s.executionState]));
  if(!dashboardFacts){
    tasks.append(loadingRegion('오늘 할 일'));
    if(loadErrors.has('오늘 할 일'))tasks.append(action('오늘 할 일 다시 불러오기',()=>loadDashboard(true)));
  }else if(!todo.length && !due.length && !goals.length)tasks.append(node('p','진행할 업무가 없습니다.','hint'));
  const projectList = node('section', undefined, 'mobile-list-panel');
  const projectsHeading=node('header',undefined,'list-heading');
  projectsHeading.append(node('h2','프로젝트 현황'),node('small',data.projects.length+'개'));
  projectList.append(projectsHeading);
  root.append(tasks,projectList,activityChart());
  if(Object.keys(phases).length){
    const counts=node('p',undefined,'hint');
    counts.textContent=Object.entries(phases).map(([phase,count])=>phase+' '+count+'개').join(' / ');
    projectList.append(counts);
  }
  if (!data.projects.length)
    projectList.append(
      node(
        "p",
        "데스크톱의 프로젝트 추가에서 작업할 폴더를 지정하세요.",
        "hint",
      ),
    );
  for (const p of data.projects) {
    const list = data.sessions.filter((s) => s.projectId === p.id);
    projectList.append(
      row(
        p.name,
        "업무 " + list.length + "개",
        () => go("project", p.id),
        list.some(s=>s.executionState==='decision') ? '결정' : list.some(s=>s.executionState==='running') ? '작업중' : list.some(s=>s.executionState==='waiting') ? '대기' : undefined,
      ),
    );
  }
}
function activityChart(){
  const chart=node('section',undefined,'activity-chart'), days=[];
  for(let offset=6;offset>=0;offset--){
    const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-offset);
    const next=new Date(day);next.setDate(next.getDate()+1);
    const during=value=>value&&Date.parse(value)>=day.getTime()&&Date.parse(value)<next.getTime();
    days.push({day,started:data.sessions.filter(s=>during(s.createdAt)).length,done:data.sessions.filter(s=>during(s.workflow?.completedAt)).length});
  }
  chart.append(node('h2','최근 7일 업무 흐름'));
  const bars=node('ol'),peak=Math.max(1,...days.flatMap(d=>[d.started,d.done]));
  for(const {day,started,done} of days){
    const label=day.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'});
    const cell=node('li'),pair=node('div',undefined,'bars');
    cell.setAttribute('aria-label',label+' 시작 '+started+'개 / 완료 '+done+'개');cell.title=cell.getAttribute('aria-label');
    for(const [key,value] of [['started',started],['done',done]]){
      const bar=node('meter');bar.min=0;bar.max=peak;bar.value=value;bar.className=key;
      bar.setAttribute('aria-hidden','true');pair.append(bar);
    }
    cell.append(pair,node('small',String(day.getDate())+'일'));bars.append(cell);
  }
  const legend=node('p',undefined,'chart-legend');
  legend.append(node('span','시작','started'),document.createTextNode(' / '),node('span','완료','done'));
  chart.append(bars,legend);
  return chart;
}
function statusPage(root){
  const label=executionNames[statusFilter];root.append(action('대시보드로',()=>goBack('projects')),node('h1',label+' 대화'));
  const list=data.sessions.filter(s=>s.executionState===statusFilter).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  if(list.length) root.append(sessionList(list));
  if(!list.length)root.append(node('p',label+' 상태의 대화가 없습니다.','hint'));
}
function sessionList(sessions) {
  const list = node('div', undefined, 'mobile-list-panel session-list');
  for (const session of sessions) list.append(sessionRow(session));
  return list;
}
function team(root) {
  const reset = action("팀 상태 새로 고침", () => loadAssets());
  root.append(reset);
  if (!teamBoard) { root.append(loadingRegion('팀')); return; }
  root.append(action('새 팀 만들기',()=>{editingTeam='new';teamDraft={name:'',roles:[{name:'',instruction:'',mode:'plan'},{name:'',instruction:'',mode:'review'}]};render()}));
  if(editingTeam) teamEditor(root);
  for (const t of teamBoard.teams){
    const card=node('section',undefined,'box');
    card.append(node('p',t.name+' / '+t.roles.map(r=>r.name).join(' / ')),action(t.name+' 편집',()=>{editingTeam=t.id;teamDraft=structuredClone(t);render()}));
    const form=node('form'),goal=bindDraft(node('textarea'),'teamGoal/'+t.id,''),strategy=bindDraft(select([['plan','AI가 역할별 계획 배정'],['manual','역할 지시로 직접 배정']],'plan'),'teamStrategy/'+t.id,'plan');goal.required=true;goal.maxLength=12000;
    const isolate=node('input');isolate.type='checkbox';isolate.checked=drafts.get('teamIsolate/'+t.id)===true;isolate.addEventListener('change',()=>drafts.set('teamIsolate/'+t.id,isolate.checked));form.append(label(t.name+'의 목표',goal),label('배정 방식',strategy),label('역할별 Git 작업 공간 분리',isolate));
    const start=node('button','팀 업무 시작','main-action');start.type='submit';start.disabled=busy;form.append(start);
    form.addEventListener('submit',e=>{e.preventDefault();if(!mayStartProjectWork(selectedProject))return;const prompt=goal.value.trim(),method=strategy.value;void run(async()=>{const options={strategy:method,isolate:isolate.checked,autoReport:true,autoDispatch:method==='plan',autoPM:true,autoQA:true,autoIntegrate:false};if(method==='manual'){options.assignments=t.roles.map((r,index)=>({index,title:r.name,task:prompt+'\n'+r.instruction,steps:[]}));if(options.assignments.some(a=>a.task.length>6000))throw Error('직접 배정할 목표와 역할 지시를 합해 6,000자 이내로 입력하세요.');}await call('directTeam',selectedProject,t.id,prompt,crypto.randomUUID(),options);drafts.delete('teamGoal/'+t.id);await loadAssets();showNotice('팀 업무를 시작했습니다.')})});card.append(form);root.append(card);
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
        assetRequest++;
        preview = undefined;
        render();
      }),
      node("h2", preview.name),
      preview.loading ? loadingRegion('문서 내용') : node("pre", preview.body, "body box"),
    );
    return;
  }
  root.append(action("문서 새로 고침", () => loadAssets()));
  if (!files) { root.append(loadingRegion('문서')); return; }
  if (!files.artifacts.length)
    root.append(node("p", "아직 저장한 문서가 없습니다.", "hint"));
  for (const file of files.artifacts) {
    const item = row(
      file.path.split("/").pop(),
      file.path,
      () =>
        run(async () => {
          const id = ++assetRequest;
          preview = {name:file.path, loading:true};
          render();
          try {
            const body = await call("readWorkArtifact", selectedProject, file.path);
            if (id === assetRequest) preview = {name:file.path, body};
          } catch (error) {
            if (id !== assetRequest) return;
            preview = undefined;
            throw error;
          }
        }),
      file.preview ? "미리보기" : "데스크톱에서 열기",
    );
    item.disabled = !file.preview || busy;
    root.append(item);
  }
}
function folderGuide(root,p) {
  if(!p || p.trustedForFileAccess===true)return;
  const title=p.trustedForFileAccess===false?'컴퓨터에서 프로젝트를 신뢰해 주세요':'컴퓨터 앱을 업데이트해 주세요';
  const description=p.trustedForFileAccess===false
    ? '컴퓨터의 Flowrium에서 ‘'+p.name+'’ 프로젝트에 첫 작업을 보내면 폴더 경로가 표시됩니다. 경로를 확인하고 ‘신뢰하고 편집 허용’을 누른 뒤 이 화면에서 요청을 보내세요.'
    : '이 컴퓨터의 Flowrium을 업데이트한 뒤 프로젝트 폴더를 확인하세요. 작성한 요청은 이 화면에 남아 있습니다.';
  const box=node('aside',undefined,'folder-guide');
  const guide=confirmationButton('확인 방법','folder-trust/'+p.id,title,description);
  box.append(node('span',title),guide);root.append(box);
}
function openFolderGuide(id) {
  const trigger=content.querySelector('[data-confirm-action="folder-trust/'+CSS.escape(id)+'"]');
  if(!trigger)return false;
  trigger.click();return true;
}
function mayStartProjectWork(id) {
  if(project(id)?.trustedForFileAccess===true)return true;
  if(!openFolderGuide(id))showNotice('컴퓨터의 Flowrium에서 프로젝트 폴더를 먼저 신뢰해 주세요.');
  return false;
}
function projectPage(root) {
  const p = project(selectedProject);
  if (!p) return projects(root);
  root.append(
    action("프로젝트 목록으로", () => goBack("projects")),
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
  folderGuide(root,p);
  if (detailTab === "team") return team(root);
  if (detailTab === "files") return artifacts(root);
  const list = ownSessions()
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  root.append(action("새 업무 대화", () => go("new"), "main-action"));
  if (!list.length)
    root.append(node("p", "이 프로젝트에서 맡길 첫 업무를 고르세요.", "hint"));
  if (list.length) root.append(sessionList(list));
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
    action("프로젝트로", () => goBack("project", p.id)),
    node("h1", "새 업무 대화"),
  );
  folderGuide(root,p);
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
    if(!mayStartProjectWork(p.id))return;
    void run(async () => {
      const s = await call("startWork", values);
      data.sessions = [s, ...data.sessions.filter((v) => v.id !== s.id)];
      if (values.brief) drafts.set("chat/" + s.id, values.brief);
      for (const k of ["kind", "title", "brief"]) drafts.delete(prefix + k);
      go("chat", s.id,{replace:true});
    });
  });
  root.append(form);
}
let chatModelRequest,chatModels;
async function loadChatModels(){
  if(chatModels?.length || mobileSettings?.models?.length || chatModelRequest || gate || !data?.connection?.authenticated)return;
  const epoch=accessEpoch,request=call('mobileSettings');chatModelRequest=request;
  try{
    const catalog=await request;
    if(epoch===accessEpoch){chatModels=catalog.models;if(route==='chat')render();}
  }catch(error){if(epoch===accessEpoch&&error.gate)clearPrivateState(error.gate);}
  finally{if(chatModelRequest===request)chatModelRequest=undefined;}
}
function chatModelPicker(s){
  const models=mobileSettings?.models||chatModels||[],own=s.preferences?.model||'';
  const inherited=data.settings.model||models.find(m=>m.isDefault)?.id;
  const name=id=>modelDisplayName(models.find(row=>row.id===id)||id);
  const options=[['',inherited?'기본 설정 따르기 ('+name(inherited)+')':'기본 설정 따르기']];
  if(own&&!models.some(m=>m.id===own))options.push([own,name(own)]);
  for(const model of models)options.push([model.id,modelDisplayName(model)]);
  const picker=select(options,own);
  picker.disabled=busy||(!own&&!models.length);
  picker.addEventListener('change',()=>{
    const value=picker.value;
    void run(async()=>{
      const saved=await call('setMobileChatModel',s.id,value);
      const current=session(s.id);
      if(current)current.preferences={...current.preferences,model:saved.model||undefined};
    });
  });
  return label('이 채팅의 모델',picker);
}
function chat(root) {
  const s = session(selectedSession);
  if (!s) return projects(root);
  const heading=node('header',undefined,'mobile-chat-heading'),origin=recentRoutes.at(-1);
  const backLabel=origin?.view==='projects'?'대시보드로':chatOriginStatus?executionNames[chatOriginStatus]+' 대화 목록으로':'프로젝트로';
  const back=action('',()=>goBack('project',s.projectId));back.setAttribute('aria-label',backLabel);back.title=backLabel;
  heading.append(back,node('h1',s.title));
  root.append(heading,node('p',(project(s.projectId)?.name||'')+' / '+(kinds[s.workflow?.kind]||'대화'),'chat-context'));
  if(!s.scope)folderGuide(root,project(s.projectId));
  const pending = data.approvals.filter((a) => a.sessionId === s.id);
  if (pending.length) approvals(pending, root);
  if (historyError) {
    root.append(
      node("p", historyError, "hint"),
      action("기록 다시 불러오기", () => loadMessages()),
    );
  } else if (!historyPage)
    root.append(loadingRegion('최근 메시지', 'chat'));
  if (historyPage?.before) {
    const more = action("이전 메시지 더 보기", () => loadMessages(true));
    more.disabled = historyBusy;
    root.append(more);
  }
  const timeline=groupMobileHistory(historyPage?.messages||[],s,running(s.id));
  const history=node('div',undefined,'mobile-timeline');root.append(history);
  for (const row of timeline.rows) {
    if(row.group){history.append(progressButton(row.group));continue;}
    const m=row.message;
    const block = node("article", undefined, "message");
    block.dataset.role = m.role;
    block.dataset.messageId = m.id;
    const citations=presentCitations(m.text||'',m.role,running(s.id)&&m.id===s.lastMessageId);

    block.append(
      node(
        "small",
        (m.role === "user" ? "나" : m.role === "assistant" ? "Codex" : "작업 상태") + " / " + date(m.createdAt),
      ),
      markdownBody(m.role==='user'&&!m.attachmentHeaderRemoved?attachmentDisplayText(citations.text):citations.text),
    );
    const cited=new Set(citations.references?.map(ref=>ref.attachmentId).filter(Boolean));
    appendAttachments(block,(m.attachments||[]).filter(file=>!cited.has(file.id)),s.projectId,m.id);
    for(const group of citations.groups)block.append(citationCard(s,m,group));
    if(m.sourceOnly){
      const details=node('details'),summary=node('summary','요청 원문 읽기'),body=node('p'),buttons=node('div',undefined,'actions');
      let offset=0,next=null;const previous=[];
      const load=async()=>{const page=await call('readRequestSource',s.id,m.id,offset);body.textContent=page.text;next=page.next;back.disabled=!previous.length;forward.disabled=next===null;};
      const back=action('이전 부분',async()=>{if(previous.length){offset=previous.pop();await load().catch(e=>showNotice(e.message,'error'));}});
      const forward=action('다음 부분',async()=>{if(next!==null){previous.push(offset);offset=next;await load().catch(e=>showNotice(e.message,'error'));}});
      body.style.whiteSpace='pre-wrap';body.style.overflowWrap='anywhere';buttons.append(back,forward);details.append(summary,body,buttons);
      details.addEventListener('toggle',()=>{if(details.open && !body.textContent)load().catch(error=>showNotice(error.message,'error'));});
      block.append(details);
    }
    history.append(block);
  }
  if (running(s.id)) {
    const stop = confirmationButton('작업 중단', 'interrupt/' + s.id, '실행 중인 작업을 중단할까요?', s.title, () =>
      run(async () => { await call('interrupt', s.id); showNotice('작업 중단을 요청했습니다.'); }));
    stop.disabled = busy;
    root.append(stop);
  }
  if(queueItems.length){
    const queue=node("section",undefined,"box");
    queue.append(node("h2","추가 지시 대기열"));
    const firstPending=queueItems.find(row=>row.status==='queued'||row.status==='sending');
    for(const item of queueItems){
      const line=node("div",undefined,"queue-line");
      const view=queuedInputView(item);
      line.append(node("p",item.text||"첨부 요청","body"),node("small",view.status));
      if(view.hint)line.append(node("p",view.hint,"hint"));
      if(item.error)line.append(node("p",item.error,"hint"));
      if(view.canCancel)line.append(confirmationButton('이 지시 취소','queue/'+item.id,'대기 중인 지시를 취소할까요?',item.text||'첨부 요청',()=>
        run(async()=>{await call('cancelQueuedMessage',s.id,item.id);await loadQueue();showNotice('대기 중인 지시를 취소했습니다.');})));
      if(view.canSendToCodex&&item.id===firstPending?.id)line.append(confirmationButton(nativeQueueAction,'send-to-codex/'+s.id+'/'+item.id,nativeQueueQuestion,nativeQueueExplanation,()=>
        run(async()=>{if(!mayStartProjectWork(s.projectId))return;const result=await call('sendQueuedToCodex',s.id,item.id);await loadQueue();if(result.accepted)showNotice(nativeQueueNotice(result));})));
      if(view.canClear)line.append(confirmationButton(clearQueueAction,'clear-codex-queue/'+s.id+'/'+item.id,clearQueueQuestion,clearQueueExplanation,()=>
        run(async()=>{await call('clearUnconfirmedCodexQueue',s.id,item.id);await loadQueue();})));
      queue.append(line);
    }
    if(queueItems.some(item=>queuedInputView(item).canResume))queue.append(action("대기 지시 이어 보내기",()=>run(async()=>{if(!mayStartProjectWork(s.projectId))return;await call("resumeQueuedMessages",s.id);await loadQueue()})));
    root.append(queue);
  }
  const form = node("form",undefined,"chat-compose"),draftId = "chat/" + s.id;
  const oldInput=content.querySelector('.markdown-input > textarea');
  const text=oldInput?.dataset.field===draftId ? oldInput : node('textarea');
  text.dataset.field=draftId;
  const fullText=()=>drafts.get(draftId)||'';
  const listener={signal:chatRenderEvents.signal};

  const mode = projectMode(s);
  text.addEventListener('input',()=>{
    const previous=submissionReceipts.get(s.id);
    if(!busy && previous && previous.text!==fullText()){
      if(previous.chunked)discardUpload(s.id,previous.id,key);
      submissionReceipts.delete(s.id);
    }
  },listener);
  const canSteer = running(s.id) && data.canSteer;
  const submit = node("button", canSteer ? "현재 작업에 전달" : running(s.id) ? "추가 지시 대기열에 넣기" : "요청 보내기", "main-action");
  submit.type = "submit";
  submit.disabled = busy || !data.connection?.authenticated;
  const options=node('div',undefined,'chat-options');
  const modelPicker=chatModelPicker(s);modelPicker.firstChild.remove();options.append(modelPicker);
  const textLabel=label('요청',text),editor=node('span',undefined,'markdown-input');
  const ink=node('span',undefined,'markdown-input-ink');ink.setAttribute('aria-hidden','true');
  text.replaceWith(editor);editor.append(text,ink);
  text.rows=1;text.placeholder='이어서 요청하세요';textLabel.firstChild.remove();
  form.append(textLabel);
  const pages=node('div',undefined,'mobile-draft-pages');
  const previousPage=action('이전',()=>mobileDraftEditor.go(pageNumber-1));
  const nextPage=action('다음',()=>mobileDraftEditor.go(pageNumber+1));
  previousPage.setAttribute('aria-label','원문 이전 구간');nextPage.setAttribute('aria-label','원문 다음 구간');
  const position=node('input'),countLabel=node('span');
  position.type='text';position.inputMode='numeric';position.setAttribute('aria-label','원문 편집 구간');
  let pageNumber=draftPages.get(draftId)||0;
  const goToTypedPage=()=>{const value=Number(position.value);if(Number.isSafeInteger(value)&&value>=1)mobileDraftEditor.go(value-1);else position.value=String(pageNumber+1);};
  position.addEventListener('change',goToTypedPage);
  position.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();goToTypedPage();text.focus({preventScroll:true});}});
  pages.append(node('span','원문 편집'),previousPage,position,countLabel,nextPage);form.append(pages);
  const requestedPage=pageNumber;
  const updatePage=({page,count})=>{
      pageNumber=page;pages.hidden=count===1;
      if(count>1)draftPages.set(draftId,page);else draftPages.delete(draftId);
      position.value=String(page+1);countLabel.textContent='/ '+count;
      previousPage.disabled=page===0;nextPage.disabled=page+1>=count;
  };
  pages.append(action('전체 선택',()=>mobileDraftEditor.selectAll()),action('전체 복사',async()=>{
    try{await navigator.clipboard.writeText(fullText());showNotice('원문 전체를 복사했습니다.');}
    catch{showNotice('클립보드에 복사할 수 없습니다. 브라우저의 클립보드 접근을 확인해 주세요.','error');}
  }));
  if(mobileDraftSurface?.input!==text){
    mobileDraftEditor?.dispose();
    const surface={input:text,update:updatePage};
    mobileDraftSurface=surface;
    mobileDraftEditor=attachDraftEditor(text,{
      read:fullText,change:value=>drafts.set(draftId,value),
      render:view=>{surface.view=view;surface.update(view);}
    });
    if(requestedPage)mobileDraftEditor.go(requestedPage);
  }else{
    mobileDraftSurface.update=updatePage;
    mobileDraftEditor.refresh();updatePage(mobileDraftSurface.view);
  }
  const uploadStatus=node('div',undefined,'text-upload-status');
  uploadStatus.dataset.uploadStatus=s.id;
  const uploadLabel=node('span');uploadLabel.setAttribute('role','status');
  uploadStatus.append(uploadLabel,action('전송 취소',()=>{
    const flight=textUploads.get(s.id);if(!flight)return;
    flight.abort.abort();discardUpload(s.id,flight.id,key);
  }));
  uploadStatus.hidden=!textUploads.has(s.id);
  uploadLabel.textContent=textUploads.get(s.id)?.label||'';form.append(uploadStatus);
  if(historyPage && !running(s.id) && !pending.length && !busy) {
    const suggested=originalAnswerFollowups({...s,messages:historyPage.messages})[0];
    if(suggested){
      const accept=()=>{
        if(text.value || composingField || busy)return;
        text.value=suggested.prompt;text.dispatchEvent(new Event('input',{bubbles:true}));
        text.focus({preventScroll:true});text.setSelectionRange(text.value.length,text.value.length);
      };
      const button=action('',accept,'mobile-followup');
      button.append(node('span',suggested.prompt),node('kbd','Tab'));
      button.hidden=!!text.value;
      const sync=()=>{button.hidden=!!text.value || !!composingField;};
      text.addEventListener('input',sync,listener);text.addEventListener('compositionstart',()=>button.hidden=true,listener);text.addEventListener('compositionend',()=>queueMicrotask(sync),listener);
      text.addEventListener('keydown',event=>{
        if(event.key==='Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !text.value && !button.hidden){
          event.preventDefault();accept();
        }
      },listener);
      form.append(button);
    }
  }
  form.append(options);
  if (s.executionState) {
    const state=node('p',executionNames[s.executionState],'chat-state');
    state.dataset.state=s.executionState;
    heading.append(state);
  }
  if(s.canCompleteWaiting){
    const choices=node('div',undefined,'actions');
    const proceed=action('진행하기',()=>{if(!s.scope&&!mayStartProjectWork(s.projectId))return;return run(async()=>{
      const attachments=attachedDrafts.get(s.id)||[];
      const value=fullText();
      await call('workflowAction',{action:'continueConversation',sessionId:s.id,messageId:s.lastMessageId,...await mobileChatInput(s,value),attachments:attachments.map(a=>a.id),mode});
      clearSentDraft(s.id,value,attachments);
    });});
    const complete=action('완료',()=>run(async()=>{
      await call('workflowAction',{action:'completeContinuation',sessionId:s.id,messageId:s.lastMessageId});showNotice('후속 대기를 완료했습니다.');
    }));
    proceed.disabled=busy||!data.connection?.authenticated;complete.disabled=busy;choices.append(proceed,complete);form.append(choices);
  }
  attachmentComposer(form,s);
  form.insertBefore(form.querySelector('.attachments'),options);
  if (canSteer) {
    const choices=node('div',undefined,'actions'), queue=node('button','다음 차례');
    queue.type='submit'; queue.dataset.delivery='queue'; queue.disabled=submit.disabled;
    queue.setAttribute('aria-label','추가 지시 대기열에 넣기');
    choices.append(submit,queue);form.append(choices);
  } else form.append(submit);
  if (!data.connection?.authenticated)
    form.append(
      node("p", "데스크톱 설정에서 본인의 ChatGPT 계정을 연결하세요.", "hint"),
    );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = fullText();
    const attachments=attachedDrafts.get(s.id)||[];
    if (!value.trim() && !attachments.length) return;
    if(!s.scope&&!mayStartProjectWork(s.projectId))return;
    void run(async () => {
      const result=await call("send", {
        ...(canSteer && e.submitter?.dataset.delivery!=='queue' && {delivery:'steer'}),
        sessionId: s.id,
        ...await mobileChatInput(s,value),
        attachments:attachments.map(a=>a.id),
        mode,
      });
      clearSentDraft(s.id,value,attachments);await loadQueue();
      showNotice(result.steered ? "현재 작업에 추가 지시를 전달했습니다." : result.waitingForWriter ? "요청을 보관했습니다. 채팅의 추가 지시에서 전달 상태를 확인할 수 있습니다." : result.queued ? "추가 지시를 대기열에 넣었습니다." : "요청을 보냈습니다.");
    });
  });
  root.append(form);
}
async function mobileChatInput(session,text){
  if(text.length<=maxChatInput)return {text};
  if(!text.isWellFormed()||text.includes('\0'))throw Error('입력한 글에 저장할 수 없는 문자가 있습니다.');
  const receipt=longSubmission(session.id,text),saved=submissionReceipts.get(session.id);
  const blob=new Blob([text]);
  if(data?.canUploadRequestChunks){
    saved.chunked=true;
    const flight={abort:new AbortController(),id:receipt.submissionId,label:''},epoch=accessEpoch;
    textUploads.set(session.id,flight);
    const update=(current,total)=>{
      flight.label='원문 전송 중 ('+Math.floor(current*100/total)+'%)';
      const status=content.querySelector('[data-upload-status="'+CSS.escape(session.id)+'"]');
      if(status){status.hidden=false;status.firstChild.textContent=flight.label;}
    };
    const check=()=>{if(flight.abort.signal.aborted||epoch!==accessEpoch||gate)throw Error('전송을 중단했습니다. 작성한 요청을 확인해 주세요.');};
    try{
      update(0,blob.size);
      const id=await uploadText({blob,sessionId:session.id,id:flight.id,key,guard:check,signal:flight.abort.signal,onProgress:update});
      check();return {text:'',requestSourceId:id,...receipt};
    }finally{
      textUploads.delete(session.id);
      const status=content.querySelector('[data-upload-status="'+CSS.escape(session.id)+'"]');if(status)status.hidden=true;
    }
  }
  if(blob.size>20*1024*1024)throw Error('긴 원문을 한 번에 보내려면 컴퓨터의 Flowrium을 업데이트해 주세요. 작성한 내용은 이 화면에 남아 있습니다.');
  const response=await fetch('/api/mobile/request-source?sessionId='+encodeURIComponent(session.id),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/octet-stream'},body:blob,credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(120000)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'원문을 보관하지 못했습니다. 작성한 글에서 다시 시도해 주세요.');
  return {text:'',requestSourceId:result.id,...receipt};
}
async function loadQueue(){
  const id=selectedSession,epoch=accessEpoch;if(route!=='chat'||gate||!id)return;
  try{const rows=await call('listQueuedMessages',id);if(epoch!==accessEpoch||id!==selectedSession)return;if(JSON.stringify(rows)!==JSON.stringify(queueItems)){queueItems=rows;render()}}catch{}
}
function citationCard(session,message,group) {
  const card=node('section',undefined,'mobile-citation'),status=node('p',undefined,'hint');
  const id=session.id+':'+message.id+':'+group.key;
  const epoch=accessEpoch, readable=()=>epoch===accessEpoch && !gate && selectedSession===session.id;
  const load=(file,action)=>call('readChatCitation',session.id,message.id,file.index,action);
  const report=error=>{
    if(epoch!==accessEpoch)return;
    if(error.gate){clearPrivateState(error.gate);return;}
    if(readable()){if(missingCitations.size>=128)missingCitations.delete(missingCitations.values().next().value);missingCitations.add(id);card.querySelector('.citation-preview')?.remove();status.hidden=false;status.textContent='파일을 열 수 없습니다. 컴퓨터에서 파일 위치를 확인하세요.';}
  };
  const picture=group.files.find(f=>f.image);
  if(picture && !missingCitations.has(id)) {
    const preview=node('button',undefined,'citation-preview'),image=node('img');
    preview.type='button';preview.setAttribute('aria-label',picture.name+' 확대');image.alt=picture.name+' 미리보기';
    preview.append(image);card.append(preview);
    const cacheId='ref:'+session.id+':'+message.id+':'+picture.index+':'+picture.path;
    observePhoto(image,{name:picture.name,id:cacheId},session.projectId,()=>load(picture,'preview'),report);
    preview.addEventListener('click',()=>{
      if(!readable()||!image.src)return;
      const dialog=node('dialog',undefined,'citation-zoom');dialog.setAttribute('aria-label',picture.name+' 확대');
      const full=node('img');full.src=image.src;full.alt=picture.name;
      dialog.append(full,action('닫기',()=>dialog.close()));
      dialog.addEventListener('close',()=>{dialog.remove();preview.focus({preventScroll:true});},{once:true});
      document.body.append(dialog);dialog.showModal();
    });
  }
  status.hidden=true;status.setAttribute('role','status');
  if(missingCitations.has(id))report({});
  for(const file of group.files){
    const download=action(file.name+' 내려받기',async()=>{
      download.disabled=true;
      try{
        const result=await load(file,'download');
        if(!readable()||!result?.dataUrl?.startsWith('data:'))return;
        const link=node('a');link.href=result.dataUrl;link.download=result.name;document.body.append(link);link.click();link.remove();
        missingCitations.delete(id);status.hidden=true;
      }catch(error){report(error);}finally{download.disabled=false;}
    });
    card.append(download);
  }
  card.append(status);return card;
}
function observePhoto(img,attachment,projectId,read=()=>call('readChatAttachment',projectId,attachment.id),onError) {
  const id=projectId+':'+attachment.id;
  img.alt='첨부 사진';
  img.setAttribute('aria-label',attachment.name);
  const cached=attachmentPreviews.get(id);
  if(cached){img.src=cached;return;}
  const epoch=accessEpoch;
  img.loadPreview=async()=>{
    if(epoch!==accessEpoch||gate)return;
    if(!attachmentFlights.has(id)){
      const flight=read().then(result=>{
        if(epoch!==accessEpoch||gate)return;
        if(result.dataUrl) {
          if(attachmentPreviews.size>=48)attachmentPreviews.delete(attachmentPreviews.keys().next().value);
          attachmentPreviews.set(id,result.dataUrl);
        }
        return result.dataUrl;
      }).finally(()=>{if(attachmentFlights.get(id)===flight)attachmentFlights.delete(id)});
      attachmentFlights.set(id,flight);
    }
    try {
      const url=await attachmentFlights.get(id);
      if(img.isConnected && epoch===accessEpoch && url)img.src=url;
      else if(!url)img.alt='미리보기를 열 수 없습니다';
    }catch(error){if(error.gate&&epoch===accessEpoch)clearPrivateState(error.gate);else {img.alt='미리보기를 열 수 없습니다';onError?.(error);}}
  };
  photoObserver ||= new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){
      photoObserver.unobserve(entry.target);
      void entry.target.loadPreview();
    }
  },{rootMargin:'120px'});
  photoObserver.observe(img);
}
function appendAttachments(parent,items,projectId,id,remove) {
  if(!items.length)return;
  const photos=items.filter(a=>a.type?.startsWith('image/'));
  if(photos.length){
    const strip=node('ul',undefined,'mobile-photo-strip');
    strip.dataset.gallery=id;strip.tabIndex=0;strip.setAttribute('aria-label','첨부 사진');
    for(const a of photos){
      const tile=node('li',undefined,'attachment'),img=node('img');
      observePhoto(img,a,projectId);tile.append(img);
      if(remove){
        const button=action('×',()=>remove(a.id),'mobile-photo-remove');
        button.setAttribute('aria-label',a.name+' 첨부 해제');tile.append(button);
      }
      strip.append(tile);
    }
    parent.append(strip);
  }
  for(const a of items.filter(a=>!a.type?.startsWith('image/'))){
    const box=node('div',undefined,'attachment');box.append(node('span',a.name+' / '+Math.ceil(a.size/1024)+'KB'));
    if(remove)box.append(action(a.name+' 첨부 해제',()=>remove(a.id)));parent.append(box);
  }
}
function attachmentComposer(form,s){
  const box=node('section',undefined,'attachments'),picker=node('input');picker.type='file';picker.multiple=true;picker.disabled=busy;picker.setAttribute('aria-label','파일 첨부');
  picker.addEventListener('click',e=>{if(!s.scope&&!mayStartProjectWork(s.projectId))e.preventDefault();});
  picker.addEventListener('change',()=>{const files=[...picker.files];void uploadAttachments(s,files)});
  const choose=label('파일 첨부',picker);choose.className='mobile-attach-button';box.append(choose);
  appendAttachments(box,attachedDrafts.get(s.id)||[],s.projectId,'draft:'+s.id,id=>{attachedDrafts.set(s.id,(attachedDrafts.get(s.id)||[]).filter(x=>x.id!==id));render()});
  form.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault()});
  form.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();void uploadAttachments(s,[...e.dataTransfer.files])}});
  form.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void uploadAttachments(s,files)}});
  form.append(box);
}
let uploadTail=Promise.resolve();
function uploadAttachments(s,files){
  if(!files.length)return;
  if(!s.scope&&!mayStartProjectWork(s.projectId))return;
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
  }).catch(e=>{if(epoch===accessEpoch)showNotice(e.message, "error")});
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
  const commands=d.phase==='stopped'||d.phase==='done'?[['팀 다시 열기','reopen']]:d.phase==='paused'?[['다시 시작','resume'],['팀 중단','stop']]:[['일시 중지','pause'],['팀 중단','stop'],['결과 보고','report']];
  for(const [name,act] of commands){
    const button=act==='stop'
      ? confirmationButton(name,'team/'+entry.id+'/'+d.revision,'팀 작업을 중단할까요?',entry.name,()=>change({action:act}))
      : action(name,()=>change({action:act}));
    button.disabled=busy;
    buttons.append(button);
  }
  card.append(buttons);
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
  const target=route, settingsRevision=extrasEpoch;
  if(gate||!['assistant','settings'].includes(target)||(!announce && pendingExtras.has(target)))return;
  if(target==='settings' && mobileSettings && !announce)return;
  const label=target==='assistant'?'비서 상태':'계정 설정';
  const epoch=accessEpoch, ticket=Symbol();
  pendingExtras.set(target,ticket);
  const current=()=>epoch===accessEpoch && target===route && pendingExtras.get(target)===ticket;
  if(announce && loadErrors.delete(label))render();
  try{
    if(target==='assistant'){
      const result=await call('mobileWorkflowState');if(!current())return;
      if(loadErrors.delete(label)||JSON.stringify(result)!==JSON.stringify(workflowData)){workflowData=result;render()}
    }else{
      const [settings,usage,push]=await Promise.all([call('mobileSettings'),call('readAccountUsage').catch(()=>null),data.pushAvailable?call('webPushState').catch(()=>null):null]);
      if(!current()||settingsRevision!==extrasEpoch)return;
      loadErrors.delete(label);mobileSettings=settings;usageData=usage;pushData=push;render();
    }
  }catch(error){
    if(!current())return;
    if(error.gate)clearPrivateState(error.gate);
    else if(target==='assistant' ? !workflowData : !mobileSettings){
      loadErrors.set(label, label+' 정보를 불러오지 못했습니다.');
      render();
    }else if(announce) showNotice(error.message, "error");
  }finally{if(pendingExtras.get(target)===ticket)pendingExtras.delete(target);}
}
function workflowDo(input){return run(async()=>{await call('workflowAction',input);await loadExtras();showNotice('반영했습니다.')})}
function reminderRepeat() {
  const group=node('fieldset',undefined,'repeat-segment');group.append(node('legend','반복'));
  for(const [value,name] of [['0','반복 안 함'],['1','매일'],['7','매주']]){
    const input=node('input');input.type='radio';input.name='repeatDays';input.value=value;
    input.checked=value===(drafts.get('reminder/repeat')||'0');
    input.addEventListener('change',()=>drafts.set('reminder/repeat',value));
    const option=node('label');option.append(input,node('span',name));group.append(option);
  }
  return group;
}
function assistantPreferences(root) {
  const prefs=workflowData.preferences,form=node('form');
  const enabled=node('input'),report=node('input');
  const prefKey=key=>'assistant/preferences/'+key;
  for(const [field,key] of [[enabled,'enabled'],[report,'aiReports']]){
    field.checked=drafts.get(prefKey(key))??prefs[key];
    field.addEventListener('change',()=>drafts.set(prefKey(key),field.checked));
  }
  const interval=bindDraft(node('input'),prefKey('intervalMinutes'),String(prefs.intervalMinutes));
  interval.type='text';interval.inputMode='numeric';interval.pattern='[0-9]{1,4}';interval.required=true;
  interval.setAttribute('aria-label','확인 주기 (분)');
  const group=node('div',undefined,'mobile-stepper'),step=delta=>{
    const button=action(delta>0?'+':'−',()=>{
      const value=Number(interval.value);
      interval.value=String(Math.min(1440,Math.max(5,(Number.isInteger(value)?value:prefs.intervalMinutes)+delta)));
      interval.dispatchEvent(new Event('input',{bubbles:true}));
    });
    button.setAttribute('aria-label','확인 주기 5분 '+(delta>0?'늘리기':'줄이기'));return button;
  };
  const minus=step(-5),plus=step(5);
  const validate=()=>{const n=Number(interval.value);interval.setCustomValidity(Number.isInteger(n)&&n>=5&&n<=1440?'':'5분부터 1,440분까지 숫자로 입력하세요.');minus.disabled=n<=5;plus.disabled=n>=1440;};
  interval.addEventListener('input',validate);validate();
  group.append(minus,interval,plus);
  form.append(settingsSwitch('자동 비서 사용',enabled),settingsSwitch('ChatGPT로 보고 생성',report),node('strong','확인 주기 (분)'),group);
  const hours={};
  for(const [key,name] of [['startHour','업무 시작 시간'],['endHour','업무 종료 시간']]){
    const slider=node('input');slider.type='range';slider.min='0';slider.max='23';slider.step='1';
    bindDraft(slider,prefKey(key),String(prefs[key]));
    const control=label(name,slider),value=node('output');control.className='mobile-hour-range';
    const update=()=>{value.textContent=slider.value+'시';slider.setAttribute('aria-valuetext',value.textContent);};
    slider.addEventListener('input',update);update();control.append(value);form.append(control);hours[key]=slider;
  }
  const save=node('button','비서 설정 저장','main-action');save.type='submit';form.append(save);
  form.addEventListener('submit',event=>{event.preventDefault();
    const value={enabled:enabled.checked,aiReports:report.checked,intervalMinutes:Number(interval.value),startHour:Number(hours.startHour.value),endHour:Number(hours.endHour.value)};
    void run(async()=>{await call('workflowAction',{action:'preferences',value});for(const key of Object.keys(value))drafts.delete(prefKey(key));await loadExtras();showNotice('반영했습니다.');});
  });
  root.append(form);
}
function assistantPage(root){
  root.append(node('h1','업무 연결 / 비서'),action('비서 상태 새로 고침',()=>loadExtras()));
  if(!workflowData){root.append(loadingRegion('비서 상태'));return}
  const tabs=node('div',undefined,'tabs');for(const [id,title]of [['decisions','결정'],['messages','대화 연결'],['reminders','예약 알림'],['reports','보고'],['preferences','비서 설정']]){const b=action(title,()=>{workflowTab=id;render()});if(workflowTab===id)b.setAttribute('aria-current','page');tabs.append(b)}root.append(tabs);
  if(workflowTab==='decisions'){
    const visible=workflowData.proposals.filter(p=>!p.hidden),bulk=node('div',undefined,'actions');
    const pending=new Map(visible.filter(p=>p.status==='pending').map(p=>[p.id,p]));
    for(const [id,revision] of selectedProposals){
      if(!pending.has(id) || pending.get(id).revision!==revision)selectedProposals.delete(id);
    }
    const chosen=()=>[...selectedProposals.keys()].map(id=>pending.get(id));
    function updateSelection(){
      const selection=JSON.stringify([...selectedProposals]);
      for(const button of bulk.children){
        button.disabled=busy || !selectedProposals.size;
        button.dataset.confirmAction='bulk/'+button.dataset.operation+'/'+selection;
      }
    }
    for(const [title,verb,operation] of [['선택 승인','승인','approve'],['선택 거절','거절','reject']]){
      const button=confirmationButton(title,'bulk/'+operation,'선택한 결정을 '+verb+'할까요?',
        ()=>chosen().map(p=>p.title).join(' / '),
        ()=>workflowDo({action:'bulk',operation,items:chosen().map(p=>({id:p.id,revision:p.revision}))}));
      button.dataset.operation=operation;
      bulk.append(button);
    }
    updateSelection();
    root.append(bulk);
    if(!visible.length)root.append(node('p','확인할 결정이 없습니다.','hint'));
    for(const p of visible){const card=node('section',undefined,'box');card.append(node('h2',p.title),node('p',p.body,'body'),node('small',p.status));if(p.preview)card.append(node('p',[p.preview.action,p.preview.calendarName,p.preview.event?.title,p.preview.event?.at].filter(Boolean).join(' / '),'hint'));
      if(p.status==='pending'){const check=node('input');check.type='checkbox';check.checked=selectedProposals.has(p.id);check.addEventListener('change',()=>{if(check.checked)selectedProposals.set(p.id,p.revision);else selectedProposals.delete(p.id);updateSelection();});card.append(label(p.title+' 선택',check));const buttons=node('div',undefined,'actions');for(const [title,act]of [['승인','approve'],['거절','reject'],['숨기기','hide']])buttons.append(action(title,()=>workflowDo({action:act,id:p.id,revision:p.revision})));buttons.append(action('한 시간 뒤 확인',()=>workflowDo({action:'snooze',id:p.id,revision:p.revision,minutes:60})));card.append(buttons)}if(p.result)card.append(node('p',p.result,'body'));root.append(card)}
    const events=node('section',undefined,'box');events.append(node('h2','최근 알림'));
    for(const n of workflowData.notifications.slice(0,40)){const line=node('div',undefined,'queue-line');line.append(node('strong',n.title),node('p',n.body,'body'));if(!n.readAt)line.append(action('확인한 알림',()=>workflowDo({action:'read',ids:[n.id]})));if(n.sessionId&&session(n.sessionId))line.append(action('알림 대화 열기',()=>go('chat',n.sessionId)));events.append(line)}root.append(events);
  }else if(workflowTab==='messages'){
    const form=node('form'),target=select(data.sessions.map(s=>[s.id,s.title]),data.sessions[0]?.id),text=bindDraft(node('textarea'),'workflow/send','');text.required=true;const title=bindDraft(node('input'),'workflow/title','');
    form.append(label('대상 대화',target),label('요청 제목',title),label('보낼 내용',text));const mode=select([['send','기존 대화에 메시지'],['request','업무 요청 제안']],'send');form.append(label('연결 방식',mode));const submit=node('button','업무 연결 보내기','main-action');submit.type='submit';submit.disabled=busy||!data.sessions.length;form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();void workflowDo(mode.value==='send'?{action:'send',targetId:target.value,text:text.value}:{action:'request',targetId:target.value,title:title.value||'업무 요청',text:text.value})});root.append(form);
    for(const d of workflowData.deliveries.slice(0,30)){const card=node('section',undefined,'box');card.append(node('p',d.text,'body'),node('small',d.status));if(['failed','held'].includes(d.status))card.append(action('메시지 다시 전달',()=>workflowDo({action:'retryDelivery',id:d.id})));root.append(card)}
  }else if(workflowTab==='reminders'){
    const form=node('form'),text=bindDraft(node('textarea'),'reminder/text',''),at=bindDraft(node('input'),'reminder/at','');
    text.required=at.required=true;at.type='datetime-local';at.dataset.timeParts='';
    form.append(label('예약 알림 내용',text),label('알림 시간',at),reminderRepeat());
    const submit=node('button','예약 알림 추가','main-action');submit.type='submit';form.append(submit);
    form.addEventListener('submit',e=>{e.preventDefault();void workflowDo({action:'reminderAdd',text:text.value,when:new Date(at.value).toISOString(),repeatDays:Number(form.elements.repeatDays.value)})});root.append(form);
    for(const r of workflowData.reminders.filter(r=>!r.cancelled)){const card=node('section',undefined,'box');card.append(node('p',r.text),node('small',date(r.nextAt)),confirmationButton('예약 취소','reminder/'+r.id,'예약 알림을 취소할까요?',r.text,()=>workflowDo({action:'reminderCancel',id:r.id})));root.append(card)}
  }else if(workflowTab==='reports'){
    root.append(action('AI 업무 보고 생성',()=>workflowDo({action:'reportNow'})),action('결정 추천 생성',()=>workflowDo({action:'recommend'})),action('프로젝트 현황 수집',()=>workflowDo({action:'collect'})));
    for(const report of workflowData.reports.slice(0,20)){const card=node('section',undefined,'box');card.append(node('h2',date(report.at)+' / '+(report.status||'보고')),node('p',report.body||report.error||'AI가 보고서를 작성하고 있습니다.','body'));if(report.sessionId&&session(report.sessionId))card.append(action('보고 대화 열기',()=>go('chat',report.sessionId)));root.append(card)}
  }else{
    assistantPreferences(root);
  }
}
function settingsSwitch(name, input) {
  const row=node('label',name,'mobile-settings-switch');
  input.type='checkbox';
  input.setAttribute('role','switch');
  input.setAttribute('aria-label',name);
  const control=node('span',undefined,'mobile-switch-control');
  const track=node('span',undefined,'mobile-switch-track');
  track.setAttribute('aria-hidden','true');
  control.append(input,track);
  row.append(control);
  return row;
}
function settingsPage(root){
  root.append(node('h1','설정 / 사용량'),settingsGuides());
  root.append(mobileUpdateSection({
    data, call, onError:clearPrivateState,
    refresh:()=>{if (route === 'settings' && data && !gate) render();},
    canReload:()=>route === 'settings' && !gate && !busy,
    hasDrafts:()=>Boolean(settingsDraft || editingTeam || [...drafts.values()].some(Boolean) ||
      [...attachedDrafts.values()].some(items=>items.length) ||
      [...questionDrafts.values()].some(fields=>[...fields.values()].some(answer=>answer.text || answer.selection))),
  }));
  const device=node('section',undefined,'settings-block');
  device.append(node('h2','기기 연결'));
  root.append(device);
  const remember=node('input');remember.type='checkbox';remember.checked=rememberDevice;remember.addEventListener('change',()=>{try{rememberDevice=remember.checked;if(rememberDevice){localStorage.setItem(rememberFlag,'1');localStorage.setItem(rememberedKeyStorage,key)}else{localStorage.removeItem(rememberFlag);localStorage.removeItem(rememberedKeyStorage)}showNotice(rememberDevice?'이 기기에 연결을 보관했습니다.':'탭을 닫으면 연결 정보를 보관하지 않습니다.')}catch{rememberDevice=false;remember.checked=false;showNotice('이 브라우저에서 연결을 보관할 수 없습니다.', 'error')}});device.append(settingsSwitch('이 기기에서 연결 유지',remember),node('p','개인 기기에서만 켜세요. 알림으로 새 창을 열 때도 연결하며 데스크톱의 연결 종료로 언제든 취소할 수 있습니다.','hint'));
  const account=node('section',undefined,'settings-block');
  const accountLine=node('div',undefined,'settings-account-line');
  accountLine.append(node('p',data.connection.accountLabel||'ChatGPT','hint'),action('설정과 사용량 새로 고침',()=>loadExtras()));
  account.append(node('h2','계정과 모델'),accountLine);
  root.append(account);
  if(!mobileSettings){account.append(loadingRegion('계정 설정'));return}
  const preferences=settingsDraft||mobileSettings;
  const form=node('form'),models=mobileSettings.models||[],model=select([['','계정 기본 모델'],...models.map(m=>[m.id,modelDisplayName(m)])],preferences.model||''),effort=select([],''),answer=select([['short','짧게'],['normal','보통'],['detailed','자세히']],preferences.chatDefaults?.answerLength||'normal');
  function refreshEfforts(preferred=''){
    const selected=models.find(m=>m.id===model.value)||(!model.value?models.find(m=>m.isDefault):undefined),available=reasoningEffortOptions(selected);
    effort.replaceChildren(...[['','모델 기본값'],...available.map(row=>[row.reasoningEffort,effortDisplayName(row.reasoningEffort)])].map(([value,title])=>{const option=node('option',title);option.value=value;return option}));
    effort.value=available.some(row=>row.reasoningEffort===preferred)?preferred:'';
  }
  refreshEfforts(preferences.effort||'');model.addEventListener('change',()=>refreshEfforts());
  const tests=node('input'),ask=node('input'),compact=node('input');tests.type=ask.type=compact.type='checkbox';tests.checked=preferences.chatDefaults?.testing!==false;ask.checked=preferences.chatDefaults?.askNext===true;compact.checked=preferences.chatDefaults?.autoCompact!==false;
  form.append(label('기본 ChatGPT 모델',model),label('추론 수준',effort),label('답변 길이',answer),settingsSwitch('작업 후 검증',tests),settingsSwitch('필요한 다음 질문',ask),settingsSwitch('문맥 자동 압축',compact));
  for(const control of form.elements)control.dataset.field='setting/'+control.getAttribute('aria-label');
  const readForm=()=>({model:model.value,...(effort.value?{effort:effort.value}:{}),chatDefaults:{answerLength:answer.value,testing:tests.checked,askNext:ask.checked,autoCompact:compact.checked}});
  form.addEventListener('change',()=>{settingsDraft=readForm()});
  const save=node('button','기본 설정 저장','main-action');save.type='submit';save.disabled=busy||!models.length;form.append(save);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const value=settingsDraft||readForm(),epoch=accessEpoch;
    void run(async()=>{
      const saved=await call('saveMobileSettings',value);
      if(epoch!==accessEpoch)return;
      extrasEpoch++;
      mobileSettings={...mobileSettings,...saved};
      if(settingsDraft===value)settingsDraft=undefined;
      if(route==='settings'){await loadExtras();showNotice('기본 설정을 저장했습니다.');}
    });
  });
  account.append(form);
  const usage = node('section', undefined, 'box');
  usage.append(node('h2', '계정 사용량'));
  if (usageData) {
    usage.append(node('p', '남은 크레딧 / ' + creditBalance(usageData.credits)));
    if (Number.isSafeInteger(usageData.resetCredits))
      usage.append(node('p', '사용 한도 재설정 / ' + usageData.resetCredits.toLocaleString('ko-KR') + '회'));
  } else {
    usage.append(node('p', '현재 사용량을 읽지 못했습니다.', 'hint'));
  }
  for (const bucket of usageData?.buckets || []) {
    usage.append(node('strong', [bucket.name, bucket.plan].filter(Boolean).join(' / ')));
    for (const window of bucket.windows) {
      const progress = node('progress');
      progress.max = 100;
      progress.value = window.usedPercent;
      progress.setAttribute('aria-label', bucket.name + ' 사용량');
      const period = window.minutes ? Math.round(window.minutes / 60) + '시간' : '사용 구간';
      usage.append(node('p', period + ' / ' + Math.round(window.usedPercent) + '% 사용', 'hint'), progress);
      if (window.resetsAt) usage.append(node('small', '초기화 ' + date(window.resetsAt)));
    }
    if (usageData.buckets.length > 1 && bucket.credits)
      usage.append(node('p', '이 한도의 크레딧 / ' + creditBalance(bucket.credits), 'hint'));
  }
  root.append(usage);
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
    for(const [kind,title]of Object.entries(pushLabels)){const check=node('input');check.type='checkbox';check.checked=chosen.has(kind);check.addEventListener('change',()=>check.checked?chosen.add(kind):chosen.delete(kind));box.append(settingsSwitch(title,check))}
    box.append(action('알림 종류 저장',()=>run(async()=>{await call('webPushAction',{action:'preferences',id:device.id,kinds:[...chosen]});await loadExtras()})),action('이 기기에 시험 알림 보내기',()=>run(async()=>{const result=await call('webPushAction',{action:'test',id:device.id});showNotice(result.sent?'알림 서버에 발송했습니다.':'발송을 확인하지 못했습니다.',result.sent?'info':'error');await loadExtras()})),confirmationButton('이 기기 알림 해제','push/'+device.id,'이 기기 알림을 해제할까요?','이 기기로 보내는 작업 알림이 중지됩니다.',()=>run(async()=>{await call('webPushAction',{action:'unsubscribe',id:device.id});const registration=await navigator.serviceWorker.ready;await(await registration.pushManager.getSubscription())?.unsubscribe();sessionStorage.removeItem('flowrium.mobile.pushId');await loadExtras();showNotice('기기 알림을 해제했습니다.')})));
    if(device.lastError)box.append(node('p',device.lastError,'hint'));
  }
  box.append(node('p','연결을 종료하거나 계정을 바꾸면 알림도 중지됩니다. 새 연결 주소에서는 기기를 다시 등록하세요.','hint'));root.append(box);
}

let renderedChatId;
function visibleMessageAnchor(){
  if(route!=='chat'||renderedChatId!==selectedSession||gate)return;
  const messages=content.querySelectorAll('[data-message-id]');
  const headerBottom=document.querySelector('.bar').getBoundingClientRect().bottom;
  let lo=0,hi=messages.length;
  while(lo<hi){
    const middle=Math.floor((lo+hi)/2);
    if(messages[middle].getBoundingClientRect().bottom<=headerBottom)lo=middle+1;
    else hi=middle;
  }
  const first=messages[lo],top=first?.getBoundingClientRect().top;
  if(first && top<innerHeight)return {id:first.dataset.messageId,top};
}
let mobileEditor, mobileDraftEditor, mobileDraftSurface, composingField, composerHistory, chatRenderEvents, pendingComposerRender=false;
function render() {
  if (composingField?.isConnected && route==='chat' && renderedChatId===selectedSession && !gate && data && key) {
    pendingComposerRender=true;return;
  }
  const calendar = document.querySelector('.flow-date-picker[open]');
  if (calendar) {
    if (!gate && key) return;
    calendar.close();
  }
  mobileEditor?.dispose();mobileEditor=undefined;
  chatRenderEvents?.abort();chatRenderEvents=new AbortController();
  composingField=undefined;pendingComposerRender=false;
  photoObserver?.disconnect();
  const galleryPositions=new Map([...content.querySelectorAll('[data-gallery]')].map(strip=>[strip.dataset.gallery,strip.scrollLeft]));
  const active = document.activeElement,
    progressFocus=active?.dataset?.workGroup,
    field = active?.dataset?.field,
    settingsGuide = route === 'settings' && active?.dataset?.settingsGuide,
    confirmAction = active?.dataset?.confirmAction,
    anchor=visibleMessageAnchor();
  const fieldTop=field && renderedChatId===selectedSession && route==='chat' ? active.getBoundingClientRect().top : undefined;
  const fieldOffset=active?.scrollTop;
  const start =
      field && "selectionStart" in active ? active.selectionStart : null,
    end = field && "selectionEnd" in active ? active.selectionEnd : null;
  const root = document.createDocumentFragment();
  content.dataset.view = gate || !data ? 'connection' : route;
  navigation.hidden = !data || !!gate;
  for (const btn of navigation.querySelectorAll("button")) {
    const current =
      (["project", "new", "chat", "status"].includes(route) ? "projects" : route) ===
      btn.dataset.view;
    if (current) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  const connecting = !data && !gate && Boolean(key || handoff);
  content.setAttribute('aria-busy', String(connecting));
  if (connecting) {
    connection.textContent = '연결 중';
    root.append(loadingRegion('대시보드', 'dashboard'));
  } else if (!data || gate) {
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
      gate === "locked" ? "잠김" : !key ? "연결 필요" : gate === "offline" ? "연결 재시도 중" : "연결 중";
    root.append(node("h1", title), node("p", hint, "hint"));
    if (key) root.append(action("다시 확인", () => poll()));
    else if (!handoff) root.append(reconnectForm());
  } else if (route === "projects") projects(root);
  else if (route === "status") statusPage(root);
  else if (route === "running") {
    root.append(node("h1", "실행 중인 업무"));
    const list = data.sessions.filter((s) => running(s.id));
    if (list.length) root.append(sessionList(list));
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
  for(const strip of content.querySelectorAll('[data-gallery]'))strip.scrollLeft=galleryPositions.get(strip.dataset.gallery)||0;
  const composingInput=content.querySelector('.markdown-input > textarea');
  if(composingInput){
    if(composerHistory?.id!==selectedSession)composerHistory={id:selectedSession};
    mobileEditor=attachComposerMarkdown(composingInput,composingInput.nextElementSibling,composerHistory);
    composingInput.addEventListener('compositionstart',()=>{composingField=composingInput;},{signal:chatRenderEvents.signal});
    composingInput.addEventListener('compositionend',()=>{
      composingField=undefined;
      if(pendingComposerRender)requestAnimationFrame(()=>{if(pendingComposerRender)render();});
    },{signal:chatRenderEvents.signal});
  }else{
    composerHistory=undefined;mobileDraftEditor?.dispose();mobileDraftEditor=undefined;mobileDraftSurface=undefined;
  }
  reconcileConfirmation(Boolean(gate) || !data);
  if ((settingsGuide || confirmAction) && !gate && !document.querySelector('dialog[open]')) {
    const selector = confirmAction ? '[data-confirm-action="' + CSS.escape(confirmAction) + '"]' : '[data-settings-guide="' + CSS.escape(settingsGuide) + '"]';
    content.querySelector(selector)?.focus({preventScroll:true});
  }
  renderedChatId=data && !gate && route==='chat' ? selectedSession : undefined;
  const restored=anchor && content.querySelector('[data-message-id="'+CSS.escape(anchor.id)+'"]');
  if(restored)window.scrollBy(0,restored.getBoundingClientRect().top-anchor.top);
  if(progressFocus)content.querySelector('[data-work-group="'+CSS.escape(progressFocus)+'"]')?.focus({preventScroll:true});
  if (field) {
    const next = [...content.querySelectorAll("[data-field]")].find(
      (el) => el.dataset.field === field,
    );
    if (next) {
      next.focus({ preventScroll: true });
      if (start !== null && typeof next.setSelectionRange === "function")
        next.setSelectionRange(start, end);
      if(fieldOffset)next.scrollTop=fieldOffset;
      if(!restored && fieldTop!==undefined && fieldTop>=0 && fieldTop<innerHeight)
        window.scrollBy(0,next.getBoundingClientRect().top-fieldTop);
    }
  }
}
document.addEventListener('flowrium-install-state', () => { if (route === 'settings') render(); });
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
      const response=await fetch('/api/mobile/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handoff}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(18000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'연결 주소가 만료됐습니다.');
      key=result.key;try{sessionStorage.setItem(keyStorage,key);if(rememberDevice)localStorage.setItem(rememberedKeyStorage,key)}catch{}
    }catch(e){key=null;showNotice(e.message, "error")}finally{handoff=null;render();}
  }
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{});
  void poll();
}
void initialize();
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='flowrium:notification'){go('assistant');void poll();}});
setInterval(() => void poll(), 2000);
