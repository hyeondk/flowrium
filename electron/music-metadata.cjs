const MAX_BYTES = 128 * 1024;
const ID = /^[a-zA-Z0-9_-]{6,100}$/;

function thumbnail(value) {
  if (typeof value !== 'string' || value.length > 1000) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && ['i.ytimg.com', 'img.youtube.com'].includes(url.hostname)) return url.href;
  } catch {}
  return '';
}

async function jsonBody(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body?.cancel(); throw Error('음악 정보의 응답 크기를 초과했습니다.'); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('음악 정보의 응답이 없습니다.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error('음악 정보의 응답 크기를 초과했습니다.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createMusicMetadata({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map(), controllers = new Set();
  let closed = false;
  async function one(kind, id, refresh) {
    const key = kind + ':' + id, hit = cache.get(key);
    if (!refresh && hit && hit.until > now()) return { ...hit.value };
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const fallback = { id, title: '', author: '', thumbnail: '', available: false };
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 8000); timeout.unref?.();
      let value = fallback;
      try {
        if (closed) throw Error('음악 정보 조회가 종료됐습니다.');
        const target = new URL(kind === 'playlist' ? 'https://www.youtube.com/playlist' : 'https://www.youtube.com/watch');
        target.searchParams.set(kind === 'playlist' ? 'list' : 'v', id);
        const endpoint = new URL('https://www.youtube.com/oembed');
        endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('url', target.href);
        const response = await fetchImpl(endpoint.href, { signal: controller.signal, credentials: 'omit', redirect: 'error' });
        if (!response.ok) { await response.body?.cancel(); throw Error('현재 음악 정보를 읽을 수 없습니다.'); }
        const data = await jsonBody(response);
        if (!data || typeof data.title !== 'string' || !data.title.trim()) throw Error('곡 제목을 확인할 수 없습니다.');
        value = {
          id, title: data.title.trim().slice(0, 200),
          author: kind === 'video' && typeof data.author_name === 'string' ? data.author_name.trim().slice(0, 200) : '',
          thumbnail: thumbnail(data.thumbnail_url), available: true,
        };
      } catch {} finally { clearTimeout(timeout); controllers.delete(controller); }
      if (!closed) {
        cache.delete(key); cache.set(key, { value, until: now() + (value.available ? 24 * 60 * 60 * 1000 : 60000) });
        while (cache.size > 600) cache.delete(cache.keys().next().value);
      }
      return { ...value };
    })();
    pending.set(key, task);
    try { return await task; } finally { if (pending.get(key) === task) pending.delete(key); }
  }
  return {
    async read(input) {
      if (closed) throw Error('음악 정보 조회가 종료됐습니다.');
      if (!input || typeof input !== 'object' || (input.refresh !== undefined && typeof input.refresh !== 'boolean')) throw Error('음악 정보 조회 조건을 확인해 주세요.');
      const playlist = typeof input.playlistId === 'string';
      if (playlist ? !ID.test(input.playlistId) || input.videoIds !== undefined : !Array.isArray(input.videoIds) || input.videoIds.length > 50 || input.videoIds.some(id => typeof id !== 'string' || !ID.test(id))) throw Error('한 번에 50개 이하의 곡 또는 재생목록을 선택해 주세요.');
      if (playlist) return [await one('playlist', input.playlistId, input.refresh)];
      const ids = [...new Set(input.videoIds)], results = [];
      for (let index = 0; index < ids.length; index += 4) {
        if (closed) break;
        results.push(...await Promise.all(ids.slice(index, index + 4).map(id => one('video', id, input.refresh))));
      }
      return results;
    },
    shutdown() { closed = true; for (const controller of controllers) controller.abort(); cache.clear(); },
  };
}

module.exports = { createMusicMetadata, thumbnail };
