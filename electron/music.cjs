const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  { randomUUID } = require("node:crypto");
function musicEntry(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw Error("YouTube 동영상 또는 재생목록 주소를 입력해 주세요.");
  }
  if (
    url.protocol !== "https:" ||
    ![
      "www.youtube.com",
      "youtube.com",
      "music.youtube.com",
      "youtu.be",
    ].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw Error("YouTube 주소를 확인해 주세요.");
  const list = url.searchParams.get("list"),
    video =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.searchParams.get("v");
  const id = list || video;
  if (!id || !/^[a-zA-Z0-9_-]{6,100}$/.test(id))
    throw Error("재생목록 또는 동영상 식별자를 찾지 못했습니다.");
  return {
    id,
    kind: list ? "playlist" : "video",
    url: list
      ? "https://www.youtube.com/playlist?list=" + id
      : "https://www.youtube.com/watch?v=" + id,
  };
}
function validateState(input) {
  if (!input || !Array.isArray(input.lists) || input.lists.length > 100)
    throw Error("재생목록 설정을 확인해 주세요.");
  const lists = input.lists.map((v) => {
    const parsed = musicEntry(v.url);
    if (
      typeof v.title !== "string" ||
      v.title.length > 200 ||
      typeof (v.lyrics || "") !== "string" ||
      (v.lyrics || "").length > 50000
    )
      throw Error("재생목록 제목이나 가사를 확인해 주세요.");
    return {
      ...parsed,
      title: v.title.trim() || parsed.id,
      lyrics: v.lyrics || "",
      ...(v.thumbnail && { thumbnail: require('./music-metadata.cjs').thumbnail(v.thumbnail) }),
    };
  });
  if (new Set(lists.map((v) => v.id)).size !== lists.length)
    throw Error("같은 재생목록이 중복됐습니다.");
  const number = (n, min, max) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (
    !number(input.volume, 0, 100) ||
    !number(input.time, 0, 86400) ||
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    input.index > 10000
  )
    throw Error("재생 설정을 확인해 주세요.");
  if (input.selected && !lists.some((v) => v.id === input.selected))
    throw Error("선택한 재생목록이 없습니다.");
  return {
    lists,
    selected: input.selected || "",
    volume: input.volume,
    time: input.time,
    index: input.index,
    muted: !!input.muted,
    shuffle: !!input.shuffle,
    loop: !!input.loop,
    repeatOne: !!input.repeatOne,
  };
}
function registerMusic(register, directory, options = {}) {
  const metadata = require('./music-metadata.cjs').createMusicMetadata(options);
  register('musicInfo', input => metadata.read(input));
  const file = path.join(directory, "music.json");
  let queue = Promise.resolve(),
    server,
    origin,
    playerPath = "/" + randomUUID() + "/player";
  const empty = {
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
  register("musicState", async () => {
    try {
      return validateState(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return empty;
      throw e;
    }
  });
  register("saveMusic", async (input) => {
    const value = validateState(input);
    const save = queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const temporary = file + "." + randomUUID() + ".tmp";
        try {
          await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    queue = save;
    await save;
    return value;
  });
  register("musicPlayer", async () => {
    if (!server) {
      server = http.createServer((req, res) => {
        if (
          req.url !== playerPath ||
          req.method !== "GET" ||
          req.headers.host !== "127.0.0.1:" + server.address().port
        ) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; style-src 'unsafe-inline'; connect-src https://www.youtube.com; img-src https://i.ytimg.com data:;",
        });
        res.end(playerHTML(origin));
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      server.unref();
      origin = "http://127.0.0.1:" + server.address().port;
    }
    return { url: origin + playerPath };
  });
  return {
    shutdown: () => { metadata.shutdown(); return server && new Promise((resolve) => server.close(resolve)); },
  };
}
function playerHTML(origin) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#e5e8ec}#player{width:100%;height:100%}</style><div id="player"></div><script>
let p,options,last,ready=false;
const send=(data)=>parent.postMessage({flowriumMusic:true,...data},'*');
function setup(v){options=v;if(!p||!ready)return;const f=v.kind==='playlist'?'loadPlaylist':'loadVideoById';if(v.kind==='playlist')p[f]({list:v.id,listType:'playlist',index:v.index||0,startSeconds:v.time||0});else p[f]({videoId:v.id,startSeconds:v.time||0});p.setVolume(v.volume);v.muted?p.mute():p.unMute();p.setLoop(!!v.loop);if(v.shuffle)p.setShuffle(true);}
window.onYouTubeIframeAPIReady=()=>{p=new YT.Player('player',{host:'https://www.youtube-nocookie.com',playerVars:{origin:${JSON.stringify(origin)},playsinline:1,rel:0},events:{onReady:()=>{ready=true;send({ready:true});if(options)setup(options);},onStateChange:e=>{if(e.data===0&&options?.repeatOne){p.seekTo(0);p.playVideo();}},onError:e=>send({error:'동영상을 재생하지 못했습니다. YouTube에서 공개 및 재생 허용 상태를 확인해 주세요. ('+e.data+')'})}})};
window.addEventListener('message',e=>{if(e.source!==parent||!e.data?.flowriumMusic)return;const v=e.data;if(v.action==='load'){setup(v);return;}if(!p||!ready)return;const methods={play:'playVideo',pause:'pauseVideo',next:'nextVideo',previous:'previousVideo',mute:'mute',unmute:'unMute'};if(methods[v.action])p[methods[v.action]]();if(v.action==='seek'&&Number.isFinite(v.value))p.seekTo(Math.max(0,v.value),true);if(v.action==='volume'&&Number.isFinite(v.value))p.setVolume(Math.max(0,Math.min(100,v.value)));if(v.action==='shuffle'){p.setShuffle(!!v.value);if(options)options.shuffle=!!v.value;}if(v.action==='loop'){p.setLoop(!!v.value);if(options)options.loop=!!v.value;}if(v.action==='repeat'){if(options)options.repeatOne=!!v.value;}if(v.action==='at'&&Number.isInteger(v.value))p.playVideoAt(v.value);});
setInterval(()=>{if(!p||!ready)return;const video=p.getVideoData(), data={playing:p.getPlayerState()===1,time:p.getCurrentTime()||0,duration:p.getDuration()||0,index:p.getPlaylistIndex()||0,title:video?.title||'',author:video?.author||'',queue:p.getPlaylist()||[]};send(data);},700);
const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.onerror=()=>send({error:'YouTube에 연결하지 못했습니다. 네트워크를 확인해 주세요.'});document.head.appendChild(s);
</script></html>`;
}
module.exports = { registerMusic, musicEntry, validateState };
