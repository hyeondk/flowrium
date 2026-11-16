export function creditBalance(credits) {
  if (!credits) return '잔액 미제공';
  if (credits.unlimited) return '무제한';
  const balance = credits.balance?.trim();
  if (balance) {
    const [integer, fraction] = balance.split('.');
    return /^\d+(\.\d+)?$/.test(balance)
      ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction)
      : balance;
  }
  return credits.hasCredits ? '잔액 미제공' : '보유 크레딧 없음';
}
