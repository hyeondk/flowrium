import type { RemoteItem } from './integrations';

export function calendarDay(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error('날짜를 확인해 주세요.');
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function monthDate(month: string): Date {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('조회할 월을 확인해 주세요.');
  const [year, value] = month.split('-').map(Number);
  if (year < 1900 || year > 2200) throw new Error('1900년부터 2200년 사이의 월을 선택해 주세요.');
  return new Date(year, value - 1, 1);
}

export function calendarMonthRange(month: string): { from: string; to: string } {
  const first = monthDate(month);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  return { from: first.toISOString(), to: next.toISOString() };
}

export function calendarMonthGrid(month: string): { day: string; currentMonth: boolean }[] {
  const first = monthDate(month);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { day: calendarDay(date), currentMonth: date.getMonth() === first.getMonth() && date.getFullYear() === first.getFullYear() };
  });
}

export function calendarMonthShift(month: string, amount: number): string {
  const first = monthDate(month);
  const next = new Date(first.getFullYear(), first.getMonth() + amount, 1);
  const result = calendarDay(next).slice(0, 7);
  monthDate(result);
  return result;
}

export function calendarEventOnDay(event: Pick<RemoteItem, 'at' | 'end' | 'allDay'>, day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !event.at) return false;
  const [year, month, date] = day.split('-').map(Number);
  const startOfDay = new Date(year, month - 1, date);
  if (calendarDay(startOfDay) !== day) return false;
  const nextDay = new Date(year, month - 1, date + 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.at)) {
    if (!event.end || !/^\d{4}-\d{2}-\d{2}$/.test(event.end)) return event.at === day;
    return event.at <= day && day < event.end;
  }
  const start = Date.parse(event.at);
  const parsedEnd = event.end ? Date.parse(event.end) : NaN;
  if (!Number.isFinite(start)) return false;
  const end = Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + 1;
  return start < nextDay.getTime() && end > startOfDay.getTime();
}
