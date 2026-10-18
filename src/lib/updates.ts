import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

/**
 * Over-the-air updates (EAS Update). The app checks on launch by itself; this also checks when it
 * comes back to the foreground (at most every 30 minutes) and downloads in the background. A
 * downloaded update applies on the next launch, or right away with `Updates.reloadAsync()`.
 */
const CHECK_EVERY_MS = 30 * 60_000;
let lastCheck = 0;

export const updatesEnabled = Updates.isEnabled;

export async function checkForAppUpdate({ force = false } = {}): Promise<'none' | 'downloaded' | 'disabled'> {
  if (!Updates.isEnabled) return 'disabled';
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return 'none';
  lastCheck = Date.now();
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return 'none';
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew ? 'downloaded' : 'none';
}

/** Background checks when the app comes to the foreground. */
export function startUpdateChecks(): () => void {
  if (!Updates.isEnabled) return () => {};
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void checkForAppUpdate().catch(() => {});
  });
  return () => sub.remove();
}
