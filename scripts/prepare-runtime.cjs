const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash,randomUUID} = require('node:crypto');
const {createReadStream,createWriteStream} = require('node:fs');
const {pipeline} = require('node:stream/promises');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);

const versions = {node:'24.22.3', npm:'11.19.1', gh:'2.103.3',cloudflared:'2026.11.0'};
const platforms = {
  'darwin-arm64':{node:'darwin-arm64.tar.gz',gh:'macOS_arm64.zip',cloud:'cloudflared-darwin-arm64.tgz',
    cloudSha:'8c2f90277ef06a6080bb40b964d33f09f1188102f8798f2e344174b6cf41accf',
    cloudBinary:'97e24268d9704a570fab276293028f3580ae2c7d5d2678621a4809e90f776a5e',
    nodeSha:'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd',
    ghSha:'d700207eae9ae98fe2b89535c2c087c07823d4628c56364695a5a07ef311c062'},
  'win32-x64':{node:'win-x64.zip',gh:'windows_amd64.zip',cloud:'cloudflared-windows-amd64.exe',
    cloudSha:'d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a',
    cloudBinary:'d5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a',
    nodeSha:'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f',
    ghSha:'98d0cfa794721665d7973dd728c78aff7bd836d58f10f6d7a03568eccb0a22e0'},
};
async function download(dir,base,name,checksumFile,sha) {
  const options={signal:AbortSignal.timeout(300000)};
  const check=await fetch(base+checksumFile,options);
  if(!check.ok) throw new Error('공식 체크섬 다운로드 실패 / '+check.status+' / '+checksumFile);
  const row=(await check.text()).split(/\r?\n/).find(line=>line.trim().split(/\s+/)[1]?.replace(/^\*/,'')===name);
  if(row?.trim().split(/\s+/)[0]!==sha) throw new Error('공식 체크섬이 고정한 값과 다릅니다. / '+name);
  return downloadPinned(dir,name,base+name,sha);
}
async function sha256(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function downloadPinned(dir,name,url,sha) {
  const res=await fetch(url,{signal:AbortSignal.timeout(300000)});
  if(!res.ok) throw new Error('런타임 다운로드 실패 / '+res.status+' / '+name);
  const file=path.join(dir,name);
  await pipeline(res.body,createWriteStream(file,{flags:'wx'}));
  if(await sha256(file)!==sha) throw new Error('다운로드 파일 SHA-256 검증 실패 / '+name);
  return file;
}
async function verifyRuntime(root) {
  const binary=(name)=>path.join(root,'bin',name+(process.platform==='win32'?'.exe':''));
  const options={windowsHide:true,timeout:30000};
  const results=await Promise.all([
    run(binary('node'),['--version'],options),
    run(binary('node'),[path.join(root,'npm','bin','npm-cli.js'),'--version'],options),
    run(binary('gh'),['--version'],options),
    run(binary('cloudflared'),['--version'],options),
  ]);
  if(results[0].stdout.trim()!=='v'+versions.node||results[1].stdout.trim()!==versions.npm||
    !results[2].stdout.startsWith('gh version '+versions.gh+' ') ||
    !results[3].stdout.startsWith('cloudflared version '+versions.cloudflared+' '))
    throw new Error('번들에 포함할 개발 도구의 버전이 다릅니다.');
  console.log('번들 실행 확인 / Node '+versions.node+' / npm '+versions.npm+' / GitHub CLI '+versions.gh+' / cloudflared '+versions.cloudflared);
}
async function prepareRuntime(projectRoot = path.resolve(__dirname,'..')) {
  const key=process.platform+'-'+process.arch, target=platforms[key];
  if(!target) throw new Error('Mac Apple Silicon 또는 Windows x64에서 준비해 주세요.');
  const downloads=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-tools-'));
  const base=path.join(projectRoot,'.flowrium-tmp');
  await fs.mkdir(base,{recursive:true});
  const stage=await fs.mkdtemp(path.join(base,'runtime-stage-'));
  const final=path.join(base,'runtime'),backup=path.join(base,'runtime-previous-'+randomUUID());
  let moved=false;
  try {
    const n='node-v'+versions.node+'-'+target.node, g='gh_'+versions.gh+'_'+target.gh;
    const cloudBase='https://github.com/cloudflare/cloudflared/releases/download/'+versions.cloudflared+'/';
    const results=await Promise.allSettled([
      download(downloads,'https://nodejs.org/dist/v'+versions.node+'/',n,'SHASUMS256.txt',target.nodeSha),
      download(downloads,'https://github.com/cli/cli/releases/download/v'+versions.gh+'/',g,'gh_'+versions.gh+'_checksums.txt',target.ghSha),
      downloadPinned(downloads,target.cloud,cloudBase+target.cloud,target.cloudSha),
      downloadPinned(stage,'Cloudflare-LICENSE','https://raw.githubusercontent.com/cloudflare/cloudflared/'+versions.cloudflared+'/LICENSE',
        '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd'),
    ]);
    for (const result of results) if(result.status==='rejected') throw result.reason;
    const win=process.platform==='win32', tar=win?path.join(process.env.SystemRoot,'System32','tar.exe'):'/usr/bin/tar';
    const nd=path.join(downloads,'node'),gd=path.join(downloads,'gh'),bin=path.join(stage,'bin');
    for(const folder of [nd,gd,bin]) await fs.mkdir(folder);
    await run(tar,['-xf',results[0].value,'-C',nd],{windowsHide:true});
    await run(tar,['-xf',results[1].value,'-C',gd],{windowsHide:true});
    const nodeRoot=path.join(nd,n.replace(/\.tar\.gz$|\.zip$/,''));
    const ghRoot=await fs.access(path.join(gd,'bin')).then(()=>gd,()=>path.join(gd,g.replace('.zip','')));
    const ext=win?'.exe':'';
    const tunnel=path.join(bin,'cloudflared'+ext);
    if(win) await fs.copyFile(results[2].value,tunnel);
    else await run(tar,['-xf',results[2].value,'-C',bin,'cloudflared'],{windowsHide:true});
    if(await sha256(tunnel)!==target.cloudBinary) throw new Error('Cloudflare 터널 실행 파일의 SHA-256 검증에 실패했습니다.');
    await fs.copyFile(path.join(nodeRoot,win?'':'bin','node'+ext),path.join(bin,'node'+ext));
    await fs.copyFile(path.join(ghRoot,'bin','gh'+ext),path.join(bin,'gh'+ext));
    await fs.cp(path.join(nodeRoot,win?'':'lib','node_modules','npm'),path.join(stage,'npm'),{recursive:true,verbatimSymlinks:true});
    await fs.copyFile(path.join(nodeRoot,'LICENSE'),path.join(stage,'Node-LICENSE'));
    await fs.copyFile(path.join(ghRoot,'LICENSE'),path.join(stage,'GitHub-CLI-LICENSE'));
    for(const name of ['npm','npx']){
      const entry=name+'-cli.js';
      if(win) {
        await fs.writeFile(path.join(bin,name+'.cmd'),'@ECHO OFF\r\n"%~dp0node.exe" "%~dp0..\\npm\\bin\\'+entry+'" %*\r\n');
      } else {
        await fs.writeFile(path.join(bin,name),'#!/bin/sh\nbin=$(dirname "$0")\nexec "$bin/node" "$bin/../npm/bin/'+entry+'" "$@"\n',{mode:0o755});
      }
    }
    await fs.writeFile(path.join(stage,'flowrium-runtime.json'),JSON.stringify({key,versions,nodeSha:target.nodeSha,ghSha:target.ghSha,cloudSha:target.cloudSha})+'\n');
    await verifyRuntime(stage);
    try {
      const existing=JSON.parse(await fs.readFile(path.join(final,'flowrium-runtime.json'),'utf8'));
      if(!existing.key||!existing.nodeSha||!existing.ghSha) throw new Error('기존 도구 폴더를 확인해 주세요.');
      await fs.rename(final,backup); moved=true;
    } catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.rename(stage,final);
    if(moved) await fs.rm(backup,{recursive:true,force:true});
  } catch(e){
    if(moved) await fs.rename(backup,final).catch(()=>{});
    throw e;
  } finally {
    await fs.rm(downloads,{recursive:true,force:true,maxRetries:4,retryDelay:100});
    await fs.rm(stage,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
}
module.exports={prepareRuntime,verifyRuntime,versions};
if(require.main===module) prepareRuntime().catch(e=>{console.error(e.message);process.exitCode=1;});
