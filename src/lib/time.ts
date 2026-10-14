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
