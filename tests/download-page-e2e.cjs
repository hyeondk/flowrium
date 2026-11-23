const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

async function assertExampleImage(page, expectedPath) {
  await page.waitForFunction(path => {
    const image = document.querySelector('#example-dialog img');
    return image.complete && image.currentSrc && new URL(image.currentSrc).pathname === path &&
      image.naturalWidth >= 300 && image.naturalHeight >= 200;
  }, expectedPath);
  await page.locator('#example-dialog img').evaluate(image=>image.decode());
}

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
    "workspace-sales.png",
    "workspace-sales-chat.png",
    "sales-example.mjs",
    "fonts/NanumSquareRoundR.woff2",
    "fonts/NanumSquareRoundB.woff2",
    "fonts/NanumSquareRoundEB.woff2",
    "fonts/OFL.txt",
  ]);
  const serverRequests=[];
  let imageGate;
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
    if (file === 'workspace-sales.png' && imageGate) await imageGate.promise;
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
      error = false, missing = false, noRelease = false;
    await page.route(
      "https://api.github.com/repos/" + repository + "/releases/latest",
      (route) => {
        if (noRelease) return route.fulfill({ status: 404, body: "{}" });
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
            assets: (missing ? [] : names).map((name) => ({
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
    const { monthlySales, amount, growthPercent, salesAnswer } = await import('../docs/sales-example.mjs');
    assert.deepEqual(monthlySales, [2400,2700,2550,3000,3200,3600]);
    assert.equal(growthPercent, 50);
    assert.equal(await page.locator('.hero h1').textContent(), '자료를 보며 AI와 일하세요.');
    assert.equal(await page.locator('.hero-copy > p').textContent(), '프로젝트 자료를 펼쳐 두고, 오른쪽 대화에서 수정을 요청하세요. 완성한 문서는 같은 프로젝트에 보관할 수 있습니다.');
    assert.deepEqual(await page.locator('.features h3').allTextContents(), ['오늘 할 일 확인하기','답변을 문서로 남기기','휴대폰에서 이어보기']);
    assert.equal((await page.locator('.product-example figcaption').textContent()).includes('가상의 매출 데이터로 구성한 예시 화면입니다.'),true);
    assert.deepEqual(await page.locator('.sales-bars data').allTextContents(),monthlySales.map(amount));
    assert.deepEqual(await page.locator('.sales-bars li > span').allTextContents(),monthlySales.map((_, i) => (i+1)+'월'));
    assert.match(await page.locator('.install-note').first().textContent(), /해당 버전의 릴리스/);
    assert.doesNotMatch(await page.locator('body').innerText(), /산책길|중앙역|벤치|노선도/);
    assert.match(await page.locator('meta[name=description]').getAttribute('content'), /온라인 스토어 매출 분석/);
    const client = await page.context().newCDPSession(page);
    const {root:doc} = await client.send('DOM.getDocument');
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    for (const selector of ['.hero h1 span','.hero-platforms','.download-button','.chart-title b','.sales-bars data']) {
      const {nodeId} = await client.send('DOM.querySelector', {nodeId:doc.nodeId, selector});
      const {fonts} = await client.send('CSS.getPlatformFontsForNode',{nodeId});
      assert(fonts.some(f=>f.isCustomFont && /NanumSquareRound|나눔스퀘어라운드/i.test(f.familyName) && f.glyphCount>0),selector+'의 실제 웹글꼴');
    }
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(),'본문으로 이동');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'),'main');
    assert.match(await page.locator('.getting-started .section-intro').textContent(),/첫 작업.*폴더를 신뢰/);
    const downloadOrigin = new URL(page.url()).origin;
    for (const [label, fragment, region, command] of [
      ["터미널로 설치", "#mac-terminal", "Mac 터미널", "bash Flowrium-install.sh"],
      ["PowerShell로 설치", "#windows-terminal", "Windows PowerShell", "& '.\\Flowrium-install.ps1'"],
    ]) {
      await page.getByRole("link", {name: label, exact: true}).click();
      assert.equal(new URL(page.url()).origin, downloadOrigin);
      assert.equal(new URL(page.url()).hash, fragment);
      const instructions=page.getByRole("article", {name: region});
      assert.ok(await instructions.getByText(command, {exact: true}).isVisible());
      const download=await instructions.locator("pre code").first().textContent();
      assert.match(download, /https:\/\/github\.com\/hyeondk\/flowrium\/releases\/latest\/download\/install\.(sh|ps1)/);
      assert.doesNotMatch(download, /\|\s*(bash|sh|powershell)|Invoke-Expression|ExecutionPolicy/);
    }
    await page.evaluate(()=>{
      Object.defineProperty(navigator, "clipboard", {configurable:true, value:{
        writeText(value) {
          if (window.rejectClipboard) return Promise.reject(Error("clipboard unavailable"));
          window.copiedCommand=value;
          return Promise.resolve();
        },
      }});
    });
    await page.getByRole("button", {name: "윈도우 내려받기 명령 복사"}).click();
    await page.getByRole("status").filter({hasText:"명령을 클립보드에 복사했습니다"}).waitFor();
    assert.equal(await page.evaluate(()=>window.copiedCommand),await page.locator("#win-download-command").textContent());
    await page.evaluate(()=>window.rejectClipboard=true);
    await page.getByRole("button", {name: "맥 설치 명령 복사"}).click();
    await page.getByRole("status").filter({hasText:"선택한 명령을 키보드로 복사"}).waitFor();
    assert.equal(await page.evaluate(()=>window.getSelection().toString()),"bash Flowrium-install.sh");
    await page.getByRole("link", {name:"운영체제별 안내"}).click();
    assert.equal(new URL(page.url()).hash, "#security-help");
    await page.locator("#security-help .help-answer").waitFor();
    await page.locator("#security-help summary").press("Enter");
    await page.locator("#security-help .help-answer").waitFor({state:"hidden"});
    await page.getByRole("link", {name:"운영체제별 안내"}).click();
    await page.locator("#security-help .help-answer").waitFor();
    await page.getByRole("link", {name:"기존 앱 업데이트"}).click();
    assert.equal(new URL(page.url()).hash, "#update-help");
    await page.locator("#update-help .help-answer").waitFor();
    await page.getByRole("link", {name:"설치 후 시작하기"}).click();
    assert.equal(new URL(page.url()).hash, "#start");
    assert.equal(await page.locator(".start-steps li").count(),3);
    const detachedDocs = await page.locator('a[href*="/blob/"][href$=".md"]').evaluateAll(links =>
      links.every(link => link.closest(".guide-links,.help-answer")));
    assert.equal(detachedDocs,true,"일반 안내의 이동은 홈페이지 안에서 완료");
    await page.setViewportSize({width:1440,height:900});
    imageGate = Promise.withResolvers();
    try {
      const desktopRequest = page.waitForRequest(request=>new URL(request.url()).pathname==='/workspace-sales.png');
      await page.locator('#example-open').click();
      await desktopRequest;
      await page.setViewportSize({width:320,height:844});
      imageGate.resolve();
      await assertExampleImage(page,'/workspace-sales-chat.png');
      await page.keyboard.press('Escape');
    } finally { imageGate.resolve(); imageGate=undefined; }
    const captures = process.env.FLOWRIUM_SITE_SCREENSHOTS;
    if(captures) await fs.mkdir(captures,{recursive:true});
    for (const width of [320,390,768,1440]) {
      await page.setViewportSize({ width, height: width>=768?900:844 });
      await page.evaluate(()=>{ document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,0); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),'다운로드 가로폭 '+width);
      assert.equal(await page.locator('.hero-copy > p').evaluate(e=>getComputedStyle(e).wordBreak),'keep-all');
      const commandFits = await page.locator('.command-block pre').evaluateAll(blocks=>blocks.every(block=>block.scrollWidth<=block.clientWidth+1));
      assert.ok(commandFits,'설치 명령 가로폭 '+width);
      assert.deepEqual(await page.locator('.sales-bars data').allTextContents(), monthlySales.map(amount));
      const heights = await page.locator('.sales-bars i').evaluateAll(nodes=>nodes.map(e=>e.getBoundingClientRect().height));
      assert(heights[2] < heights[1] && heights[5] > heights[4], '3월의 하락과 6월의 최고 매출');
      if(captures && [390,768,1440].includes(width)) await page.screenshot({path:path.join(captures,'homepage-'+width+'.png'),animations:'disabled'});
      await page.locator('#example-open').click();
      const dialog = page.getByRole('dialog',{name:'온라인 스토어 매출 분석'});
      await dialog.waitFor();
      assert.equal(await dialog.locator('[data-sales-summary]').textContent(),salesAnswer);
      assert.deepEqual(await dialog.locator('tbody td').allTextContents(),monthlySales.map(amount));
      await assertExampleImage(page,width<=620?'/workspace-sales-chat.png':'/workspace-sales.png');
      const close = dialog.getByRole('button',{name:'예시 화면 닫기'});
      assert.equal(await close.textContent(),'닫기');
      const closeBox = await close.boundingBox();
      assert.ok(closeBox.height>=44 && closeBox.x+closeBox.width<=width);
      assert.equal(await close.locator('svg[aria-hidden="true"]').count(),1);
      await close.click();
      await dialog.waitFor({state:'hidden'});
      assert.equal(await page.locator(':focus').getAttribute('id'),'example-open');
      await page.locator('.hero-actions a[href="#workspace"]').click();
      assert.equal(new URL(page.url()).hash,'#workspace');
      await page.locator('.hero-actions a[href="#download"]').click();
      assert.equal(new URL(page.url()).hash,'#download');
      await page.evaluate(()=>document.documentElement.style.fontSize='200%');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '확대 글자 가로폭 '+width);
      const legible = await page.locator('.sales-bars data').evaluateAll(nodes=>{
        const cells=nodes.map(node=>node.getBoundingClientRect());
        return cells.every((cell,i)=>cells.slice(i+1).every(other=>other.top>=cell.bottom-1 || cell.top>=other.bottom-1 || other.left>=cell.right-1 || cell.left>=other.right-1));
      });
      assert(legible,'확대 글자의 월별 매출 숫자가 서로 겹치지 않음 '+width);
      await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
    }
    for (const [selector,surface] of [['.hero-platforms','#deecfc'],['.product-example figcaption','#deecfc'],['.download-card small','#ffffff'],['.sales-bars data','#ffffff']]) {
      const ratio=await page.locator(selector).first().evaluate((node,color)=>{
        const rgb=getComputedStyle(node).color.match(/[0-9.]+/g).slice(0,3).map(Number);
        const bg=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
        const luminance=values=>values.map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
        const a=luminance(rgb),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      },surface);
      console.log('글자 대비',selector,ratio.toFixed(2));
      assert.ok(ratio>=4.5,selector);
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
    assert(await page.getByRole('button',{name:'다시 확인'}).isVisible());
    noRelease = true;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('status').filter({hasText:'첫 공개 릴리스'}).waitFor();
    assert.equal(await page.locator('[data-download][href]').count(),0);
    noRelease = false; missing = true;
    await page.getByRole('button',{name:'다시 확인'}).click();
    await page.getByRole('status').filter({hasText:'설치 파일을 추가'}).waitFor();
    assert.equal(await page.locator('[data-download][href]').count(),0);
    missing = false;
    error = true;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole("button", { name: "다시 확인" }).waitFor();
    error = false;
    tag = "v0.3.0";
    await page.getByRole("button", { name: "다시 확인" }).click();
    await page.getByRole("status").filter({ hasText: "2개 플랫폼" }).waitFor();
    assert.deepEqual(pageErrors,[]);
    console.log(
      "공개 페이지 실제 브라우저 / 로컬 웹폰트와 매출 그래프 / 네 화면 폭과 글씨 확대 / 설치 명령 복사와 홈페이지 도움말 / 키보드 / 실제 앱 사진 / 다운로드 상태와 재시도",
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
