const test = require('node:test');
const assert = require('node:assert/strict');
const { createMusicMetadata, thumbnail } = require('../electron/music-metadata.cjs');

test('곡과 목록의 공식 정보 조회 / 중복 병합 / 캐시 / 목록 작성자 비노출', async t => {
  const calls = [];
  const runtime = createMusicMetadata({ fetchImpl: async (address, options) => {
    calls.push({ address, options });
    return Response.json({ title: '실제 제공된 제목', author_name: '목록 작성자', thumbnail_url: 'https://i.ytimg.com/vi/samplevideo/hqdefault.jpg' });
  } });
  t.after(() => runtime.shutdown());
  const [first, repeated] = await Promise.all([runtime.read({ playlistId: 'PL123456789' }), runtime.read({ playlistId: 'PL123456789' })]);
  assert.deepEqual(first, repeated); assert.equal(calls.length, 1);
  assert.equal(first[0].title, '실제 제공된 제목'); assert.equal(first[0].author, '');
  await runtime.read({ playlistId: 'PL123456789' }); assert.equal(calls.length, 1);
  const [track] = await runtime.read({ videoIds: ['samplevideo', 'samplevideo'] });
  assert.equal(track.author, '목록 작성자'); assert.equal(track.available, true); assert.equal(calls.length, 2);
  for (const { address, options } of calls) {
    const url = new URL(address); assert.equal(url.origin, 'https://www.youtube.com'); assert.equal(url.pathname, '/oembed');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined);
  }
});

test('정보 실패와 과대 응답은 재생을 막지 않는 대체 값이며 명시적 재조회로 회복한다', async t => {
  let mode = 'missing', calls = 0;
  const runtime = createMusicMetadata({ fetchImpl: async () => {
    calls++;
    if (mode === 'missing') return new Response('자료 없음', { status: 404 });
    if (mode === 'oversized') return new Response('x'.repeat(140 * 1024));
    return Response.json({ title: '복구한 곡', author_name: '공개 가수', thumbnail_url: 'https://untrusted.example.test/private.png' });
  } });
  t.after(() => runtime.shutdown());
  assert.equal((await runtime.read({ videoIds: ['samplevideo'] }))[0].available, false);
  mode = 'available'; assert.equal((await runtime.read({ videoIds: ['samplevideo'] }))[0].available, false); assert.equal(calls, 1);
  const recovered = (await runtime.read({ videoIds: ['samplevideo'], refresh: true }))[0];
  assert.equal(recovered.title, '복구한 곡'); assert.equal(recovered.thumbnail, '');
  mode = 'oversized'; assert.equal((await runtime.read({ videoIds: ['secondvideo'], refresh: true }))[0].available, false);
  assert.equal(thumbnail('http://127.0.0.1/image'), ''); assert.equal(thumbnail('https://i.ytimg.com:8443/image'), '');
});

test('식별자 / 한 번 조회 수 / 동시 공급자 요청 수를 제한하고 종료 시 남은 요청을 취소한다', async () => {
  let active = 0, maximum = 0;
  const runtime = createMusicMetadata({ fetchImpl: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return Response.json({ title: '합성 공개 곡' });
  } });
  await assert.rejects(runtime.read({ playlistId: '../private' }));
  await assert.rejects(runtime.read({ videoIds: Array(51).fill('samplevideo') }));
  await assert.rejects(runtime.read({ videoIds: ['https://example.test'] }));
  await runtime.read({ videoIds: Array.from({ length: 12 }, (_, index) => 'sample' + String(index).padStart(5, '0')) });
  assert.equal(maximum, 4); runtime.shutdown();
  let aborted = false;
  const waiting = createMusicMetadata({ fetchImpl: async (_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(Error('종료')); }, { once: true });
  }) });
  const pending = waiting.read({ videoIds: ['samplevideo'] });
  waiting.shutdown(); await pending; assert.equal(aborted, true);
  await assert.rejects(waiting.read({ videoIds: ['samplevideo'] }), /종료/);
});
