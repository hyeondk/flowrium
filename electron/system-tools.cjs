const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const exec = promisify(execFile);
let previousWindowsCpu = new Map();
function commandEnv() {
  try {
    return require("./runtime.cjs").runtimeEnvironment();
  } catch {
    return {
      ...process.env,
      PATH:
        process.env.PATH +
        (process.platform === "darwin"
          ? ":/opt/homebrew/bin:/usr/local/bin"
          : ""),
    };
  }
}
async function processList() {
  if (process.platform === "darwin") {
    const { stdout } = await exec(
      "/bin/ps",
      ["-U", String(process.getuid()), "-o", "pid=,pcpu=,rss=,comm="],
      { timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    return stdout.split("\n").flatMap((line) => {
      const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
      return m
        ? [
            {
              pid: Number(m[1]),
              cpu: Number(m[2]),
              memoryBytes: Number(m[3]) * 1024,
              name: path.basename(m[4]),
            },
          ]
        : [];
    });
  }
  const ps = path.join(
    process.env.SystemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script =
    "Get-Process | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId } | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress";
  const { stdout } = await exec(
    ps,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const value = JSON.parse(stdout || "[]");
  const now = Date.now();
  const next = new Map();
  const rows = (Array.isArray(value) ? value : [value]).map(v => {
    const prior = previousWindowsCpu.get(v.Id);
    const cpu = typeof v.CPU === "number" && prior && now > prior.at
      ? Math.max(0, Math.min(100, Math.round((v.CPU - prior.value) * 100000 / (now - prior.at) / require("node:os").cpus().length)))
      : null;
    if (typeof v.CPU === "number") next.set(v.Id, { value: v.CPU, at: now });
    return { pid: v.Id, name: v.ProcessName, cpu, memoryBytes: v.WorkingSet64 };
  });
  previousWindowsCpu = next;
  return rows;
}
async function processIdentity(pid) {
  if(process.platform === 'darwin')return (await exec('/bin/ps',['-p',String(pid),'-o','lstart=,comm='],{timeout:8000,env:{...process.env,LC_ALL:'C'}})).stdout.trim();
  const bin=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const script='$p=Get-Process -Id '+pid+' -ErrorAction Stop; [string]$p.StartTime.ToUniversalTime().Ticks + " " + $p.Path';
  return (await exec(bin,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:10000,windowsHide:true})).stdout.trim();
}
function registerSystemTools(register, store, options = {}) {
  const { canRun = () => true } = options;
  const storage = typeof store.file === "string" ? require("./storage-tools.cjs").registerStorageTools(register,store,options) : {isBusy:()=>false};
  const services = new Map();
  let stopping = false;
  async function scripts(id) {
    const repos=await require("./project-repositories.cjs").repositoriesFor(store,store.project(id));
    const all=[];
    for(const repo of repos){
      const file=path.join(repo.cwd,"package.json");
      try { if((await fs.stat(file)).size>1024*1024)throw Error("package.json 파일이 너무 큽니다.");
        const value=JSON.parse(await fs.readFile(file,"utf8"));
        for(const script of Object.keys(value.scripts||{}).filter(v=>v&&v.length<150))all.push(repos.length===1&&repo.path==='.'?script:repo.id+'::'+script);
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    const project=store.project(id);
    if(project.id && typeof store.file === "string")for(const service of (await require("./project-details.cjs").readDetails(store,id)).services||[])all.push("service::"+service.id);
    return all;
  }
  const snapshot = (s) => ({
    id: s.id,
    projectId: s.projectId,
    script: s.script,
    state: s.state,
    code: s.code,
    output: s.output,
  });
  async function stopService(id) {
    const s = services.get(id);
    if (!s) throw Error("실행 기록을 찾을 수 없습니다.");
    if (s.state !== "running") return;
    if (process.platform === "win32")
      await exec("taskkill.exe", ["/PID", String(s.child.pid), "/T"], {
        timeout: 10000,
        windowsHide: true,
      }).catch(() => {});
    else
      try {
        process.kill(-s.child.pid, "SIGTERM");
      } catch {}
    await Promise.race([s.exited, new Promise((r) => setTimeout(r, 2500))]);
    if (s.state === "running") {
      if (process.platform === "win32")
        await exec("taskkill.exe", ["/PID", String(s.child.pid), "/T", "/F"], {
          timeout: 10000,
          windowsHide: true,
        }).catch(() => {});
      else
        try {
          process.kill(-s.child.pid, "SIGKILL");
        } catch {}
      await s.exited;
    }
  }
  register("systemProcesses", async () => {
    const rows = await processList();
    return rows.sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 80);
  });
  const stopSystemProcess = async (pid) => {
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      pid === process.pid ||
      pid === process.ppid
    )
      throw Error("종료할 프로세스를 확인해 주세요.");
    const selected = (await processList()).find((p) => p.pid === pid);
    if (
      !selected ||
      !/^(node|python[\d.]*|java|ruby|php|dotnet|deno|bun|vite|npm)(\.exe)?$/i.test(
        selected.name,
      )
    )
      throw Error("사용자 개발 프로세스만 이 화면에서 종료할 수 있습니다.");
    for (const s of services.values())
      if (s.child.pid === pid) return stopService(s.id);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      throw Error(
        "프로세스를 종료하지 못했습니다. 접근 권한이나 실행 상태를 확인해 주세요.",
      );
    }
  };
  register("stopSystemProcess",stopSystemProcess);
  const processPlans = new Map();
  register('analyzeSystemProcesses',async()=>{
    if(stopping||!canRun())throw Error('실행 상태를 확인한 뒤 다시 분석하세요.');
    if(typeof options.analyzeProcesses !== 'function')throw Error('Codex 프로세스 분석 연결을 준비하지 못했습니다. 계정 연결 상태를 확인해 주세요.');
    const rows=(await processList()).filter(p=>p.pid!==process.pid&&p.pid!==process.ppid);
    const result=await options.analyzeProcesses(rows.map(({pid,name,cpu,memoryBytes})=>({pid,name,cpu,memoryBytes})));
    if(stopping||!canRun())throw Error('실행 상태가 변경돼 분석 결과를 적용하지 않았습니다.');
    if(!result||!Array.isArray(result.candidates)||result.candidates.length>20)throw Error('AI 분석 결과 형식을 확인하지 못했습니다.');
    const candidates=[],identities={};
    for(const c of result.candidates){
      const row=rows.find(p=>p.pid===c.pid);
      if(!row||!/^(node|python[\d.]*|java|ruby|php|dotnet|deno|bun|vite|npm)(\.exe)?$/i.test(row.name)||typeof c.reason!=='string'||!c.reason.trim())continue;
      let identity;try{identity=await processIdentity(c.pid);}catch{continue;}
      if(/(?:Flowrium|ChatGPT|Codex)[\\/].*Contents|(?:Flowrium|ChatGPT|Codex)\.app/i.test(identity))continue;
      if(candidates.some(v=>v.pid===c.pid))continue;
      candidates.push({...row,reason:c.reason.slice(0,1000)});identities[c.pid]=identity;
    }
    const token=randomUUID();processPlans.clear();processPlans.set(token,{at:Date.now(),identities});
    return {token,candidates,summary:typeof result.summary==='string'?result.summary.slice(0,3000):''};
  });
  register('stopSystemProcesses',async input=>{
    if(stopping||!canRun())throw Error('실행 상태를 확인한 뒤 다시 종료하세요.');
    const plan=processPlans.get(input?.token);
    if(!plan||Date.now()-plan.at>5*60*1000||!Array.isArray(input.pids)||!input.pids.length||new Set(input.pids).size!==input.pids.length)throw Error('분석 결과를 다시 확인하고 종료할 항목을 선택하세요.');
    for(const pid of input.pids)if(!plan.identities[pid]||await processIdentity(pid)!==plan.identities[pid])throw Error('프로세스가 종료됐거나 다시 실행됐습니다. 분석을 다시 하세요.');
    const stopped=[];
    for(const pid of input.pids){if(stopping||!canRun()||await processIdentity(pid)!==plan.identities[pid])throw Error('프로세스 실행 상태가 변경돼 중단했습니다.');await stopSystemProcess(pid);stopped.push(pid);}
    processPlans.delete(input.token);return {stopped};
  });
  register("dockerContainers", async () => {
    try {
      const { stdout } = await exec(
        "docker",
        ["ps", "-a", "--format", "{{json .}}"],
        {
          env: commandEnv(),
          timeout: 15000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
      return {
        available: true,
        containers: stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const v = JSON.parse(line);
            return {
              id: v.ID,
              name: v.Names,
              image: v.Image,
              status: v.Status,
            };
          }),
      };
    } catch {
      return {
        available: false,
        message: "Docker Desktop 실행 상태와 명령 설치를 확인해 주세요.",
        containers: [],
      };
    }
  });
  register("controlContainer", async (id, action) => {
    if (
      typeof id !== "string" ||
      !/^[a-f0-9]{12,64}$/.test(id) ||
      !["start", "stop", "restart"].includes(action)
    )
      throw Error("컨테이너 작업을 확인해 주세요.");
    await exec("docker", [action, id], {
      env: commandEnv(),
      timeout: 45000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
  });
  register("projectScripts", scripts);
  register("listServices", () => [...services.values()].map(snapshot));
  register("runService", async (projectId, script) => {
    if (stopping || !canRun())
      throw Error("앱 업데이트가 끝난 뒤 실행해 주세요.");
    if (!(await scripts(projectId)).includes(script))
      throw Error("프로젝트에 등록된 실행 명령을 선택해 주세요.");
    if (
      [...services.values()].some(
        (s) =>
          s.projectId === projectId &&
          s.script === script &&
          s.state === "running",
      )
    )
      throw Error("같은 명령이 이미 실행 중입니다.");
    const [repositoryId,scriptName] = script.includes("::") ? script.split("::") : [undefined,script];
    const custom=repositoryId === 'service' ? (await require('./project-details.cjs').readDetails(store,projectId)).services?.find(s=>s.id===scriptName) : null;
    if(repositoryId === 'service' && !custom)throw Error('서비스 설정을 다시 확인하세요.');
    const cwd = custom ? await require('./project-repositories.cjs').inside(await fs.realpath(store.project(projectId).path),custom.cwd) : (await require("./project-repositories.cjs").repositoryFor(store,projectId,repositoryId)).cwd,
      env = commandEnv(),
      id = randomUUID();
    // npm의 CLI 스크립트를 node로 직접 실행해 Windows 명령 문자열 인용을 피한다.
    let command = process.platform === "win32" ? "npm.cmd" : "npm",
      args = ["run", scriptName];
    try {
      const runtime = require("./runtime.cjs").runtimePaths();
      if (runtime.npmCli) {
        command = runtime.node;
        args = [runtime.npmCli, "run", scriptName];
      }
    } catch {}
    if (process.platform === "win32" && command === "npm.cmd")
      throw Error(
        "내장 Node.js 런타임을 찾지 못했습니다. 앱을 다시 설치해 주세요.",
      );
    if(custom){
      command=process.platform === 'win32' ? path.join(process.env.SystemRoot,'System32','cmd.exe') : '/bin/sh';
      args=process.platform === 'win32' ? ['/d','/s','/c',custom.command] : ['-lc',custom.command];
    }
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const s = {
      id,
      projectId,
      script,
      state: "running",
      code: null,
      output: "",
      child,
    };
    services.set(id, s);
    const append = (data) => {
      s.output = (s.output + data.toString("utf8")).slice(-200000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    s.exited = new Promise((resolve) => {
      child.once("error", (error) => {
        s.output +=
          "\n실행 파일을 열지 못했습니다. Node.js 준비 상태를 확인해 주세요.";
        s.state = "done";
        s.code = -1;
        resolve();
      });
      child.once("exit", (code) => {
        s.state = "done";
        s.code = code;
        resolve();
      });
    });
    return snapshot(s);
  });
  register("stopService", stopService);
  return {
    isBusy: () => storage.isBusy() || [...services.values()].some((s) => s.state === "running"),
    shutdown: async () => {
      stopping = true;
      await Promise.allSettled([...services.keys()].map(stopService));
    },
  };
}
module.exports = { registerSystemTools, processList };
