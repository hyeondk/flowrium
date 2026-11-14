const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DesktopUpdater, newer, selectRelease, checksum, artifactSuffix } = require('../electron/updater.cjs');

const base = 'https://github.com/hyeondk/flowrium/releases/download/v0.2.0/';
const name = 'Flowrium-0.2.0-mac-arm64.zip';
const payload = Buffer.from('새 버전의 배포 파일');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sums = Buffer.from(sha(payload) + '  ' + name + '\n');
function asset(name, value) {
  return { name, size: value.length, browser_download_url: base + name, digest: 'sha256:' + sha(value) };
}
function release() {
  return { tag_name: 'v0.2.0', draft: false, prerelease: false,
    assets: [asset(name, payload), asset('SHA256SUMS.txt', sums)] };
}
async function fixture(t, options = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-updater-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'Flowrium.app', 'Contents', 'MacOS', 'Flowrium');
  await fs.mkdir(path.dirname(target), { recursive: true });
  let exits = 0, transfers = 0;
  const get = async (url) => {
    if (url.includes('api.github.com')) return Response.json(options.release || release());
    if (url.endsWith('SHA256SUMS.txt')) return new Response(options.sums || sums);
    assert.equal(url, base + name);
    if (options.onFile) return options.onFile();
    return new Response(options.payload || payload);
  };
  const app = { isPackaged: true, getPath: () => path.join(temporary, 'settings'),
    getVersion: () => '0.1.2', quit: () => { exits++; } };
  const updater = new DesktopUpdater({ app, platform: 'darwin', arch: 'arm64', execPath: target,
    fetchImpl: get, isBusy: options.isBusy,
    transfer: async ({ file }) => { transfers++; assert.deepEqual(await fs.readFile(file), payload); } });
  return { updater, temporary, counts: () => [exits, transfers] };
}

test('정식 버전의 숫자 비교와 플랫폼 선택', () => {
  assert.equal(newer('0.10.0', '0.9.12'), true);
  for (const candidate of ['0.1.2', '0.0.9', '1.2.0-beta', '03.0.0', '../0.2.2', '1.2.3.4'])
    assert.equal(newer(candidate, '0.1.2'), false);
  assert.equal(artifactSuffix('darwin', 'x64'), null);
  assert.equal(artifactSuffix('win32', 'x64'), 'win-x64.exe');
  for (const override of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.1.0' }])
    assert.equal(selectRelease({ ...release(), ...override }, '0.1.2', 'mac-arm64.zip'), null);
});

test('정상 알림 후 설치를 클릭하면 검증한 파일을 한 번만 넘긴다', async (t) => {
  const { updater, counts } = await fixture(t);
  const events = [];
  updater.on('state', (state) => events.push(state));
  assert.equal((await updater.check()).status, 'available');
  assert.deepEqual(counts(), [0, 0]);
  const [first, second] = await Promise.all([updater.install(), updater.install()]);
  assert.equal(first.status, 'installing');
  assert.deepEqual(first, second);
  assert.deepEqual(counts(), [1, 1]);
  assert.ok(events.some(({ status, progress }) => status === 'downloading' && progress === 100));
});

test('기존 작업 중이거나 다운로드할 때 새 작업이 시작되면 설치하지 않는다', async (t) => {
  let busy = "내장 터미널의 세션을 닫은 뒤 업데이트해 주세요.";
  const { updater, counts, temporary } = await fixture(t, { isBusy: () => busy,
    onFile: () => { busy = "실행 중인 세션을 닫아 주세요."; return new Response(payload); } });
  await updater.check();
  assert.equal((await updater.install()).status, 'available');
  assert.match(updater.getState().message, /내장 터미널/);
  busy = false;
  assert.equal((await updater.install()).status, 'available');
  assert.match(updater.getState().message, /실행 중인 세션/);
  assert.deepEqual(counts(), [0, 0]);
  assert.equal((await fs.readdir(temporary)).some((file) => file.startsWith('.flowrium-update-')), false);
});

test('변조, 잘린 파일, 과대 파일, 다른 서버로의 이동 및 검증 목록 오류는 종료 전에 차단한다', async (t) => {
  for (const options of [{ payload: Buffer.alloc(payload.length) }, { payload: Buffer.from('x') },
    { payload: Buffer.alloc(payload.length + 1) }, { sums: Buffer.alloc(sums.length) },
    { onFile: () => Response.redirect('https://attacker.example/payload') }]) {
    const { updater, counts, temporary } = await fixture(t, options);
    assert.equal((await updater.check()).status, 'available');
    assert.equal((await updater.install()).status, 'error');
    assert.deepEqual(counts(), [0, 0]);
    assert.equal((await fs.readdir(temporary)).some((file) => file.startsWith('.flowrium-update-')), false);
  }
});

test('다른 저장소 파일, 누락 및 중복 자산을 차단한다', () => {
  for (const changes of [[asset(name, payload)], [...release().assets, asset(name, payload)],
    [{ ...asset(name, payload), browser_download_url: 'https://github.com/someone/else' }, release().assets[1]]])
    assert.throws(() => selectRelease({ ...release(), assets: changes }, '0.1.2', 'mac-arm64.zip'));
  assert.throws(() => checksum(sums.toString().repeat(2), name));
});

test('이전 설치 실패는 새 후보가 없어도 다음 실행의 일반 화면에서 다시 시도할 수 있다', async (t) => {
  const { updater } = await fixture(t);
  await fs.mkdir(path.dirname(updater.resultPath), { recursive: true });
  await fs.writeFile(updater.resultPath, 'failed');
  await updater.start();
  t.after(() => updater.stop());
  assert.equal(updater.getState().launchFailed, true);
  assert.equal(updater.getState().status, 'error');
  assert.equal(updater.getState().latestVersion, undefined);
  assert.equal((await updater.check()).status, 'available');
});
test('기동 티켓은 해당 설치 경로·버전·프로세스의 시작 및 화면 준비 순서를 구분한다', async (t) => {
  const { acknowledgeUpdateLaunch } = require('../electron/updater.cjs');
  const { randomUUID } = require('node:crypto');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowrium-ack-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const token = randomUUID();
  const base = path.join(dir, '.flowrium-launch-' + token);
  const argv = ['--flowrium-update-token=' + token];
  const app = { isPackaged: true, getVersion: () => '1.0.0', getPath: k => k === 'exe' ? process.execPath : dir };
  assert.equal(await acknowledgeUpdateLaunch(app, 'starting', argv), false);
  await fs.writeFile(base + '.json', JSON.stringify({version: '1.0.0', executable: process.execPath}));
  assert.equal(await acknowledgeUpdateLaunch(app, 'ready', argv), false);
  assert.equal(await acknowledgeUpdateLaunch({...app, getVersion: () => '0.9.1'}, 'starting', argv), false);
  assert.equal(await acknowledgeUpdateLaunch({...app, getPath: () => dir}, 'starting', argv), false);
  assert.equal(await acknowledgeUpdateLaunch(app, 'starting', argv), true);
  assert.equal(await acknowledgeUpdateLaunch(app, 'ready', argv), true);
  assert.equal(await fs.readFile(base + '.ready', 'utf8'), String(process.pid));
});
test('동시에 화면 준비를 알릴 때 한 번만 쓰고 도우미가 정리한 티켓을 늦은 호출이 재생성하지 않는다',async t=>{
  const {acknowledgeUpdateLaunch}=require('../electron/updater.cjs'),{randomUUID}=require('node:crypto');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-ack-shared-')),token=randomUUID(),base=path.join(dir,'.flowrium-launch-'+token),argv=['--flowrium-update-token='+token];
  const app={isPackaged:true,getVersion:()=> '0.4.0',getPath:key=>key==='exe'?process.execPath:dir};
  const originalWrite=fs.writeFile;let opened,release,writes=0;
  const entered=new Promise(resolve=>opened=resolve),gate=new Promise(resolve=>release=resolve);
  t.after(async()=>{release();fs.writeFile=originalWrite;await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
  await fs.writeFile(base+'.json',JSON.stringify({version:'0.4.0',executable:process.execPath}));assert.equal(await acknowledgeUpdateLaunch(app,'starting',argv),true);
  fs.writeFile=async function(file,...args){if(file===base+'.ready'){writes++;opened();await gate;}return originalWrite.call(fs,file,...args);};
  const first=acknowledgeUpdateLaunch(app,'ready',argv);await entered;const second=acknowledgeUpdateLaunch(app,'ready',argv);release();assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(writes,1);
  await Promise.all(['.json','.starting','.ready','.helper'].map(ext=>fs.rm(base+ext,{force:true})));
  assert.equal(await acknowledgeUpdateLaunch(app,'ready',argv),true);assert.equal(writes,1);assert.deepEqual(await fs.readdir(dir),[]);
});

test('날짜 태그와 파일 이름을 검증하고 날짜판 알림은 공개 버전으로 표시한다',async t=>{
 const version='261114_02',file='Flowrium-'+version+'-mac-arm64.zip',url='https://github.com/hyeondk/flowrium/releases/download/'+version+'/',data=Buffer.from('날짜판 업데이트'),list=Buffer.from(sha(data)+'  '+file+'\n');
 const release={tag_name:version,draft:false,prerelease:false,assets:[[file,data],['SHA256SUMS.txt',list]].map(([name,bytes])=>({name,size:bytes.length,digest:'sha256:'+sha(bytes),browser_download_url:url+name}))};
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-dated-update-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));let transferred;
 const updater=new DesktopUpdater({app:{isPackaged:true,getVersion:()=> '26.11.1401',getPath:()=>directory,quit:()=>{}},platform:'darwin',arch:'arm64',execPath:path.join(directory,'Flowrium.app/Contents/MacOS/Flowrium'),fetchImpl:async target=>target.includes('api.github.com')?Response.json(release):new Response(target.endsWith('SHA256SUMS.txt')?list:data),transfer:async value=>{transferred=value;}});
 const result=await updater.check();assert.equal(result.status,'available');assert.equal(result.currentVersion,'261114_01');assert.equal(result.latestVersion,version);await updater.install();assert.equal(transferred.version,version);assert.equal(require('../electron/version.cjs').nativeVersion(transferred.version),'26.11.1402');
 assert.equal(selectRelease({...release,tag_name:'v261114_02'},'26.11.1401','mac-arm64.zip'),null);assert.equal(selectRelease({...release,tag_name:'261132_01'},'26.11.1401','mac-arm64.zip'),null);
});
