export function creditBalance(credits) {
  if (!credits) return '잔액 미제공';
  if (credits.unlimited) return '무제한';
  const balance = credits.balance?.trim();
  if (balance) {
    if (!/^-?\d+(\.\d+)?$/.test(balance)) return balance;
    const fraction = balance.split('.')[1] || '';
    return new Intl.NumberFormat('ko-KR', {
      minimumFractionDigits: Math.min(fraction.length, 3),
      maximumFractionDigits: 3,
    }).format(balance);
  }
  return credits.hasCredits ? '잔액 미제공' : '보유 크레딧 없음';
}
