const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {registerVoice,DEFAULT_VOICE,validatePreferences,localEndpoint}=require('../electron/voice.cjs');
async function fixture(t,options={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'flowrium-local-voice-')),api={};let revision=0,allowed=true;
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const runtime=registerVoice((name,handler)=>api[name]=handler,{directory,secretStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(`encrypted:${value}`),decryptString:value=>value.toString().slice(10)},allowCapture:async()=>true,accountRevision:()=>revision,canRun:()=>allowed,...options});
  t.after(()=>runtime.shutdown());
  return {api,runtime,directory,revision(value){revision=value;},allowed(value){allowed=value;}};
}
async function server(t,handler) {
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(request){const chunks=[];for await(const chunk of request)chunks.push(chunk);return Buffer.concat(chunks);}
async function wav(){const {pcmWav}=await import('../shared/voice-activity.ts');return Buffer.from(pcmWav(new Float32Array(3200).fill(.1)));}
test('로컬 음성 설정은 기기 내부 주소만 허용하고 자동 전송은 연속 듣기와 호출어를 명시해야 한다',async t=>{
  const {api}=await fixture(t);
  assert.equal((await api.voicePreferences()).autoSubmit,false);
  assert.equal((await api.voicePreferences()).continuous,false);
  for(const url of ['http://localhost:9890','http://127.0.0.1.evil:9890','https://127.0.0.1:9890','http://0.0.0.0:9890','http://[::1]:9890','http://127.0.0.1:9890/inference','http://127.0.0.1:9890?url=evil','http://x@127.0.0.1:9890','http://127.0.0.1:99999'])assert.throws(()=>localEndpoint(url));
  assert.equal(localEndpoint('http://127.0.0.1:9890/'),'http://127.0.0.1:9890');
  assert.throws(()=>validatePreferences({...DEFAULT_VOICE,autoSubmit:true}),/호출어/);
  assert.throws(()=>validatePreferences({...DEFAULT_VOICE,continuous:true,wakeEnabled:false,autoSubmit:true}),/호출어/);
  assert.throws(()=>validatePreferences({...DEFAULT_VOICE,silenceMs:1}));
  const saved=await api.configureVoicePreferences({...DEFAULT_VOICE,continuous:true,autoSubmit:true});assert.equal(saved.autoSubmit,true);
});
test('실제 로컬 HTTP 서버에 WAV를 한 번만 보내며 키 없이 인식하고 설정 재시작과 계정 분리를 유지한다',async t=>{
  const audio=await wav();let calls=0,received;
  const url=await server(t,async(req,res)=>{calls++;received={url:req.url,headers:req.headers,body:await body(req)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'검증한 로컬 음성 요청'}));});
  const {api,directory,revision}=await fixture(t);await api.configureVoice('sk-test12345678901234567890');await api.configureVoicePreferences({...DEFAULT_VOICE,provider:'local',localWhisper:url});
  const input={base64:audio.toString('base64'),mime:'audio/wav',requestId:'same-utterance'};
  const result=await Promise.all([api.transcribeVoice(input),api.transcribeVoice(input)]);assert.deepEqual(result,['검증한 로컬 음성 요청','검증한 로컬 음성 요청']);assert.equal(calls,1);
  assert.equal(received.url,'/inference');assert.equal(received.headers.authorization,undefined);assert.ok(received.body.includes(audio));assert.ok(received.body.includes(Buffer.from('name="response_format"')));
  const reopened={};registerVoice((name,handler)=>reopened[name]=handler,{directory,secretStorage:{decryptString(){throw Error('로컬 인식에 키 접근 금지');}},allowCapture:async()=>false});assert.equal((await reopened.voiceStatus()).configured,true);assert.equal((await reopened.voicePreferences()).localWhisper,url);
  revision(1);assert.equal((await api.voiceStatus()).configured,false);assert.equal((await api.voicePreferences()).provider,'api');await assert.rejects(api.transcribeVoice(input),/API/);assert.equal(calls,1);
});
test('화면 종료와 계정 변경으로 늦은 인식 결과를 폐기하고 제한된 요청만 동시에 보낸다',async t=>{
  const pending=[];const url=await server(t,async(req,res)=>{await body(req);pending.push(res);});
  const {api,runtime,allowed,revision}=await fixture(t);await api.configureVoicePreferences({...DEFAULT_VOICE,provider:'local',localWhisper:url});
  const input={base64:(await wav()).toString('base64'),mime:'audio/wav'};
  const one=api.transcribeVoice({...input,requestId:'cancel-one'}),two=api.transcribeVoice({...input,requestId:'cancel-two'});
  const rejectedOne=assert.rejects(one,/취소/),rejectedTwo=assert.rejects(two,/취소/);
  while(pending.length<2)await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(api.transcribeVoice({...input,requestId:'over-limit'}),/먼저/);
  runtime.cancel();pending.splice(0).forEach(res=>res.end(JSON.stringify({text:'취소 뒤 전달 금지'})));await Promise.all([rejectedOne,rejectedTwo]);
  allowed(false);await assert.rejects(api.transcribeVoice(input),/취소/);allowed(true);
  const next=api.transcribeVoice({...input,requestId:'old-account'}),rejectedNext=assert.rejects(next,/취소/);
  while(!pending.length)await new Promise(resolve=>setTimeout(resolve,5));revision(1);pending.shift().end(JSON.stringify({text:'다른 계정에 전달 금지'}));await rejectedNext;
});
test('늦은 마이크 권한 허용을 취소하고 로컬 음성 합성은 지정한 본문만 보내 WAV로 반환한다',async t=>{
  let permit,permissionContext;const {api,runtime}=await fixture(t,{allowCapture:context=>{permissionContext=context;return new Promise(resolve=>permit=resolve);}});
  const permission=api.allowVoiceCapture(),rejected=assert.rejects(permission,/취소/);assert.equal(permissionContext.isCurrent(),true);runtime.cancel();assert.equal(permissionContext.isCurrent(),false);permit(true);await rejected;
  const audio=await wav();let received;
  const url=await server(t,async(req,res)=>{received={url:req.url,headers:req.headers,value:JSON.parse((await body(req)).toString())};res.setHeader('Content-Type','audio/wav');res.end(audio);});
  await api.configureVoicePreferences({...DEFAULT_VOICE,tts:'local',localTts:url,ttsReferencePath:'/server-only/reference.wav',ttsPromptText:'내가 직접 지정한 기준 문장',ttsSpeed:1.2});
  const result=await api.speakVoice({text:'읽을 답변',requestId:'speech-one'});assert.equal(result.mime,'audio/wav');assert.deepEqual(Buffer.from(result.base64,'base64'),audio);assert.equal(received.url,'/tts');assert.equal(received.headers.authorization,undefined);assert.equal(received.value.text,'읽을 답변');assert.equal(received.value.ref_audio_path,'/server-only/reference.wav');assert.equal(received.value.speed_factor,1.2);
});
test('로컬 인식 서버가 외부 주소로 돌려보내는 응답과 과도한 결과는 거절한다',async t=>{
  let targetCalls=0;const target=await server(t,(req,res)=>{targetCalls++;res.end('{}');});
  const redirect=await server(t,(req,res)=>{res.writeHead(307,{Location:target+'/capture'});res.end();});
  const {api}=await fixture(t);await api.configureVoicePreferences({...DEFAULT_VOICE,provider:'local',localWhisper:redirect});
  await assert.rejects(api.transcribeVoice({base64:(await wav()).toString('base64'),mime:'audio/wav'}));assert.equal(targetCalls,0);
  const huge=await fixture(t,{fetchImpl:async()=>new Response('x',{headers:{'content-length':String(2*1024*1024)}})});await huge.api.configureVoicePreferences({...DEFAULT_VOICE,provider:'local'});await assert.rejects(huge.api.transcribeVoice({base64:'YWJj',mime:'audio/wav'}),/너무/);
});
test('말소리 구간은 짧은 잡음을 무시하고 무음·최대 길이에 끝나며 호출어 접두어와 PCM WAV를 검증한다',async()=>{
  const {segmenter,rms,pcmWav,resample,afterWakeWord}=await import('../shared/voice-activity.ts');
  const detector=segmenter({silenceMs:600,maximumMs:3000,idleMs:10000});
  assert.equal(detector.push(.1,80),null);assert.equal(detector.push(.001,100),null);assert.equal(detector.push(.1,160),'start');assert.equal(detector.push(.005,300),null);assert.equal(detector.push(.001,300),'end');assert.equal(detector.push(.001,10000),'idle');
  assert.equal(detector.push(.1,160),'start');assert.equal(detector.push(.1,3000),'end');
  assert.equal(rms(new Float32Array([.5,-.5])),.5);assert.equal(resample(new Float32Array(48000),48000).length,16000);
  const bytes=Buffer.from(pcmWav(new Float32Array([-1,0,1])));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt32LE(24),16000);assert.equal(bytes.readInt16LE(44),-32768);assert.equal(bytes.readInt16LE(48),32767);
  assert.equal(afterWakeWord('플로리움, 변경 사항을 설명해 줘.','플로리움'),'변경 사항을 설명해 줘.');assert.equal(afterWakeWord('플 로 리 움아 도와줘','플로리움'),'도와줘');assert.equal(afterWakeWord('플로리움','플로리움'),'');assert.equal(afterWakeWord('플로리움이 좋아','플로리움'),null);assert.equal(afterWakeWord('우리는 플로리움 작업 중','플로리움'),null);
});
