const MarkdownIt = require("markdown-it");
const html = new MarkdownIt({ html: false, linkify: false, breaks: true });
const escape = (v) => html.utils.escapeHtml(v);
// 산출물을 열 때 외부 서버로 이미지 요청이 나가지 않도록 대체 텍스트만 남긴다.
html.renderer.rules.image = (tokens, index) => escape(tokens[index].content || "");
function htmlDocument(title, body) {
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\';base-uri \'none\';form-action \'none\'">' +
    '<title>' + escape(title) + '</title><style>@page{size:A4;margin:18mm}body{font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;color:#222;font-size:11pt;line-height:1.65;word-break:keep-all;overflow-wrap:break-word;max-width:800px;margin:32px auto;padding:0 20px}h1,h2,h3{line-height:1.3;break-after:avoid}h1{font-size:23pt}h2{font-size:17pt;margin-top:1.6em}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:5px 8px}blockquote{margin-left:0;border-left:2px solid #aaa;padding-left:14px}a{color:inherit}@media print{body{margin:0;max-width:none;padding:0}}</style></head><body><h1>' +
    escape(title) + '</h1>' + html.render(body) + '</body></html>';
}
async function printPDF(title, body) {
  const { BrowserWindow } = require("electron");
  if (typeof BrowserWindow !== "function") throw new Error("PDF 출력은 데스크톱 앱에서 사용할 수 있습니다.");
  const win = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true,
  } });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const data = Buffer.from(htmlDocument(title, body)).toString("base64");
    await win.loadURL("data:text/html;charset=utf-8;base64," + data);
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
// 슬라이드 텍스트는 원문 순서를 유지한다. 긴 어절·코드 줄만 마지막 수단으로 나눈다.
function slidesOf(title, body) {
  const slides = [];
  let heading = title;
  let lines = [];
  let used = 0;
  const flush = () => {
    if (lines.length) slides.push({ heading, body: lines.join("\n") });
    lines = []; used = 0;
  };
  const add = (line) => {
    const weight = Math.max(1, Math.ceil(Array.from(line).length / 46));
    if (used && used + weight > 10) flush();
    lines.push(line); used += weight;
  };
  const plain = (text) => text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  let code = false;
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { code = !code; continue; }
    const match = !code && raw.match(/^#{1,6}\s+(.+)/);
    if (match) {
      if (!lines.length && heading !== title) add(heading);
      flush(); heading = plain(match[1]);
      continue;
    }
    if (!raw.trim()) continue;
    let line = "";
    for (const word of plain(raw).split(/\s+/)) {
      if (line && line.length + word.length > 90) { add(line); line = ""; }
      const chunks = Array.from(word);
      while (chunks.length > 90) add(chunks.splice(0, 90).join(""));
      line += (line ? " " : "") + chunks.join("");
    }
    if (line) add(line);
  }
  if (!lines.length && (!slides.length || heading !== slides.at(-1).heading)) add(heading);
  flush();
  return slides;
}
async function presentation(title, body) {
  const PptxGenJS = require("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE"; deck.author = "Flowrium"; deck.title = title; deck.subject = title;
  const slides = slidesOf(title, body);
  if (slides.length > 150) throw new Error("발표자료가 150장을 초과합니다. 답변을 나누어 저장해 주세요.");
  slides.forEach((page, index) => {
    const slide = deck.addSlide();
    slide.background = { color: "FFFFFF" };
    const base = { fontFace: "Malgun Gothic", lang: "ko-KR", color: "252525", margin: 0, valign: "top", fit: "shrink" };
    slide.addText(page.heading, { ...base, x: 0.68, y: 0.5, w: 12, h: 1, fontSize: 30, bold: true });
    slide.addText(page.body, { ...base, x: 0.7, y: 1.75, w: 11.95, h: 4.94, fontSize: 18, paraSpaceAfterPt: 4 });
    slide.addText(String(index + 1) + " / " + slides.length, { ...base, x: 10.8, y: 7.02, w: 1.82, h: 0.26, align: "right", fontSize: 10, color: "656565" });
  });
  return deck.write({ outputType: "nodebuffer", compression: true });
}
async function renderDocument(format, title, body) {
  if (format === "md") return Buffer.from("# " + title.replace(/[\r\n]+/g, " ") + "\n\n" + body.trim() + "\n");
  if (format === "html") return Buffer.from(htmlDocument(title, body));
  if (format === "pdf") return printPDF(title, body);
  if (format === "pptx") return presentation(title, body);
  throw new Error("지원하는 산출물 형식을 선택해 주세요.");
}
module.exports = { renderDocument };
