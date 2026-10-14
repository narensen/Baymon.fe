/**
 * Small JSON persistence on `localStorage` (SQLite-backed on native via expo-sqlite, the browser's on web).
 * Failures are swallowed: persistence is a convenience, never a requirement.
 */
export function readJSON<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function removeKey(key: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {}
}
