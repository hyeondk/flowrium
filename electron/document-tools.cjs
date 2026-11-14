const MAX_BYTES = 20 * 1024 * 1024;
const plain = value => String(value || '').replace(/<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
async function bounded(response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('자료 크기가 허용 범위를 넘습니다.');
  const chunks = []; let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) { await response.body.cancel?.().catch(() => {}); throw Error('자료 크기가 허용 범위를 넘습니다.'); }
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}
function eventFields(input, partial = false) {
  const result = {};
  for (const [key, max] of [['summary', 500], ['description', 12000], ['location', 2000]]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > max || (key === 'summary' && !input[key].trim())) throw Error('일정 내용을 확인해 주세요.');
      result[key] = input[key].trim();
    }
  }
  for (const key of ['start', 'end']) {
    if (input[key] === undefined && partial) continue;
    const value = input[key];
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw Error('일정 시작과 종료 시각을 확인해 주세요.');
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { if(new Date(value).toISOString().slice(0,10)!==value) throw Error('실제 달력의 날짜를 확인해 주세요.'); result[key] = { date: value }; }
    else if (/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) result[key] = { dateTime: new Date(value).toISOString() };
    else throw Error('일정 시각에 시간대를 포함해 주세요.');
  }
  if (!partial && !result.summary) throw Error('일정 제목을 입력해 주세요.');
  return result;
}
async function extract(bytes, mime) {
  if (mime === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
    try {
      const doc = await task.promise; const pages = [];
      for (let i = 1; i <= Math.min(doc.numPages, 100); i++) {
        pages.push((await (await doc.getPage(i)).getTextContent()).items.map(x => (x.str || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,' ')).join(' ').replace(/[\t ]+/g,' ').trim());
        if (pages.join('\n').length > 200000) break;
      }
      return pages.join('\n\n').slice(0, 200000);
    } finally { await task.destroy(); }
  }
  if (/officedocument\.(?:wordprocessingml|presentationml|spreadsheetml)/.test(mime)) {
    const Zip = require(require('node:module').createRequire(require.resolve('pptxgenjs')).resolve('jszip'));
    const zip = await Zip.loadAsync(bytes, { checkCRC32: true });
    const names = Object.keys(zip.files).filter(n => /^(?:word\/document|ppt\/slides\/slide\d+|xl\/(?:sharedStrings|worksheets\/sheet\d+))\.xml$/.test(n)).slice(0, 150);
    const out = []; let total = 0;
    for (const n of names) {
      if (zip.files[n]._data?.uncompressedSize > 10 * 1024 * 1024) throw Error('압축 문서의 본문이 너무 큽니다.');
      const value = plain(await zip.files[n].async('string')); total += value.length;
      if (total > 500000) throw Error('문서 본문이 허용 범위를 넘습니다.');
      out.push(value);
    }
    return out.join('\n').slice(0, 200000);
  }
  if (mime === 'text/html') return plain(bytes.toString('utf8')).slice(0, 200000);
  if (/^(text\/|application\/(json|xml|csv))/.test(mime)) return bytes.toString('utf8').slice(0, 200000);
  return '';
}
module.exports = { eventFields, extract, bounded };
