const { randomUUID } = require('node:crypto');
const path = require('node:path');
const MAX_BYTES = 20 * 1024 * 1024;
const identifier = (v, label = '자료 식별자') => {
  if (typeof v !== 'string' || !v || v.length > 350 || /[\x00-\x1f]/.test(v)) throw Error(label + '를 확인해 주세요.');
  return encodeURIComponent(v);
};
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
function eventView(e, calendarId) {
  return { id: e.id, calendarId, title: e.summary || '제목 없음', detail: [e.location, e.description].filter(Boolean).join(' / ').slice(0, 10000),
    at: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, description: e.description || '', location: e.location || '', etag: e.etag, url: e.htmlLink, recurring: !!(e.recurringEventId || e.recurrence) };
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
function validateSpan(e) {
  const start = e.start?.dateTime || e.start?.date, end = e.end?.dateTime || e.end?.date;
  if (!start || !end || Date.parse(end) <= Date.parse(start) || !!e.start.date !== !!e.end.date) throw Error('종료 시각은 시작보다 뒤여야 합니다.');
}
function mailBody(payload, depth = 0) {
  if (!payload || depth > 15) return '';
  if (payload.filename) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  const parts = payload.parts || [];
  const text = parts.map(p => mailBody(p, depth + 1)).filter(Boolean).join('\n');
  if (text) return text;
  return payload.mimeType === 'text/html' && payload.body?.data ? plain(Buffer.from(payload.body.data, 'base64url').toString('utf8')) : '';
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
function installGoogleTools(register, { get, request, token, current, generation, store, canWrite = async () => true }) {
  const tickets = new Map();
  const calendars = async () => {
    const result = await get('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');
    return (result.items || []).map(c => ({ id: c.id, title: c.summary || c.id, primary: !!c.primary, role: c.accessRole, timeZone: c.timeZone, writable: ['owner', 'writer'].includes(c.accessRole) }));
  };
  register('googleCalendars', calendars);
  register('googleMail', async id => {
    const v = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + identifier(id) + '?format=full');
    const header = name => v.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
    return { id: v.id, title: header('subject'), from: header('from'), to: header('to'), at: new Date(Number(v.internalDate)).toISOString(), body: mailBody(v.payload).slice(0, 200000), url: 'https://mail.google.com/mail/u/0/#inbox/' + encodeURIComponent(v.id) };
  });
  async function document(id, format) {
    const expected = generation(), encoded = identifier(id);
    const meta = await get('https://www.googleapis.com/drive/v3/files/' + encoded + '?fields=id,name,mimeType,size,modifiedTime');
    const exports = {
      'application/vnd.google-apps.document': { mime: 'text/markdown', ext: '.md' },
      'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', ext: '.csv' },
      'application/vnd.google-apps.presentation': { mime: 'text/plain', ext: '.txt' },
      'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: '.pdf' },
    };
    const pdf = format === 'pdf' && exports[meta.mimeType];
    const item = pdf ? { mime: 'application/pdf', ext: '.pdf' } : exports[meta.mimeType];
    if (format && !['text', 'pdf'].includes(format)) throw Error('가져올 문서 형식을 확인해 주세요.');
    if (Number(meta.size) > MAX_BYTES) throw Error('문서는 20MB까지 가져올 수 있습니다.');
    const access = await token(); current(expected);
    const response = await request('https://www.googleapis.com/drive/v3/files/' + encoded + (item ? '/export?mimeType=' + encodeURIComponent(item.mime) : '?alt=media'), { headers: { Authorization: 'Bearer ' + access } });
    const bytes = await bounded(response); current(expected);
    const mime = item?.mime || meta.mimeType;
    const ext = item?.ext || path.extname(meta.name || '').replace(/[^.a-z0-9]/gi, '').slice(0, 12);
    const body = await extract(bytes, mime); current(expected);
    return { id: meta.id, name: meta.name || '드라이브 문서', mimeType: mime, extension: ext || '.bin', body, bytes };
  }
  register('googleDocument', async (id, format) => { const { bytes, ...view } = await document(id, format); return { ...view, size: bytes.length }; });
  register('importGoogleFile', async (projectId, id, format) => {
    const expected = generation(), project = store.project(projectId), file = await document(id, format);
    current(expected);
    const root = await require('node:fs/promises').realpath(project.path);
    if (path.resolve(root) !== path.resolve(project.path)) throw Error('프로젝트 위치가 바뀌었습니다.');
    const fs = require('node:fs/promises'), { projectDirectory, readJSON } = require('./project-store.cjs');
    await projectDirectory(path.join(root, '.flowrium'));
    if ((await readJSON(path.join(root, '.flowrium', 'project.json'))).id !== project.id) throw Error('프로젝트 식별자가 바뀌었습니다.');
    const folder = path.join(root, '산출물'); await projectDirectory(folder); current(expected);
    const base = path.parse(file.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90) || '드라이브 문서';
    const target = path.join(folder, base + '-' + randomUUID().slice(0, 8) + file.extension);
    await fs.writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 });
    return { path: path.relative(root, target), body: file.body };
  });
  register('prepareGoogleEvent', async input => {
    if (!input || !['create', 'update', 'delete'].includes(input.action)) throw Error('일정 작업을 확인해 주세요.');
    if (!(await canWrite())) throw Error('일정 쓰기 권한이 필요합니다. Google 계정을 다시 연결해 주세요.');
    const calendarId = input.calendarId || 'primary', encoded = identifier(calendarId), expected = generation();
    const list = await calendars(), calendar = list.find(c => c.id === calendarId || (calendarId === 'primary' && c.primary));
    if (!calendar?.writable) throw Error('이 캘린더에는 일정을 쓸 권한이 없습니다.');
    let previous;
    if (input.action !== 'create') {
      previous = await get('https://www.googleapis.com/calendar/v3/calendars/' + encoded + '/events/' + identifier(input.eventId));
      if (!previous.etag) throw Error('일정 개정을 확인하지 못했습니다.');
      if (input.etag && input.etag !== previous.etag) throw Error('다른 곳에서 일정을 변경했습니다. 다시 확인해 주세요.');
      if (previous.recurringEventId || previous.recurrence) throw Error('반복 일정은 Google 캘린더에서 수정해 주세요.');
    }
    let event;
    if (input.action !== 'delete') {
      const fields = eventFields(input, input.action === 'update');
      event = { ...(previous || {}), ...fields };
      validateSpan(event);
      if (!previous) event.id = randomUUID().replace(/-/g, '');
    }
    current(expected);
    for (const [id, v] of tickets) if (v.expiresAt < Date.now()) tickets.delete(id);
    if (tickets.size >= 100) throw Error('일정 검토 요청이 너무 많습니다. 이전 검토를 마쳐 주세요.');
    const id = randomUUID(), expiresAt = Date.now() + 10 * 60000;
    const ticket = { id, action: input.action, calendarId, calendarName: calendar.title, previous, event, expected, expiresAt };
    tickets.set(id, ticket);
    return { id, action: ticket.action, calendarId, calendarName: calendar.title, expiresAt, previous: previous && eventView(previous, calendarId), event: event && eventView(event, calendarId) };
  });
  register('commitGoogleEvent', async id => {
    const ticket = tickets.get(id);
    if (!ticket || ticket.expiresAt < Date.now()) throw Error('일정 검토가 만료됐거나 이미 처리됐습니다. 다시 확인해 주세요.');
    current(ticket.expected); tickets.delete(id);
    const { action, calendarId, event, previous } = ticket;
    const access = await token(); current(ticket.expected);
    const endpoint = 'https://www.googleapis.com/calendar/v3/calendars/' + identifier(calendarId) + '/events' + (previous ? '/' + identifier(previous.id) : '') + '?sendUpdates=none';
    const headers = { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json', ...(previous && { 'If-Match': previous.etag }) };
    const response = await request(endpoint, { method: action === 'create' ? 'POST' : action === 'update' ? 'PUT' : 'DELETE', headers, ...(action !== 'delete' && { body: JSON.stringify(event) }) });
    current(ticket.expected);
    return action === 'delete' ? { deleted: true, id: previous.id } : eventView(await response.json(), calendarId);
  });
  return { document, clear: () => tickets.clear() };
}
module.exports = { installGoogleTools, eventFields, mailBody, extract, eventView, bounded };
