export function workDuration(start, end) {
  const milliseconds = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60 ? seconds + '초 동안 작업' :
    Math.floor(seconds / 60) + '분' + (seconds % 60 ? ' ' + seconds % 60 + '초' : '') + ' 동안 작업';
}
