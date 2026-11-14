import { useEffect, useRef, useState } from "react";
import {
  Music,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { MusicState, MusicLyrics, MusicInfo } from "../shared/music";
import "./music.css";
const initial: MusicState = {
  lists: [],
  selected: "",
  volume: 60,
  time: 0,
  index: 0,
  muted: false,
  shuffle: false,
  loop: true,
  repeatOne: false,
};
const clock = (n: number) =>
  Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
export default function MusicPanel({
  visible,
  locked = false,
}: {
  visible: boolean;
  locked?: boolean;
}) {
  const [state, setState] = useState(initial),
    [url, setURL] = useState(""),
    [input, setInput] = useState(""),
    [name, setName] = useState(""),
    [tab, setTab] = useState("queue"),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false);
  const [track, setTrack] = useState({
    playing: false,
    time: 0,
    duration: 0,
    index: 0,
    title: "",
    author: "",
    queue: [] as string[],
  });
  const frame = useRef<HTMLIFrameElement>(null),
    lastSave = useRef(0),
    latest = useRef(state);
  latest.current = state;
  const entry = state.lists.find((v) => v.id === state.selected),
    api = window.flowrium;
  const [adding,setAdding] = useState(false),[musicNotice,setMusicNotice] = useState('');
  const [infos,setInfos] = useState<Record<string,MusicInfo>>({}),[infoBusy,setInfoBusy] = useState(false),[infoRefresh,setInfoRefresh] = useState(0),[queueLimit,setQueueLimit] = useState(50);
  const infoEpoch=useRef(0),infoRef=useRef(infos),lockedRef=useRef(locked);
  infoRef.current=infos;lockedRef.current=locked;
  const queueIds=Array.isArray(track.queue)?track.queue.filter(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{6,100}$/.test(id)).slice(0,queueLimit):[];
  const queueKey=queueIds.join(',');
  useEffect(()=>{setQueueLimit(50);},[state.selected]);
  useEffect(()=>{
    const epoch=++infoEpoch.current;
    if(!api||locked||!visible||!queueIds.length){setInfoBusy(false);return;}
    const missing=queueIds.filter(id=>infoRefresh>0||!infoRef.current[id]);
    if(!missing.length){setInfoBusy(false);return;}
    setInfoBusy(true);
    void (async()=>{
      for(let index=0;index<missing.length;index+=50){
        const rows=await api.musicInfo({videoIds:missing.slice(index,index+50),refresh:infoRefresh>0});
        if(epoch!==infoEpoch.current)return;
        setInfos(current=>({...current,...Object.fromEntries(rows.map(row=>[row.id,row]))}));
      }
    })().catch(()=>{if(epoch===infoEpoch.current)setMusicNotice('곡 정보를 읽지 못했습니다. 재생은 계속 사용할 수 있습니다.');})
      .finally(()=>{if(epoch===infoEpoch.current)setInfoBusy(false);});
    return()=>{infoEpoch.current++;};
  },[api,locked,visible,queueKey,infoRefresh]);
  const [lyrics, setLyrics] = useState<MusicLyrics | null>(), [lyricsNotice, setLyricsNotice] = useState(''), [lyricsBusy,setLyricsBusy] = useState(false);
  const lyricEpoch = useRef(0);
  useEffect(()=>{lyricEpoch.current++;setLyrics(undefined);setLyricsNotice('');},[track.title,track.author,state.selected,locked]);
  async function lookupLyrics() {
    if (!api || !track.title || locked || lyricsBusy) return;
    const epoch=++lyricEpoch.current;setLyricsBusy(true);setLyricsNotice('');
    try {const value=await api.findMusicLyrics({title:track.title,author:track.author,duration:track.duration});if(epoch===lyricEpoch.current){setLyrics(value);if(!value)setLyricsNotice('일치하는 가사를 찾지 못했습니다.');}}
    catch(e){if(epoch===lyricEpoch.current)setLyricsNotice(e instanceof Error?e.message:String(e));}
    finally{setLyricsBusy(false);}
  }
  const lyricIndex = lyrics?.lines.reduce((last,line,i)=>line.time<=track.time?i:last,-1) ?? -1;
  const lyricContainer=useRef<HTMLElement>(null);
  useEffect(()=>{ const container=lyricContainer.current, line=container?.querySelector<HTMLElement>('[aria-current=true]');
    if(!visible || tab!=='lyrics' || !container || !line)return;
    const box=container.getBoundingClientRect(), item=line.getBoundingClientRect();
    if(item.top<box.top || item.bottom>box.bottom)container.scrollTop+=item.top-box.top-container.clientHeight/2+item.height/2;
  },[lyricIndex,visible,tab]);
  useEffect(()=>()=>{lyricEpoch.current++;},[]);
  function command(action: string, value?: unknown) {
    if (url)
      frame.current?.contentWindow?.postMessage(
        { flowriumMusic: true, action, value },
        new URL(url).origin,
      );
  }
  async function save(value: MusicState) {
    setState(value);
    try {
      await api?.saveMusic(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    let live = true;
    api
      ?.musicState()
      .then((v) => {
        if (live) setState(v);
      })
      .catch((e) => setError(String(e)));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!url) return;
    function received(e: MessageEvent) {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== new URL(url).origin ||
        !e.data?.flowriumMusic
      )
        return;
      if (e.data.ready) setReady(true);
      if (e.data.error) {
        setError(e.data.error);
        return;
      }
      if (typeof e.data.playing === "boolean") {
        const data = e.data;
        setTrack(data);
        if (!locked && Date.now() - lastSave.current > 7000 && data.playing) {
          lastSave.current = Date.now();
          void api
            ?.saveMusic({
              ...latest.current,
              time: data.time,
              index: data.index,
            })
            .catch(() => {});
        }
      }
    }
    window.addEventListener("message", received);
    return () => window.removeEventListener("message", received);
  }, [url, locked]);
  useEffect(() => {
    if (locked) command("pause");
  }, [locked]);
  async function play(id: string) {
    const item = state.lists.find((v) => v.id === id);
    if (!item || !api) return;
    setError("");
    const next = {
      ...state,
      selected: id,
      time: state.selected === id ? track.time || state.time : 0,
      index: state.selected === id ? track.index : 0,
    };
    await save(next);
    if (!url) {
      setURL((await api.musicPlayer()).url);
      return;
    }
    frame.current?.contentWindow?.postMessage(
      { flowriumMusic: true, action: "load", ...item, ...next },
      new URL(url).origin,
    );
  }
  useEffect(() => {
    if (ready && entry)
      frame.current?.contentWindow?.postMessage(
        { flowriumMusic: true, action: "load", ...entry, ...state },
        new URL(url).origin,
      );
  }, [ready]);
  async function add() {
    if(adding||locked)return;
    setAdding(true);setMusicNotice('');
    try {
      const parsed = new URL(input);
      if (
        ![
          "www.youtube.com",
          "youtube.com",
          "music.youtube.com",
          "youtu.be",
        ].includes(parsed.hostname) ||
        parsed.protocol !== "https:"
      )
        throw Error("YouTube 주소를 확인해 주세요.");
      const list = parsed.searchParams.get("list"),
        id =
          list ||
          (parsed.hostname === "youtu.be"
            ? parsed.pathname.slice(1)
            : parsed.searchParams.get("v"));
      if (!id || !/^[a-zA-Z0-9_-]{6,100}$/.test(id))
        throw Error("동영상 또는 재생목록을 확인해 주세요.");
      if (state.lists.some((v) => v.id === id))
        throw Error("이미 저장한 목록입니다.");
      const chosenName=name.trim();
      let info:MusicInfo|undefined;
      try{[info]=await api!.musicInfo(list?{playlistId:id}:{videoIds:[id]});}catch{}
      if(lockedRef.current)return;
      const current=latest.current;
      if(current.lists.some(item=>item.id===id))throw Error('이미 저장한 목록입니다.');
      await save({
        ...current,
        lists: [
          ...current.lists,
          {
            id,
            kind: list ? "playlist" : "video",
            url: list
              ? "https://www.youtube.com/playlist?list=" + id
              : "https://www.youtube.com/watch?v=" + id,
            title: chosenName || info?.title || "재생목록 " + (current.lists.length + 1),
            lyrics: "",
            ...(info?.thumbnail&&{thumbnail:info.thumbnail}),
          },
        ],
      });
      setInput("");
      setName("");
      setError("");
      if(!info?.available)setMusicNotice('제목과 이미지를 읽지 못해 입력한 이름으로 저장했습니다. 목록에서 정보를 다시 읽을 수 있습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally{setAdding(false);}
  }
  async function refreshEntry(id:string){
    const item=latest.current.lists.find(value=>value.id===id);
    if(!api||!item||locked||adding)return;
    setAdding(true);setMusicNotice('');
    try{
      const [info]=await api.musicInfo(item.kind==='playlist'?{playlistId:id,refresh:true}:{videoIds:[id],refresh:true});
      if(lockedRef.current)return;
      if(!info?.available)throw Error('목록 정보를 읽지 못했습니다. 현재 이름과 재생 설정은 유지됩니다.');
      const current=latest.current;
      await save({...current,lists:current.lists.map(value=>value.id===id?{...value,title:info.title,...(info.thumbnail&&{thumbnail:info.thumbnail})}:value)});
      setMusicNotice('목록의 실제 이름과 이미지를 불러왔습니다.');
    }catch(value){setMusicNotice(value instanceof Error?value.message:String(value));}finally{setAdding(false);}
  }
  return (
    <div
      className={
        visible
          ? "music-page page-scroll"
          : url && !locked
            ? "music-mini"
            : "music-hidden"
      }
      aria-hidden={locked || (!visible && !url)}
    >
      {visible && (
        <header>
          <Music size={23} />
          <div>
            <h1>뮤직</h1>
            <p>재생목록을 직접 추가하고 작업하면서 들으세요.</p>
          </div>
        </header>
      )}
      <div className="music-stage">
        <div className="music-video">
          {url ? (
            <iframe
              ref={frame}
              title="YouTube 음악 플레이어"
              src={url}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="autoplay; encrypted-media; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="music-placeholder">
              <Music size={32} />
              <p>목록에서 재생할 음악을 선택하세요.</p>
            </div>
          )}
        </div>
        <div className="music-controls">
          <strong>{track.title || entry?.title || "선택한 음악 없음"}</strong>
          <small>{track.author}</small>
          <div className="music-buttons">
            <button
              aria-label="섞기"
              aria-pressed={state.shuffle}
              onClick={() => {
                void save({ ...state, shuffle: !state.shuffle });
                command("shuffle", !state.shuffle);
              }}
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="이전 곡"
              onClick={() => command("previous")}
              disabled={!ready}
            >
              <SkipBack />
            </button>
            <button
              aria-label={track.playing ? "일시정지" : "재생"}
              disabled={!ready}
              onClick={() => command(track.playing ? "pause" : "play")}
            >
              {track.playing ? <Pause /> : <Play />}
            </button>
            <button
              aria-label="다음 곡"
              onClick={() => command("next")}
              disabled={!ready}
            >
              <SkipForward />
            </button>
            <button
              aria-label={
                state.repeatOne
                  ? "한 곡 반복"
                  : state.loop
                    ? "전체 반복"
                    : "반복 안 함"
              }
              aria-pressed={state.repeatOne || state.loop}
              onClick={() => {
                const repeatOne = !state.repeatOne && state.loop,
                  loop = !state.loop || repeatOne;
                void save({ ...state, repeatOne, loop });
                command("loop", loop);
                command("repeat", repeatOne);
              }}
            >
              <Repeat size={17} />
              {state.repeatOne && <small>1</small>}
            </button>
          </div>
          <label className="music-range">
            {clock(track.time)}
            <input
              aria-label="재생 위치"
              type="range"
              min={0}
              max={track.duration || 1}
              value={track.time}
              onChange={(e) => command("seek", Number(e.target.value))}
            />
            {clock(track.duration)}
          </label>
          <label className="music-range">
            <button
              aria-label={state.muted ? "소리 켜기" : "음소거"}
              onClick={() => {
                void save({ ...state, muted: !state.muted });
                command(state.muted ? "unmute" : "mute");
              }}
            >
              {state.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              aria-label="음량"
              type="range"
              min={0}
              max={100}
              value={state.volume}
              onChange={(e) => {
                setState({ ...state, volume: Number(e.target.value) });
                command("volume", Number(e.target.value));
              }}
              onPointerUp={() => void save(latest.current)}
            />
          </label>
        </div>
      </div>
      {visible && (
        <>
          <section className="music-lists">
            <h2>내 재생목록</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                aria-label="음악 주소"
                placeholder="YouTube 동영상 또는 재생목록 주소"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={adding}
                required
              />
              <input
                aria-label="재생목록 이름"
                placeholder="목록 이름"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={adding}
              />
              <button className="button secondary" disabled={adding}>
                <Plus size={15} />
                추가
              </button>
            </form>
            {state.lists.map((item) => (
              <div className="music-list" key={item.id}>
                <button onClick={() => void play(item.id)}>
                  {item.thumbnail?<img className="music-list-thumbnail" src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"/>:<Play size={15} />}
                  <span>{item.title}</span>
                  {state.selected === item.id && <small>선택됨</small>}
                </button>
                <button type="button" className="music-info-action" aria-label={item.title+' 이름과 이미지 자동 읽기'} title="실제 이름과 이미지로 바꾸기" disabled={adding} onClick={()=>void refreshEntry(item.id)}><RefreshCw size={15}/></button>
                <button
                  aria-label={item.title + " 삭제"}
                  onClick={() => {
                    if (state.selected === item.id) command("pause");
                    void save({
                      ...state,
                      selected:
                        state.selected === item.id ? "" : state.selected,
                      lists: state.lists.filter((v) => v.id !== item.id),
                    });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </section>
          <nav className="music-tabs">
            <button
              aria-pressed={tab === "queue"}
              onClick={() => setTab("queue")}
            >
              재생 순서
            </button>
            <button
              aria-pressed={tab === "lyrics"}
              onClick={() => setTab("lyrics")}
            >
              가사와 메모
            </button>
          </nav>
          {tab === "queue" ? (
            <><div className="music-queue-tools"><span>{track.queue.length}곡{infoBusy?' / 곡 정보 확인 중':''}</span><button type="button" disabled={infoBusy||!queueIds.length} onClick={()=>setInfoRefresh(value=>value+1)}><RefreshCw size={14}/>곡 정보 다시 읽기</button></div><ol className="music-queue">
              {queueIds.map((id, i) => (
                <li key={id + i}>
                  <button
                    onClick={() => command("at", i)}
                    aria-pressed={i === track.index}
                  >
                    <span className="music-queue-number">{i+1}</span>{infos[id]?.thumbnail&&<img src={infos[id].thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer"/>}<span className="music-queue-label"><strong>{infos[id]?.title||'곡 정보 확인 중'}</strong><small>{infos[id]?.author||(!infos[id]?.available&&infos[id]?'정보를 읽지 못한 곡 / '+id:id)}</small></span>
                  </button>
                </li>
              ))}
            </ol>{queueLimit<track.queue.length&&<button type="button" className="music-queue-more" onClick={()=>setQueueLimit(value=>value+50)}>다음 50곡 보기</button>}</>
          ) : entry ? (
            <section className="music-lyrics-panel">
            <button disabled={!track.title || lyricsBusy || locked} onClick={()=>void lookupLyrics()}>{lyricsBusy?'가사 검색 중':'현재 곡 가사 자동 검색'}</button>
            {lyrics && <section ref={lyricContainer} className="synced-lyrics" aria-label="자동 검색 가사"><p>{lyrics.track}<br/>{lyrics.artist} ({lyrics.source})</p>
              {lyrics.instrumental?<p>연주곡입니다.</p>:lyrics.lines.length?<ol>{lyrics.lines.map((line,i)=><li key={line.time+':'+i} aria-current={i===lyricIndex?'true':undefined}><button onClick={()=>command('seek',line.time)}>{line.text||'♪'}</button></li>)}</ol>:<pre>{lyrics.plain}</pre>}</section>}
            {lyricsNotice&&<p role="status">{lyricsNotice}</p>}
            <label className="music-lyrics">
              직접 보관할 가사나 메모
              <textarea
                value={entry.lyrics}
                rows={10}
                onChange={(e) =>
                  setState({
                    ...state,
                    lists: state.lists.map((v) =>
                      v.id === entry.id ? { ...v, lyrics: e.target.value } : v,
                    ),
                  })
                }
                onBlur={() => void save(latest.current)}
              />
            </label>
            </section>
          ) : (
            <p>재생목록을 먼저 선택하세요.</p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {musicNotice&&<p className="music-info-notice" role="status">{musicNotice}</p>}
        </>
      )}
    </div>
  );
}
