const { contextBridge, ipcRenderer } = require("electron");
const invoke = (method, ...args) =>
  ipcRenderer.invoke(`flowrium:${method}`, ...args);
contextBridge.exposeInMainWorld(
  "flowrium",
  Object.freeze({
    importWorkFiles: (projectId, files) => invoke("importWorkFiles", projectId, files),
    readWorkbench: (id) => invoke("readWorkbench", id),
    startWork: (input) => invoke("startWork", input),
    updateWork: (id, change) => invoke("updateWork", id, change),
    saveWorkArtifact: (id, messageId, format) => invoke("saveWorkArtifact", id, messageId, format),
    readWorkArtifact: (projectId, path) => invoke("readWorkArtifact", projectId, path),
    revealWorkArtifact: (projectId, path) => invoke("revealWorkArtifact", projectId, path),
    repositoryAction: (id, input) => invoke("repositoryAction", id, input),
    terminalList: (id) => invoke("terminalList", id),
    terminalOpen: (id) => invoke("terminalOpen", id),
    terminalRead: (project, id, offset) => invoke("terminalRead", project, id, offset),
    terminalWrite: (project, id, data) => invoke("terminalWrite", project, id, data),
    terminalResize: (project, id, cols, rows) => invoke("terminalResize", project, id, cols, rows),
    terminalClose: (project, id) => invoke("terminalClose", project, id),
    readSystemActivity: () => invoke("readSystemActivity"),
    readProjectDetails: (id) => invoke("readProjectDetails", id),
    updateProjectDetails: (id, rev, change) => invoke("updateProjectDetails", id, rev, change),
    readTeams: (id) => invoke("readTeams", id),
    saveTeam: (id, input) => invoke("saveTeam", id, input),
    removeTeam: (id, team, revision) => invoke("removeTeam", id, team, revision),
    runTeam: (id, team, prompt, request) => invoke("runTeam", id, team, prompt, request),
    openTeamRole: (id, run, index) => invoke("openTeamRole", id, run, index),
    openSessionChatGPT: (id) => invoke("openSessionChatGPT", id),
    editConversation: (id, action) => invoke("editConversation", id, action),
    updateState: () => invoke("updateState"),
    checkUpdate: () => invoke("checkUpdate"),
    installUpdate: () => invoke("installUpdate"),
    onUpdate: (callback) => {
      if (typeof callback !== "function") throw new TypeError("업데이트 처리 함수가 필요합니다.");
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("flowrium:update", listener);
      return () => ipcRenderer.removeListener("flowrium:update", listener);
    },
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
