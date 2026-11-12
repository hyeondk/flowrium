const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) =>
  ipcRenderer.invoke(`flowrium:${method}`, ...args);
contextBridge.exposeInMainWorld(
  "flowrium",
  Object.freeze({
    bootstrap: () => invoke("bootstrap"),
    chooseProject: () => invoke("chooseProject"),
    createSession: (projectId) => invoke("createSession", projectId),
    deleteSession: (id) => invoke("deleteSession", id),
    saveSettings: (input) => invoke("saveSettings", input),
    connectionStatus: () => invoke("connectionStatus"),
    connect: () => invoke("connect"),
    login: () => invoke("login"),
    send: (input) => invoke("send", input),
    interrupt: (id) => invoke("interrupt", id),
    approval: (input) => invoke("approval", input),
    openExternal: (target) => invoke("openExternal", target),
    copyText: (value) => invoke("copyText", value),
    openProject: (id) => invoke("openProject", id),
    exportSession: (id) => invoke("exportSession", id),
    listCodexHistory: (projectId) => invoke("listCodexHistory", projectId),
    importCodexHistory: (projectId, ids) =>
      invoke("importCodexHistory", projectId, ids),
    onEvent: (callback) => {
      if (typeof callback !== "function")
        throw new TypeError("이벤트 처리 함수가 필요합니다.");
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("flowrium:event", listener);
      return () => ipcRenderer.removeListener("flowrium:event", listener);
    },
  }),
);
