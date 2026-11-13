function parseLyrics(value) {
  if (typeof value !== 'string' || value.length > 150000) return [];
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(value)?.[1] || 0) / 1000;
  const lines = [];
  for (const row of value.split(/\r?\n/)) {
    const tags = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const match of tags) {
      const time = Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || '0')) + offset;
      if (Number(match[2]) < 60 && time <= 86400) lines.push({ time: Math.max(0, time), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 3000);
}
function guess(title, author) {
  const cleaned = title.replace(/\([^)]*(official|video|audio|lyrics|가사|mv|hd|4k)[^)]*\)|\[[^\]]*(official|video|audio|lyrics|가사|mv|hd|4k)[^\]]*\]/gi, '').trim();
  const pair = cleaned.split(/\s+[-–—]\s+/);
  return pair.length > 1 ? { artist: pair[0], track: pair.slice(1).join(' - ') } : { artist: author.replace(/\s*[-–]\s*Topic$|VEVO$/i, '').trim(), track: cleaned };
}
function registerLyrics(register, { fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  register('findMusicLyrics', async input => {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || typeof (input.author || '') !== 'string' || (input.author || '').length > 200 || !Number.isFinite(input.duration) || input.duration < 0 || input.duration > 86400) throw Error('가사를 찾을 곡 정보를 확인해 주세요.');
    const key = JSON.stringify([input.title, input.author || '', Math.round(input.duration)]), cached = cache.get(key);
    if (cached && cached.until > now()) return cached.value;
    const { artist, track } = guess(input.title, input.author || '');
    async function search(params) {
      const response = await fetchImpl('https://lrclib.net/api/search?' + new URLSearchParams(params), { headers: { 'User-Agent': 'Flowrium (https://github.com/hyeondk/flowrium)' }, signal: AbortSignal.timeout(9000), redirect: 'error' });
      if (!response.ok) throw Error('가사 검색 서비스가 응답하지 않았습니다. 잠시 뒤 다시 확인해 주세요.');
      const bytes = await require('./google-tools.cjs').bounded(response, 2 * 1024 * 1024);
      const values = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(values)) throw Error('가사 응답 형식이 올바르지 않습니다.');
      return values.filter(v => typeof v.trackName === 'string' && Number.isFinite(v.duration) && (v.instrumental || typeof v.syncedLyrics === 'string' || typeof v.plainLyrics === 'string'));
    }
    let hits = await search(artist ? { track_name: track, artist_name: artist } : { q: track });
    if (!hits.length && artist) hits = await search({ q: artist + ' ' + track });
    const usable = hits.filter(h => !input.duration || Math.abs(h.duration - input.duration) <= 20);
    const best = usable.sort((a,b) => (Math.abs(a.duration-input.duration)-(a.syncedLyrics?3:0))-(Math.abs(b.duration-input.duration)-(b.syncedLyrics?3:0)))[0];
    const value = best ? { track: best.trackName.slice(0,300), artist: String(best.artistName || '').slice(0,200), instrumental: !!best.instrumental,
      plain: typeof best.plainLyrics === 'string' ? best.plainLyrics.slice(0,150000) : '', lines: parseLyrics(best.syncedLyrics), source: 'LRCLIB' } : null;
    cache.set(key, { value, until: now() + (value ? 3600000 : 300000) });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  });
}
module.exports = { registerLyrics, parseLyrics, guess };
