export interface SegmentOptions {
  silenceMs: number;
  maximumMs: number;
  minimumMs?: number;
  idleMs?: number;
}
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}
export function segmenter(options: SegmentOptions) {
  let noise = .003, speaking = false, voiceMs = 0, quietMs = 0, duration = 0, idle = 0;
  return {
    get speaking() { return speaking; },
    push(level: number, milliseconds: number): "start" | "end" | "idle" | null {
      if (!Number.isFinite(level) || !Number.isFinite(milliseconds) || milliseconds <= 0) return null;
      const loud = level > Math.max(speaking ? .008 : .012, noise * (speaking ? 2 : 3));
      if (!speaking) {
        idle += milliseconds;
        if (!loud) noise = Math.max(.001, noise * .96 + level * .04);
        voiceMs = loud ? voiceMs + milliseconds : 0;
        if (voiceMs >= (options.minimumMs ?? 160)) {
          speaking = true; duration = voiceMs; quietMs = 0; return "start";
        }
        if (options.idleMs && idle >= options.idleMs) { idle = 0; return "idle"; }
      } else {
        duration += milliseconds; quietMs = loud ? 0 : quietMs + milliseconds;
        if (quietMs >= options.silenceMs || duration >= options.maximumMs) {
          speaking = false; voiceMs = 0; idle = 0; return "end";
        }
      }
      return null;
    },
  };
}
export function pcmWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const label = (offset: number, value: string) => { for (let index=0; index<value.length; index++) view.setUint8(offset+index,value.charCodeAt(index)); };
  label(0,"RIFF"); view.setUint32(4,36+samples.length*2,true); label(8,"WAVE"); label(12,"fmt ");
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  label(36,"data"); view.setUint32(40,samples.length*2,true);
  for(let index=0;index<samples.length;index++) { const value=Math.min(1,Math.max(-1,samples[index])); view.setInt16(44+index*2,Math.round(value*(value<0?32768:32767)),true); }
  return buffer;
}
export function resample(samples: Float32Array, sourceRate: number, targetRate = 16000): Float32Array {
  if(sourceRate===targetRate)return samples.slice();
  if(!Number.isFinite(sourceRate)||sourceRate<=0)throw Error("음성 샘플 속도를 확인해 주세요.");
  const ratio=sourceRate/targetRate, out=new Float32Array(Math.floor(samples.length/ratio));
  for(let index=0;index<out.length;index++) { const at=index*ratio, left=Math.floor(at), mix=at-left; out[index]=samples[left]*(1-mix)+(samples[Math.min(samples.length-1,left+1)]||0)*mix; }
  return out;
}
export function afterWakeWord(text: string, wakeWord: string): string | null {
  const value=text.normalize("NFC").trim().replace(/^[\s"'“”‘’,.!?]+/,"");
  const name=wakeWord.normalize("NFC").trim();
  if(!name)return null;
  const compact=name.replace(/\s/g,"").toLocaleLowerCase();
  let read="", end=0;
  for(const character of value) { end+=character.length; if(/\s/.test(character))continue; read+=character.toLocaleLowerCase(); if(!compact.startsWith(read))return null; if(read===compact)break; }
  if(read!==compact)return null;
  let tail=value.slice(end);
  if(/^[가-힣A-Za-z0-9]/.test(tail)) {
    const call=tail.match(/^(?:야|아|님)(?=[\s,.!?]|$)/);
    if(!call)return null;
    tail=tail.slice(call[0].length);
  }
  return tail.replace(/^[\s"'“”‘’,.!?:]+/,"").trim();
}
