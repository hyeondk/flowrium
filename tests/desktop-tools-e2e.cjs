const assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const { _electron:electron }=require("playwright");
const {Store}=require("../electron/store.cjs");
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-tools-e2e-"));let app;
 try{
  const store=new Store(path.join(temp,"profile"));await store.load();await store.saveSettings({codexPath:path.join(__dirname,"backend-fake-codex.cjs")});
  const env={...process.env,FLOWRIUM_USER_DATA:path.join(temp,"profile"),CODEX_HOME:path.join(temp,"codex")};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  app=await electron.launch({args:[path.resolve(__dirname,"..")],env});const page=await app.firstWindow();page.setDefaultTimeout(20000);
  const button=name=>page.getByRole("button",{name,exact:true});
  await button("뮤직").click();
  await page.getByLabel("음악 주소",{exact:true}).fill("https://music.youtube.com/playlist?list=PL123456789");
  await page.getByLabel("재생목록 이름",{exact:true}).fill("작업 음악");
  await page.locator(".music-lists").getByRole("button",{name:"추가",exact:true}).click();
  await page.getByRole("button",{name:"작업 음악",exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.flowrium.musicState())).lists[0].title,"작업 음악");
  await page.route("https://www.youtube.com/iframe_api",route=>route.fulfill({contentType:"text/javascript",body:`window.YT={Player:function(id,options){let state=2,time=0;Object.assign(this,{loadPlaylist(){state=1},loadVideoById(){state=1},setVolume(){},setLoop(){},setShuffle(){},mute(){},unMute(){},playVideo(){state=1},pauseVideo(){state=2},nextVideo(){},previousVideo(){},playVideoAt(){},seekTo(t){time=t},getPlayerState(){return state},getCurrentTime(){return time},getDuration(){return 180},getPlaylistIndex(){return 0},getVideoData(){return {title:'시험 음악',author:'시험용 플레이어'}},getPlaylist(){return ['sample-video']}});setTimeout(()=>options.events.onReady({target:this}),10)}};window.onYouTubeIframeAPIReady();`}));
  await button("작업 음악").click();
  await page.locator(".music-controls").getByText("시험 음악",{exact:true}).waitFor();
  await button("일시정지").click();await button("재생").waitFor();
  await page.getByRole("button",{name:"대시보드",exact:true}).click();await page.locator(".music-mini iframe").waitFor();
  await button("뮤직").click();await page.getByRole("button",{name:"가사 / 메모",exact:true}).click();
  await page.locator(".music-lyrics textarea").fill("직접 저장하는 메모");await page.locator(".music-lyrics textarea").blur();
  await page.waitForTimeout(120);
  const before=await page.evaluate(()=>window.flowrium.musicState());assert.equal(before.lists[0].lyrics,"직접 저장하는 메모");
  await button("작업 음악 삭제").click();
  await page.waitForFunction(()=>!document.querySelector(".music-list"));
  assert.equal((await page.evaluate(()=>window.flowrium.musicState())).lists.length,0);
  console.log("실제 앱 뮤직 목록·메모 저장, 외부 플레이어 모의 제어, 화면 전환 유지 및 목록 삭제 통과");
 }finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
