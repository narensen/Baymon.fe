import Constants, { ExecutionEnvironment } from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

/**
 * expo-notifications, loaded on first use. Returns null where its native side is missing (e.g. Expo
 * Go on Android), so reminders degrade instead of crashing the app.
 */
export function notifications(): NotificationsModule | null {
  if (cached === undefined) {
    // Expo Go on Android lacks part of its native side (and warns on load), so don't load it there.
    if (process.env.EXPO_OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      cached = null;
      return cached;
    }
    try {
      // A lazy require is the point: a static import would crash at startup where it's unsupported.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('expo-notifications') as NotificationsModule;
    } catch {
      cached = null;
    }
  }
  return cached;
}
