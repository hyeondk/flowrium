const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {registerVoiceServers,defaults,environment,endpoint,redact}=require('../electron/voice-servers.cjs');
const processTools=require('../electron/voice-server-process.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function free(){const s=net.createServer();await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-voice-servers-'));let owner='account-one',revision=0,allowed=true;const api={};
 const storage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('encrypted:'+value),decryptString:value=>{const v=value.toString();if(!v.startsWith('encrypted:'))throw Error();return v.slice(10)}};
 const runtime=registerVoiceServers((name,handler)=>api[name]=handler,{directory,secretStorage:storage,accountOwner:()=>owner,accountRevision:()=>revision,canRun:()=>allowed,...options});
 t.after(async()=>{await runtime.shutdown();await fs.rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
 async function save(mode='server',extra={},environment){const port=await free(),value={...defaults('recognition'),command:process.execPath,args:[path.resolve(__dirname,'voice-server-fixture.cjs'),'--port',String(port),'--mode',mode],cwd:directory,endpoint:'http://127.0.0.1:'+port,healthPath:'/health',startupTimeoutMs:20000,...extra};delete value.id;delete value.environmentNames;delete value.encryptedEnvironment;const state=await api.voiceServersState();await api.configureVoiceServer({id:'recognition',revision:state.revision,config:value,...(environment!==undefined&&{environment})});return value;}
 async function state(){return(await api.voiceServersState()).servers.find(row=>row.config.id==='recognition').run;}
 async function phase(expected){const end=Date.now()+30000;while(Date.now()<end){const value=await state();if(value.phase===expected)return value;await wait(100);}throw Error('예상 상태 '+expected+' / '+JSON.stringify(await state()));}
 async function start(action='start'){const p=await api.previewVoiceServer('recognition');await api.voiceServerAction({id:'recognition',action,token:p.token});return p;}
 return{api,runtime,directory,save,state,phase,start,setAllowed(value){allowed=value},setAccount(value){owner=value;revision++},nextRevision(){revision++}};
}
test('서버 실행 설정은 명령과 인자를 분리하고 루프백·범위·환경변수를 검사한다',async t=>{
 const f=await fixture(t);const state=await f.api.voiceServersState();assert.equal(state.servers.length,2);assert.equal(f.runtime.isBusy(),false);
 for(const value of ['http://localhost:9890','http://127.0.0.1.evil:9890','https://127.0.0.1:9890','http://0.0.0.0:9890','http://x@127.0.0.1:9890','http://127.0.0.1:65536','http://127.0.0.1:9890/x'])assert.throws(()=>endpoint(value));
 for(const value of [{HOME:'/elsewhere'},{NODE_OPTIONS:'--eval wrong'},{'BAD-NAME':'value'},{X:'line\nbreak'}])assert.throws(()=>environment(value));
 assert.equal(redact('Bearer aabbcc token=abc sk-1234567890 value123',['value123']),'Bearer [보호됨] token=[보호됨] [보호됨] [보호됨]');
 await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'start',token:'missing'}),/미리보기/);
 await f.save('server');const plan=await f.api.previewVoiceServer('recognition');assert.equal(plan.command,process.execPath);assert(plan.args.includes('--port'));assert(!JSON.stringify(plan).includes('encryptedEnvironment'));
 const state2=await f.api.voiceServersState();await f.api.configureVoiceServer({id:'recognition',revision:state2.revision,config:{command:'',args:[],cwd:'',endpoint:'http://127.0.0.1:9890',healthPath:'',startupTimeoutMs:20000}});
 await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'start',token:plan.token}),/미리보기/);
});
test('실제 서버 시작·준비·비밀 로그 보호·재시작·중지와 설정 재열기를 검증한다',async t=>{
 const f=await fixture(t),secret='private-server-secret-721';await f.save('server',{}, {FLOWRIUM_TEST_SECRET:secret});let state=await f.api.voiceServersState();assert.deepEqual(state.servers[0].config.environmentNames,['FLOWRIUM_TEST_SECRET']);assert(!JSON.stringify(state).includes(secret));
 const files=await fs.readdir(f.directory),disk=await fs.readFile(path.join(f.directory,files.find(n=>n.startsWith('voice-servers-'))),'utf8');assert(!disk.includes(secret));
 const first=await f.start();const ready=await f.phase('running');assert(ready.pid>0);assert.equal(f.runtime.isBusy(),true);await wait(120);state=await f.api.voiceServersState();assert(!JSON.stringify(state).includes(secret));assert(state.servers[0].run.logs.some(row=>row.text.includes('[보호됨]')));
 await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'start',token:first.token}),/미리보기/);
 const p=await f.api.previewVoiceServer('recognition');await f.api.voiceServerAction({id:'recognition',action:'restart',token:p.token});const second=await f.phase('running');assert.notEqual(second.pid,ready.pid);
 await f.api.voiceServerAction({id:'recognition',action:'stop'});assert.equal((await f.state()).phase,'stopped');assert.equal(f.runtime.isBusy(),false);
 const reopened={};const other=registerVoiceServers((name,handler)=>reopened[name]=handler,{directory:f.directory,secretStorage:{isEncryptionAvailable:()=>false},accountOwner:()=> 'account-one'});t.after(()=>other.shutdown());const persisted=await reopened.voiceServersState();assert.equal(persisted.servers[0].config.command,process.execPath);assert.deepEqual(persisted.servers[0].config.environmentNames,['FLOWRIUM_TEST_SECRET']);assert.equal(persisted.servers[0].run.phase,'stopped');
});
test('기존 포트는 실행도 종료도 하지 않고 외부 서버를 보존한다',async t=>{
 const f=await fixture(t),server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;
 await f.save('server',{endpoint:'http://127.0.0.1:'+port});await assert.rejects(f.start(),/다른 프로그램/);assert.equal((await f.state()).phase,'external');await f.api.voiceServerAction({id:'recognition',action:'stop'});assert.equal(server.listening,true);assert.equal(f.runtime.isBusy(),false);
});
test('시작 실패·준비 시간 초과·실행 파일 변경은 원인을 기록하고 실행을 정리한다',async t=>{
 const f=await fixture(t);await f.save('failure');await f.start();const failure=await f.phase('failed');assert.match(failure.logs.map(row=>row.text).join(' '),/시작 실패/);assert.equal(f.runtime.isBusy(),false);
 await f.api.voiceServerAction({id:'recognition',action:'stop'});assert.equal((await f.state()).phase,'stopped');
 await f.save('never',{startupTimeoutMs:3000});await f.start();const timeout=await f.phase('failed');assert.match(timeout.message,/대기 시간/);assert.equal(f.runtime.isBusy(),false);
 await f.save('server');const p=await f.api.previewVoiceServer('recognition');f.nextRevision();await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'start',token:p.token}),/바뀌|미리보기/);
});
test('잠금과 계정 전환은 소유 실행을 중지하고 다른 계정의 설정·로그를 숨긴다',async t=>{
 const f=await fixture(t);await f.save('server');await f.start();await f.phase('running');f.setAllowed(false);await assert.rejects(f.api.voiceServersState(),/잠금/);await f.runtime.invalidate();assert.equal(f.runtime.isBusy(),false);f.setAllowed(true);assert.equal((await f.state()).phase,'stopped');
 await f.start();await f.phase('running');f.setAccount('account-two');await f.runtime.invalidate();const state=await f.api.voiceServersState();assert.equal(state.servers[0].config.command,'');assert.deepEqual(state.servers[0].run.logs,[]);
 f.setAccount('account-one');const restored=await f.api.voiceServersState();assert.equal(restored.servers[0].config.command,process.execPath);assert.equal(restored.servers[0].run.phase,'stopped');
});
test('본 앱의 하위 서버까지 종료하고 다른 PID의 외부 서버는 보존한다',async t=>{
 const f=await fixture(t),marker=path.join(f.directory,'child-pid.txt');const value=await f.save('child');value.args.push('--marker',marker);const st=await f.api.voiceServersState();await f.api.configureVoiceServer({id:'recognition',revision:st.revision,config:value});await f.start();await f.phase('running');const child=Number(await fs.readFile(marker,'utf8'));assert(child>0);
 await f.api.voiceServerAction({id:'recognition',action:'stop'});const rows=await processTools.processes();assert(!rows.some(row=>row.pid===child&&row.identity.includes(process.execPath)));
});
test('프로세스 식별자가 바뀐 재사용 PID와 그 자손은 소유 목록에 추가하지 않는다',()=>{
 const owned=new Map([[10,{pid:10,ppid:1,identity:'original-start|node'}],[11,{pid:11,ppid:10,identity:'child-start|node'}]]);
 processTools.tree([{pid:10,ppid:1,identity:'new-start|node'},{pid:12,ppid:10,identity:'new-child|node'}],10,owned);assert.equal(owned.get(10).identity,'original-start|node');assert(!owned.has(12));
});
test('종료된 PID와 같은 번호의 새 외부 프로세스는 실제 중지 경로에서도 보존한다',async t=>{
 const {spawn}=require('node:child_process'),port=await free();
 const external=spawn(process.execPath,[path.resolve(__dirname,'voice-server-fixture.cjs'),'--port',String(port)],{stdio:'ignore'});
 const exited=new Promise(resolve=>external.once('exit',resolve));t.after(async()=>{if(processTools.alive(external))external.kill();await exited;});
 const url='http://127.0.0.1:'+port;const end=Date.now()+20000;while(!await require('../electron/voice-servers.cjs').portOpen(url)){if(Date.now()>end)throw Error('외부 서버 준비 시간 초과');await wait(100);}
 const row=(await processTools.processes()).find(value=>value.pid===external.pid);assert(row);
 const old={child:{pid:external.pid,exitCode:0,signalCode:null},owned:new Map([[external.pid,{...row,identity:'different-old-start'}]]),groupReleased:true,exited:Promise.resolve()};
 await processTools.stopOwned(old);assert.equal(processTools.alive(external),true);assert.equal(await require('../electron/voice-servers.cjs').portOpen(url),true);
 const unknown={child:{pid:external.pid,exitCode:0,signalCode:null},owned:new Map(),groupReleased:true,exited:Promise.resolve()};await processTools.stopOwned(unknown);assert.equal(processTools.alive(external),true);assert.equal(unknown.owned.size,0);
});
test('미리보기 뒤 실행 파일이 바뀌면 새 프로그램을 시작하지 않는다',async t=>{
 const f=await fixture(t),binary=path.join(f.directory,process.platform==='win32'?'copied-node.exe':'copied-node');await fs.copyFile(process.execPath,binary);await fs.chmod(binary,0o700);await f.save('server',{command:binary});
 const preview=await f.api.previewVoiceServer('recognition');await fs.appendFile(binary,'changed-after-preview');
 await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'start',token:preview.token}),/실행 파일|바뀌/);assert.equal(f.runtime.isBusy(),false);
});
test('녹음 구간 취소는 서버를 유지하고 보안 전환과 앱 종료는 서버를 정리한다',async t=>{
 const {registerVoice,DEFAULT_VOICE}=require('../electron/voice.cjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-voice-lifecycle-')),api={};
 const runtime=registerVoice((name,handler)=>api[name]=handler,{directory,accountOwner:()=> 'voice-owner',secretStorage:{isEncryptionAvailable:()=>true},allowCapture:async()=>true});
 t.after(async()=>{await runtime.shutdown();await fs.rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
 const port=await free(),endpoint='http://127.0.0.1:'+port;
 await api.configureVoiceServer({id:'recognition',revision:0,config:{command:process.execPath,args:[path.resolve(__dirname,'voice-server-fixture.cjs'),'--port',String(port)],cwd:directory,endpoint,healthPath:'/health',startupTimeoutMs:20000}});
 const p=await api.previewVoiceServer('recognition');await api.voiceServerAction({id:'recognition',action:'start',token:p.token});let state;const end=Date.now()+25000;do{state=await api.voiceServersState();if(state.servers[0].run.phase==='running')break;await wait(100);}while(Date.now()<end);assert.equal(state.servers[0].run.phase,'running');
 await api.cancelVoiceCapture();assert.equal((await api.voiceServersState()).servers[0].run.phase,'running');
 await api.configureVoicePreferences({...DEFAULT_VOICE,provider:'local',localWhisper:endpoint});
 const {pcmWav}=await import('../shared/voice-activity.ts');const wav=Buffer.from(pcmWav(new Float32Array(1600).fill(.1)));
 assert.equal(await api.transcribeVoice({base64:wav.toString('base64'),mime:'audio/wav',requestId:'managed-model'}),'관리 서버 인식 결과');
 await runtime.cancel();assert.equal(runtime.isBusy(),false);assert.equal((await api.voiceServersState()).servers[0].run.phase,'stopped');
 const again=await api.previewVoiceServer('recognition');await api.voiceServerAction({id:'recognition',action:'start',token:again.token});await runtime.shutdown();assert.equal(runtime.isBusy(),false);assert.equal(await require('../electron/voice-servers.cjs').portOpen(endpoint),false);
});
test('종료 확인 실패 때 실행을 잃지 않고 저장·포트 조회를 막은 뒤 다시 중지한다',async t=>{
 let fail=true;const f=await fixture(t,{processTools:{...processTools,async stopOwned(run){if(fail)throw Error('종료 확인 합성 실패');return processTools.stopOwned(run);}}});await f.save('server');await f.start();const before=await f.phase('running');
 await assert.rejects(f.api.voiceServerAction({id:'recognition',action:'stop'}),/합성 실패/);assert.equal(f.runtime.isBusy(),true);assert.equal((await f.state()).phase,'failed');
 const state=await f.api.voiceServerAction({id:'recognition',action:'probe'});assert.equal(state.servers[0].run.pid,before.pid);assert.equal(state.servers[0].run.phase,'failed');
 const cfg={...state.servers[0].config};delete cfg.id;delete cfg.environmentNames;await assert.rejects(f.api.configureVoiceServer({id:'recognition',revision:state.revision,config:cfg}),/중지/);
 fail=false;await f.api.voiceServerAction({id:'recognition',action:'stop'});assert.equal((await f.state()).phase,'stopped');assert.equal(f.runtime.isBusy(),false);
});
test('포트 점검 직후 외부 서버가 먼저 열려도 외부 실행을 보존하고 본 앱 실행만 정리한다',async t=>{
 const {spawn}=require('node:child_process'),http=require('node:http');let external;
 const f=await fixture(t,{spawnImpl(command,args,options){const port=Number(args[args.indexOf('--port')+1]);external=http.createServer((req,res)=>res.end('{}'));external.listen(port,'127.0.0.1');return spawn(command,args,options);}});
 t.after(()=>external&&new Promise(resolve=>{external.close(resolve);external.closeAllConnections();}));
 await f.save('never');await f.start();const run=await f.phase('failed');assert.match(run.message,/다른 프로그램/);assert.equal(external.listening,true);assert.equal(f.runtime.isBusy(),false);
});
test('앱 인증 환경변수는 상속하지 않고 사용자가 따로 지정한 환경변수만 전달한다',async t=>{
 const {spawn}=require('node:child_process');let observed;
 const f=await fixture(t,{baseEnv:{...process.env,OPENAI_API_KEY:'inherited-openai-secret',GH_TOKEN:'inherited-github-secret'},spawnImpl(command,args,options){observed=options.env;return spawn(command,args,options);}});
 await f.save('server',{}, {FLOWRIUM_TEST_SECRET:'selected-value'});await f.start();await f.phase('running');assert.equal(observed.OPENAI_API_KEY,undefined);assert.equal(observed.GH_TOKEN,undefined);assert.equal(observed.FLOWRIUM_TEST_SECRET,'selected-value');await f.api.voiceServerAction({id:'recognition',action:'stop'});
});
