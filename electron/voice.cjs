const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_VOICE = Object.freeze({
  provider: 'api', localWhisper: 'http://127.0.0.1:9890',
  tts: 'system', localTts: 'http://127.0.0.1:9880',
  ttsReferencePath: '', ttsPromptText: '', ttsSpeed: 1,
  continuous: false, wakeEnabled: true, wakeWord: '플로리움', autoSubmit: false,
  silenceMs: 900, maxSpeechSeconds: 45,
});
function localEndpoint(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1(?::[1-9][0-9]{0,4})?\/?$/.test(value))
    throw Error('로컬 음성 서버는 http://127.0.0.1 주소와 포트만 사용할 수 있습니다.');
  if (Number(value.match(/:([0-9]+)\/?$/)?.[1] || 80) > 65535) throw Error('음성 서버의 포트를 확인해 주세요.');
  const url = new URL(value);
  return url.origin;
}
function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('음성 설정을 확인해 주세요.');
  const out = { ...DEFAULT_VOICE, ...value };
  for (const name of Object.keys(value)) if (!Object.hasOwn(DEFAULT_VOICE,name)) throw Error('지원하지 않는 음성 설정입니다.');
  if (!['api','local'].includes(out.provider) || !['system','local'].includes(out.tts)) throw Error('음성 처리 방식을 확인해 주세요.');
  out.localWhisper = localEndpoint(out.localWhisper); out.localTts = localEndpoint(out.localTts);
  for (const name of ['continuous','wakeEnabled','autoSubmit']) if (typeof out[name] !== 'boolean') throw Error('음성 선택 설정을 확인해 주세요.');
  for (const [name, max] of [['wakeWord',40],['ttsReferencePath',2000],['ttsPromptText',4000]])
    if (typeof out[name] !== 'string' || out[name].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(out[name])) throw Error('음성 설정 문장을 확인해 주세요.');
  out.wakeWord = out.wakeWord.trim();
  if (out.wakeEnabled && !out.wakeWord) throw Error('호출어를 입력해 주세요.');
  if (out.autoSubmit && (!out.continuous || !out.wakeEnabled)) throw Error('자동 전송은 연속 듣기와 호출어를 함께 선택해야 합니다.');
  if (!Number.isInteger(out.silenceMs) || out.silenceMs < 400 || out.silenceMs > 3000 ||
      !Number.isInteger(out.maxSpeechSeconds) || out.maxSpeechSeconds < 10 || out.maxSpeechSeconds > 120 ||
      !Number.isFinite(out.ttsSpeed) || out.ttsSpeed < .7 || out.ttsSpeed > 2) throw Error('음성 시간과 속도 범위를 확인해 주세요.');
  return out;
}
function registerVoice(register, {directory, secretStorage, allowCapture, fetchImpl = fetch, canRun = () => true, accountRevision = () => 0}) {
  let queue = Promise.resolve(), epoch = 0, stopped = false;
  const active = new Set(), requests = new Map();
  const owner = () => String(accountRevision());
  function files(revision = owner()) {
    if (!/^[0-9]+$/.test(revision)) throw Error('음성 계정 상태를 확인해 주세요.');
    return { key: path.join(directory, revision === '0' ? 'voice.enc' : `voice-${revision}.enc`), prefs: path.join(directory, `voice-${revision}.json`) };
  }
  function assertAllowed(revision, token) {
    if (stopped || !canRun() || revision !== owner() || (token !== undefined && token !== epoch)) throw Error('음성 처리가 취소되었습니다. 다시 시작해 주세요.');
  }
  function cancel() { epoch++; for (const request of active) request.abort(); active.clear(); requests.clear(); }
  async function readKey(revision = owner()) {
    try {
      const file=files(revision).key, stat=await fs.lstat(file);
      if(!stat.isFile()||stat.size>8192)throw Error();
      const data = await fs.readFile(file);
      if (data.length > 8192) throw Error();
      return secretStorage.decryptString(data);
    } catch (e) { if (e.code === 'ENOENT') return ''; throw Error('음성 인증 설정을 열지 못했습니다.'); }
  }
  async function readPreferences(revision = owner()) {
    try {
      const file = files(revision).prefs, stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 20000) throw Error('음성 설정 파일을 확인해 주세요.');
      return validatePreferences(JSON.parse(await fs.readFile(file,'utf8')));
    } catch (e) { if (e.code === 'ENOENT') return { ...DEFAULT_VOICE }; throw e; }
  }
  async function write(file, data) {
    await fs.mkdir(directory,{recursive:true}); const temp = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp,data,{flag:'wx',mode:0o600}); await fs.rename(temp,file); }
    finally { await fs.rm(temp,{force:true}); }
  }
  function serial(callback) { const task = queue.catch(()=>{}).then(callback); queue = task; return task; }
  register('voiceStatus', async () => {
    const revision = owner(); assertAllowed(revision);
    const prefs = await readPreferences(revision), key = prefs.provider==='api'?await readKey(revision):''; assertAllowed(revision);
    return { configured: prefs.provider === 'local' || !!key };
  });
  register('voicePreferences', async () => { const revision=owner(); assertAllowed(revision); const prefs=await readPreferences(revision); assertAllowed(revision); return prefs; });
  register('configureVoicePreferences', async value => {
    const prefs = validatePreferences(value), revision = owner(); assertAllowed(revision); cancel();
    return serial(async () => { assertAllowed(revision); await write(files(revision).prefs,JSON.stringify(prefs)); return prefs; });
  });
  register('configureVoice', async key => {
    if (key !== null && (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{15,300}$/.test(key))) throw Error('OpenAI API 키를 확인해 주세요.');
    const revision = owner(); assertAllowed(revision); cancel();
    return serial(async () => {
      assertAllowed(revision);
      if (key === null) return fs.rm(files(revision).key,{force:true});
      if (!secretStorage.isEncryptionAvailable()) throw Error('운영체제의 보안 저장소를 사용할 수 없습니다.');
      await write(files(revision).key,secretStorage.encryptString(key));
    });
  });
  register('allowVoiceCapture', async () => {
    const revision=owner(), token=epoch; assertAllowed(revision,token);
    const allowed=await allowCapture({isCurrent:()=>!stopped&&canRun()&&revision===owner()&&token===epoch});
    assertAllowed(revision,token);return !!allowed;
  });
  register('cancelVoiceCapture', async () => { cancel(); return {cancelled:true}; });
  async function limitedBody(response, maximum) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maximum) throw Error('음성 서버 응답이 너무 큽니다.');
    if (!response.body?.getReader) { const bytes=Buffer.from(await response.arrayBuffer()); if(bytes.length>maximum)throw Error('음성 서버 응답이 너무 큽니다.'); return bytes; }
    const reader=response.body.getReader(), chunks=[]; let size=0;
    try { while(true) { const result=await reader.read(); if(result.done)break; size+=result.value.length; if(size>maximum)throw Error('음성 서버 응답이 너무 큽니다.'); chunks.push(Buffer.from(result.value)); } }
    catch(error) { await reader.cancel().catch(()=>{}); throw error; }
    return Buffer.concat(chunks,size);
  }
  function request(kind, input, operation) {
    const revision=owner(), token=epoch; assertAllowed(revision,token);
    const id=input?.requestId;
    if(id !== undefined && (typeof id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(id))) throw Error('음성 요청 식별자를 확인해 주세요.');
    const key=id?`${revision}:${kind}:${id}`:null;
    if(key&&requests.has(key))return requests.get(key);
    if(active.size>=2) throw Error('먼저 시작한 음성 처리가 끝난 뒤 다시 시도해 주세요.');
    const abort=new AbortController(); active.add(abort);
    const result=(async()=>{
      const timer=setTimeout(()=>abort.abort(),120000); timer.unref?.();
      try { const value=await operation({revision,token,signal:abort.signal}); assertAllowed(revision,token); return value; }
      catch(error) { if(abort.signal.aborted) throw Error('음성 처리가 취소되었거나 제한 시간을 넘었습니다.'); throw error; }
      finally { clearTimeout(timer); active.delete(abort); }
    })();
    if(key) { requests.set(key,result); result.catch(()=>{if(requests.get(key)===result)requests.delete(key);}); while(requests.size>32)requests.delete(requests.keys().next().value); }
    return result;
  }
  register('transcribeVoice', async input => request('transcribe',input,async ({revision,token,signal}) => {
    if (!input || typeof input.base64!=='string' || input.base64.length>26*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) ||
        !['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/flac'].includes(input.mime)) throw Error('지원하는 음성 파일과 크기를 확인해 주세요.');
    const buffer=Buffer.from(input.base64,'base64');
    if(!buffer.length||buffer.length>19*1024*1024)throw Error('음성 파일은 19MB까지 사용할 수 있습니다.');
    const prefs=await readPreferences(revision), key=prefs.provider==='api'?await readKey(revision):'';
    if(prefs.provider==='api'&&!key)throw Error('음성 입력 설정에 본인의 OpenAI API 키를 등록하거나 로컬 음성 서버를 선택해 주세요.');
    assertAllowed(revision,token);
    const form=new FormData(), ext={'audio/webm':'webm','audio/wav':'wav','audio/mpeg':'mp3','audio/mp4':'mp4','audio/x-m4a':'m4a','audio/ogg':'ogg','audio/flac':'flac'}[input.mime];
    form.append('file',new Blob([buffer],{type:input.mime}),`recording.${ext}`); form.append('response_format','json');
    if(prefs.provider==='api')form.append('model','gpt-4o-mini-transcribe');
    else { form.append('language','ko'); form.append('temperature','0'); }
    const response=await fetchImpl(prefs.provider==='local'?`${prefs.localWhisper}/inference`:'https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:prefs.provider==='api'?{Authorization:`Bearer ${key}`}:{},body:form,signal,redirect:'error',
    });
    if(!response.ok)throw Error(`음성 인식을 마치지 못했습니다. ${prefs.provider==='local'?'로컬 서버 실행과 연결':'API 키, 잔액과 연결'}을 확인해 주세요. (${response.status})`);
    const value=JSON.parse((await limitedBody(response,1024*1024)).toString('utf8'));
    if(typeof value.text!=='string'||value.text.length>200000)throw Error('음성 인식 결과를 확인하지 못했습니다.');
    return value.text.trim();
  }));
  register('speakVoice', async input => request('speak',input,async({revision,token,signal})=>{
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>12000)throw Error('읽을 문장을 12,000자 이내로 입력해 주세요.');
    const prefs=await readPreferences(revision); assertAllowed(revision,token);
    if(prefs.tts!=='local')throw Error('로컬 음성 읽기가 선택되어 있지 않습니다.');
    const body={text:input.text,text_lang:'ko',ref_audio_path:prefs.ttsReferencePath,prompt_text:prefs.ttsPromptText,prompt_lang:'ko',text_split_method:'cut5',media_type:'wav',streaming_mode:false,speed_factor:prefs.ttsSpeed,batch_size:1};
    const response=await fetchImpl(`${prefs.localTts}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,redirect:'error'});
    if(!response.ok)throw Error(`로컬 음성 읽기를 마치지 못했습니다. 서버와 기준 음성 설정을 확인해 주세요. (${response.status})`);
    const buffer=await limitedBody(response,24*1024*1024);
    if(buffer.length<44||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')throw Error('로컬 서버가 WAV 음성을 반환하지 않았습니다.');
    return {base64:buffer.toString('base64'),mime:'audio/wav'};
  }));
  return { cancel, shutdown(){stopped=true;cancel();} };
}
module.exports={registerVoice,DEFAULT_VOICE,validatePreferences,localEndpoint};
