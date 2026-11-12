const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Menu,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Store, text } = require("./store.cjs");
const { Controller } = require("./controller.cjs");
const { publicMessage } = require("./errors.cjs");

const { DesktopUpdater, acknowledgeUpdateLaunch } = require("./updater.cjs");
const { registerWorkbench } = require("./workbench.cjs");
app.setName("Flowrium");
let updater;
let terminals;
let window;
let controller;
let quitting = false;
const DEV_URL = process.env.ELECTRON_RENDERER_URL;
if (!app.isPackaged && process.env.FLOWRIUM_USER_DATA)
  app.setPath("userData", path.resolve(process.env.FLOWRIUM_USER_DATA));
const productionUrl = pathToFileURL(
  path.join(__dirname, "..", "dist", "index.html"),
).href;

function validateSender(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("허용되지 않은 화면의 요청입니다.");
  const actual = new URL(event.senderFrame.url);
  if (DEV_URL && !app.isPackaged) {
    const expected = new URL(DEV_URL);
    if (
      actual.origin !== expected.origin ||
      !["localhost", "127.0.0.1", "[::1]"].includes(actual.hostname)
    )
      throw new Error("허용되지 않은 개발 화면입니다.");
  } else if (actual.href.split("#")[0] !== productionUrl)
    throw new Error("허용되지 않은 앱 화면입니다.");
}
function register(name, handler) {
  ipcMain.handle(`flowrium:${name}`, async (event, ...args) => {
    try {
      validateSender(event);
      return await handler(...args);
    } catch (error) {
      throw new Error(publicMessage(error));
    }
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 780,
    minHeight: 600,
    backgroundColor: "#0d1015",
    title: "Flowrium",
    icon: path.join(__dirname, "..", "assets", "flowrium.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on("close", (event) => {
    if (updater?.isInstalling() && !updater.readyToQuit) event.preventDefault();
  });
  window.on("closed", () => {
    window = null;
  });
  if (DEV_URL && !app.isPackaged) {
    const url = new URL(DEV_URL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("개발 서버는 이 컴퓨터의 주소만 사용할 수 있습니다.");
    window.loadURL(url.href);
  } else window.loadURL(productionUrl);
}
async function launch() {
  await acknowledgeUpdateLaunch(app, "starting");
  const store = new Store(app.getPath("userData"));
  try {
    await store.load();
  } catch (error) {
    dialog.showErrorBox("Flowrium 작업 공간 확인", error.message);
    app.quit();
    return;
  }
  controller = new Controller(store);
  const repositoryBusy = require("./repository-actions.cjs").registerRepository(register, store, () => updater.isInstalling());
  terminals = require("./terminal.cjs").registerTerminal(register, store, { canOpen: () => !updater.isInstalling() });
  updater = new DesktopUpdater({ app, isBusy: () => terminals.isBusy()
    ? "내장 터미널의 세션을 닫은 뒤 업데이트해 주세요."
    : repositoryBusy() || controller.runs.size > 0 || controller.editingSessions.size > 0 });
  updater.on("state", (state) => {
    if (window && !window.isDestroyed()) window.webContents.send("flowrium:update", state);
  });
  register("updateState", () => updater.getState());
  register("checkUpdate", () => updater.check());
  register("installUpdate", () => updater.install());
  require("./conversation-tools.cjs").registerConversationTools(register, controller);
  require("./teams.cjs").registerTeams(register, store, controller, { canRun: () => !updater.isInstalling() });
  register("readSystemActivity", require("./activity.cjs").readSystemActivity);
  require("./project-details.cjs").registerProjectDetails(register, store);
  registerWorkbench(register, store, {
    reveal: (file) => shell.showItemInFolder(file),
    isRunning: (id) => controller.runs.has(id) || controller.editingSessions.has(id),
  });
  controller.on("event", (payload) => {
    if (window && !window.isDestroyed())
      window.webContents.send("flowrium:event", payload);
  });
  register("bootstrap", async () => {
    const snapshot = { ...store.snapshot(), version: app.getVersion(), platform: process.platform };
    await acknowledgeUpdateLaunch(app, "ready");
    return snapshot;
  });
  register("chooseProject", async () => {
    const choice = await dialog.showOpenDialog(window, {
      title: "Flowrium에서 작업할 프로젝트 폴더 선택",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "프로젝트 추가",
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return store.addProject(choice.filePaths[0]);
  });
  register("createSession", (projectId) =>
    store.createSession(text(projectId, "프로젝트 식별자", 100)),
  );
  register("deleteSession", (id) =>
    controller.deleteSession(text(id, "대화 식별자", 100)),
  );
  register("saveSettings", (input) => controller.saveSettings(input));
  register("connectionStatus", () => controller.connectionStatus());
  register("listCodexHistory", (projectId) =>
    controller.listCodexHistory(text(projectId, "프로젝트 식별자", 100)),
  );
  register("importCodexHistory", (projectId, ids) =>
    controller.importCodexHistory(text(projectId, "프로젝트 식별자", 100), ids),
  );
  register("connect", () => controller.connect());
  register("login", async () => {
    const result = await controller.login();
    if (result.authUrl) await shell.openExternal(result.authUrl);
    return result;
  });
  register("send", (input) => {
    if (updater.isInstalling()) throw new Error("업데이트가 진행 중입니다. 재시작 후 요청해 주세요.");
    return controller.send(input);
  });
  register("interrupt", (id) =>
    controller.interrupt(text(id, "대화 식별자", 100)),
  );
  register("approval", (input) => {
    if (!input || !["accept", "decline"].includes(input.decision))
      throw new Error("승인 선택을 확인해 주세요.");
    controller.client.decide(
      text(input.requestId, "승인 식별자", 100),
      input.decision,
    );
  });
  const links = {
    chatgpt: "https://chatgpt.com/",
    "codex-docs": "https://learn.chatgpt.com/docs/app-server",
    "download-docs":
      "https://docs.github.com/ko/pages/getting-started-with-github-pages/creating-a-github-pages-site",
  };
  register("openSessionChatGPT", (id) => {
    const session = store.session(text(id, "대화 식별자", 100));
    return shell.openExternal(require("./chat-preferences.cjs").chatAddress(session.preferences?.chatGptUrl) || links.chatgpt);
  });
  register("openExternal", (target) => {
    if (!Object.hasOwn(links, target))
      throw new Error("지원하지 않는 외부 링크입니다.");
    return shell.openExternal(links[target]);
  });
  register("copyText", (value) => {
    if (typeof value !== "string" || value.length > 2_000_000)
      throw new Error("복사할 텍스트 크기를 확인해 주세요.");
    clipboard.writeText(value);
  });
  register("openProject", async (id) => {
    const project = store.project(text(id, "프로젝트 식별자", 100));
    const resolved = await fs.realpath(project.path);
    if (!(await fs.stat(resolved)).isDirectory())
      throw new Error("프로젝트 폴더를 찾을 수 없습니다.");
    const error = await shell.openPath(resolved);
    if (error)
      throw new Error(
        "프로젝트 폴더를 열지 못했습니다. 폴더 위치와 접근 권한을 확인해 주세요.",
      );
  });
  register("exportSession", async (id) => {
    const session = store.session(text(id, "대화 식별자", 100));
    const project = store.project(session.projectId);
    const filename =
      session.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 60) ||
      "Flowrium 작업";
    const selected = await dialog.showSaveDialog(window, {
      title: "작업 대화 내보내기",
      defaultPath: `${filename}.md`,
      filters: [{ name: "마크다운 문서", extensions: ["md"] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    const roles = { user: "나", assistant: "Codex", system: "작업 상태" };
    const body = [
      `# ${session.title}`,
      "",
      `프로젝트: ${project.name}`,
      `생성: ${session.createdAt}`,
      "",
      ...session.messages.flatMap((message) => [
        `## ${roles[message.role]}`,
        "",
        message.text,
        "",
      ]),
    ].join("\n");
    await fs.writeFile(selected.filePath, body, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  });
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: "Flowrium",
            submenu: [
              { role: "about", label: "Flowrium 정보" },
              { type: "separator" },
              { role: "hide", label: "Flowrium 가리기" },
              { role: "unhide", label: "모두 보기" },
              { type: "separator" },
              { role: "quit", label: "Flowrium 종료" },
            ],
          },
        ]
      : []),
    {
      label: "편집",
      submenu: [
        { role: "undo", label: "실행 취소" },
        { role: "redo", label: "다시 실행" },
        { type: "separator" },
        { role: "cut", label: "잘라내기" },
        { role: "copy", label: "복사" },
        { role: "paste", label: "붙여넣기" },
        { role: "selectAll", label: "모두 선택" },
      ],
    },
    {
      label: "보기",
      submenu: [
        { role: "resetZoom", label: "기본 크기" },
        { role: "zoomIn", label: "확대" },
        { role: "zoomOut", label: "축소" },
        { role: "togglefullscreen", label: "전체 화면" },
      ],
    },
    {
      label: "창",
      submenu: [
        { role: "minimize", label: "최소화" },
        { role: "close", label: "창 닫기" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  updater.start();
  app.on("activate", () => {
    if (!window) createWindow();
  });
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      dialog.showErrorBox("Flowrium 실행 오류", error.message);
      app.quit();
    });
  app.on("will-quit", () => updater?.stop());
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (updater?.isInstalling() && !updater.readyToQuit) { event.preventDefault(); return; }
    if (quitting || !controller) return;
    event.preventDefault();
    quitting = true;
    Promise.allSettled([controller.shutdown(), terminals?.shutdown()]).finally(() => app.quit());
  });
}
