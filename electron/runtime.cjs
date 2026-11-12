const fs = require('node:fs');
const path = require('node:path');

function runtimePaths(resources = process.resourcesPath, platform = process.platform) {
  const root = resources && !process.defaultApp ? path.join(resources,'runtime') :
    path.resolve(__dirname,'..','.flowrium-tmp','runtime');
  const bin = path.join(root,'bin'), npm = path.join(root,'npm','bin');
  const ext = platform === 'win32' ? '.exe' : '';
  return {root,bin,node:path.join(bin,'node'+ext),gh:path.join(bin,'gh'+ext),cloudflared:path.join(bin,'cloudflared'+ext),
    npmCli:path.join(npm,'npm-cli.js'),npxCli:path.join(npm,'npx-cli.js')};
}
function runtimeEnvironment(base = process.env, locations = runtimePaths(), platform = process.platform) {
  const env = {...base};
  if (!fs.existsSync(locations.node)) return env;
  const key = Object.keys(env).find(k=>k.toUpperCase()==='PATH') || 'PATH';
  const delimiter = platform==='win32'?';':':';
  env[key] = [locations.bin,...(env[key]||'').split(delimiter).filter(p=>p&&p!==locations.bin)].join(delimiter);
  return env;
}
module.exports = {runtimePaths, runtimeEnvironment};
