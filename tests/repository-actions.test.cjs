const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os"),fs=require("node:fs/promises"),path=require("node:path");
const exec=require("node:util").promisify(require("node:child_process").execFile);
const {registerRepository}=require("../electron/repository-actions.cjs");

test("선택 커밋과 차이 / 별도 로컬 원격으로 푸시 / 대화 폴더와 상위 경로 보호",async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-git-"));
 t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150}));
 const cwd=path.join(temp,"검증 & 폴더"),remote=path.join(temp,"remote.git");
 await fs.mkdir(cwd);
 const git=(...args)=>exec("git",args,{cwd});
 await git("init","-b","main");await git("config","user.name","테스트");await git("config","user.email","test@example.invalid");
 await git("init","--bare",remote);await git("remote","add","origin",remote);
 await fs.writeFile(path.join(cwd,"기록.txt"),"최초");await fs.writeFile(path.join(cwd,"other.txt"),"제외");
 await fs.mkdir(path.join(cwd,".flowrium"));await fs.writeFile(path.join(cwd,".flowrium","private"),"보존");
 let action;const busy=registerRepository((_,fn)=>action=fn,{project:()=>({path:cwd})},()=>false);
 const act=input=>action("fixture",input);
 assert.deepEqual((await act({action:"changes"})).map(row=>row.file).sort(),["other.txt","기록.txt"].sort());
 await git("add","other.txt");
 await act({action:"commit",files:["기록.txt"],message:"선택 파일"});
 assert.equal((await git("-c","core.quotepath=false","ls-tree","--name-only","HEAD")).stdout.trim(),"기록.txt");
 await fs.writeFile(path.join(cwd,"기록.txt"),"다음");
 assert.match(await act({action:"diff",files:["기록.txt"]}),/다음/);
 await act({action:"push"});assert.equal((await git("rev-parse","origin/main")).stdout,(await git("rev-parse","HEAD")).stdout);
 for (const file of ["../some", ".flowrium/private", ".git/config"]) await assert.rejects(act({action:"commit",files:[file],message:"거부"}),/경로/);
 assert.equal(busy(),false);
});
