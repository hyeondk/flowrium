const assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const {_electron:electron}=require("playwright");
const {newProjectConversation,leaveConversation}=require("./shell-test-helpers.cjs");
const {Store}=require("../electron/store.cjs");
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-voice-lifecycle-"));let app;
 try{
  const store=new Store(temp+"/profile");await store.load();await fs.mkdir(temp+"/project");const project=await store.addProject(temp+"/project");
  await store.saveSettings({codexPath:path.join(__dirname,"backend-fake-codex.cjs")});
  const env={...process.env,FLOWRIUM_USER_DATA:temp+"/profile",CODEX_HOME:temp+"/codex"};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[path.resolve(__dirname,"..")],env});const page=await app.firstWindow();await page.setViewportSize({width:1440,height:1000});page.setDefaultTimeout(15000);
  await newProjectConversation(page,project.id);
  await page.getByLabel("Codex에 보낼 작업 요청").waitFor();
  await app.evaluate(({ipcMain})=>{
   ipcMain.removeHandler("flowrium:voiceStatus");ipcMain.handle("flowrium:voiceStatus",()=>({configured:true}));
   ipcMain.removeHandler("flowrium:allowVoiceCapture");ipcMain.handle("flowrium:allowVoiceCapture",()=>true);
  });
  await page.evaluate(()=>{
   window.voiceTest={stopped:0,recorders:0,requested:false};
   Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:()=>new Promise(resolve=>{window.voiceTest.requested=true;window.voiceTest.resolve=()=>resolve({getTracks:()=>[{stop:()=>window.voiceTest.stopped++}]});})});
   window.MediaRecorder=function(){window.voiceTest.recorders++;throw Error("새 녹음기가 만들어지면 실패");};
  });
  await page.getByRole("button",{name:"음성으로 입력",exact:true}).click();
  await page.waitForFunction(()=>window.voiceTest.requested);
  await leaveConversation(page);
  await page.getByRole("heading",{name:"프로젝트 대시보드",exact:true}).waitFor();
  await page.evaluate(()=>window.voiceTest.resolve());
  await page.waitForFunction(()=>window.voiceTest.stopped===1);
  assert.equal(await page.evaluate(()=>window.voiceTest.recorders),0);
  console.log("음성 권한 대기 중 화면 이동 후 늦은 스트림 즉시 종료 / 녹음·전사 시작 안 됨 확인");
 }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1});
