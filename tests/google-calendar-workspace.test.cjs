const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../shared/calendar-days.ts');

test('월간 날짜는 윤년과 연도 경계를 유지하고 일요일부터 여섯 주를 제공한다', async () => {
  const { calendarMonthGrid, calendarMonthShift, calendarMonthRange } = await modulePromise;
  const days = calendarMonthGrid('2028-02');
  assert.equal(days.length, 42);
  assert.equal(days.filter(day => day.currentMonth).length, 29);
  assert.equal(new Date(days[0].day + 'T12:00:00').getDay(), 0);
  assert.equal(calendarMonthShift('2026-12', 1), '2027-01');
  assert.equal(calendarMonthShift('2027-01', -1), '2026-12');
  const range = calendarMonthRange('2028-02');
  assert.equal(new Date(range.from).getDate(), 1);
  assert.equal(new Date(range.to).getMonth(), 2);
  assert.throws(() => calendarMonthGrid('2026-13'), /월/);
});

test('하루 종일 일정은 종료일을 제외하고 시간 일정은 날짜 경계에서 겹친 날만 표시한다', async () => {
  const { calendarEventOnDay } = await modulePromise;
  const allDay = { at: '2026-11-15', end: '2026-11-17', allDay: true };
  assert.equal(calendarEventOnDay(allDay, '2026-11-15'), true);
  assert.equal(calendarEventOnDay(allDay, '2026-11-16'), true);
  assert.equal(calendarEventOnDay(allDay, '2026-11-17'), false);
  assert.equal(calendarEventOnDay({ at: '2026-11-15' }, '2026-11-15'), true);
  assert.equal(calendarEventOnDay({ at: '2026-11-15' }, '2026-11-16'), false);
  const start = new Date(2026, 10, 15, 23, 30).toISOString();
  const end = new Date(2026, 10, 16, 1, 0).toISOString();
  assert.equal(calendarEventOnDay({ at: start, end }, '2026-11-15'), true);
  assert.equal(calendarEventOnDay({ at: start, end }, '2026-11-16'), true);
  assert.equal(calendarEventOnDay({ at: start, end }, '2026-11-17'), false);
  const midnight = new Date(2026, 10, 16).toISOString();
  assert.equal(calendarEventOnDay({ at: start, end: midnight }, '2026-11-16'), false);
  assert.equal(calendarEventOnDay({ at: '날짜 아님' }, '2026-11-15'), false);
  assert.equal(calendarEventOnDay({ at: start, end }, '2026-11-31'), false);
});
