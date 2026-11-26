const day = 86400000;
const mailUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const calendarUrl = 'https://www.googleapis.com/calendar/v3';

function short(value, limit = 1000) {
  return typeof value === 'string' ? value.slice(0,limit) : '';
}

function endpoint(base, fields) {
  const url = new URL(base);
  for (const [key,value] of fields) url.searchParams.append(key,value);
  return url.href;
}

function id(value, kind) {
  if (kind === 'mail' && typeof value === 'string' && /^[\w-]{1,128}$/.test(value)) return value;
  if (kind === 'calendar' && typeof value === 'string' && value.length > 0 && value.length <= 350 &&
      !/[/\\\x00-\x1f\x7f]/.test(value) && value !== '.' && value !== '..') return encodeURIComponent(value);
  throw Error('자료 식별자를 확인해 주세요.');
}

function rows(value, count) {
  return Array.isArray(value) ? value.slice(0,count) : [];
}

function mailView(mail) {
  const header = name => short(rows(mail.payload?.headers,100).find(item => item?.name?.toLowerCase?.() === name)?.value);
  const at = Date.parse(header('date')), received = Number(mail.internalDate);
  const date = new Date(Number.isFinite(received) && received > 0 ? received : at);
  const from = header('from');
  return {id:id(mail.id,'mail'),title:header('subject') || '제목 없음',from,
    detail:short(mail.snippet,260) || from,at:Number.isFinite(date.getTime()) ? date.toISOString() : undefined};
}

function plainHtml(value) {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<\/(p|div|li|h[1-6])\s*>|<br\s*\/?>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .replace(/&(nbsp|lt|gt|amp|quot|#39);/gi,(_,entity) => ({
      nbsp:' ',lt:'<',gt:'>',amp:'&',quot:'"', '#39':"'",
    })[entity.toLowerCase()]);
}

function mailBody(payload) {
  function find(part, type, depth) {
    if (!part || depth > 12 || part.filename) return '';
    if (part.mimeType === type && typeof part.body?.data === 'string') {
      const value = Buffer.from(part.body.data.slice(0,660000),'base64url').toString('utf8');
      return type === 'text/html' ? plainHtml(value) : value;
    }
    return rows(part.parts,30).map(child => find(child,type,depth+1)).filter(Boolean).join('\n');
  }
  return (find(payload,'text/plain',0) || find(payload,'text/html',0)).slice(0,120000);
}

function dateInput(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 35 || !Number.isFinite(Date.parse(value))) {
    throw Error('Google 일정 조회 기간을 확인해 주세요.');
  }
  return Date.parse(value);
}

function createGoogleReader(get, now = Date.now) {
  return async function read(input, stamp) {
    if (!input || typeof input !== 'object' || !['mails','mail','calendars','events'].includes(input.action))
      throw Error('읽을 Google 자료를 선택해 주세요.');
    const query = input.query ?? '';
    if (typeof query !== 'string' || query.length > 240 || /[\x00-\x1f\x7f]/.test(query))
      throw Error('검색어를 240자 이내로 입력해 주세요.');
    if (input.action === 'mail') {
      const message = await get(endpoint(mailUrl + '/' + id(input.id,'mail'),[
        ['format','full'],['fields','id,internalDate,snippet,payload'],
      ]),stamp,8*1024*1024);
      return {...mailView(message),body:mailBody(message.payload) || '본문을 표시할 수 없습니다.'};
    }
    if (input.action === 'mails') {
      const data = await get(endpoint(mailUrl,[
        ['maxResults','20'],['fields','messages(id)'],...(query.trim() ? [['q',query.trim()]] : [['labelIds','INBOX']]),
      ]),stamp);
      const messages = rows(data.messages,20), results = [];
      for (let index = 0; index < messages.length; index += 5) {
        const details = await Promise.all(messages.slice(index,index+5).map(message => get(endpoint(mailUrl + '/' + id(message.id,'mail'),[
          ['format','metadata'],['metadataHeaders','Subject'],['metadataHeaders','From'],['metadataHeaders','Date'],
          ['fields','id,internalDate,snippet,payload(headers)'],
        ]),stamp,131072)));
        results.push(...details.map(mailView));
      }
      return results;
    }
    if (input.action === 'calendars') {
      const data = await get(endpoint(calendarUrl + '/users/me/calendarList',[
        ['maxResults','100'],['fields','items(id,summary,summaryOverride,primary)'],['showHidden','false'],
      ]),stamp);
      return rows(data.items,100).filter(item => typeof item?.id === 'string').map(item => ({
        id:short(item.id,350),title:short(item.summaryOverride || item.summary,300) || item.id,primary:item.primary === true,
      }));
    }
    const from = dateInput(input.from,now()), to = dateInput(input.to,from+14*day);
    if (to <= from || to-from > 62*day) throw Error('Google 일정 조회 기간은 최대 62일입니다.');
    const data = await get(endpoint(calendarUrl + '/calendars/' + id(input.calendarId || 'primary','calendar') + '/events',[
      ['timeMin',new Date(from).toISOString()],['timeMax',new Date(to).toISOString()],
      ['singleEvents','true'],['showDeleted','false'],['orderBy','startTime'],['maxResults','50'],
      ['fields','items(id,summary,start,end,location,description)'],...(query.trim() ? [['q',query.trim()]] : []),
    ]),stamp);
    return rows(data.items,50).filter(item => typeof item?.id === 'string').map(item => ({
      id:short(item.id,350),title:short(item.summary,500) || '제목 없음',
      at:short(item.start?.dateTime || item.start?.date,35),end:short(item.end?.dateTime || item.end?.date,35),
      detail:[short(item.location,500),plainHtml(short(item.description,3000))].filter(Boolean).join('\n'),
    }));
  };
}

module.exports = {createGoogleReader};
