import { requireOptionalNativeModule } from 'expo';

export type AgentStatus = {
  screenAccess: boolean;
  notificationAccess: boolean;
  allFilesAccess: boolean;
  /** "Display over other apps": needed for the floating bubble. */
  overlayAccess: boolean;
};

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

/** One floating bubble. */
export type BubbleSpec = {
  id: string;
  /** Shown above the text, e.g. "Reminder". */
  label: string;
  urgent: boolean;
  text: string;
  /** Epoch milliseconds; the bubble removes itself then. */
  expiresAt: number;
  /** Deep link opened on tap, e.g. baymon://nudge/<id>. */
  url: string;
  /** Opened by the bubble's mic button: talk mode with this bubble. */
  talkUrl: string;
  /** Opened by Edit on a drafted reply. */
  editUrl: string;
  /** A reply Baymon drafted; shown quoted with Send / Edit. */
  draft?: string | null;
  draftTo?: string | null;
  /** Notification key: Send replies inline (notification_reply) without opening any app. */
  replyKey?: string | null;
};

/** Something shared to Baymon, or the assistant gesture (from `takeIntent`). */
export type IncomingIntent =
  | { kind: 'assist' }
  | {
      kind: 'share';
      /** The app that shared, when Android says. */
      from?: string | null;
      items: SharedItem[];
    };

export type SharedItem =
  | { type: 'text'; text: string; subject?: string | null }
  | {
      type: 'file';
      /** A copy in Baymon's cache (file://); missing when it couldn't be read. */
      uri?: string;
      name: string;
      mime?: string | null;
      size?: number;
      error?: 'too_large' | 'unreadable';
    };

export type WakeWordConfig = {
  accessKey: string;
  /** A built-in Porcupine keyword (e.g. "jarvis"), used unless `keywordPath` is set. */
  keyword: string;
  /** A custom .ppn keyword file (e.g. "Hey Baymon" trained in the Picovoice Console). */
  keywordPath?: string | null;
  sensitivity: number;
};

/** Things the phone noticed while JS wasn't listening (JSON from `takeSignals`). */
export type NativeSignal = { type: string; at: string; data: Record<string, unknown> };

/** What the user did with a floating bubble (JSON from `takeBubbleActions`). */
export type BubbleAction = {
  id: string;
  action: 'opened' | 'dismissed' | 'snoozed' | 'done';
  at: string;
  snooze_minutes?: number;
  reason?: 'not_useful' | 'wrong_time' | 'draft_sent';
};

export type SettingsPage =
  | 'accessibility'
  | 'notification_access'
  | 'all_files'
  | 'write_settings'
  | 'overlay'
  | 'assistant'
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

  /** Which signals the phone may record on its own (stored natively; off until set). */
  setSignalSources(sources: { notifications: boolean; screen: boolean }): void;
  /** Recorded signals as a JSON array of `NativeSignal`; clears them. */
  takeSignals(): string;
  /** Recorded bubble actions as a JSON array of `BubbleAction`; clears them. */
  takeBubbleActions(): string;
  /** Shows exactly these bubbles over other apps (needs `overlayAccess`). */
  showBubbles(bubbles: BubbleSpec[]): void;
  hideBubbles(): void;
  /** Apps a "remind me when I open …" reminder waits for; opening one is reported right away. */
  setWatchedApps(apps: string[]): void;

  /** The next share or assistant-gesture launch not yet handled (shared files are copied to the cache). */
  takeIntent(): Promise<IncomingIntent | null>;
  /** Android 13+: asks to add the Quick Settings tile. */
  requestAddTile(): Promise<'added' | 'already_added' | 'not_added' | 'failed' | 'unsupported'>;
  /** Asks the launcher to pin the home-screen widget; false if it can't. */
  requestAddWidget(): boolean;
  getAudioOutput(): 'bluetooth' | 'headphones' | 'speaker';

  /** The app the user was in before Baymon. */
  previousApp(): { package: string; app: string } | null;
  /** Reads a long screen in full by scrolling; `app` is brought forward first (then Baymon comes back). */
  readScreenAll(
    pages: number,
    app: string | null
  ): Promise<{ app: string | null; package: string | null; pages: number; complete: boolean; text: string }>;

  startWakeWord(config: WakeWordConfig): void;
  stopWakeWord(): void;
  /** While Baymon is open it uses the microphone itself. */
  pauseWakeWord(): void;
  resumeWakeWord(): void;
  wakeWordStatus(): { running: boolean; listening: boolean; error: string | null };

  addListener(event: 'onSignal', listener: (event: { type: string }) => void): { remove(): void };
  addListener(event: 'onBubbleAction' | 'onIntent', listener: () => void): { remove(): void };
};

/**
 * Baymon's Android hands. `null` where the native module isn't compiled in (Expo Go, iOS, web):
 * the screen-control tools then report that they need the development build.
 */
export const BaymonAgent = requireOptionalNativeModule<NativeAgent>('BaymonAgent');
