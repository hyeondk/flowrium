// 홈페이지의 차트 / 입력표 / 실제 앱 촬영에 사용하는 가상의 월별 매출 (만 원).
export const monthlySales = [2400, 2700, 2550, 3000, 3200, 3600];
const first = monthlySales[0];
const last = monthlySales.at(-1);
export const growthPercent = (last - first) / first * 100;
export const amount = value => value.toLocaleString('ko-KR');
export const salesAnswer = `6월 매출은 ${amount(last)}만 원으로, 1월 ${amount(first)}만 원보다 ${growthPercent}% 늘었어요.`;
