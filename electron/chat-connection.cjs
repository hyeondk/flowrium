const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {chatFailure} = require('./errors.cjs');

const run = promisify(execFile);

async function desktopAppInstalled(platform = process.platform) {
  if (platform === 'darwin') {
    const applications = ['/Applications',path.join(os.homedir(),'Applications')];
    for (const directory of applications) {
      for (const name of ['ChatGPT.app','Codex.app']) {
        try {
          if ((await fs.stat(path.join(directory,name,'Contents','Info.plist'))).isFile()) return true;
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
        }
      }
    }
    return false;
  }
  if (platform !== 'win32' || !process.env.SystemRoot) return null;
  try {
    const powershell = path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const command = "$ErrorActionPreference = 'Stop'; [bool](Get-AppxPackage -Name 'OpenAI.Codex')";
    const {stdout} = await run(powershell,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:2500,maxBuffer:4096});
    const result = stdout.trim();
    return result === 'True' ? true : result === 'False' ? false : null;
  } catch {
    return null;
  }
}

async function verifyChatConnection(controller) {
  const owner = controller.options.queueOwner?.();
  const changedResult = {ready:false,reason:'changed',message:'연결 계정이나 잠금 상태가 바뀌었습니다. 현재 대화를 확인한 뒤 다시 보내 주세요.'};
  if (controller.options.canRun?.() === false) return changedResult;
  try {
    await controller.client.start(controller.store.state.settings.codexPath);
    const {account} = await controller.client.request('account/read',{refreshToken:false},3500);
    const changed = await controller.accountObserved?.(account);
    if (changed || owner !== controller.options.queueOwner?.() || controller.options.canRun?.() === false) {
      return changedResult;
    }
    if (account?.type !== 'chatgpt') {
      return {ready:false,reason:'login',message:'Flowrium에서 대화를 보내려면 ChatGPT 계정을 연결해 주세요.'};
    }
    return {ready:true};
  } catch (error) {
    return {ready:false,reason:'unavailable',message:chatFailure(error).message};
  }
}

module.exports = {desktopAppInstalled,verifyChatConnection};
