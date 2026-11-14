const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto'),{archive,source}=require('./installer-fixtures.cjs');
const {execFixture:exec,within,closeInstalledApp,killOwnedProcess}=require('./update-installed-ui.cjs');
const checkpoint=text=>console.log('Windows 설치 검증 / '+text);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('이 검증은 Windows x64에서 실행하세요.');const actualMode=process.argv.includes('--installer');if(actualMode&&(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'))throw Error('실제 설치 검증은 일회용 GitHub 호스팅 러너에서만 실행할 수 있습니다.');const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-install-win-'));let child,installed=false;
 try{
  checkpoint('기본 검증 시작');
  const root=path.resolve(__dirname,'..'),script=path.join(root,'install.ps1'),powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),name='Flowrium-0.4.0-win-x64.exe',file=path.join(temp,name),manifest=path.join(temp,'SHA256SUMS.txt'),destination=path.join(temp,'프로그램 검증','Flowrium');const env={...process.env,APPDATA:path.join(temp,'AppData','Roaming'),LOCALAPPDATA:path.join(temp,'AppData','Local')};await fs.mkdir(env.APPDATA,{recursive:true});await fs.mkdir(env.LOCALAPPDATA,{recursive:true});const data=path.join(env.APPDATA,'Flowrium');await fs.mkdir(data);await fs.writeFile(path.join(data,'보존.txt'),'대화 자료 보존');
  const run=(...args)=>{const targetIndex=args.indexOf('-InstallDir'),target=targetIndex>=0?args[targetIndex+1]:destination,extra=args.filter((_v,i)=>targetIndex<0||i!==targetIndex&&i!==targetIndex+1);return exec(powershell,['-NoProfile','-NonInteractive','-File',script,'-Package',file,'-Checksums',manifest,'-InstallDir',target,...extra],{env,timeout:60000,maxBuffer:1024*1024});};const pe=machine=>{const b=Buffer.alloc(128);b.write('MZ');b.writeUInt32LE(80,60);b.write('PE\0\0',80,'binary');b.writeUInt16LE(machine,84);return b;};const valid=pe(0x8664);await fs.writeFile(file,valid);await fs.writeFile(manifest,hash(valid)+'  '+name+'\n');await run('-VerifyOnly');await assert.rejects(fs.stat(destination),e=>e.code==='ENOENT');assert.equal(await fs.readFile(path.join(data,'보존.txt'),'utf8'),'대화 자료 보존');
  await fs.writeFile(manifest,'0'.repeat(64)+'  '+name+'\n');await assert.rejects(run('-VerifyOnly'),/SHA-256/);const wrong=pe(0xaa64);await fs.writeFile(file,wrong);await fs.writeFile(manifest,hash(wrong)+'  '+name+'\n');await assert.rejects(run('-VerifyOnly'),/x64/);await fs.writeFile(file,valid);await fs.writeFile(manifest,hash(valid)+'  '+name+'\n');await assert.rejects(run('-Version','0.4.1','-VerifyOnly'));await assert.rejects(run('-InstallDir',data,'-VerifyOnly'));
  const executable=path.join(temp,'Flowrium.exe');await fs.copyFile(process.execPath,executable);child=spawn(executable,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',env});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});await assert.rejects(run('-VerifyOnly'));const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();try{await within(exited,10000,'모의 실행 앱 종료');}catch(error){await killOwnedProcess(child);throw error;}child=null;
  const sourceName='Flowrium-0.4.0-source.tar.gz',sourceFolder=path.join(temp,'소스 검증 자료'),sourceFile=path.join(sourceFolder,sourceName),helper=path.join(sourceFolder,'검증 도구.cjs'),sourceBytes=archive(source());await fs.mkdir(sourceFolder);await fs.copyFile(path.join(root,'scripts','installer-support.cjs'),helper);await fs.writeFile(sourceFile,sourceBytes);await fs.writeFile(manifest,hash(sourceBytes)+'  '+sourceName+'\n'+hash(await fs.readFile(helper))+'  flowrium-install-support.cjs\n');await exec(powershell,['-NoProfile','-NonInteractive','-File',script,'-FromSource','-VerifyOnly','-Package',sourceFile,'-Checksums',manifest,'-SupportFile',helper,'-InstallDir',destination],{env,timeout:60000});
  const index=process.argv.indexOf('--installer');if(index>=0){const installer=process.argv[index+1],checksumsIndex=process.argv.indexOf('--checksums'),checksums=checksumsIndex>=0?process.argv[checksumsIndex+1]:null;assert(installer&&checksums,'실제 릴리스 검증에는 --installer와 --checksums를 지정하세요.');const install=()=>exec(powershell,['-NoProfile','-NonInteractive','-File',script,'-Package',path.resolve(installer),'-Checksums',path.resolve(checksums),'-InstallDir',destination],{env,timeout:180000,maxBuffer:1024*1024});installed=true;
    checkpoint('실제 설치 검증 시작');
    let legacyFixture;
    const publicVersion=require('../package.json').flowriumVersion;
    if(publicVersion){
      const oldName='Flowrium-0.6.0-win-x64.exe',oldFile=path.join(temp,oldName),oldSums=path.join(temp,'old-SHA256SUMS.txt');
      const expected=require('../docs/validation/release-0.6.0.json').hashes[oldName];assert.match(expected,/^[a-f0-9]{64}$/);
      checkpoint('이전 0.6.0 다운로드 시작');
      const response=await fetch('https://github.com/hyeondk/flowrium/releases/download/v0.6.0/'+oldName,{signal:AbortSignal.timeout(240000)});assert(response.ok,'이전 공개 설치본 다운로드');
      await require('node:stream/promises').pipeline(response.body,require('node:fs').createWriteStream(oldFile,{flags:'wx'}));assert.equal(hash(await fs.readFile(oldFile)),expected);await fs.writeFile(oldSums,expected+'  '+oldName+'\n');checkpoint('이전 0.6.0 다운로드와 해시 확인 완료');
      checkpoint('이전 0.6.0 설치 시작');
      await exec(powershell,['-NoProfile','-NonInteractive','-File',script,'-Package',oldFile,'-Checksums',oldSums,'-InstallDir',destination],{env,timeout:180000,maxBuffer:1024*1024});
      checkpoint('이전 0.6.0 설치 완료 / 합성 프로젝트 생성 시작');
      const helpers=require('./update-installed-ui.cjs');legacyFixture=await helpers.seedOldProject(data,temp);checkpoint('합성 프로젝트 생성 완료');
      const {_electron}=require('playwright'),testEnv={...env,CODEX_HOME:path.join(temp,'codex')};delete testEnv.ELECTRON_RUN_AS_NODE;delete testEnv.ELECTRON_RENDERER_URL;
      checkpoint('이전 앱 실행 시작');
      const oldApp=await _electron.launch({executablePath:path.join(destination,'Flowrium.exe'),args:['--user-data-dir='+data],env:testEnv,timeout:45000});
      try{checkpoint('이전 앱 실행 완료');assert.equal(await within(oldApp.evaluate(({app})=>app.getVersion()),30000,'이전 버전 조회'),'0.6.0');const oldPage=await within(oldApp.firstWindow({timeout:45000}),45000,'이전 창 열기');oldPage.setDefaultTimeout(30000);oldPage.setDefaultNavigationTimeout(45000);await within(oldPage.setViewportSize({width:1440,height:1000}),30000,'이전 창 크기');checkpoint('이전 초안 생성 시작');await helpers.writeOldDraft(oldPage,legacyFixture);checkpoint('이전 초안 생성 완료');}finally{await closeInstalledApp(oldApp,'이전 검사 앱 종료');}
    }
    checkpoint('새 설치 시작');await install();checkpoint('새 설치 완료');
    checkpoint('새 프로필 검증 시작');
    if(legacyFixture)await require('./update-installed-ui.cjs').checkNewProfile(path.join(destination,'Flowrium.exe'),temp,data,legacyFixture,require('../package.json').version);checkpoint('새 프로필 검증 완료');
    await fs.writeFile(path.join(destination,'기존 앱 자료.txt'),'이전 앱 백업');checkpoint('재설치와 백업 시작');await install();checkpoint('재설치 완료 / 백업 확인 시작');const backup=(await fs.readdir(path.dirname(destination))).filter(n=>n.startsWith('Flowrium.backup-')).sort().reverse()[0];assert(backup);assert.equal(await fs.readFile(path.join(path.dirname(destination),backup,'기존 앱 자료.txt'),'utf8'),'이전 앱 백업');assert.equal(await fs.readFile(path.join(data,'보존.txt'),'utf8'),'대화 자료 보존');checkpoint('백업과 개인 자료 보존 확인 완료');}
  console.log('Windows 터미널 설치 검증 / 파일 변조·ARM64·버전 불일치·데이터 경로 차단 / 실행 중 거절 / 소스 검증 통과'+(index>=0?' / 실제 설치와 기존 앱 백업 / 이전 0.6.0에서 날짜판 수동 설치와 프로젝트·초안 복원 통과':''));
 }finally{
  checkpoint('소유한 검사 앱 정리 시작');
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();try{await within(closed,10000,'모의 검사 앱 정리');}catch(error){await killOwnedProcess(child);throw error;}}
  if(installed){checkpoint('검사 설치 등록 정리 시작');const uninstaller=path.join(temp,'프로그램 검증','Flowrium','Uninstall Flowrium.exe'),powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');const cleanup="$ErrorActionPreference='Stop'; if(Test-Path -LiteralPath $env:FLOWRIUM_TEST_UNINSTALLER){$p=Start-Process -FilePath $env:FLOWRIUM_TEST_UNINSTALLER -ArgumentList '/S /currentuser' -Wait -PassThru; if($p.ExitCode -ne 0){throw '검증 설치의 등록 정보를 정리하지 못했습니다.'}}";await exec(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(cleanup,'utf16le').toString('base64')],{env:{...process.env,FLOWRIUM_TEST_UNINSTALLER:uninstaller},timeout:120000,label:'검사 설치 등록 정리'});checkpoint('검사 설치 등록 정리 완료');}
  await fs.rm(temp,{recursive:true,force:true,maxRetries:12,retryDelay:500});checkpoint('임시 검사 폴더 정리 완료');
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
