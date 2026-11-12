// 실제 렌더러/프리로드의 사용자 동작은 여기서, 실제 설치본 교체는 update-native-e2e에서 검증한다.
const assert = require("node:assert/strict");
async function verifyUpdateUI(app, page) {
  await app.evaluate(({ipcMain,BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0];
    ipcMain.removeHandler("flowrium:checkUpdate");
    ipcMain.handle("flowrium:checkUpdate", () => {
      win.webContents.send("flowrium:update", {status:"available",currentVersion:"0.2.0",latestVersion:"0.2.1",message:"재시도했습니다."});
    });
    win.webContents.send("flowrium:update", {status:"error",currentVersion:"0.2.0",message:"지난 업데이트 실패",launchFailed:true});
  });
  const failed=page.getByRole("region",{name:"프로그램 업데이트"});
  await failed.getByText("지난 업데이트 실패").waitFor();
  await app.evaluate(({shell})=>{ globalThis.__flowriumOriginalOpen=shell.openExternal; shell.openExternal = async url => { globalThis.__flowriumDownloadPage=url; }; });
  try {
    await failed.getByRole("button",{name:"수동 설치 파일 받기"}).click();
    assert.equal(await app.evaluate(()=>globalThis.__flowriumDownloadPage),"https://hyeondk.github.io/flowrium/");
  } finally {
    await app.evaluate(({shell})=>{shell.openExternal=globalThis.__flowriumOriginalOpen; delete globalThis.__flowriumOriginalOpen; delete globalThis.__flowriumDownloadPage;});
  }
  await failed.getByRole("button",{name:"새 버전 확인"}).click();
  await failed.getByText("재시도했습니다.").waitFor();
  await app.evaluate(({ipcMain,BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows()[0];
    const show=(status,message,extra={})=>win.webContents.send("flowrium:update",{status,message,currentVersion:"0.2.0",latestVersion:"0.2.1",...extra});
    ipcMain.removeHandler("flowrium:installUpdate");
    ipcMain.handle("flowrium:installUpdate",()=>{
      show("downloading","검증용 다운로드",{progress:35});
      return {status:"downloading"};
    });
    show("available","새 버전이 준비되었습니다.");
  });
  const banner=page.getByRole("region",{name:"프로그램 업데이트"});
  await banner.getByRole("button",{name:"업데이트 후 재시작"}).click();
  const progress=banner.getByRole("progressbar");
  await progress.waitFor();
  assert.equal(await progress.getAttribute("value"),"35");
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send("flowrium:update",{status:"installing",message:"설치 후 재시작합니다.",currentVersion:"0.2.0"}));
  await banner.getByText("설치 후 재시작합니다.").waitFor();
}
module.exports={verifyUpdateUI};
