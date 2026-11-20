const shortDate = new Intl.DateTimeFormat('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'});
const shortTime = new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit'});

export function chatClock(createdAt) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = shortDate.formatToParts(date);
  return {
    date:['year','month','day'].map(type=>parts.find(part=>part.type===type)?.value).join('.')+'.',
    time:shortTime.format(date),
  };
}
