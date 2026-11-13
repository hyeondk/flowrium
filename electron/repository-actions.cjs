const fs = require("node:fs/promises");
const path = require("node:path");
const {execFile, spawn} = require("node:child_process");
const {promisify} = require("node:util");
const exec = promisify(execFile);
const {text} = require("./store.cjs");

function registerRepository(register, store, isUpdating, options = {}) {
  const busy = new Set();
  const readers = new Map();
  const handler = async (id, input) => {
    const project = store.project(text(id,"프로젝트 식별자",100));
    if(input?.action === "repositories") return require("./project-repositories.cjs").repositoriesFor(store,project,{includeHidden:true}).then(rows=>rows.map(({cwd,...row})=>row));
    const repository = await require("./project-repositories.cjs").repositoryFor(store,project,input?.repositoryId);
    const cwd = repository.cwd;
    if (!input || typeof input !== "object") throw new Error("저장소 작업을 확인해 주세요.");
    if (isUpdating() || busy.has(cwd)) throw new Error("실행 중인 작업이 끝난 뒤 다시 시도해 주세요.");
    const readOnly = ["changes","diff","prs","repoLocal","repoActivity","repoPull","repoIssue","repoOpen","accounts","identity"].includes(input.action);
    if (!readOnly && readers.has(cwd)) throw new Error("저장소 조회가 끝난 뒤 다시 시도해 주세요.");
    if (readOnly) readers.set(cwd,(readers.get(cwd)||0)+1);
    else busy.add(cwd);
    let selectedAccount=repository.account;
    let accountEnv;
    const run = async (command, args) => {
      try {
        let env = { ...require("./runtime.cjs").runtimeEnvironment(), GIT_TERMINAL_PROMPT:"0", GH_PROMPT_DISABLED:"true", ...(readOnly && {GIT_OPTIONAL_LOCKS:"0"}) };
        if (process.platform === "darwin") env.PATH += ":/opt/homebrew/bin:/usr/local/bin";
        if(selectedAccount && (command === "gh" || command === "git" && args[0] === "push")) {
          accountEnv ||= await require("./repository-auth.cjs").accountEnvironment(selectedAccount,env,cwd);
          env = {...env,...accountEnv};
        }
        const result = await exec(command,args,{cwd,env,encoding:"utf8",windowsHide:true,timeout:90000,maxBuffer:2*1024*1024});
        return result.stdout;
      } catch(error) {
        throw new Error(error.code === "ENOENT" ? `${command} 실행 파일을 찾을 수 없습니다.` :
          (error.stderr || error.stdout || error.message).trim().slice(-1800).replace(/(https?:\/\/)[^/\s]*@/g,"$1"));
      }
    };
    try {
      if(input.action === "accounts")return require("./repository-auth.cjs").accounts(require("./runtime.cjs").runtimeEnvironment(),cwd);
      if(input.action === "identity") {
        const identity={name:(await run("git",["config","user.name"]).catch(()=>"" )).trim(),email:(await run("git",["config","user.email"]).catch(()=>"" )).trim(),account:repository.account||"",warnings:[]};
        const origin=(await run("git",["remote","get-url","origin"]).catch(()=>"" )).trim();
        if(repository.account && /^(git@|ssh:)/.test(origin))identity.warnings.push("SSH 원격은 별도의 SSH 키 계정을 사용합니다. 선택한 GitHub 계정과 일치하는지 확인하세요.");
        if(!identity.name||!identity.email)identity.warnings.push("Git 커밋 작성자 이름과 이메일을 먼저 설정하세요.");
        if(repository.account && identity.email && !identity.email.toLowerCase().includes(repository.account.toLowerCase()))identity.warnings.push("커밋 이메일과 선택한 GitHub 계정 이름이 다릅니다. 작성자 설정을 확인하세요.");
        return identity;
      }
      if (input.action === "terminal") {
        if (process.platform === "darwin") await run("/usr/bin/open", ["-a","Terminal",cwd]);
        else if (process.platform === "win32") {
          const child=spawn(path.join(process.env.SystemRoot,"System32","cmd.exe"),["/d","/k"],{cwd,detached:true,stdio:"ignore",windowsHide:false});
          await new Promise((resolve,reject)=>{ child.once("spawn",resolve);child.once("error",reject); });
          child.unref();
        } else throw new Error("지원하지 않는 운영체제입니다.");
        return "프로젝트 폴더에서 터미널을 열었습니다.";
      }
      if (await fs.realpath((await run("git",["rev-parse","--show-toplevel"])).trim()) !== cwd)
        throw new Error("형상관리를 사용하려면 Git 저장소의 최상위 폴더를 연결해 주세요.");
      const {inspectionActions, inspectRepository} = require("./repository-inspection.cjs");
      if (inspectionActions.has(input.action)) return await inspectRepository(input, run);
      const git = (...args) => run("git",args);
      const branch = (await git("branch","--show-current")).trim();
      if (input.action === "changes") {
        const status = await git("status","--porcelain=v1","--no-renames","-z","--untracked-files=all");
        return status.split("\0").filter(Boolean).map(line=>({code:line.slice(0,2),file:line.slice(3)}))
          .filter(({file})=>file!==".flowrium" && !file.startsWith(".flowrium/")).slice(0,200);
      }
      if (input.action === "diff" || input.action === "commit") {
        if (!Array.isArray(input.files) || !input.files.length || input.files.length>200) throw new Error("파일을 선택해 주세요.");
        const files = input.files.map(name => {
          if (typeof name !== "string" || !name || name.includes("\0") || path.isAbsolute(name) || name.split(/[\\/]/).some(p=>["..",".git",".flowrium"].includes(p))) throw new Error("선택한 파일 경로를 확인해 주세요.");
          return ":(literal)" + name;
        });
        if (input.action === "diff") {
          const tracked = await git("diff","--no-ext-diff","--no-color","HEAD","--",...files).catch(async()=>git("diff","--cached","--no-ext-diff","--no-color","--",...files));
          return tracked.slice(0,80000) || "표시할 비교 내용이 없습니다. 새 파일은 첫 커밋 후 변경 내역을 비교할 수 있습니다.";
        }
        const message=text(input.message,"커밋 제목",240);
        await git("add","-A","--",...files);
        return await git("commit","--only","-m",message,"--",...files);
      }
      if (!branch || branch.startsWith("-")) throw new Error("이름이 있는 로컬 브랜치를 선택해 주세요.");
      if (input.action === "push") return (await git("push","--set-upstream","origin","HEAD:refs/heads/"+branch)) || "현재 브랜치를 원격 저장소로 푸시했습니다.";
      if (input.action === "prs") return JSON.parse(await run("gh",["pr","list","--limit","40","--json","number,title,headRefOid,headRefName,baseRefName,url"]));
      if (input.action === "createPR") {
        const base=text(input.base,"대상 브랜치",200);
        await git("check-ref-format","--branch",base);
        return await run("gh",["pr","create","--head",branch,"--base",base,"--title",text(input.title,"변경 요청 제목",240),"--body",text(input.body,"변경 요청 설명",10000)]);
      }
      if (input.action === "merge" && Number.isSafeInteger(input.number) && input.number>0 && /^[a-f0-9]{40,64}$/.test(input.head))
        return (await run("gh",["pr","merge",String(input.number),"--merge","--match-head-commit",input.head])) || "선택한 변경 요청을 병합했습니다.";
      throw new Error("지원하지 않는 저장소 작업입니다.");
    } finally {
      if (!readOnly) busy.delete(cwd);
      else if (readers.get(cwd)===1) readers.delete(cwd);
      else readers.set(cwd,readers.get(cwd)-1);
    }
  };
  register("repositoryAction", handler);
  const flowBusy = typeof store.file === "string" ? require("./repository-flow.cjs").registerRepositoryFlow(register,store,handler,{...options,isUpdating}) : () => false;
  return () => busy.size > 0 || readers.size > 0 || flowBusy();
}
module.exports = {registerRepository};
