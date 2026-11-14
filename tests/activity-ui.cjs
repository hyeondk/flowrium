const assert = require("node:assert/strict");

async function verifyActivityUI(page) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const key = process.platform === "darwin" ? "Meta" : "Control";
  const snapshot = await page.evaluate(() => window.flowrium.readSystemActivity());
  assert.ok(snapshot.cpuPercent === null || (snapshot.cpuPercent >= 0 && snapshot.cpuPercent <= 100));
  assert.ok(snapshot.freeMemoryBytes >= 0 && snapshot.totalMemoryBytes >= snapshot.freeMemoryBytes);
  assert.ok(Number.isFinite(Date.parse(snapshot.measuredAt)));

  const goDashboard=async()=>{const side=page.locator('.workspace-side');await side.hover();await side.getByRole('button',{name:'대시보드',exact:true}).click();};
  await goDashboard();
  await button("작업 현황").click();
  await page.locator(".activity-metrics").waitFor();
  for(const label of ['작업중','대기','결정'])await page.locator('.activity-filter').getByRole('button',{name:new RegExp('^'+label+' \\d+$')}).waitFor();
  await page.getByRole("button", {name:/^전체 \d+$/}).click();
  await button("대화 열기").first().click();
  const composer = page.getByLabel("Codex에 보낼 작업 요청");
  await composer.fill("대기검증 / 전체 작업 현황에서 중단");
  await composer.press("Enter");
  await goDashboard();
  await button("작업 현황").click();
  const row = page.locator(".flow-activity li").filter({hasText:"대기검증 / 전체 작업 현황에서 중단"});
  await row.getByRole("button", {name:"중단", exact:true}).click();
  await page.locator('.activity-filter').getByRole("button", {name:"작업중 0", exact:true}).waitFor();
  await page.keyboard.press(key + "+2");
  await page.getByRole("heading", {name:"작업 기록", exact:true}).waitFor();
  await page.keyboard.press(key + "+,");
  const dialog = page.getByRole("dialog", {name:"설정",exact:true});
  await dialog.waitFor();
  await page.keyboard.press(key + "+1");
  assert.ok(await dialog.isVisible());
  await page.keyboard.press("Escape");
  await dialog.waitFor({state:'hidden'});
  await page.keyboard.press(key + "+1");
  await page.locator("[data-work-kind=task]").waitFor();
  const before=await page.evaluate(async()=>(await window.flowrium.bootstrap()).sessions.map(s=>s.id));
  await page.keyboard.press(key + "+n");
  await page.waitForFunction(async count=>(await window.flowrium.bootstrap()).sessions.length===count+1,before.length);
  const created=await page.evaluate(async ids=>(await window.flowrium.bootstrap()).sessions.find(s=>!ids.includes(s.id)),before);
  await page.locator('.conversation-dock').getByRole("heading", {name:created.title,exact:true}).waitFor();
  assert.equal(created.messages.length,0,'새 대화 단축키는 실제 빈 대화를 생성');
  assert.equal(created.workflow,undefined,'새 대화는 이전 업무 역할을 복제하지 않음');
  assert.equal(await page.locator('.app-shell').getAttribute('data-chat-focus'),'false','새 대화는 본 화면을 가리지 않음');
  assert(await page.locator('[data-work-kind=task]').isVisible(),'새 대화를 열어도 가운데 업무 보드 유지');
  console.log("실제 앱 검증 / 시스템 자원 / 작업중·대기·결정과 전체 목록 / 열기 / 중단 / 네 단축키와 모달 보호 / 빈 대화 실제 생성과 가운데 화면 유지");
}

module.exports = { verifyActivityUI };
