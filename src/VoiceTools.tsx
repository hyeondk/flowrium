import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, VolumeX, Upload } from "lucide-react";
export function VoiceSettings() {
  const [configured, setConfigured] = useState(false),
    [key, setKey] = useState(""),
    [notice, setNotice] = useState("");
  const api = window.flowrium;
  useEffect(() => {
    api
      ?.voiceStatus()
      .then((v) => setConfigured(v.configured))
      .catch(() => {});
  }, []);
  return (
    <section className="settings-section">
      <h3>음성 입력</h3>
      <p>
        음성 인식은 본인의 OpenAI API 키로 사용하며 API 사용료가 발생합니다.
        인식한 문장은 입력창에서 확인하고 직접 전송합니다.
      </p>
      <label>
        OpenAI API 키
        <input
          aria-label="음성 인식 API 키"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <div className="settings-buttons">
        <button
          className="button secondary"
          disabled={!key.trim()}
          onClick={() =>
            void api
              ?.configureVoice(key.trim())
              .then(() => {
                setConfigured(true);
                setKey("");
                setNotice("음성 입력을 연결했습니다.");
              })
              .catch((e) => setNotice(String(e)))
          }
        >
          키 저장
        </button>
        {configured && (
          <button
            className="button subtle"
            onClick={() =>
              void api?.configureVoice(null).then(() => {
                setConfigured(false);
                setNotice("음성 입력 연결을 해제했습니다.");
              })
            }
          >
            키 삭제
          </button>
        )}
      </div>
      <p role="status">
        {notice || (configured ? "음성 입력 연결됨" : "음성 입력 설정 전")}
      </p>
    </section>
  );
}
export function VoiceComposer({
  onText,
  disabled = false,
}: {
  onText: (value: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | undefined>(undefined),
    stream = useRef<MediaStream | undefined>(undefined),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    handler = useRef(onText),
    generation = useRef(0),
    starting = useRef(false),
    blocked = useRef(disabled);
  handler.current = onText;
  blocked.current = disabled;
  async function transcribe(blob: Blob) {
    if (blob.size > 19 * 1024 * 1024) {
      setMessage("음성 파일은 19MB까지 사용할 수 있습니다.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (!alive.current || blocked.current) return;
      const value = await window.flowrium!.transcribeVoice({
        base64: data,
        mime: blob.type.split(";")[0] || "audio/webm",
      });
      if (alive.current) handler.current(value);
    } catch (e) {
      if (alive.current) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      generation.current++;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      setRecording(false);
    }
  }, [disabled]);
  async function start() {
    if (starting.current || disabled) return;
    starting.current = true;
    setBusy(true);
    setMessage("");
    const epoch = ++generation.current;
    const valid = () =>
      alive.current && !blocked.current && epoch === generation.current;
    try {
      const status = await window.flowrium?.voiceStatus();
      if (!valid()) return;
      if (!status?.configured)
        throw Error("설정에서 음성 입력 API 키를 먼저 등록해 주세요.");
      const allowed = await window.flowrium?.allowVoiceCapture();
      if (!valid()) return;
      if (!allowed) throw Error("마이크 사용 권한을 허용해 주세요.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!valid()) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const r = new MediaRecorder(media, { mimeType: "audio/webm" }),
        chunks: BlobPart[] = [];
      recorder.current = r;
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        clearTimeout(timer.current);
        if (valid()) {
          setRecording(false);
          void transcribe(new Blob(chunks, { type: "audio/webm" }));
        }
      };
      r.start(1000);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (r.state === "recording") r.stop();
      }, 180000);
    } catch (e) {
      if (valid()) setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      starting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <span className="voice-composer">
      <input
        ref={input}
        type="file"
        accept="audio/webm,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void transcribe(file);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="icon-button"
        aria-label={recording ? "녹음 끝내기" : "음성으로 입력"}
        disabled={disabled || busy}
        onClick={() => (recording ? recorder.current?.stop() : void start())}
      >
        {recording ? <Square size={15} /> : <Mic size={15} />}
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="음성 파일에서 입력"
        disabled={disabled || busy || recording}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} />
      </button>
      {busy && <small>음성 인식 중</small>}
      {message && (
        <span role="status" className="voice-message">
          {message}
        </span>
      )}
    </span>
  );
}
export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; speechSynthesis.cancel(); }, []);
  function stop() { generation.current++; speechSynthesis.cancel(); setSpeaking(false); }
  function play() {
    if (speaking) { stop(); return; }
    const chunks = text.match(/[\s\S]{1,900}(?:[。.!?\n]|$)|[\s\S]{1,900}/g) || [];
    if (!chunks.length) return;
    const token = ++generation.current;
    let index = 0;
    speechSynthesis.cancel();
    setSpeaking(true);
    function next() {
      if (generation.current !== token) return;
      if (index >= chunks.length) { setSpeaking(false); return; }
      const utterance = new SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = "ko-KR";
      utterance.onend = next;
      utterance.onerror = () => { if (generation.current === token) setSpeaking(false); };
      speechSynthesis.speak(utterance);
    }
    next();
  }
  return <button className="icon-button" aria-label={speaking ? "읽기 중단" : "답변 읽어주기"} onClick={play}>
    {speaking ? <VolumeX size={14}/> : <Volume2 size={14}/>}
  </button>;
}
