const { relativePath } = require('./path-boundary.cjs');
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const definitions = require("./work-kinds.json");

const { renderDocument } = require("./work-documents.cjs");
const gitExec = promisify(execFile);
const kinds = Object.keys(definitions);
const statuses = ["active", "review", "done"];
const documentRoots = ["산출물", "docs", "outputs"];
const previewable = new Set([".md", ".markdown", ".txt", ".csv", ".html", ".htm"]);
const documents = new Set([...previewable, ".pdf", ".docx", ".xlsx", ".pptx"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const invalid = () => new Error("업무 정보의 형식을 확인해 주세요.");
const bounded = (v, max) => typeof v === "string" && v.length <= max;
const isoDay = (v) => v === "" || (typeof v === "string" && dateOnly.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const validTime = (v) => bounded(v, 100) && Number.isFinite(Date.parse(v));
const compact = (value, max) => value.replace(/\s+/g, " ").trim().slice(0, max);
const lastAnswer = (s) => s.messages.findLast((m) => m.role === "assistant" && m.text.trim());

function validateWorkflow(w) {
  if (!w || !kinds.includes(w.kind) || !statuses.includes(w.status) ||
      !bounded(w.role, 120) || !bounded(w.brief, 12000) || !bounded(w.audience, 500) ||
      !isoDay(w.from) || !isoDay(w.to) || (w.from && w.to && w.from > w.to) ||
      !Array.isArray(w.checklist) || w.checklist.length > 128 ||
      !w.checklist.every((i) => i && uuid.test(i.id) && bounded(i.text, 400) && typeof i.done === "boolean") ||
      new Set(w.checklist.map((i) => i.id)).size !== w.checklist.length) throw invalid();
  if (w.reportProjects !== undefined && (!["weekly","briefing"].includes(w.kind) || !Array.isArray(w.reportProjects) ||
      !w.reportProjects.length || w.reportProjects.length > 64 || w.reportProjects.some(id => !uuid.test(id)) ||
      new Set(w.reportProjects).size !== w.reportProjects.length)) throw invalid();
  if (w.searchMode !== undefined && (w.kind !== "research" || !["live", "cached", "disabled"].includes(w.searchMode))) throw invalid();
  if(w.researchDepth!==undefined&&(w.kind!=='research'||!['quick','standard','deep'].includes(w.researchDepth)))throw invalid();
  if(w.documentKind!==undefined&&(w.kind!=='document'||!['report','slides'].includes(w.documentKind)))throw invalid();
  if(w.slideCount!==undefined&&(w.kind!=='document'||!Number.isSafeInteger(w.slideCount)||w.slideCount<1||w.slideCount>60))throw invalid();
  if (w.teamSlot && ((w.teamSlot.integration !== undefined && typeof w.teamSlot.integration !== 'boolean') || (w.teamSlot.isolated !== undefined && typeof w.teamSlot.isolated !== 'boolean') || !uuid.test(w.teamSlot.runId) || !Number.isInteger(w.teamSlot.index) || w.teamSlot.index < 0 || w.teamSlot.index > 7 || (w.teamSlot.mode !== undefined && !["plan", "build", "review"].includes(w.teamSlot.mode)))) throw invalid();
  if (w.source && (!uuid.test(w.source.sessionId) || !bounded(w.source.title, 300) || !bounded(w.source.summary, 12000))) throw invalid();
  if (w.completion && (!validTime(w.completion.at) || !bounded(w.completion.summary, 1000) || !Array.isArray(w.completion.commits) ||
      w.completion.commits.length > 30 || !w.completion.commits.every((c) => c && /^[0-9a-f]{4,64}$/i.test(c.hash) && validTime(c.at) && bounded(c.subject, 400)))) throw invalid();
  if(w.completion?.repositoryFlowId!==undefined&&!uuid.test(w.completion.repositoryFlowId))throw invalid();
  return w;
}
function required(value, max) {
  if (!bounded(value, max) || !value.trim()) throw invalid();
  return value.trim();
}
function newWorkflow(kind) {
  return {
    kind, status: "active", role: definitions[kind].role, brief: "", audience: "",
    from: "", to: "", checklist: [],
  };
}
function dayHere(value) {
  const d = new Date(value);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
function inPeriod(value, w) {
  const day = dayHere(value);
  return (!w.from || day >= w.from) && (!w.to || day <= w.to);
}
async function projectRoot(project) {
  const root = await fs.realpath(project.path);
  if (relativePath(root, project.path) !== "" || !(await fs.stat(root)).isDirectory())
    throw new Error("연결한 프로젝트의 경로가 변경됐습니다. 원래 폴더를 확인해 주세요.");
  return root;
}
async function git(root, args, options = {}) {
  const { stdout } = await gitExec("git", ["--no-optional-locks", "-C", root,
    "-c", "core.fsmonitor=false", "-c", "core.quotepath=false", ...args], {
    timeout: 4500, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" }, ...options,
  });
  return stdout;
}
async function gitOverview(root, from = "", to = "") {
  const empty = { available: false, branch: "", changes: [], commits: [], limited: false };
  let prefix;
  try {
    prefix = (await git(root, ["rev-parse", "--show-prefix"])).trimEnd();
  } catch (error) {
    return { ...empty, reason: error.code === "ENOENT" ? "이 컴퓨터에서 Git을 찾지 못했습니다." :
      /not a git repository/i.test(error.stderr || "") ? "Git 저장소가 없는 프로젝트입니다." : "저장소에 접근할 수 없습니다." };
  }
  const scope = ["--", ".", ":(exclude).flowrium", ":(exclude).flowrium/**"];
  const dates = [...(from ? ["--since=" + from + "T00:00:00"] : []), ...(to ? ["--until=" + to + "T23:59:59"] : [])];
  const [branch, status, history] = await Promise.allSettled([
    git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal", ...scope]),
    git(root, ["log", "--no-show-signature", "-n", "31", "-z", "--format=%h%x00%aI%x00%s", ...dates, ...scope]),
  ]);
  const records = status.status === "fulfilled" ? status.value.split("\0").filter(Boolean) : [];
  const historyValues = history.status === "fulfilled" ? history.value.split("\0") : [];
  const commits = [];
  for (let i = 0; i + 2 < historyValues.length; i += 3)
    commits.push({ hash: historyValues[i], at: historyValues[i + 1], subject: compact(historyValues[i + 2], 400) });
  return { available: true, branch: branch.status === "fulfilled" ? branch.value.trim() : "",
    changes: records.slice(0, 120).map((record) => {
      const name = record.slice(3);
      return { code: record.slice(0, 2).trim(), path: prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name };
    }), commits: commits.slice(0, 30), limited: records.length > 120 || commits.length > 30,
    ...(status.status === "rejected" || (history.status === "rejected" && branch.status === "fulfilled")
      ? { reason: "일부 Git 기록을 읽지 못했습니다." } : {}),
  };
}
function artifactParts(relative) {
  if (!bounded(relative, 1500) || relative.includes("\\") || relative.includes("\0") || path.isAbsolute(relative)) throw invalid();
  const parts = relative.split("/");
  if (!documentRoots.includes(parts[0]) || parts.length < 2 || parts.some((p) => !p || p.startsWith(".") || /[:\x00-\x1f]/.test(p)) ||
      !documents.has(path.extname(relative).toLowerCase())) throw new Error("프로젝트의 산출물 파일만 열 수 있습니다.");
  return parts;
}
async function checkedDirectory(root, parts, create = false) {
  let dir = root;
  for (const name of parts) {
    dir = path.join(dir, name);
    if (create) {
      try { await fs.mkdir(dir, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const st = await fs.lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink() || relativePath(dir, await fs.realpath(dir)) !== "")
      throw new Error("프로젝트 밖을 가리키는 산출물 폴더는 열 수 없습니다.");
  }
  return dir;
}
async function artifactFile(root, relative) {
  const parts = artifactParts(relative);
  const name = parts.pop();
  const dir = await checkedDirectory(root, parts);
  const file = path.join(dir, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || relativePath(file, await fs.realpath(file)) !== "") throw new Error("일반 문서 파일만 열 수 있습니다.");
  return { file, stat };
}
function artifactInfo(relative, stat) {
  const id = relative.split("/")[2]?.split("--").at(-1);
  return { path: relative, size: stat.size, modifiedAt: stat.mtime.toISOString(),
    ...(relative.startsWith("산출물/") && uuid.test(id || "") ? { sessionId: id } : {}),
    preview: previewable.has(path.extname(relative).toLowerCase()) };
}
async function listArtifacts(root) {
  const artifacts = [];
  let entries = 0;
  let truncated = false;
  const queue = documentRoots.map((name) => [name]);
  while (queue.length && entries < 3500 && artifacts.length < 500) {
    const parts = queue.shift();
    let dir;
    try { dir = await checkedDirectory(root, parts); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code) || /가리키는/.test(error.message)) continue;
      throw error;
    }
    const files = await fs.opendir(dir);
    for await (const f of files) {
      if (++entries > 3500 || artifacts.length >= 500) { truncated = true; break; }
      if (f.name.startsWith(".") || /[:\x00-\x1f\\]/.test(f.name) || f.isSymbolicLink()) continue;
      const next = [...parts, f.name];
      if (f.isDirectory()) {
        if (parts.length < 7) queue.push(next);
        else truncated = true;
      }
      if (f.isFile() && documents.has(path.extname(f.name).toLowerCase())) {
        const relative = next.join("/");
        try { artifacts.push(artifactInfo(relative, (await artifactFile(root, relative)).stat)); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    }
  }
  artifacts.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.path.localeCompare(b.path));
  return { artifacts, truncated: truncated || queue.length > 0 };
}
function safeTitle(title) {
  return Array.from(title.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "")).slice(0, 40).join("") || "작업";
}
async function saveArtifact(store, id, messageId, format = "md") {
  if (!["md", "html", "pdf", "pptx"].includes(format)) throw invalid();
  const s = store.session(id);
  const answer = s.messages.find((m) => m.id === messageId && m.role === "assistant" && m.text.trim());
  if (!answer) throw new Error("저장할 답변을 찾을 수 없습니다.");
  const kind = s.workflow?.kind || "task";
  const root = await projectRoot(store.project(s.projectId));
  const parts = ["산출물", definitions[kind].label, safeTitle(s.title) + "--" + s.id];
  const dir = await checkedDirectory(root, parts, true);
  const name = dayHere(answer.createdAt) + "-" + answer.id + "." + format;
  const relative = [...parts, name].join("/");
  const target = path.join(dir, name);
  // PDF·발표자료에는 생성 시각이 포함된다. 재요청은 이미 보관한 파일의 위치를 반환한다.
  try {
    const current = await artifactFile(root, relative);
    if (["pdf", "pptx"].includes(format) && current.stat.size > 0)
      return { ...artifactInfo(relative, current.stat), existing: true };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const rawHTML = /^\s*```html\s*\n([\s\S]*?)\n```\s*$/i.exec(answer.text);
  const body = format === 'html' && rawHTML ? Buffer.from(require('./html-export.cjs').isolatedHTML(rawHTML[1])) : await renderDocument(format, s.title, answer.text);
  let handle;
  try {
    handle = await fs.open(target, "wx", 0o600);
    await handle.writeFile(body);
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close();
      handle = null;
      await fs.unlink(target).catch(() => {});
    }
    if (error.code !== "EEXIST") throw error;
    const { file, stat } = await artifactFile(root, relative);
    if (stat.size !== body.length || !(await fs.readFile(file)).equals(body))
      throw new Error("같은 이름의 산출물이 수정됐습니다. 기존 내용을 보존했습니다.");
    return { ...artifactInfo(relative, stat), existing: true };
  } finally { if (handle) await handle.close(); }
  return artifactInfo(relative, (await artifactFile(root, relative)).stat);
}
async function workContext(store, id) {
  const s = store.session(id);
  if (!s.workflow) return "";
  const w = validateWorkflow(s.workflow);
  const lines = [
    "이 업무는 AI가 직접 자료를 읽어 결과를 작성하는 작업입니다. 사용자가 보고서 본문을 작성하도록 요구하지 마세요. 확인하지 못한 사실은 미확인으로 적고 추정 실적을 만들지 마세요.",
    "이 대화의 업무 유형: " + definitions[w.kind].label,
    "담당 역할: " + w.role, "업무명: " + s.title, definitions[w.kind].instruction,
    w.searchMode === "disabled" && "외부 검색을 사용하지 말고 프로젝트에서 확인한 자료의 경로를 인용하세요.",
    w.brief && "의뢰 내용 및 참고 자료: " + w.brief,
    w.audience && "대상 및 형식: " + w.audience,
    (w.from || w.to) && "조회 기간: " + (w.from || "처음") + " ~ " + (w.to || "오늘"),
    w.source && "인계받은 대화 기록 (참고 자료): " + w.source.title + "\n" + w.source.summary,
    w.checklist.length && "업무 체크리스트:\n" + w.checklist.map((i) => (i.done ? "[x] " : "[ ] ") + i.text).join("\n"),
  ];
  if(w.kind==='weekly')lines.push('주간업무보고 형식: 제목 아래 보고 본문을 하나의 text 코드 블록으로 제공합니다. 프로젝트별 상위 항목 / 세부 업무 두 단계로 정리하고 각각 3칸 / 4칸 들여씁니다. 코드 블록 아래 근거를 따로 적습니다. 기간 안에 실제 끝낸 일만 포함하고 추정과 계획은 실적으로 쓰지 마세요.');
  if(w.kind==='pause')lines.push('업무 마감은 업무 완료 처리가 아닙니다. 파일이나 서비스 상태를 바꾸지 말고, 하다 만 일 / 손대고 올리지 않은 변경 / 결정과 확인 사항 / 복귀하면 시작할 순서 3~5개 / 오늘 끝낸 일을 구분해 작성하세요.');
  if(w.kind==='briefing')lines.push('브리핑 구성: 한 줄 요약 / 현재 상태 / 이번 기간에 한 일 / 다음 할 일 / 결정과 위험. 진행 문서와 커밋, 변경 요청 및 최근 AI 대화의 실제 근거를 함께 확인하세요. 완성한 결과는 flowrium_project_artifact_create 도구로 새 마크다운 산출물에 저장하세요. 이 업무에서는 프로젝트 원본과 Git 및 서비스 상태를 변경하지 마세요.');
  if(w.kind==='document')lines.push('문서 작성: 프로젝트 근거를 확인한 뒤 완성된 보고서 또는 발표자료를 생성하세요. 앱의 flowrium_project_artifact_create 도구로 HTML 원문을 저장하면 PDF와 발표자료 변환을 앱이 수행합니다. 보고서는 A4 문서 HTML로, 발표자료는 1280x720 크기의 section.slide 요소들로 구성하세요. 외부 스크립트는 포함하지 마세요.');
  if(w.kind==='document'&&w.documentKind==='slides')lines.push('선택한 결과 형식: 발표자료 / 슬라이드 '+(w.slideCount||12)+'장. 각 section.slide를 고정 크기로 만들고 내용에 맞는 도표와 편집 가능한 글자를 구성하세요. aside.notes에 발표자 메모를 넣으세요.');
  if(w.kind==='document'&&w.documentKind==='report')lines.push('선택한 결과 형식: 보고서 / A4 HTML 문서와 PDF. 표지 / 요약 / 본문 / 근거를 용도에 맞게 구성하고 인쇄 시 문단과 표가 잘리지 않도록 하세요.');
  if(w.kind==='research')lines.push('선택한 조사 깊이: '+({quick:'빠른 조사 / 핵심 질문과 주요 출처를 확인해 간단히 답하세요.',standard:'일반 조사 / 주요 주장을 교차 확인하고 비교와 실행 제안을 정리하세요.',deep:'심층 조사 / 하위 질문을 나누고 반대 근거와 제약까지 검토해 출처를 비교하세요.'}[w.researchDepth||'standard']));
  if (["briefing", "weekly", "pause"].includes(w.kind)) {
    const ids = w.reportProjects || [s.projectId];
    const perProject = Math.floor((47000 - lines.filter(Boolean).join("\n").length) / ids.length);
    for (const projectId of ids) {
      const project = store.state.projects.find(entry => entry.id === projectId);
      if (!project) { lines.push("연결이 해제된 보고 대상 프로젝트가 있습니다."); continue; }
      if (w.reportProjects) lines.push("\n프로젝트 / " + project.name);
      const others = store.state.sessions.filter((item) => item.projectId === project.id && item.id !== s.id);
      const recentEnough=value=>w.kind!=='pause'||Date.parse(value)>=Date.now()-12*60*60*1000;
      const completed = others.filter((item) => item.workflow?.completion && inPeriod(item.workflow.completion.at, w)&&recentEnough(item.workflow.completion.at))
        .sort((a, b) => b.workflow.completion.at.localeCompare(a.workflow.completion.at));
      const active = others.filter((item) => item.workflow?.status !== "done")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const summaries = completed.slice(0, 30).map((item) =>
        dayHere(item.workflow.completion.at) + " / " + item.title + " / " + compact(item.workflow.completion.summary, 400)).join("\n") || "해당 기간 기록 없음";
      const evidenceLimit = ids.length > 1 ? Math.max(50, Math.floor((perProject - 240) / 2)) : 48000;
      lines.push("프로젝트의 실제 완료 기록:\n" + summaries.slice(0, evidenceLimit));
      if (w.kind !== "weekly") lines.push("진행 중인 업무:\n" +
        (active.slice(0, 30).map((item) => item.title + " / " + dayHere(item.updatedAt) +
          (item.workflow?.checklist?.length ? " / 남은 항목: " + item.workflow.checklist.filter((i) => !i.done).map((i) => i.text).join(", ").slice(0, 300) : "")).join("\n") || "없음"));
      const recentActivity=others.flatMap(item=>item.messages.filter(m=>inPeriod(m.createdAt,w)&&recentEnough(m.createdAt)).slice(-4).map(m=>m.createdAt+' / '+item.title+' / '+(m.role==='user'?'지시':'응답')+' / '+compact(m.text,450))).sort().slice(-40);
      if(recentActivity.length)lines.push('실제 최근 AI 업무 활동:\n'+recentActivity.join('\n').slice(0,Math.max(1000,Math.floor(perProject/4))));
      let repositories;
      try { repositories=await require('./project-repositories.cjs').repositoriesFor(store,project); }
      catch { lines.push('연결한 저장소 폴더를 확인하지 못했습니다.');continue; }
      for(const repo of repositories){
        let gitData;
        try{gitData=await gitOverview(repo.cwd,w.from,w.to);}catch{lines.push(repo.name+' / Git 조회 실패');continue;}
        lines.push('저장소 / '+repo.name+' / '+repo.path);
        if(gitData.available){
          const commitEvidence=gitData.commits.filter(c=>recentEnough(c.at)).map(c=>c.at+' '+c.hash+' '+c.subject).join('\n')||'해당 기간 커밋 없음';
          lines.push('프로젝트 Git 기록 (사실 확인용):\n'+commitEvidence.slice(0,Math.max(200,Math.floor(evidenceLimit/repositories.length))));
          if(w.kind!=='weekly'){
            lines.push('미커밋 파일:\n'+(gitData.changes.map(c=>c.code+' '+c.path).join('\n')||'없음'));
            const unpushed=await git(repo.cwd,['log','--format=%h %aI %s','@{upstream}..HEAD']).catch(()=>null);
            lines.push('미푸시 커밋:\n'+(unpushed===null?'원격 추적 브랜치가 없어 미확인':unpushed.trim()||'없음'));
            const stash=await git(repo.cwd,['stash','list','--format=%gd %s']).catch(()=>null);lines.push('임시 보관 변경:\n'+(stash===null?'미확인':stash.trim()||'없음'));
          }
          try{
            const env=await require('./repository-auth.cjs').accountEnvironment(repo.account,{...require('./runtime.cjs').runtimeEnvironment(),GH_PROMPT_DISABLED:'true'},repo.cwd);
            const {stdout}=await gitExec('gh',['pr','list','--state','open','--limit','30','--json','number,title,updatedAt,headRefName'],{cwd:repo.cwd,env,timeout:7000,windowsHide:true,maxBuffer:512*1024});
            const pulls=JSON.parse(stdout);lines.push('열린 GitHub 변경 요청 (조회 시점):\n'+(pulls.map(p=>'#'+p.number+' / '+p.title+' / '+p.updatedAt+' / '+p.headRefName).join('\n')||'없음'));
          }catch{lines.push('GitHub 변경 요청은 계정이나 원격 연결을 확인하지 못해 미확인입니다.');}
          if(gitData.limited||gitData.reason)lines.push('표시 범위가 제한된 Git 기록입니다.');
        }else lines.push(gitData.reason);
      }
      try{
        const notes=(await listArtifacts(await projectRoot(project))).artifacts.filter(a=>/\.(md|txt)$/i.test(a.path)&&/(workflow|progress|진행|회의록|plan|계획)/i.test(a.path)).slice(0,6);
        for(const note of notes){const {file,stat}=await artifactFile(await projectRoot(project),note.path);if(stat.size<=128*1024)lines.push('프로젝트 진행 문서 '+note.path+' (원문 참고):\n'+(await fs.readFile(file,'utf8')).slice(0,Math.max(500,Math.floor(perProject/8))));}
      }catch{lines.push('일부 진행 문서는 확인하지 못했습니다.');}
    }
  }
  return "\n" + lines.filter(Boolean).join("\n").slice(0, 48000) + "\n";
}
async function startWork(store, input, teamSlot) {
  if (!input || !kinds.includes(input.kind)) throw invalid();
  store.project(input.projectId);
  const title = required(input.title, 160);
  const workflow = newWorkflow(input.kind);
  for (const name of ["brief", "role", "audience", "from", "to", "searchMode", "researchDepth", "documentKind", "slideCount"])
    if (input[name] !== undefined) workflow[name] = input[name];
  if (input.reportProjects !== undefined) {
    workflow.reportProjects = input.reportProjects;
    validateWorkflow(workflow);
    for (const id of workflow.reportProjects) store.project(id);
  }
  if (teamSlot) workflow.teamSlot = { runId: teamSlot.runId, index: teamSlot.index, ...(teamSlot.mode && { mode: teamSlot.mode }), ...(teamSlot.isolated === true && { isolated: true }), ...(teamSlot.integration === true && {integration:true}) };
  if (!workflow.role) workflow.role = definitions[input.kind].role;
  if (input.sourceSessionId) {
    const source = store.session(input.sourceSessionId);
    if (source.projectId !== input.projectId) throw new Error("같은 프로젝트의 대화만 인계할 수 있습니다.");
    const messages = source.messages.filter((m) => m.role !== "system").slice(-16);
    workflow.source = {
      sessionId: source.id, title: source.title, summary: messages
        .map((m) => (m.role === "user" ? "사용자" : "답변") + " / " + m.text.slice(-2600)).join("\n\n").slice(-12000),
    };
  }
  const preferences = input.model || input.effort ? require("./chat-preferences.cjs").preferences({...(input.model?{model:input.model}:{}),...(input.effort?{effort:input.effort}:{})}) : undefined;
  return store.createSession(input.projectId, { title, workflow: validateWorkflow(workflow), ...(preferences && {preferences}) });
}
async function autoSaveWorkArtifact(store,id) {
  const session=store.session(id);
  if(!session.workflow || !lastAnswer(session))return null;
  const root=await projectRoot(store.project(session.projectId)),lastUser=session.messages.findLast(m=>m.role==='user');
  const existing=(await listArtifacts(root)).artifacts.filter(a=>a.sessionId===id&&Date.parse(a.modifiedAt)>=Date.parse(lastUser?.createdAt||session.createdAt));
  if(existing.length)return existing[0];
  const artifact=await saveArtifact(store,id,lastAnswer(session).id,session.workflow.kind === 'document' ? 'html' : 'md');
  if(session.workflow.kind==='document'){
    const html=await fs.readFile(path.join(root,...artifact.path.split('/')),'utf8');
    for(const format of ['pdf',...(/<section[^>]+class=["'][^"']*\bslide\b/i.test(html)?['pptx']:[])]){
      const output=await require('./html-export.cjs').exportHTML(format,session.title,html),target=path.join(root,...artifact.path.replace(/\.html$/,'.'+format).split('/'));
      try{await fs.writeFile(target,output,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    }
  }
  return artifact;
}
function registerWorkbench(register, store, { reveal, isRunning = () => false }) {
  const pending = new Map();
  function serialize(key, action) {
    const previous = pending.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    pending.set(key, next);
    return next.finally(() => { if (pending.get(key) === next) pending.delete(key); });
  }
  register("artifactAction", (projectId,input) => serialize(projectId,async()=>{
    const root=await projectRoot(store.project(projectId)),backupRoot=path.join(root,'.flowrium','artifact-trash');
    if(input?.action==='restore'){
      if(!uuid.test(input.id||''))throw invalid();
      const dir=await checkedDirectory(root,['.flowrium','artifact-trash',input.id]);
      const meta=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
      if(meta.projectId!==projectId)throw invalid();
      const parts=artifactParts(meta.path),name=parts.pop(),target=path.join(await checkedDirectory(root,parts,true),name);
      try{await fs.lstat(target);throw Error('같은 위치에 파일이 있어 복원하지 않았습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}
      const bytes=await fs.readFile(path.join(dir,'document'));
      if(createHash('sha256').update(bytes).digest('hex')!==meta.revision)throw Error('보관한 원본 확인값이 다릅니다.');
      await fs.writeFile(target,bytes,{flag:'wx',mode:0o600});
      return artifactInfo(meta.path,await fs.stat(target));
    }
    if(input?.action==='create'){
      const session=store.session(input.sessionId);if(session.projectId!==projectId||!['md','html'].includes(input.format)||typeof input.body!=='string'||!input.body.trim()||Buffer.byteLength(input.body)>2*1024*1024)throw invalid();
      const title=required(input.title,160),parts=['산출물',definitions[session.workflow?.kind||'task'].label,safeTitle(session.title)+'--'+session.id],dir=await checkedDirectory(root,parts,true);
      const name=safeTitle(title)+'--'+randomUUID()+'.'+input.format,relative=[...parts,name].join('/'),body=input.format==='html'?require('./html-export.cjs').isolatedHTML(input.body):input.body;
      await fs.writeFile(path.join(dir,name),body,{flag:'wx',mode:0o600});const artifact=artifactInfo(relative,await fs.stat(path.join(dir,name))),exports=[];
      if(input.format==='html')for(const format of ['pdf',...(/<section[^>]+class=["'][^"']*\bslide\b/i.test(input.body)?['pptx']:[])]){
        const output=await require('./html-export.cjs').exportHTML(format,title,body),filename=name.replace(/\.html$/,'.'+format);await fs.writeFile(path.join(dir,filename),output,{flag:'wx',mode:0o600});exports.push(artifactInfo([...parts,filename].join('/'),await fs.stat(path.join(dir,filename))));
      }
      return {artifact,exports};
    }
    const {file,stat}=await artifactFile(root,input?.path);
    if(stat.size>32*1024*1024)throw Error('처리 가능한 문서 크기는 32MB까지입니다.');
    const bytes=await fs.readFile(file),revision=createHash('sha256').update(bytes).digest('hex');
    if(input.action==='info')return {revision};
    if(input.action==='preview'){
      if(!/\.html?$/i.test(file))throw Error('HTML 문서를 선택해 주세요.');
      if(bytes.length>3*1024*1024)throw Error('HTML 미리보기는 3MB까지 가능합니다.');
      return {html:require('./html-export.cjs').isolatedHTML(bytes.toString('utf8')),source:bytes.toString('utf8'),revision};
    }
    if(input.revision!==revision)throw Error('문서가 변경됐습니다. 다시 열어 확인해 주세요.');
    if(input.action==='delete'||input.action==='edit'){
      if(input.action==='edit'&&(!/\.html?$/i.test(file)||typeof input.body!=='string'||Buffer.byteLength(input.body)>3*1024*1024))throw Error('수정할 HTML을 3MB 이내로 입력해 주세요.');
      const id=randomUUID(),dir=await checkedDirectory(root,['.flowrium','artifact-trash',id],true);
      await fs.writeFile(path.join(dir,'document'),bytes,{flag:'wx',mode:0o600});
      await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({projectId,path:input.path,revision,at:new Date().toISOString(),kind:input.action}),{flag:'wx',mode:0o600});
      if(createHash('sha256').update(await fs.readFile(file)).digest('hex')!==revision)throw Error('문서가 동시에 변경돼 기존 파일을 보존했습니다.');
      if(input.action==='delete'){await fs.unlink(file);return {id,path:input.path};}
      const temporary=file+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(temporary,input.body,{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
      return {id,path:input.path,revision:createHash('sha256').update(input.body).digest('hex')};
    }
    if(input.action==='reexport'){
      if(!/\.html?$/i.test(file)||!['pdf','pptx'].includes(input.format))throw Error('HTML 문서를 PDF 또는 PPTX로 변환하세요.');
      const relative=input.path.replace(/\.html?$/i,'')+'--'+revision.slice(0,12)+'.'+input.format;
      const parts=artifactParts(relative),name=parts.pop(),target=path.join(await checkedDirectory(root,parts,true),name);
      const output=await require('./html-export.cjs').exportHTML(input.format,path.basename(file),bytes.toString('utf8'));
      try{await fs.writeFile(target,output,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;throw Error('같은 변환 파일이 있습니다. 기존 파일을 보존했습니다.');}
      return artifactInfo(relative,await fs.stat(target));
    }
    throw invalid();
  }));
  register("readWorkbench", async (projectId) => {
    const root = await projectRoot(store.project(projectId));
    const [files, gitData] = await Promise.all([listArtifacts(root), gitOverview(root)]);
    return { ...files, git: gitData };
  });
  register("startWork", (input) => startWork(store, input));
  register("updateWork", (id, change) => serialize(id, async () => {
    if (!change || typeof change !== "object") throw invalid();
    const session = store.session(id);
    const previous = session.workflow;
    const next = structuredClone(previous || newWorkflow("task"));
    if (change.action === "status") {
      if (!statuses.includes(change.status)) throw invalid();
      if (change.status === next.status) return structuredClone(session);
      if (change.status === "done") {
        if (isRunning(id)) throw new Error("답변이 끝난 뒤 업무를 완료해 주세요.");
        const now = new Date().toISOString();
        const repository = await gitOverview(await projectRoot(store.project(session.projectId)), dayHere(session.createdAt), dayHere(now));
        if (isRunning(id)) throw new Error("답변이 끝난 뒤 업무를 완료해 주세요.");
        next.completion = { at: now, summary: compact(lastAnswer(session)?.text || "", 1000),
          commits: repository.commits.filter((c) => Date.parse(c.at) >= Date.parse(session.createdAt) && Date.parse(c.at) <= Date.parse(now)) };
      } else delete next.completion;
      next.status = change.status;
    } else {
      if (next.status === "done") throw new Error("업무를 재개한 뒤 체크리스트를 변경해 주세요.");
      if (change.action === "add") {
        next.checklist.push({ id: randomUUID(), text: required(change.text, 400), done: false });
      } else {
        const index = next.checklist.findIndex((i) => i.id === change.id);
        if (index < 0) throw new Error("체크리스트 항목을 찾을 수 없습니다.");
        if (change.action === "toggle") next.checklist[index].done = !next.checklist[index].done;
        else if (change.action === "remove") next.checklist.splice(index, 1);
        else throw invalid();
      }
    }
    if (store.session(id) !== session) throw new Error("업무 대화를 다시 열어 주세요.");
    session.workflow = validateWorkflow(next);
    const oldTime = session.updatedAt;
    const modified = new Date().toISOString();
    session.updatedAt = modified;
    try { await store.save(); }
    catch (error) {
      session.workflow = previous;
      if (session.updatedAt === modified) session.updatedAt = oldTime;
      throw error;
    }
    return structuredClone(session);
  }));
  register("saveWorkArtifact", (id, messageId, format) => serialize(id, () => {
    if (isRunning(id)) throw new Error("답변이 끝난 뒤 산출물로 저장해 주세요.");
    return saveArtifact(store, id, messageId, format);
  }));
  register("importWorkFiles", async (projectId, files) => {
    if (!Array.isArray(files) || !files.length || files.length > 20) throw new Error("문서는 한 번에 20개까지 추가할 수 있습니다.");
    if (files.some((f) => !f || !bounded(f.name, 180) || !(f.body instanceof Uint8Array) || f.body.byteLength > 16 * 1024 * 1024) ||
        files.reduce((sum, f) => sum + f.body.byteLength, 0) > 32 * 1024 * 1024)
      throw new Error("문서 한 개는 16MB, 한 번에 추가할 문서 합계는 32MB까지 가능합니다.");
    const root = await projectRoot(store.project(projectId));
    const parts = ["산출물", "가져온 문서"];
    const dir = await checkedDirectory(root, parts, true);
    const added = [], skipped = [];
    for (const f of files) {
      const name = f.name;
      if (!documents.has(path.extname(name).toLowerCase()) || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name.startsWith(".") ||
          /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        skipped.push({ name, reason: "지원하지 않는 파일 이름 또는 형식" }); continue;
      }
      const target = path.join(dir, name);
      let handle;
      try {
        handle = await fs.open(target, "wx", 0o600);
        await handle.writeFile(f.body);
        await handle.sync();
        const relative = [...parts, name].join("/");
        added.push(artifactInfo(relative, (await handle.stat())));
      } catch (error) {
        if (handle) {
          await handle.close(); handle = null;
          await fs.unlink(target).catch(() => {});
        }
        skipped.push({ name, reason: error.code === "EEXIST" ? "같은 이름의 파일이 이미 있음" : "파일을 저장하지 못함" });
      } finally { if (handle) await handle.close(); }
    }
    return { added, skipped };
  });
  register("readWorkArtifact", async (projectId, relative) => {
    const root = await projectRoot(store.project(projectId));
    const { file, stat } = await artifactFile(root, relative);
    if (!previewable.has(path.extname(file).toLowerCase())) throw new Error("이 형식은 파일 위치에서 열어 주세요.");
    if (stat.size > 3 * 1024 * 1024) throw new Error("미리보기 크기를 초과했습니다. 파일 위치에서 열어 주세요.");
    return fs.readFile(file, "utf8");
  });
  register("revealWorkArtifact", async (projectId, relative) => {
    const root = await projectRoot(store.project(projectId));
    const { file } = await artifactFile(root, relative);
    await reveal(file);
  });
}
module.exports = { registerWorkbench, startWork, workContext, validateWorkflow, saveArtifact, autoSaveWorkArtifact };
