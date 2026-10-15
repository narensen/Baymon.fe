import Constants from 'expo-constants';

import { BaymonAgent } from '@/modules/baymon-agent';
import { ApiError, api } from '@/lib/api';
import { notifications } from '@/lib/notifications';
import { readJSON, writeJSON } from '@/lib/storage';
import { toolSpecs } from '@/lib/tools';
import { hasNativeAgent } from '@/lib/tools/native';

const ID_KEY = 'baymon.device_id';

/** Stable per install; tells the backend which phone's tools to offer the model. */
export function deviceId(): string {
  let id = readJSON<string>(ID_KEY);
  if (!id) {
    id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    writeJSON(ID_KEY, id);
  }
  return id;
}

/** What this phone can currently do (permissions granted). */
export function capabilities() {
  const status = hasNativeAgent && BaymonAgent ? BaymonAgent.getStatus() : null;
  return {
    native_agent: hasNativeAgent,
    screen_control: status?.screenAccess ?? false,
    notification_access: status?.notificationAccess ?? false,
    all_files: status?.allFilesAccess ?? false,
  };
}

async function pushToken(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications) return null;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    // Expo Go on Android has no remote push, and there's no EAS project yet: both are fine.
    return null;
  }
}

let lastSent = '';

/**
 * Registers this device and its tool catalog with the backend (`POST /v1/devices`). Cheap to call
 * often: it only sends when something changed. Silently skipped if the backend doesn't have the
 * endpoint yet.
 */
export async function registerDevice() {
  const body = {
    device_id: deviceId(),
    platform: process.env.EXPO_OS,
    app_version: Constants.expoConfig?.version ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    push_token: await pushToken(),
    capabilities: capabilities(),
    tools: toolSpecs(),
  };
  const fingerprint = JSON.stringify(body);
  if (fingerprint === lastSent) return;
  try {
    await api('/v1/devices', { method: 'POST', body });
    lastSent = fingerprint;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) lastSent = fingerprint;
  }
}
