const assert=require("node:assert/strict"),fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os");
const { _electron }=require("playwright");
const {Store}=require("../electron/store.cjs"),{registerMemory}=require("../electron/memory.cjs");
async function main(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-workflow-ui-")),profile=path.join(temp,"설정"),folder=path.join(temp,"기능 검증 프로젝트");
  await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await store.addProject(folder);
  const source=await store.createSession(project.id,{title:"원래 업무 대화"}),target=await store.createSession(project.id,{title:"조사 담당 대화"});
  const memory={};registerMemory((key,fn)=>memory[key]=fn,store);await memory.changeMemory(project.id,{action:"save",revision:null,scope:"project",title:"보관할 기준",body:"검증할 메모 본문",role:"",link:"",linked:true});
  await store.saveSettings({codexPath:path.join(__dirname,"backend-fake-codex.cjs")});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,"codex")};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  let app,page;
  async function launch(){app=await _electron.launch({args:[path.resolve(__dirname,"..")],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(18000);}
  const button=name=>page.getByRole("button",{name,exact:true});
  async function state(){return page.evaluate(()=>window.flowrium.workflowState());}
  async function wait(fn){for(let n=0;n<160;n++){const value=await state();if(fn(value))return value;await page.waitForTimeout(30);}throw Error("업무 연결 화면 검증 대기 시간 초과");}
  try{
    await launch();await button("업무 연결 / 비서").click();await page.getByRole("heading",{name:"업무 연결과 비서",exact:true}).waitFor();
    await button("대화에 전달").click();await page.getByLabel("보내는 대화",{exact:true}).selectOption(source.id);await page.getByLabel("받는 대화",{exact:true}).selectOption(target.id);
    await page.getByLabel("조사 요청 제목",{exact:true}).fill("분리한 자료 조사");await page.getByLabel("전할 내용",{exact:true}).fill("두 자료의 근거를 비교해 보고하세요.");
    await button("승인할 조사 요청 만들기").click();const proposal=page.locator(".workflow-card").filter({has:page.getByText("분리한 자료 조사",{exact:true})});await proposal.waitFor();
    assert.equal((await page.evaluate(()=>window.flowrium.bootstrap())).sessions.every(s=>s.messages.length===0),true);
    await proposal.getByRole("button",{name:"내용 확인하고 승인",exact:true}).click();
    let data=await wait(d=>d.proposals[0].status==="completed"&&d.deliveries.some(r=>r.kind==="result"&&r.status==="sent"));
    assert.equal(data.proposals[0].targetId,target.id);assert.match(data.proposals[0].result,/확인한 결과/);
    await page.getByLabel("처리한 기록",{exact:true}).check();await proposal.getByRole("button",{name:"목록에서 숨기기",exact:true}).click();await page.getByLabel("숨긴 항목과 미룬 항목",{exact:true}).check();
    await proposal.getByRole("button",{name:"목록에 복원",exact:true}).click();
    await page.getByRole("button",{name:/^알림 \d+$/}).click();await button("모두 읽음").click();await wait(d=>d.notifications.every(n=>n.readAt));
    await button("읽은 알림 정리").click();assert.equal((await state()).notifications.length,0);
    await button("비서와 예약").click();assert.equal(await page.getByLabel("정한 시간에 프로젝트 감시와 반복 목표 알림 켜기").isChecked(),false);
    await page.getByLabel("보고를 보관할 프로젝트",{exact:true}).selectOption(project.id);await button("비서 설정 저장").click();await button("지금 상태 보고").click();
    data=await wait(d=>d.reports[0]?.status==="completed");assert.match(data.reports[0].body,/# 프로젝트 현황 보고/);assert(data.reports[0].artifactPath);
    assert.match(await fs.readFile(path.join(folder,data.reports[0].artifactPath),"utf8"),/결정할 사항/);
    const when=new Date(Date.now()+120000);when.setSeconds(0,0);const local=new Date(when.getTime()-when.getTimezoneOffset()*60000).toISOString().slice(0,16);
    await page.getByLabel("알릴 시각",{exact:true}).fill(local);await page.getByLabel("알릴 내용",{exact:true}).fill("검증 예약 알림");await button("예약 알림 등록").click();await page.getByRole("heading",{name:"검증 예약 알림",exact:true}).waitFor();
    await app.close();app=null;await launch();await button("업무 연결 / 비서").click();data=await state();assert.equal(data.proposals[0].status,"completed");assert(data.reminders.some(r=>r.text==="검증 예약 알림"));assert.match(data.reports[0].body,/현황 보고/);
    await button("대시보드").click();await page.locator(".pf-card").filter({hasText:project.name}).click();await page.getByRole("navigation",{name:"프로젝트 상세 탭"}).getByRole("button",{name:"규칙",exact:true}).click();
    await page.getByText("메모 백업과 가져오기",{exact:true}).click();const output=path.join(temp,"기억 백업.json");
    await app.evaluate(({session},destination)=>{session.defaultSession.once("will-download",(_event,item)=>item.setSavePath(destination));},output);
    await button("기억 묶음 내보내기").click();let exported;for(let n=0;n<100;n++){try{exported=JSON.parse(await fs.readFile(output,"utf8"));break;}catch{await page.waitForTimeout(30);}}
    assert.equal(exported.format,"flowrium-memory");assert.equal(exported.notes[0].body,"검증할 메모 본문");
    exported.notes[0].body="가져오기 후 메모 본문";
    await page.getByLabel("기억 묶음 선택",{exact:true}).setInputFiles({name:"가져오기.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(exported))});
    await page.getByRole("heading",{name:"적용할 메모 선택",exact:true}).waitFor();await button("선택한 메모 가져오기").click();await page.getByRole("status").filter({hasText:"메모 1개를 적용"}).waitFor();
    await page.locator(".memory-list button").filter({hasText:"보관할 기준"}).click();assert.equal(await page.getByLabel("지시와 메모",{exact:true}).inputValue(),"가져오기 후 메모 본문");
    await button("기기 전체로 옮기기").click();await page.locator(".memory-list button").filter({hasText:"이 기기 전체"}).waitFor();
    await button("업무 연결 / 비서").click();for(const width of [390,768,1280]){await page.setViewportSize({width,height:900});const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dimensions.scroll<=dimensions.width+1,JSON.stringify(dimensions));}
    console.log("업무 연결 화면 / 조사 요청 승인과 실제 모델 응답·원대화 회신 / 결정 숨김복원 / 읽음과 알림정리 / AI 비서 보고·산출물 / 예약과 재실행 / 메모 백업·선택가져오기·범위이동 / 세 화면 폭 통과");
  }catch(error){if(page&&!page.isClosed())console.error("업무 연결 화면 진단",await page.locator("main").innerText().catch(()=>page.locator("body").innerText()));throw error;}
  finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
