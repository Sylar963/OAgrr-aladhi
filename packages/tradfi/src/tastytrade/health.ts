const ET = 'America/New_York';

export function isUsEquityMarketOpen(nowMs: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(nowMs));

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60; // 09:30–16:00 ET, holidays not handled (v1)
}
