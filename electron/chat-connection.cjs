const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {chatFailure} = require('./errors.cjs');
const {CodexClient} = require('./codex.cjs');

const run = promisify(execFile);
const windowsDesktopNames = new Set(['openai.codex', 'openai.chatgpt', 'openai.chatgpt-desktop']);
const windowsAppQuery = [
  "$ErrorActionPreference = 'Stop'",
  '$packages = $null',
  '$startIds = $null',
  "try { $packages = @(Get-AppxPackage -Name 'OpenAI.*' -PackageTypeFilter Main | Select-Object -ExpandProperty Name) } catch {}",
  "try { $startIds = @(Get-StartApps | Where-Object AppID -Like 'OpenAI.*' | Select-Object -ExpandProperty AppID) } catch {}",
  'ConvertTo-Json -Compress -InputObject @{ packages = $packages; startIds = $startIds }',
].join('; ');
const externalAccountChecks = new WeakMap();

async function desktopAppInstalled(platform = process.platform, { systemRoot = process.env.SystemRoot || process.env.WINDIR, execute = run } = {}) {
  if (platform === 'darwin') {
    const applications = ['/Applications',path.join(os.homedir(),'Applications')];
    let unknown = false;
    for (const directory of applications) {
      for (const name of ['ChatGPT.app','Codex.app']) {
        try {
          if ((await fs.stat(path.join(directory,name,'Contents','Info.plist'))).isFile()) return true;
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') unknown = true;
        }
      }
    }
    return unknown ? null : false;
  }
  if (platform !== 'win32' || !systemRoot) return null;
  try {
    const powershell = path.win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const {stdout} = await execute(powershell,['-NoProfile','-NonInteractive','-Command',windowsAppQuery],{windowsHide:true,timeout:7500,maxBuffer:4096});
    const {packages, startIds} = JSON.parse(stdout.trim());
    if (Array.isArray(packages) && packages.some(name => typeof name === 'string' && windowsDesktopNames.has(name.toLowerCase()))) return true;
    if (Array.isArray(startIds) && startIds.some(id => {
      const family = typeof id === 'string' && /^(.+)_2p2nqsd0c76g0!/i.exec(id);
      return family && windowsDesktopNames.has(family[1].toLowerCase());
    })) return true;
    return Array.isArray(packages) ? false : null;
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

async function refreshSharedDesktopAccount(controller, {canReconnect, makeClient = options => new CodexClient(options)}) {
  const source = controller.client;
  const transfer = controller.codexTransfer;
  const idle = () => canReconnect() && !controller.status.authenticated && !controller.shuttingDown &&
    !controller.loginPending && !controller.runs.size && !controller.editingSessions.size && !controller.analysisRuns?.size &&
    !source.starting && !source.pending.size && !transfer?.isBusy() && !transfer?.syncMonitor?.flight;
  const now = Date.now();
  if (!idle() || now - (externalAccountChecks.get(controller) ?? 0) < 20000) return;
  externalAccountChecks.set(controller, now);
  const configured = controller.store.state.settings.codexPath;
  const owner = controller.options.queueOwner?.();
  // An already running Codex process can cache the pre-login account. Start a
  // read-only account probe through Codex's own credential store before reconnecting.
  const probe = makeClient({descriptor:source.descriptor || controller.options.descriptor});
  try {
    await probe.start(configured);
    const {account} = await probe.request('account/read', {refreshToken:false}, 3500);
    if (account?.type !== 'chatgpt' || !idle() || controller.options.queueOwner?.() !== owner ||
        controller.store.state.settings.codexPath !== configured) return;
    if (transfer?.ownsClient) transfer.client.close();
    source.close();
    await controller.connect(true);
  } finally {
    probe.close();
  }
}

module.exports = {desktopAppInstalled,verifyChatConnection,refreshSharedDesktopAccount};
