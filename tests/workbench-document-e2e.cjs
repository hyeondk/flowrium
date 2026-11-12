const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { _electron: electron } = require("playwright");
const { Store } = require("../electron/store.cjs");
const { startWork } = require("../electron/workbench.cjs");
const Zip = createRequire(require.resolve("pptxgenjs"))("jszip");

async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-format-"));
  const profile = path.join(temp, "profile");
  const directory = path.join(temp, "검증 프로젝트");
  let app;
  try {
    await fs.mkdir(directory);
    const store = new Store(profile);
    await store.load();
    const p = await store.addProject(directory);
    const s = await startWork(store, { projectId: p.id, kind: "document", title: "한글 출력 검증" });
    const answer = { id: randomUUID(), createdAt: new Date().toISOString(), role: "assistant",
      text: "## 검증 결과\n\n내용 확인 기준 ABC123\n\n## 다음 작업\n\n<html>원문 보존</html>" };
    store.session(s.id).messages.push(answer);
    await store.save();
    const env = { ...process.env, FLOWRIUM_USER_DATA: profile, CODEX_HOME: path.join(temp, "codex") };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    app = await electron.launch({ args: [path.resolve(__dirname, "..")], env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(16000);
    await page.getByRole("button", { name: /한글 출력 검증.*문서 작성/ }).click();
    const format = page.getByLabel("산출물 형식");
    for (const value of ["md", "html", "pdf", "pptx"]) {
      await format.selectOption(value);
      await page.getByRole("button", { name: "답변을 산출물로 저장" }).click();
      await page.locator(".wb-notice").filter({ hasText: "." + value }).waitFor();
    }
    const data = await page.evaluate((id) => window.flowrium.readWorkbench(id), p.id);
    assert.equal(data.artifacts.length, 4);
    const file = (ext) => path.join(directory, data.artifacts.find((a) => a.path.endsWith("." + ext)).path);
    assert.match(await fs.readFile(file("md"), "utf8"), /내용 확인 기준 ABC123/);
    const html = await fs.readFile(file("html"), "utf8");
    assert.match(html, /<h2>검증 결과<\/h2>/);
    assert.match(html, /&lt;html&gt;원문 보존&lt;\/html&gt;/);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfTask = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(file("pdf"))), useSystemFonts: true });
    const pdf = await pdfTask.promise;
    try {
      assert.ok(pdf.numPages >= 1);
      const text = (await (await pdf.getPage(1)).getTextContent()).items.map((item) => item.str).join("").replace(/\s/g, "");
      assert.match(text, /내용확인기준ABC123/);
    } finally { await pdfTask.destroy(); }
    const zip = await Zip.loadAsync(await fs.readFile(file("pptx")), { checkCRC32: true });
    assert.ok(zip.file("ppt/presentation.xml") && zip.file("[Content_Types].xml"));
    const slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
    assert.equal(slides.length, 2);
    assert.match(await slides[0].async("string"), /내용 확인 기준 ABC123/);
    assert.match(await slides[1].async("string"), /원문 보존/);
    // 설치된 오피스 변환기가 있는 검증 환경에서는 실제로 열어 다시 PDF로 내보낸다.
    if (process.env.FLOWRIUM_OFFICE_BIN) {
      const output = path.join(temp, "office-output");
      await fs.mkdir(output);
      execFileSync(process.env.FLOWRIUM_OFFICE_BIN, ["-env:UserInstallation=" + require("node:url").pathToFileURL(path.join(temp, "office-profile")).href,
        "--headless", "--convert-to", "pdf", "--outdir", output, file("pptx")], { timeout: 45000, stdio: "pipe" });
      const pdfFile = (await fs.readdir(output)).find((name) => name.endsWith(".pdf"));
      assert.ok(pdfFile, "오피스가 발표자료를 읽고 PDF로 변환했습니다.");
      const docTask = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path.join(output, pdfFile))) });
      const doc = await docTask.promise;
      try { assert.equal(doc.numPages, 2); } finally { await docTask.destroy(); }
    }
    await page.getByRole("button", { name: "대시보드", exact: true }).click();
    await page.getByRole("button", { name: "업무 보드", exact: true }).click();
    await page.getByRole("navigation",{name:"작업실 화면"}).getByRole("button", { name: "산출물", exact: true }).click();
    await page.getByLabel("추가할 문서 선택").setInputFiles({ name: "입력 파일.md", mimeType: "text/markdown", buffer: Buffer.from("추가한 원문") });
    await page.getByRole("status").filter({ hasText: "문서 1개 추가" }).waitFor();
    const payload = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(["끌어놓은 원문"], "드롭.txt", { type: "text/plain" }));
      return data;
    });
    await page.locator(".wb-drop").dispatchEvent("drop", { dataTransfer: payload });
    await page.locator(".wb-line-item").filter({ hasText: "드롭.txt" }).click();
    await page.locator(".wb-preview").filter({ hasText: "끌어놓은 원문" }).waitFor();
    await payload.dispose();
    console.log("파일 선택 / 끌어놓기 / 미리보기 통과. 실제 앱 화면에서 네 형식 저장 / 마크다운 및 HTML 내용 / PDF 한글 본문 / 발표자료 두 장의 본문과 구조 재열기 통과");
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
