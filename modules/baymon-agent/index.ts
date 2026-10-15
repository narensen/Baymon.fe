import { requireOptionalNativeModule } from 'expo';

export type AgentStatus = { screenAccess: boolean; notificationAccess: boolean; allFilesAccess: boolean };

export type ScreenRead = { package: string | null; app: string | null; elements: number; text: string };

export type FoundFile = {
  name: string;
  path?: string;
  uri: string;
  folder?: string | null;
  size: number;
  modified_at: string;
  mime?: string | null;
};

export type PhoneNotification = {
  key: string;
  app: string;
  package: string;
  title: string | null;
  text: string | null;
  time: string;
  can_reply: boolean;
};

export type SettingsPage =
  | 'accessibility'
  | 'notification_access'
  | 'all_files'
  | 'write_settings'
  | 'app'
  | 'wifi'
  | 'internet'
  | 'volume'
  | 'nfc'
  | 'bluetooth'
  | 'location'
  | 'display'
  | 'sound'
  | 'battery'
  | 'airplane'
  | 'dnd'
  | 'notifications'
  | 'date'
  | 'storage'
  | 'apps'
  | 'security';

type NativeAgent = {
  getStatus(): AgentStatus;
  openSystemSettings(page: SettingsPage): void;

  readScreen(): Promise<ScreenRead>;
  tap(element: number | null, text: string | null): Promise<{ tapped: boolean; method?: string }>;
  longPress(element: number | null, text: string | null): Promise<{ pressed: boolean }>;
  typeText(element: number | null, text: string, submit: boolean): Promise<{ typed: boolean; submitted: boolean }>;
  scroll(direction: 'up' | 'down' | 'left' | 'right', element: number | null): Promise<{ scrolled: boolean }>;
  navigate(action: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings' | 'lock' | 'screenshot'): Promise<{ done: boolean }>;
  waitForText(text: string, timeoutMs: number): Promise<boolean>;

  listApps(): Promise<{ name: string; package: string }[]>;
  openApp(query: string): Promise<{ name?: string; package: string }>;
  openStorePage(query: string): void;
  uninstallApp(packageName: string): void;
  openAppSettings(packageName: string): void;

  setAlarm(hour: number, minute: number, label: string | null, days: number[] | null): void;
  setTimer(seconds: number, label: string | null): void;
  setTorch(on: boolean): void;
  mediaControl(action: 'play_pause' | 'next' | 'previous' | 'stop' | 'volume_up' | 'volume_down' | 'mute'): void;

  findFiles(query: string, limit: number): Promise<{ files: FoundFile[]; matched_all_words?: boolean }>;
  recentMedia(kind: 'photo' | 'video' | 'screenshot', limit: number): Promise<FoundFile[]>;

  listNotifications(limit: number): Promise<PhoneNotification[]>;
  replyToNotification(key: string, text: string): Promise<{ sent: boolean }>;
};

/**
 * Baymon's Android hands. `null` where the native module isn't compiled in (Expo Go, iOS, web):
 * the screen-control tools then report that they need the development build.
 */
export const BaymonAgent = requireOptionalNativeModule<NativeAgent>('BaymonAgent');
