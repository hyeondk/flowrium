const assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const { _electron }=require("playwright");const {Store}=require("../electron/store.cjs");
async function main(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),"flowrium-team-auto-ui-")),folder=path.join(temp,"팀 검증 프로젝트"),profile=path.join(temp,"설정");
  await fs.mkdir(folder);const store=new Store(profile);await store.load();const project=await store.addProject(folder);
  await store.saveSettings({codexPath:path.join(__dirname,"backend-fake-codex.cjs")});
  const env={...process.env,FLOWRIUM_USER_DATA:profile,CODEX_HOME:path.join(temp,"codex")};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
  let app,page;const button=name=>page.getByRole("button",{name,exact:true});
  async function launch(){app=await _electron.launch({args:[path.resolve(__dirname,"..")],env,timeout:45000});page=await app.firstWindow();page.setDefaultTimeout(18000);
    await page.locator(".pf-card").filter({hasText:project.name}).click();await page.getByRole("navigation",{name:"프로젝트 상세 탭"}).getByRole("button",{name:"팀",exact:true}).click();}
  async function current(goal){return page.evaluate(async({id,goal})=>(await window.flowrium.readTeams(id)).runs.find(r=>r.prompt===goal),{id:project.id,goal});}
  try{
    await launch();await button("팀 만들기").click();await page.getByLabel("팀 이름").fill("선택형 자동 운영");
    await page.getByLabel("역할 이름").nth(0).fill("구현");await page.getByLabel("실행 모드").nth(0).selectOption("build");await page.getByLabel("역할 이름").nth(1).fill("검수");
    await button("역할 추가").click();await page.getByLabel("역할 이름").nth(2).fill("추가 조사");await page.getByLabel("역할 지시").nth(2).fill("빠진 근거를 추가 확인하세요.");
    await button("팀 저장").click();await page.getByLabel("업무 배정 방식").selectOption("plan");await page.getByText("참고 자료와 실행 설정",{exact:true}).click();
    assert.equal(await page.getByLabel("팀장 배정안이 나오면 등록한 역할에 자동 배부").isChecked(),false);
    assert.equal(await page.getByLabel("결과를 팀장이 검토하고 필요한 과업 추가 배정").isChecked(),false);
    await page.getByLabel("팀장 배정안이 나오면 등록한 역할에 자동 배부").check();await page.getByLabel("결과를 팀장이 검토하고 필요한 과업 추가 배정").check();
    await page.getByLabel("모든 담당자가 마치면 팀장에게 종합 보고 요청").check();await page.getByLabel("공동 요청").fill("동적추가시험");await button("팀장에게 배정안 요청").click();
    await page.getByRole("heading",{name:"완료",exact:true}).waitFor();let run=await current("동적추가시험");assert.equal(run.directed.nodes.length,3);assert.equal(run.directed.pmRounds,2);
    await page.getByText(new RegExp("^팀 메시지와 결정 기록")).click();assert.match(await page.locator(".team-directed").innerText(),/추가 배정/);
    await page.getByLabel("업무 배정 방식").selectOption("manual");await page.getByLabel("결과를 팀장이 검토하고 필요한 과업 추가 배정").uncheck();await page.getByLabel("검수 반려 사항을 구현 담당자에게 보내 보완 후 재검수").check();
    await page.getByLabel("공동 요청").fill("자동QA시험");await button("배정안 만들기").click();await page.getByRole("heading",{name:"배정안 검토",exact:true}).waitFor();
    await page.getByLabel("구현에게 배정").check();await page.getByLabel("검수에게 배정").check();await page.getByLabel("담당 과업").nth(0).fill("구현 결과를 만드세요.");await page.getByLabel("담당 과업").nth(1).fill("구현 근거를 검수하세요.");
    await page.getByLabel("먼저 완료할 구현 담당").selectOption("0");await button("선택한 담당자 실행").click();await page.getByRole("heading",{name:"완료",exact:true}).waitFor();
    run=await current("자동QA시험");assert.equal(run.directed.nodes.find(n=>n.index===1).qaRounds,1);assert(run.directed.notes.some(n=>n.type==="자동 보완"));
    assert.match(await fs.readFile(path.join(folder,run.directed.artifactPath),"utf8"),/팀 결과 보고/);
    await app.close();app=null;await launch();await page.locator(".team-entry").filter({hasText:"자동QA시험"}).click();await page.getByRole("heading",{name:"완료",exact:true}).waitFor();
    run=await current("자동QA시험");assert.equal(run.directed.autoQA,true);assert.equal(run.directed.nodes.find(n=>n.index===1).qaRounds,1);
    console.log("실제 팀 화면 / 자동 운영 기본 꺼짐 / 명시 자동 배부·추가 배정 / 보완 후 자동 재검수 / 실제 Codex 채널 응답 / 보고 파일 / 재실행 기록 보존 통과");
  }catch(error){if(page&&!page.isClosed())console.error("자동 팀 화면 진단",await page.locator("main").innerText().catch(()=>page.locator("body").innerText()));throw error;}
  finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:150});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
