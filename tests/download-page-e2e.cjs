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
  ]);
  const server = http.createServer(async (req, res) => {
    const file = req.url === "/" ? "index.html" : req.url.slice(1);
    if (!routes.has(file)) {
      res.writeHead(404).end();
      return;
    }
    const mime = file.endsWith(".png")
      ? "image/png"
      : file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".css")
          ? "text/css"
          : "text/javascript";
    res.writeHead(200, { "content-type": mime });
    res.end(await fs.readFile(path.join(root, file)));
  });
  let app;
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
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    let tag = "v0.3.0",
      error = false;
    await page.route(
      "https://api.github.com/repos/" + repository + "/releases/latest",
      (route) => {
        if (error) return route.fulfill({ status: 503, body: "unavailable" });
        const version = tag.slice(1),
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
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.getByRole("status").filter({ hasText: "2개 플랫폼" }).waitFor();
    const image = page.locator(".app-preview img");
    assert.equal(
      await image.evaluate(
        (e) => e.complete && e.naturalWidth === 1392 && e.naturalHeight === 930,
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
      /v0\.3\.0\/Flowrium-0\.3\.0-mac-arm64\.dmg$/,
    );
    tag = "v0.1.2";
    await page.reload();
    await page.getByRole("status").filter({ hasText: "1개 플랫폼" }).waitFor();
    assert.equal(
      await page.locator('[data-download="mac-arm64"]').getAttribute("href"),
      null,
    );
    error = true;
    await page.reload();
    await page.getByRole("button", { name: "다시 확인" }).waitFor();
    error = false;
    tag = "v0.3.0";
    await page.getByRole("button", { name: "다시 확인" }).click();
    await page.getByRole("status").filter({ hasText: "2개 플랫폼" }).waitFor();
    console.log(
      "공개 페이지 실제 브라우저 검증 / 실제 앱 이미지 / 네 화면 폭 / 미공증 안내 / 플랫폼 링크 / 이전 Mac 차단 / 재시도",
    );
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
