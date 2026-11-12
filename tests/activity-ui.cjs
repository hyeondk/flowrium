const assert = require("node:assert/strict");

async function verifyActivityUI(page) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const key = process.platform === "darwin" ? "Meta" : "Control";
  const snapshot = await page.evaluate(() => window.flowrium.readSystemActivity());
  assert.ok(snapshot.cpuPercent === null || (snapshot.cpuPercent >= 0 && snapshot.cpuPercent <= 100));
  assert.ok(snapshot.freeMemoryBytes >= 0 && snapshot.totalMemoryBytes >= snapshot.freeMemoryBytes);
  assert.ok(Number.isFinite(Date.parse(snapshot.measuredAt)));

  await button("대시보드").click();
  await button("작업 현황").click();
  await page.locator(".activity-metrics").waitFor();
  await page.getByRole("button", {name:/^전체 \d+$/}).click();
  await button("대화 열기").first().click();
  const composer = page.getByLabel("Codex에 보낼 작업 요청");
  await composer.fill("대기검증 / 전체 작업 현황에서 중단");
  await composer.press("Enter");
  await button("대시보드").click();
  await button("작업 현황").click();
  const row = page.locator(".flow-activity li").filter({hasText:"대기검증 / 전체 작업 현황에서 중단"});
  await row.getByRole("button", {name:"중단", exact:true}).click();
  await page.getByRole("button", {name:"실행 중 0", exact:true}).waitFor();
  await page.keyboard.press(key + "+2");
  await page.getByRole("heading", {name:"작업 기록", exact:true}).waitFor();
  await page.keyboard.press(key + "+,");
  const dialog = page.getByRole("dialog", {name:"설정",exact:true});
  await dialog.waitFor();
  await page.keyboard.press(key + "+1");
  assert.ok(await dialog.isVisible());
  await page.keyboard.press("Escape");
  await page.keyboard.press(key + "+1");
  await page.locator("[data-work-kind=task]").waitFor();
  await page.keyboard.press(key + "+n");
  await page.getByRole("heading", {name:"새 자유 대화",exact:true}).waitFor();
  console.log("실제 앱 검증 / 시스템 자원 / 전역 업무 목록 / 열기 / 중단 / 네 단축키와 모달 보호");
}

module.exports = { verifyActivityUI };
