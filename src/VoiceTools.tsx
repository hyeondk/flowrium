import { AnimatedSwitch } from './ui-motion';
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, Volume2, VolumeX, Upload } from "lucide-react";
import type { VoicePreferences } from "../shared/voice";
import { afterWakeWord } from "../shared/voice-activity";
import { captureVoice } from "./voice-capture";
import { VoiceServerPanel } from './VoiceServerPanel';
import type { VoiceServerId } from '../shared/voice-server';
import "./voice.css";
import {speakableMessage} from "./message-content";

export function VoiceSettings() {
  const [prefs,setPrefs]=useState<VoicePreferences|null>(null),[configured,setConfigured]=useState(false),
    [key,setKey]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const api=window.flowrium;
  useEffect(()=>{let active=true;void Promise.all([api!.voicePreferences(),api!.voiceStatus()]).then(([value,status])=>{if(active){setPrefs(value);setConfigured(status.configured);}}).catch(error=>{if(active)setNotice(String(error));});return()=>{active=false;};},[]);
  function change<K extends keyof VoicePreferences>(name:K,value:VoicePreferences[K]) {
    setPrefs(previous=>previous?{...previous,[name]:value,...((name==="continuous"||name==="wakeEnabled")&&!value?{autoSubmit:false}:{})}:null);
  }
  async function save() {
    if(!prefs||busy)return;setBusy(true);setNotice("");
    try{setPrefs(await api!.configureVoicePreferences(prefs));setConfigured((await api!.voiceStatus()).configured);setNotice("음성 설정을 저장했습니다. 다음 듣기부터 적용됩니다.");}
    catch(error){setNotice(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  }
  async function connectServer(id:VoiceServerId,endpoint:string) {
    const current=prefs||await api!.voicePreferences();
    const next:VoicePreferences=id==='recognition'?{...current,provider:'local',localWhisper:endpoint}:{...current,tts:'local',localTts:endpoint};
    setPrefs(await api!.configureVoicePreferences(next));setConfigured((await api!.voiceStatus()).configured);setNotice('로컬 음성 서버 주소를 적용했습니다.');
  }
  return <section className="settings-section voice-settings">
    <h3>음성 입력과 읽기</h3>
    <p>마이크 버튼을 눌러야 듣기를 시작합니다. 기본은 인식한 문장을 입력창에서 검토한 뒤 직접 전송합니다.</p>
    {prefs&&<>
      <label>음성 인식 방식<select aria-label="음성 인식 방식" value={prefs.provider} onChange={event=>change("provider",event.target.value as VoicePreferences["provider"])}><option value="api">OpenAI 음성 인식</option><option value="local">이 기기의 로컬 음성 서버</option></select></label>
      {prefs.provider==="local"?<><label>로컬 인식 서버 주소<input aria-label="로컬 인식 서버 주소" value={prefs.localWhisper} onChange={event=>change("localWhisper",event.target.value)}/></label><p>이 기기의 127.0.0.1 서버만 연결합니다. 로컬 인식은 API 키 없이 사용할 수 있습니다.</p></>:<>
        <p>음성 인식에는 본인의 OpenAI API 키와 별도 API 사용료가 필요합니다. ChatGPT 로그인과 별도 설정입니다.</p>
        <label>OpenAI API 키<input aria-label="음성 인식 API 키" type="password" autoComplete="off" value={key} onChange={event=>setKey(event.target.value)}/></label>
        <div className="settings-buttons"><button className="button secondary" disabled={!key.trim()||busy} onClick={()=>{setBusy(true);void api!.configureVoice(key.trim()).then(()=>{setConfigured(true);setKey("");setNotice("음성 입력 키를 보안 저장소에 보관했습니다.");}).catch(error=>setNotice(String(error))).finally(()=>setBusy(false));}}>키 저장</button>{configured&&<button className="button subtle" disabled={busy} onClick={()=>{setBusy(true);void api!.configureVoice(null).then(()=>{setConfigured(false);setNotice("음성 입력 키를 삭제했습니다.");}).catch(error=>setNotice(String(error))).finally(()=>setBusy(false));}}>키 삭제</button>}</div>
      </>}
      <label className="voice-choice"><span>연속 듣기 사용</span><AnimatedSwitch checked={prefs.continuous} onChange={event=>change("continuous",event.target.checked)}/></label>
      <p>대화하는 동안 말소리를 구간별로 인식합니다. 답변 생성 중에는 마이크를 닫고, 끝나면 듣기를 이어갑니다. 화면을 떠나거나 잠그면 종료합니다.</p>
      {prefs.continuous&&<>
        <label className="voice-choice"><span>호출어 뒤의 요청만 인식</span><AnimatedSwitch checked={prefs.wakeEnabled} onChange={event=>change("wakeEnabled",event.target.checked)}/></label>
        {prefs.wakeEnabled&&<label>호출어<input aria-label="음성 호출어" value={prefs.wakeWord} maxLength={40} onChange={event=>change("wakeWord",event.target.value)}/></label>}
        <label className="voice-choice"><span>호출어 뒤 요청을 ChatGPT에 바로 전송</span><AnimatedSwitch checked={prefs.autoSubmit} disabled={!prefs.wakeEnabled} onChange={event=>change("autoSubmit",event.target.checked)}/></label>
        <p>자동 전송을 선택하면 호출어 뒤의 요청으로 실제 작업이 시작됩니다. 선택하지 않으면 입력창에서 검토합니다. 호출어만 말한 뒤 30초 안에 요청을 이어 말할 수도 있습니다.</p>
      </>}
      <div className="voice-settings-grid"><label>말끝 무음 시간<select aria-label="말끝 무음 시간" value={prefs.silenceMs} onChange={event=>change("silenceMs",Number(event.target.value))}>{[500,700,900,1200,1600,2000,2500,3000].map(value=><option key={value} value={value}>{value/1000}초</option>)}</select></label><label>한 구간 최대 길이<select aria-label="음성 구간 최대 길이" value={prefs.maxSpeechSeconds} onChange={event=>change("maxSpeechSeconds",Number(event.target.value))}>{[15,30,45,60,90,120].map(value=><option key={value} value={value}>{value}초</option>)}</select></label></div>
      <label>답변 읽기 방식<select aria-label="답변 읽기 방식" value={prefs.tts} onChange={event=>change("tts",event.target.value as VoicePreferences["tts"])}><option value="system">운영체제 기본 음성</option><option value="local">로컬 음성 합성 서버</option></select></label>
      {prefs.tts==="local"&&<>
        <label>로컬 읽기 서버 주소<input aria-label="로컬 읽기 서버 주소" value={prefs.localTts} onChange={event=>change("localTts",event.target.value)}/></label>
        <label>서버의 기준 음성 경로<input aria-label="기준 음성 경로" value={prefs.ttsReferencePath} onChange={event=>change("ttsReferencePath",event.target.value)}/></label>
        <label>기준 음성에 담긴 문장<textarea aria-label="기준 음성 문장" rows={2} value={prefs.ttsPromptText} onChange={event=>change("ttsPromptText",event.target.value)}/></label>
        <label>읽기 속도<select aria-label="음성 읽기 속도" value={prefs.ttsSpeed} onChange={event=>change("ttsSpeed",Number(event.target.value))}>{[.7,.8,.9,1,1.1,1.2,1.5,2].map(value=><option key={value} value={value}>{value}배</option>)}</select></label>
        <p>사용자가 준비한 서버와 기준 음성만 사용합니다. 앱이 모델이나 기준 음성을 자동으로 내려받지 않습니다.</p>
      </>}
      <button className="button secondary" disabled={busy} onClick={()=>void save()}>음성 설정 저장</button>
    </>}
    <p role="status">{notice||(!prefs?"음성 설정을 불러오는 중":configured?"음성 입력 사용 가능":"음성 입력 설정 전")}</p>
    <VoiceServerPanel onConnect={connectServer}/>
  </section>;
}

function asBase64(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(Error("음성 파일을 열지 못했습니다."));reader.readAsDataURL(blob);});}
export function VoiceComposer({onText,onSubmit,disabled=false,suspend=false}:{onText:(value:string)=>void;onSubmit?:(value:string)=>void;disabled?:boolean;suspend?:boolean}) {
  const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const capture=useRef<ReturnType<typeof captureVoice>|undefined>(undefined), stream=useRef<MediaStream|undefined>(undefined), input=useRef<HTMLInputElement>(null);
  const alive=useRef(true),generation=useRef(0),starting=useRef(false),blocked=useRef(disabled),armed=useRef(false),prefsRef=useRef<VoicePreferences|null>(null);
  const handlers=useRef({onText,onSubmit}), chain=useRef(Promise.resolve()), pending=useRef(0),wakeUntil=useRef(0),restart=useRef<()=>void>(()=>{});
  handlers.current={onText,onSubmit};blocked.current=disabled||suspend;
  function valid(token:number){return alive.current&&!blocked.current&&generation.current===token;}
  function cancel() {
    const active=!!capture.current||!!stream.current||starting.current||pending.current>0;
    generation.current++;wakeUntil.current=0;
    capture.current?.stop();capture.current=undefined;stream.current?.getTracks().forEach(track=>track.stop());stream.current=undefined;
    if(active)void window.flowrium?.cancelVoiceCapture().catch(()=>{});
    if(alive.current){setRecording(false);setBusy(false);}
  }
  function enqueue(blob:Blob,token:number,prefs:VoicePreferences|null) {
    if(!valid(token))return;
    if(blob.size>19*1024*1024){setMessage("음성 파일은 19MB까지 사용할 수 있습니다.");return;}
    if(pending.current>=4){armed.current=false;capture.current?.stop();setMessage("인식 대기 구간이 많아 듣기를 마쳤습니다. 결과를 확인한 뒤 다시 시작해 주세요.");return;}
    pending.current++;setBusy(true);
    chain.current=chain.current.catch(()=>{}).then(async()=>{
      try {
        if(!valid(token))return;
        const base64=await asBase64(blob);if(!valid(token))return;
        let text=await window.flowrium!.transcribeVoice({base64,mime:blob.type.split(";")[0]||"audio/wav",requestId:crypto.randomUUID()});
        if(!valid(token)||!text.trim())return;
        let called=false;
        if(prefs?.continuous&&prefs.wakeEnabled) {
          const command=afterWakeWord(text,prefs.wakeWord);
          if(command===null){if(wakeUntil.current<Date.now()){setMessage("호출어를 기다리는 중");return;}called=true;wakeUntil.current=0;}
          else {called=true;text=command;if(!text){wakeUntil.current=Date.now()+30000;setMessage("네, 요청을 이어 말씀해 주세요.");return;}wakeUntil.current=0;}
        }
        if(prefs?.continuous&&/^(대화\s*종료|듣기\s*중단|그만\s*듣기)[.!?\s]*$/.test(text)){armed.current=false;capture.current?.stop();setMessage("연속 듣기를 마쳤습니다.");return;}
        if(prefs?.autoSubmit&&prefs.continuous&&prefs.wakeEnabled&&called&&handlers.current.onSubmit){handlers.current.onSubmit(text);setMessage("호출어 뒤 요청을 전송했습니다.");}
        else {handlers.current.onText(text);setMessage("인식한 문장을 입력창에 추가했습니다.");}
      }catch(error){if(valid(token))setMessage(error instanceof Error?error.message:String(error));}
      finally{pending.current--;if(valid(token)&&pending.current===0)setBusy(false);}
    });
  }
  async function start(resuming=false) {
    if(starting.current||blocked.current||!alive.current)return;
    starting.current=true;setBusy(true);setMessage("");const token=++generation.current;
    try {
      const status=await window.flowrium!.voiceStatus();if(!valid(token))return;
      if(!status.configured)throw Error("설정에서 API 키나 로컬 음성 서버를 먼저 연결해 주세요.");
      const prefs=await window.flowrium!.voicePreferences();if(!valid(token))return;
      prefsRef.current=prefs;
      if(resuming&&(!armed.current||!prefs.continuous))return;
      if(!await window.flowrium!.allowVoiceCapture())throw Error("마이크 사용 권한을 허용해 주세요.");
      if(!valid(token))return;
      const media=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(!valid(token)){media.getTracks().forEach(track=>track.stop());return;}
      stream.current=media;armed.current=prefs.continuous;
      capture.current=captureVoice(media,prefs,{
        onSegment:blob=>enqueue(blob,token,prefs),
        onState:value=>{if(valid(token))setMessage(value);},
        onStopped:()=>{capture.current=undefined;stream.current=undefined;if(valid(token))setRecording(false);},
      });
      if(valid(token))setRecording(true);
    }catch(error){if(valid(token)){armed.current=false;setMessage(error instanceof Error?error.message:String(error));}stream.current?.getTracks().forEach(track=>track.stop());stream.current=undefined;}
    finally{starting.current=false;if(valid(token)&&!pending.current)setBusy(false);}
  }
  restart.current=()=>{void start(true);};
  useEffect(()=>{alive.current=true;const hide=()=>{if(document.hidden){armed.current=false;cancel();}};document.addEventListener("visibilitychange",hide);return()=>{alive.current=false;armed.current=false;cancel();document.removeEventListener("visibilitychange",hide);};},[]);
  useEffect(()=>{if(suspend){armed.current=false;cancel();setMessage("");}},[suspend]);
  useEffect(()=>{if(disabled){cancel();if(armed.current)setMessage("답변이 끝나면 연속 듣기를 이어갑니다.");}else if(armed.current)restart.current();},[disabled]);
  return <span className="voice-composer">
    <input ref={input} type="file" accept="audio/webm,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/flac" hidden onChange={event=>{const file=event.target.files?.[0];if(file){const token=++generation.current;enqueue(file,token,null);}event.currentTarget.value="";}}/>
    <button type="button" className="icon-button" aria-label={recording?"녹음 끝내기":"음성으로 입력"} disabled={disabled||suspend||(busy&&!recording)} onClick={()=>{if(recording){armed.current=false;capture.current?.stop(true);}else void start();}}>{recording?<Square size={15}/>:<Mic size={15}/>}</button>
    <button type="button" className="icon-button" aria-label="음성 파일에서 입력" disabled={disabled||suspend||busy||recording} onClick={()=>input.current?.click()}><Upload size={14}/></button>
    {busy&&<small>음성 인식 중</small>}
    {message&&<span role="status" className="voice-message">{message}</span>}
  </span>;
}

export function SpeakButton({text}:{text:string}) {
  const [speaking,setSpeaking]=useState(false),[message,setMessage]=useState("");
  const generation=useRef(0),audio=useRef<HTMLAudioElement|null>(null),objectUrl=useRef<string|undefined>(undefined),alive=useRef(true),loading=useRef(false);
  function release(){audio.current?.pause();audio.current=null;if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=undefined;speechSynthesis.cancel();}
  function stop(){generation.current++;release();if(loading.current)void window.flowrium?.cancelVoiceCapture().catch(()=>{});loading.current=false;if(alive.current)setSpeaking(false);}
  useEffect(()=>{alive.current=true;const hide=()=>{if(document.hidden)stop();};document.addEventListener("visibilitychange",hide);return()=>{alive.current=false;stop();document.removeEventListener("visibilitychange",hide);};},[]);
  async function play(){
    if(speaking){stop();return;}
    const token=++generation.current;release();setSpeaking(true);setMessage("");loading.current=true;
    const valid=()=>alive.current&&generation.current===token;
    try {
      const prefs=await window.flowrium!.voicePreferences();if(!valid())return;
      if(prefs.tts==="local"){
        const value=await window.flowrium!.speakVoice({text,requestId:crypto.randomUUID()});if(!valid())return;
        const bytes=Uint8Array.from(atob(value.base64),character=>character.charCodeAt(0));
        objectUrl.current=URL.createObjectURL(new Blob([bytes],{type:value.mime}));
        const player=new Audio(objectUrl.current);audio.current=player;
        player.onended=()=>{if(valid()){release();setSpeaking(false);}};
        player.onerror=()=>{if(valid()){release();setSpeaking(false);setMessage("음성을 재생하지 못했습니다.");}};
        loading.current=false;
        try{await player.play();}catch{throw Error("음성을 재생하지 못했습니다. 음성 서버 응답과 재생 상태를 확인해 주세요.");}
      }else{
        loading.current=false;const chunks=text.match(/[\s\S]{1,900}(?:[。.!?\n]|$)|[\s\S]{1,900}/g)||[];let index=0;
        const next=()=>{if(!valid())return;if(index>=chunks.length){setSpeaking(false);return;}const utterance=new SpeechSynthesisUtterance(chunks[index++]);utterance.lang="ko-KR";utterance.onend=next;utterance.onerror=()=>{if(valid())setSpeaking(false);};speechSynthesis.speak(utterance);};next();
      }
    }catch(error){if(valid()){release();setSpeaking(false);setMessage(error instanceof Error?error.message:String(error));}}finally{if(valid())loading.current=false;}
  }
  return <span className="voice-read"><button className="icon-button" aria-label={speaking?"읽기 중단":"답변 읽어주기"} onClick={()=>void play()}>{speaking?<VolumeX size={14}/>:<Volume2 size={14}/>}</button>{message&&<span role="status">{message}</span>}</span>;
}

export function SpeakMessageButton({text}:{text:string}){const body=useMemo(()=>speakableMessage(text,"assistant"),[text]);return body?<SpeakButton text={body}/>:null}
