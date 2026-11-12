const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { registerMusic, musicEntry } = require("../electron/music.cjs");
test("뮤직 목록의 저장·복원과 안전한 플레이어 주소", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "flowrium-music-")),
    api = {};
  const runtime = registerMusic((n, f) => (api[n] = f), folder);
  t.after(async () => {
    await runtime.shutdown();
    await fs.rm(folder, { recursive: true, force: true });
  });
  const initial = await api.musicState();
  assert.equal(initial.lists.length, 0);
  const entry = {
    ...musicEntry("https://music.youtube.com/playlist?list=PL12345678"),
    title: "집중",
    lyrics: "직접 입력한 메모",
  };
  const state = { ...initial, lists: [entry], selected: entry.id };
  await api.saveMusic(state);
  assert.deepEqual(await api.musicState(), state);
  await assert.rejects(
    api.saveMusic({
      ...state,
      lists: [{ ...entry, url: "file:///etc/passwd" }],
    }),
  );
  await assert.rejects(api.saveMusic({ ...state, volume: -1 }));
  const { url } = await api.musicPlayer();
  const result = await fetch(url);
  assert.equal(result.status, 200);
  assert.match(await result.text(), /youtube-nocookie/);
  assert.equal((await fetch(new URL("/invalid", url))).status, 404);
});
