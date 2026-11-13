import type { VoicePreferences } from "../shared/voice";
import { pcmWav, resample, rms, segmenter } from "../shared/voice-activity";

export function captureVoice(media: MediaStream, prefs: VoicePreferences, hooks: {
  onSegment: (value: Blob) => void;
  onState: (value: string) => void;
  onStopped: () => void;
}) {
  const context = new AudioContext();
  let source:MediaStreamAudioSourceNode, processor:ScriptProcessorNode, mute:GainNode;
  try {source=context.createMediaStreamSource(media);processor=context.createScriptProcessor(2048,1,1);mute=context.createGain();}
  catch(error){media.getTracks().forEach(track=>track.stop());void context.close().catch(()=>{});throw error;}
  mute.gain.value=0;
  const vad=segmenter({silenceMs:prefs.silenceMs,maximumMs:prefs.maxSpeechSeconds*1000,idleMs:prefs.continuous?0:15000});
  let ended=false, chunks: Float32Array[]=[], preroll: Float32Array[]=[], prelength=0, watchdog: ReturnType<typeof setInterval>;
  const listeners: Array<() => void>=[];
  function emit() {
    if(!chunks.length)return;
    const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0), samples=new Float32Array(length+(length<24000?4800:0));
    let index=0;for(const chunk of chunks){samples.set(chunk,index);index+=chunk.length;}chunks=[];
    hooks.onSegment(new Blob([pcmWav(samples)],{type:"audio/wav"}));
  }
  function stop(flush=false) {
    if(ended)return;
    ended=true;
    processor.onaudioprocess=null;context.onstatechange=null;
    clearInterval(watchdog);
    listeners.forEach(remove=>remove());
    if(flush&&vad.speaking)emit();
    chunks=[];preroll=[];
    try{source.disconnect();processor.disconnect();mute.disconnect();}catch{}
    media.getTracks().forEach(track=>track.stop());
    void context.close().catch(()=>{});
    hooks.onStopped();
  }
  processor.onaudioprocess=event=>{
    if(ended)return;
    const samples=resample(event.inputBuffer.getChannelData(0),context.sampleRate);
    const wasSpeaking=vad.speaking, result=vad.push(rms(samples),samples.length/16);
    if(wasSpeaking)chunks.push(samples);
    else {
      preroll.push(samples);prelength+=samples.length;
      while(prelength>8000&&preroll.length>1)prelength-=preroll.shift()!.length;
      if(result==="start"){chunks=preroll;preroll=[];prelength=0;hooks.onState("말소리 인식 중");}
    }
    if(result==="end") { emit(); hooks.onState(prefs.continuous?"호출어를 기다리는 중":"음성 인식 중"); if(!prefs.continuous)stop(); }
    else if(result==="idle"){hooks.onState("말소리가 없어 듣기를 마쳤습니다.");stop();}
  };
  try {
    source.connect(processor);processor.connect(mute);mute.connect(context.destination);
    for(const track of media.getTracks()) {
      const ended=()=>{hooks.onState("마이크 연결이 끝나 듣기를 마쳤습니다.");stop();};
      track.addEventListener?.("ended",ended);listeners.push(()=>track.removeEventListener?.("ended",ended));
      track.addEventListener?.("mute",ended);listeners.push(()=>track.removeEventListener?.("mute",ended));
    }
    context.onstatechange=()=>{if(context.state==="closed"||context.state==="suspended")stop();};
    void navigator.permissions?.query({name:"microphone" as PermissionName}).then(permission=>{
      if(ended)return;
      const changed=()=>{if(permission.state==="denied")stop();};
      permission.addEventListener("change",changed);listeners.push(()=>permission.removeEventListener("change",changed));changed();
    }).catch(()=>{});
    watchdog=setInterval(()=>{
      if(media.getTracks().some(track=>track.readyState==="ended")||context.state==="closed")stop();
    },1000);
    void context.resume().catch(()=>stop());
    hooks.onState(prefs.continuous?"연속 듣는 중 / 중단 버튼으로 종료":"듣는 중 / 잠시 멈추면 인식합니다");
    return {stop};
  }catch(error){stop();throw error;}
}
