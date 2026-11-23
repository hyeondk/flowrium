const assert = require('node:assert/strict');
const {createHash, randomBytes} = require('node:crypto');
const {EventEmitter} = require('node:events');
const {createReadStream, createWriteStream} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pipeline} = require('node:stream/promises');
const { _electron } = require('playwright');
const {expect} = require('playwright/test');
const {runBroker} = require('../electron/mobile-bridge.cjs');
const {Security} = require('../electron/security.cjs');
const {Store} = require('../electron/store.cjs');
const {nativeVersion, releaseVersion} = require('../electron/version.cjs');
const {closeInstalledApp, execFixture, seedOldProject, within, writeOldDraft} = require('./update-installed-ui.cjs');

const previous = '261123_07';
const version = releaseVersion(require('../package.json'));
const preferences = {theme:'dark', accentColor:'purple', effort:'high'};
// The test Codex process returns this invented account for account/read.
const account = {type:'chatgpt', email:'개인정보를 출력하지 않음'};

function fileOption(name) {
  const index = process.argv.indexOf(name);
  assert(index !== -1 && process.argv[index + 1], name + ' 검사 파일을 지정하세요.');
  return path.resolve(process.argv[index + 1]);
}

async function downloadPrevious(temporary) {
  const releaseURL = 'https://github.com/hyeondk/flowrium/releases/download/' + previous + '/';
  const filename = 'Flowrium-' + previous + '-win-x64.exe';
  const installer = path.join(temporary,filename);
  const checksums = path.join(temporary,'previous-SHA256SUMS.txt');
  const response = await fetch(releaseURL + 'SHA256SUMS.txt',{signal:AbortSignal.timeout(30000)});
  assert(response.ok,'이전 공개판 체크섬 내려받기');
  const manifest = await response.text();
  const expected = manifest.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(row=>row[1]===filename)?.[0];
  assert.match(expected ?? '',/^[a-f0-9]{64}$/);
  await fs.writeFile(checksums,expected + '  ' + filename + '\n',{flag:'wx'});
  const asset = await fetch(releaseURL + filename,{signal:AbortSignal.timeout(240000)});
  assert(asset.ok,'이전 공개판 설치 파일 내려받기');
  await pipeline(asset.body,createWriteStream(installer,{flag:'wx'}));
  const hash = createHash('sha256');
  for await(const chunk of createReadStream(installer))hash.update(chunk);
  assert.equal(hash.digest('hex'),expected,'이전 공개판 설치 파일 해시');
  return {installer,checksums};
}

async function startTestRelay() {
  const secret = randomBytes(32).toString('hex');
  const key = randomBytes(32).toString('base64url');
  const origin = 'https://upgrade-test.trycloudflare.com';
  const ready = Promise.withResolvers();
  let proxyPort;
  const stop = await runBroker({secret},({port,error})=>{
    if(error)ready.reject(Error(error));else ready.resolve(port);
  },port=>{
    proxyPort = port;
    const tunnel = new EventEmitter();
    tunnel.stdout = new EventEmitter();
    tunnel.stderr = new EventEmitter();
    tunnel.kill = ()=>{};
    setImmediate(()=>tunnel.stderr.emit('data',origin+' Registered tunnel connection'));
    return tunnel;
  });
  try {
    const port = await within(ready.promise,5000,'합성 휴대폰 중계 준비');
    return {key,lease:{origin,port,secret},proxyPort,stop};
  } catch(error) {
    stop();
    throw error;
  }
}

function phoneRequest(relay, key) {
  return new Promise((resolve,reject)=>{
    const request = http.get({host:'127.0.0.1',port:relay.proxyPort,path:'/api/mobile/state',agent:false,
      headers:{Host:new URL(relay.lease.origin).host,Authorization:'Bearer '+key}}, response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('error',reject);
      response.on('end',()=>{
        const status=response.statusCode;
        try { resolve({status,state:status===200?JSON.parse(Buffer.concat(chunks).toString()):null}); }
        catch(error) { reject(error); }
      });
    });
    request.on('error',reject);
    request.setTimeout(5000,()=>request.destroy(Error('휴대폰 응답 시간 초과')));
  });
}

async function checkPhone(relay, expectedVersion, project) {
  let response;
  await expect.poll(async()=>{
    response=await phoneRequest(relay,relay.key).catch(()=>null);
    return response?.status;
  },{timeout:30000,message:'같은 중계와 기존 휴대폰 인증 사용'}).toBe(200);
  assert.equal(response.state.version,expectedVersion);
  assert.equal(response.state.connection.authenticated,true);
  assert(response.state.projects.some(item=>item.id===project));
  for(const [name,value] of Object.entries(preferences))assert.equal(response.state.settings[name],value);
  assert.equal((await phoneRequest(relay,'invalid-fixture-key')).status,401);
}

async function main() {
  assert(process.platform==='win32' && process.arch==='x64' && process.env.GITHUB_ACTIONS==='true' &&
    process.env.RUNNER_ENVIRONMENT==='github-hosted','이 시험은 일회용 GitHub Windows x64 호스팅 러너에서만 실행합니다.');
  const candidate = {installer:fileOption('--installer'),checksums:fileOption('--checksums')};
  assert.equal(path.basename(candidate.installer),'Flowrium-'+version+'-win-x64.exe');
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-public-upgrade-')));
  const env = {...process.env,APPDATA:path.join(temporary,'Roaming'),LOCALAPPDATA:path.join(temporary,'Local'),CODEX_HOME:path.join(temporary,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const profile=path.join(env.APPDATA,'Flowrium');
  const pairing=path.join(profile,'mobile-pairing-v1.json');
  const installDir=path.join(temporary,'Programs','Flowrium');
  const binary=path.join(installDir,'Flowrium.exe');
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const installScript=path.resolve(__dirname,'..','install.ps1');
  let application, relay;

  async function install(files, release) {
    await execFixture(powershell,['-NoProfile','-NonInteractive','-File',installScript,'-Version',release,
      '-Package',files.installer,'-Checksums',files.checksums,'-InstallDir',installDir],{env,timeout:180000,label:release+' 설치'});
  }
  async function open(release) {
    application=await _electron.launch({executablePath:binary,args:['--user-data-dir='+profile],env,timeout:45000});
    const state=await within(application.evaluate(({app})=>({
      packaged:app.isPackaged,profile:app.getPath('userData'),version:app.getVersion(),executable:app.getPath('exe'),
    })),20000,'실행 중인 설치판 확인');
    assert(state.packaged && path.relative(profile,state.profile)==='' && path.relative(binary,state.executable)==='');
    assert.equal(state.version,nativeVersion(release));
    const page=await application.firstWindow({timeout:30000});
    await page.waitForFunction(async()=>!!(await window.flowrium?.connectionStatus())?.authenticated,{},{timeout:30000});
    return page;
  }
  async function close(label) {
    if(!application)return;
    const current=application;
    application=null;
    await closeInstalledApp(current,label);
  }

  try {
    await Promise.all([env.APPDATA,env.LOCALAPPDATA,path.dirname(installDir)].map(dir=>fs.mkdir(dir,{recursive:true})));
    const old=await downloadPrevious(temporary);
    await install(old,previous);
    console.log('실제 공개 07 설치와 해시 확인');
    const fixture=await seedOldProject(profile,temporary);
    const security=new Security(profile);
    await security.load();
    await security.accountOwner(account);
    const store=new Store(profile,{projectTrustOwner:()=>security.data.accountOwner});
    await store.load();
    await store.requestProjectTrust(fixture.project,async folder=>folder.path===await fs.realpath(fixture.directory));
    await store.saveSettings({codexPath:path.join(__dirname,'backend-fake-codex.cjs')});
    let page=await open(previous);
    await writeOldDraft(page,fixture);
    await within(page.evaluate(settings=>window.flowrium.saveSettings(settings),preferences),30000,'기존 설치에서 사용자 환경설정 저장');
    relay=await startTestRelay();
    const receipt={version:1,owner:security.data.accountOwner,key:relay.key,lease:relay.lease};
    await within(application.evaluate(async({app,safeStorage},record)=>{
      const fs=process.getBuiltinModule('node:fs/promises');
      const path=process.getBuiltinModule('node:path');
      if(!safeStorage.isEncryptionAvailable())throw Error('Windows 합성 프로필 암호화 확인');
      const file=path.join(app.getPath('userData'),'mobile-pairing-v1.json');
      await fs.writeFile(file,safeStorage.encryptString(JSON.stringify(record)).toString('base64'),{flag:'wx',mode:0o600});
    },receipt),20000,'합성 휴대폰 연결의 OS 암호화');
    const original=await fs.readFile(pairing);
    assert(!original.includes(relay.key));
    await within(page.evaluate(async()=>{if(!(await window.flowrium.startRemoteAccess()).enabled)throw Error('이전 앱 휴대폰 연결 준비');}),20000,'이전 앱에서 중계 연결');
    await checkPhone(relay,previous,fixture.project);
    await close('이전 공개 앱 정상 종료');
    assert.equal((await phoneRequest(relay,relay.key)).status,503);

    await install(candidate,version);
    assert.deepEqual(await fs.readFile(pairing),original,'설치 프로그램이 기존 암호화된 기기 연결을 보존');
    page=await open(version);
    // Restoring the old phone only uses startup. No startRemoteAccess call is made here.
    await checkPhone(relay,version,fixture.project);
    assert.deepEqual(await fs.readFile(pairing),original,'새 앱도 기기 주소와 인증을 새로 발급하지 않음');
    const restored=await within(page.evaluate(async id=>{
      const api=window.flowrium;
      const workspace=await api.bootstrap();
      const state=await api.securityState();
      return {workspace,draft:(await api.readDrafts(state.accountRevision))['session:'+id]};
    },fixture.session),30000,'업데이트 뒤 기존 작업 공간 읽기');
    const project=restored.workspace.projects.find(item=>item.id===fixture.project);
    const session=restored.workspace.sessions.find(item=>item.id===fixture.session);
    assert(project?.trustedForFileAccess);
    assert.equal(path.relative(await fs.realpath(project.path),await fs.realpath(fixture.directory)),'');
    assert.equal(session?.projectId,fixture.project);
    assert.deepEqual(session.messages,[fixture.message]);
    assert.deepEqual(restored.draft,fixture.draft);
    for(const [name,value] of Object.entries(preferences))assert.equal(restored.workspace.settings[name],value);
    console.log('실제 공개 07 → '+version+' 설치 / 기존 프로젝트·대화 본문·초안·설정 / 같은 암호화 기기와 중계의 인증 재접속 통과');
  } finally {
    try { await close('합성 검사 앱 정상 종료'); }
    finally {
      relay?.stop();
      const uninstaller=path.join(installDir,'Uninstall Flowrium.exe');
      try {
        const cleanup="if(Test-Path -LiteralPath $env:FLOWRIUM_TEST_UNINSTALLER){$p=Start-Process -FilePath $env:FLOWRIUM_TEST_UNINSTALLER -ArgumentList '/S /currentuser' -Wait -PassThru; exit $p.ExitCode}";
        await execFixture(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(cleanup,'utf16le').toString('base64')],
          {env:{...env,FLOWRIUM_TEST_UNINSTALLER:uninstaller},timeout:120000,label:'합성 검사 앱 등록 정리'});
      } finally { await fs.rm(temporary,{recursive:true,force:true,maxRetries:12,retryDelay:500}); }
    }
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
