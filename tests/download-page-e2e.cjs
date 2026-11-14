const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

async function run() {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "flowrium-download-ui-"),
  );
  const root = path.join(__dirname, "..", "docs"),
    repository = "hyeondk/flowrium";
  const routes = new Set([
    "index.html",
    "style.css",
    "site.js",
    "releases.mjs",
    "release-config.mjs",
    "mark.png",
    "workspace.png",
    "fonts/NanumSquareRoundR.woff2",
    "fonts/NanumSquareRoundB.woff2",
    "fonts/NanumSquareRoundEB.woff2",
    "fonts/OFL.txt",
  ]);
  const serverRequests=[];
  const server = http.createServer(async (req, res) => {
    serverRequests.push(req.url);
    const file = req.url === "/" ? "index.html" : req.url.slice(1);
    if (!routes.has(file)) {
      res.writeHead(404).end();
      return;
    }
    const mime = file.endsWith(".woff2")
      ? "font/woff2"
      : file.endsWith(".txt")
        ? "text/plain; charset=utf-8"
        : file.endsWith(".png")
          ? "image/png"
          : file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".css")
              ? "text/css"
              : "text/javascript";
    res.writeHead(200, { "content-type": mime });
    res.end(await fs.readFile(path.join(root, file)));
  });
  let app,page;
  const pending=new Set(),requestFailures=[],pageErrors=[];
  try {
    await new Promise((resolve, reject) =>
      server.once("error", reject).listen(0, "127.0.0.1", resolve),
    );
    const script = path.join(temp, "browser.cjs");
    await fs.writeFile(
      script,
      'const {BrowserWindow,app}=require("electron");app.whenReady().then(()=>{globalThis.win=new BrowserWindow({webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadURL("about:blank");});',
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      args: [script, "--user-data-dir=" + path.join(temp, "프로필")],
      env,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('request',request=>pending.add(request));
    page.on('requestfinished',request=>pending.delete(request));
    page.on('requestfailed',request=>{pending.delete(request);requestFailures.push({url:request.url(),error:request.failure()?.errorText});});
    page.on('pageerror',error=>pageErrors.push(error.message));
    let tag = "261114_01",
      error = false;
    await page.route(
      "https://api.github.com/repos/" + repository + "/releases/latest",
      (route) => {
        if (error) return route.fulfill({ status: 503, body: "unavailable" });
        const version = tag.startsWith("v")?tag.slice(1):tag,
          names = [
            "Flowrium-" + version + "-mac-arm64.dmg",
            "Flowrium-" + version + "-mac-arm64.zip",
            "Flowrium-" + version + "-win-x64.exe",
            "SHA256SUMS.txt",
          ];
        return route.fulfill({
          json: {
            draft: false,
            prerelease: false,
            tag_name: tag,
            assets: names.map((name) => ({
              name,
              state: "uploaded",
              size: 50000000,
              browser_download_url:
                "https://github.com/" +
                repository +
                "/releases/download/" +
                tag +
                "/" +
                name,
            })),
          },
        });
      },
    );
    await page.goto("http://127.0.0.1:" + server.address().port,{waitUntil:'domcontentloaded'});
    await page.getByRole("status").filter({ hasText: "2개 플랫폼" }).waitFor();
    const fonts=await page.evaluate(async()=>{
      const loaded=await Promise.all([400,700,800].map(weight=>document.fonts.load(weight+' 16px NanumSquareRound','Flowrium 프로젝트')));
      return{counts:loaded.map(rows=>rows.length),family:getComputedStyle(document.body).fontFamily};
    });
    assert.deepEqual(fonts.counts,[1,1,1]);assert.match(fonts.family,/NanumSquareRound/);
    for(const name of ['NanumSquareRoundR.woff2','NanumSquareRoundB.woff2','NanumSquareRoundEB.woff2'])assert.ok(serverRequests.includes('/fonts/'+name),'공식 로컬 글꼴 '+name);
    assert.match(await page.locator('.hero p').innerText(),/대화는 넓게 열리고, 필요하면 대시보드와 나란히 볼 수 있습니다/);
    assert.match(await page.locator('.app-preview figcaption').innerText(),/예시 프로젝트로 촬영한 실제 화면입니다.*대시보드와 나란히 보세요/);
    const image = page.locator(".app-preview img");
    await page.waitForFunction(()=>{const image=document.querySelector('.app-preview img');return image?.complete&&image.naturalWidth===1440&&image.naturalHeight===1000;});
    assert.equal(
      await image.evaluate(
        (e) => e.complete && e.naturalWidth === 1440 && e.naturalHeight === 1000,
      ),
      true,
    );
    assert.ok(
      await page.getByText(/Apple 미공증 버전은 직접 설치/).isVisible(),
    );
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "다운로드 가로폭 " + width,
      );
      assert.equal(
        await page
          .locator(".hero p")
          .evaluate((n) => getComputedStyle(n).wordBreak),
        "keep-all",
      );
    }
    assert.match(
      await page.locator('[data-download="mac-arm64"]').getAttribute("href"),
      /261114_01\/Flowrium-261114_01-mac-arm64\.dmg$/,
    );
    tag = "v0.1.2";
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole("status").filter({ hasText: "1개 플랫폼" }).waitFor();
    assert.equal(
      await page.locator('[data-download="mac-arm64"]').getAttribute("href"),
      null,
    );
    error = true;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole("button", { name: "다시 확인" }).waitFor();
    error = false;
    tag = "v0.3.0";
    await page.getByRole("button", { name: "다시 확인" }).click();
    await page.getByRole("status").filter({ hasText: "2개 플랫폼" }).waitFor();
    assert.deepEqual(pageErrors,[]);
    console.log(
      "공개 페이지 실제 브라우저 검증 / 공식 로컬 글꼴 3종 / 대화함과 자동 메뉴 소개 / 실제 앱 이미지 / 네 화면 폭 / 미공증 안내 / 플랫폼 링크 / 이전 Mac 차단 / 재시도",
    );
  } catch(error){
    console.error('다운로드 페이지 진단',JSON.stringify({pending:[...pending].map(request=>request.url()),requestFailures,pageErrors,serverRequests:serverRequests.slice(-80),readyState:page&&!page.isClosed()?await page.evaluate(()=>document.readyState).catch(()=>null):null}));
    throw error;
  } finally {
    if (app) await app.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 200,
    });
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
