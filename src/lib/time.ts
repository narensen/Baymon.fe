const UNITS: [limit: number, seconds: number, label: string][] = [
  [60, 1, 's'],
  [3600, 60, 'm'],
  [86400, 3600, 'h'],
  [604800, 86400, 'd'],
  [2629800, 604800, 'w'],
];

/** Compact relative time, e.g. "3h ago". Falls back to a date beyond a month. */
export function formatRelative(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 30) return 'Just now';
  for (const [limit, unit, label] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / unit)}${label} ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');

/** ISO 8601 in local time with its UTC offset, e.g. "2026-10-18T16:00:00+05:30". */
export function localIso(value: Date | string | number = Date.now()) {
  const d = new Date(value);
  const offset = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/** "22:00" → a Date today at that time. */
export function dateFromHHMM(value: string) {
  const [h, m] = value.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export function toHHMM(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "22:00" in the user's clock format, e.g. "10:00 PM". */
export function formatClock(value: string) {
  return dateFromHHMM(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
