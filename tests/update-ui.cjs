// 실제 렌더러/프리로드의 사용자 동작은 여기서, 실제 설치본 교체는 update-native-e2e에서 검증한다.
const assert = require("node:assert/strict");
async function verifyUpdateUI(app, page) {
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
