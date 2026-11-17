const assert = require('node:assert/strict');
const {createHash, randomBytes} = require('node:crypto');

function createLargeRequest() {
  const pageSize = 12_000;
  const pages = 1_073;
  const pattern = '합성 자료 흐름 🚦 ';
  const body = pattern.repeat(pageSize / pattern.length);
  const all = Array(pages).fill(body);
  const nonce = randomBytes(8).toString('hex');
  const probes = [];
  for (const [page, start, label] of [[1, 0, '처음'], [537, 6_000, '중간'], [pages, pageSize - 96, '마지막']]) {
    const marker = `[${label}-${nonce}]`;
    const slot = page === pages ? marker.padStart(96) : marker.padEnd(96);
    all[page - 1] = body.slice(0, start) + slot + body.slice(start + 96);
    probes.push({page, marker, offset: (page - 1) * pageSize + start + slot.indexOf(marker)});
  }
  const text = all.join('');
  const byteLength = Buffer.byteLength(text);
  assert(byteLength > 25 * 1024 * 1024);
  assert.equal(text.length, pages * pageSize);
  for (const {marker, offset} of probes) assert.equal(text.slice(offset, offset + marker.length), marker);
  return {text, byteLength, sha256: createHash('sha256').update(text).digest('hex'), pageSize, pages, probes};
}

module.exports = {createLargeRequest};
