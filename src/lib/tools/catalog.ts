import * as Battery from 'expo-battery';
import * as Brightness from 'expo-brightness';
import * as Calendar from 'expo-calendar';
import * as Clipboard from 'expo-clipboard';
import { Contact, requestPermissionsAsync as requestContactsPermission } from 'expo-contacts';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { notifications as loadNotifications } from '@/lib/notifications';
import { agent, hasNativeAgent } from '@/lib/tools/native';
import { ToolError, type ToolDef } from '@/lib/tools/types';

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

const quote = (s: unknown) => `“${String(s ?? '').slice(0, 40)}”`;

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`“${name}” is required.`, 'invalid_args');
  return value.trim();
}

async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    throw new ToolError(`No app on this phone can open ${url}`, 'not_supported');
  }
}

async function ensurePermission(request: () => Promise<{ granted: boolean }>, what: string) {
  const { granted } = await request();
  if (!granted) throw new ToolError(`${what} permission is off. Allow it in Settings → Apps → Baymon → Permissions.`, 'permission_missing');
}

/** Copies a file into the app cache so the share sheet can hand it to any app. */
function stageForSharing(uri: string) {
  if (uri.startsWith(Paths.cache.uri)) return uri;
  const source = new File(uri);
  if (!source.exists) throw new ToolError('That file no longer exists.', 'not_found');
  const target = new File(Paths.cache, `share-${Date.now()}-${source.name}`);
  source.copy(target);
  return target.uri;
}

const DAY_NUMBERS: Record<string, number> = { sun: 1, mon: 2, tue: 3, wed: 4, thu: 5, fri: 6, sat: 7 };

function parseDate(value: unknown, name: string): Date {
  const date = new Date(requireString(value, name));
  if (Number.isNaN(date.getTime())) throw new ToolError(`“${name}” must be an ISO 8601 date-time.`, 'invalid_args');
  return date;
}

// -------------------------------------------------------------------------------------------------
// Screen: operate any app through its on-screen structure (Android development build)
// -------------------------------------------------------------------------------------------------

const element = { type: 'integer', minimum: 1, description: 'Element number from the latest screen_read.' };
const visibleText = { type: 'string', description: 'Alternatively, the element’s visible text or label.' };

const screen: ToolDef[] = [
  {
    name: 'screen_read',
    group: 'screen',
    native: true,
    description:
      'Read what is on the phone screen right now, as a numbered list of elements: text, buttons, fields (with their current value), switches and lists. Read before acting, and read again after any action that changes the screen. Element numbers are only valid until the next read.',
    parameters: { type: 'object', properties: {} },
    label: () => 'Reading the screen',
    run: async () => {
      const r = await agent().readScreen();
      return { app: r.app, package: r.package, elements: r.elements, screen: r.text };
    },
  },
  {
    name: 'screen_tap',
    group: 'screen',
    native: true,
    description: 'Tap an element: preferably by its number from the latest screen_read, otherwise by its visible text.',
    parameters: { type: 'object', properties: { element, text: visibleText } },
    label: (a: { element?: number; text?: string }) => `Tapping ${a.text ? quote(a.text) : `element ${a.element}`}`,
    run: (a: { element?: number; text?: string }) => agent().tap(a.element ?? null, a.text ?? null),
  },
  {
    name: 'screen_long_press',
    group: 'screen',
    native: true,
    description: 'Long-press an element (opens context menus, selects messages, etc.).',
    parameters: { type: 'object', properties: { element, text: visibleText } },
    label: (a: { element?: number; text?: string }) => `Long-pressing ${a.text ? quote(a.text) : `element ${a.element}`}`,
    run: (a: { element?: number; text?: string }) => agent().longPress(a.element ?? null, a.text ?? null),
  },
  {
    name: 'screen_type',
    group: 'screen',
    native: true,
    description:
      'Type into a text field, replacing what is in it. Give the field’s element number, or omit it to use the focused field. Set submit to press the keyboard’s Enter/Search/Send key afterwards.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The full text the field should contain.' },
        element,
        submit: { type: 'boolean', description: 'Press Enter/Send after typing.', default: false },
      },
      required: ['text'],
    },
    label: (a: { text: string }) => `Typing ${quote(a.text)}`,
    run: (a: { text: string; element?: number; submit?: boolean }) =>
      agent().typeText(a.element ?? null, requireString(a.text, 'text'), !!a.submit),
  },
  {
    name: 'screen_scroll',
    group: 'screen',
    native: true,
    description: 'Scroll the screen or a specific list. "down" reveals content further down.',
    parameters: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, element },
      required: ['direction'],
    },
    label: (a: { direction: string }) => `Scrolling ${a.direction}`,
    run: (a: { direction: 'up' | 'down' | 'left' | 'right'; element?: number }) =>
      agent().scroll(a.direction, a.element ?? null),
  },
  {
    name: 'screen_navigate',
    group: 'screen',
    native: true,
    description:
      'System navigation: back, home, recents (app switcher), notifications (pull down the shade), quick_settings, lock (lock the phone), screenshot.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['back', 'home', 'recents', 'notifications', 'quick_settings', 'lock', 'screenshot'] },
      },
      required: ['action'],
    },
    label: (a: { action: string }) =>
      ({ back: 'Going back', home: 'Going home', screenshot: 'Taking a screenshot', lock: 'Locking the phone' })[a.action] ??
      `Opening ${a.action.replace('_', ' ')}`,
    run: (a: { action: 'back' | 'home' | 'recents' | 'notifications' | 'quick_settings' | 'lock' | 'screenshot' }) =>
      agent().navigate(a.action),
  },
  {
    name: 'screen_wait_for',
    group: 'screen',
    native: true,
    timeoutMs: 25_000,
    description:
      'Wait until some text appears on screen, e.g. after opening an app, tapping Install, or sending. Returns whether it appeared in time.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        timeout_seconds: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
      },
      required: ['text'],
    },
    label: (a: { text: string }) => `Waiting for ${quote(a.text)}`,
    run: async (a: { text: string; timeout_seconds?: number }) => ({
      appeared: await agent().waitForText(requireString(a.text, 'text'), (a.timeout_seconds ?? 8) * 1000),
    }),
  },
];

// -------------------------------------------------------------------------------------------------
// Apps
// -------------------------------------------------------------------------------------------------

const apps: ToolDef[] = [
  {
    name: 'apps_list',
    group: 'apps',
    native: true,
    description: 'List the installed apps (name and package name).',
    parameters: { type: 'object', properties: {} },
    label: () => 'Checking installed apps',
    run: async () => ({ apps: await agent().listApps() }),
  },
  {
    name: 'app_open',
    group: 'apps',
    native: true,
    description: 'Open an installed app by its name as shown on the home screen (e.g. "Instagram") or its package name.',
    parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
    label: (a: { app: string }) => `Opening ${a.app}`,
    run: (a: { app: string }) => agent().openApp(requireString(a.app, 'app')),
  },
  {
    name: 'app_install',
    group: 'apps',
    native: true,
    description:
      'Open the Play Store for an app (by name, or by package name for an exact page). Then read the screen, open the right result if needed, and tap Install.',
    parameters: { type: 'object', properties: { app: { type: 'string' } }, required: ['app'] },
    label: (a: { app: string }) => `Finding ${a.app} on the Play Store`,
    run: async (a: { app: string }) => {
      agent().openStorePage(requireString(a.app, 'app'));
      return { opened: 'play_store' };
    },
  },
  {
    name: 'app_uninstall',
    group: 'apps',
    native: true,
    description: 'Show the system uninstall dialog for an app (package name from apps_list). Then confirm it on screen.',
    parameters: { type: 'object', properties: { package: { type: 'string' } }, required: ['package'] },
    label: (a: { package: string }) => `Uninstalling ${a.package}`,
    run: async (a: { package: string }) => {
      agent().uninstallApp(requireString(a.package, 'package'));
      return { opened: 'uninstall_dialog' };
    },
  },
  {
    name: 'app_info',
    group: 'apps',
    native: true,
    description: 'Open an app’s system info page: permissions, notifications, storage and cache, force stop.',
    parameters: { type: 'object', properties: { package: { type: 'string' } }, required: ['package'] },
    label: (a: { package: string }) => `Opening settings for ${a.package}`,
    run: async (a: { package: string }) => {
      agent().openAppSettings(requireString(a.package, 'package'));
      return { opened: 'app_info' };
    },
  },
];

// -------------------------------------------------------------------------------------------------
// Communication
// -------------------------------------------------------------------------------------------------

const communication: ToolDef[] = [
  {
    name: 'contacts_search',
    group: 'communication',
    description: 'Find people in the phone’s contacts by name. Returns phone numbers and emails.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 } },
      required: ['query'],
    },
    label: (a: { query: string }) => `Looking up ${quote(a.query)} in contacts`,
    run: async (a: { query: string; limit?: number }) => {
      await ensurePermission(requestContactsPermission, 'Contacts');
      const found = await Contact.getAll({ name: requireString(a.query, 'query'), limit: a.limit ?? 5 });
      const contacts = await Promise.all(
        found.map(async (c) => ({
          name: await c.getFullName(),
          phones: (await c.getPhones()).map((p) => p.number).filter(Boolean),
          emails: (await c.getEmails()).map((e) => e.address).filter(Boolean),
        }))
      );
      return { contacts };
    },
  },
  {
    name: 'phone_call',
    group: 'communication',
    description: 'Open the dialer with a number filled in (use contacts_search for names). Then tap the call button on screen.',
    parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] },
    label: (a: { number: string }) => `Dialing ${a.number}`,
    run: async (a: { number: string }) => {
      await openUrl(`tel:${encodeURIComponent(requireString(a.number, 'number'))}`);
      return { opened: 'dialer' };
    },
  },
  {
    name: 'sms_compose',
    group: 'communication',
    description: 'Open the messaging app with a text message filled in. Then tap Send on screen.',
    parameters: {
      type: 'object',
      properties: { to: { type: 'string', description: 'Phone number.' }, body: { type: 'string' } },
      required: ['to', 'body'],
    },
    label: (a: { to: string }) => `Writing a text to ${a.to}`,
    run: async (a: { to: string; body: string }) => {
      await openUrl(`sms:${encodeURIComponent(requireString(a.to, 'to'))}?body=${encodeURIComponent(a.body ?? '')}`);
      return { opened: 'messages' };
    },
  },
  {
    name: 'email_compose',
    group: 'communication',
    description: 'Open the email app with a new email filled in. Then tap Send on screen.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Comma-separated addresses.' },
        subject: { type: 'string' },
        body: { type: 'string' },
        cc: { type: 'string' },
      },
      required: ['to'],
    },
    label: (a: { to: string }) => `Writing an email to ${a.to}`,
    run: async (a: { to: string; subject?: string; body?: string; cc?: string }) => {
      const query = new URLSearchParams();
      if (a.subject) query.set('subject', a.subject);
      if (a.body) query.set('body', a.body);
      if (a.cc) query.set('cc', a.cc);
      const qs = query.toString().replace(/\+/g, '%20');
      await openUrl(`mailto:${requireString(a.to, 'to')}${qs ? `?${qs}` : ''}`);
      return { opened: 'email' };
    },
  },
  {
    name: 'share',
    group: 'communication',
    description:
      'Open the system share sheet with text or a file (uri/path from files_find or photos_recent). Then read the screen and pick the app and recipient, e.g. WhatsApp → a group → Send.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        file: { type: 'string', description: 'A file uri or path to share.' },
      },
    },
    label: (a: { file?: string }) => (a.file ? 'Opening the share sheet with the file' : 'Opening the share sheet'),
    run: async (a: { text?: string; file?: string }) => {
      if (a.file) {
        const uri = stageForSharing(a.file.startsWith('/') ? `file://${a.file}` : a.file);
        // Not awaited: the share sheet stays open while Baymon picks the target on screen.
        void Sharing.shareAsync(uri).catch(() => {});
        return { opened: 'share_sheet' };
      }
      void Share.share({ message: requireString(a.text, 'text') }).catch(() => {});
      return { opened: 'share_sheet' };
    },
  },
];

// -------------------------------------------------------------------------------------------------
// Time: alarms, timers, reminders, calendar
// -------------------------------------------------------------------------------------------------

const REMINDER_KIND = 'baymon-reminder';

function requireNotifications() {
  const n = loadNotifications();
  if (!n) throw new ToolError('Reminders aren’t available in this build.', 'not_supported');
  return n;
}

const time: ToolDef[] = [
  {
    name: 'alarm_set',
    group: 'time',
    native: true,
    description: 'Set an alarm in the clock app. 24-hour time; optional repeat days.',
    parameters: {
      type: 'object',
      properties: {
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minute: { type: 'integer', minimum: 0, maximum: 59 },
        label: { type: 'string' },
        days: { type: 'array', items: { type: 'string', enum: Object.keys(DAY_NUMBERS) } },
      },
      required: ['hour', 'minute'],
    },
    label: (a: { hour: number; minute: number }) => `Setting an alarm for ${String(a.hour).padStart(2, '0')}:${String(a.minute).padStart(2, '0')}`,
    run: async (a: { hour: number; minute: number; label?: string; days?: string[] }) => {
      const days = a.days?.map((d) => DAY_NUMBERS[d]).filter(Boolean) ?? null;
      agent().setAlarm(a.hour, a.minute, a.label ?? null, days?.length ? days : null);
      return { set: true };
    },
  },
  {
    name: 'timer_set',
    group: 'time',
    native: true,
    description: 'Start a countdown timer in the clock app.',
    parameters: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: 1, maximum: 86400 }, label: { type: 'string' } },
      required: ['seconds'],
    },
    label: (a: { seconds: number }) => `Starting a ${a.seconds >= 60 ? `${Math.round(a.seconds / 60)} min` : `${a.seconds} s`} timer`,
    run: async (a: { seconds: number; label?: string }) => {
      agent().setTimer(a.seconds, a.label ?? null);
      return { started: true };
    },
  },
  {
    name: 'reminder_set',
    group: 'time',
    description: 'Remind the user with a notification at a specific time.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        at: { type: 'string', description: 'ISO 8601 date-time with timezone offset.' },
      },
      required: ['text', 'at'],
    },
    label: (a: { text: string }) => `Setting a reminder: ${quote(a.text)}`,
    run: async (a: { text: string; at: string }) => {
      const date = parseDate(a.at, 'at');
      if (date.getTime() <= Date.now()) throw new ToolError('That time has already passed.', 'invalid_args');
      const Notifications = requireNotifications();
      await ensurePermission(Notifications.requestPermissionsAsync, 'Notifications');
      const id = await Notifications.scheduleNotificationAsync({
        content: { title: 'Reminder', body: requireString(a.text, 'text'), data: { kind: REMINDER_KIND } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
      return { id, at: date.toISOString() };
    },
  },
  {
    name: 'reminders_list',
    group: 'time',
    description: 'List upcoming reminders Baymon has set on this phone.',
    parameters: { type: 'object', properties: {} },
    label: () => 'Checking reminders',
    run: async () => {
      const scheduled = await requireNotifications().getAllScheduledNotificationsAsync();
      return {
        reminders: scheduled
          .filter((n) => n.content.data?.kind === REMINDER_KIND)
          .map((n) => ({ id: n.identifier, text: n.content.body, trigger: n.trigger })),
      };
    },
  },
  {
    name: 'reminder_cancel',
    group: 'time',
    description: 'Cancel a reminder by id (from reminders_list).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    label: () => 'Cancelling a reminder',
    run: async (a: { id: string }) => {
      await requireNotifications().cancelScheduledNotificationAsync(requireString(a.id, 'id'));
      return { cancelled: true };
    },
  },
  {
    name: 'calendar_events',
    group: 'time',
    description: 'List calendar events between two times (defaults: now to 7 days ahead).',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string', description: 'ISO 8601.' }, to: { type: 'string', description: 'ISO 8601.' } },
    },
    label: () => 'Checking your calendar',
    run: async (a: { from?: string; to?: string }) => {
      await ensurePermission(() => Calendar.requestCalendarPermissions(), 'Calendar');
      const from = a.from ? parseDate(a.from, 'from') : new Date();
      const to = a.to ? parseDate(a.to, 'to') : new Date(from.getTime() + 7 * 86_400_000);
      const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const events = await Calendar.listEvents(calendars, from, to);
      return {
        events: events
          .map((e) => ({ title: e.title, start: e.startDate, end: e.endDate, location: e.location || undefined, all_day: e.allDay }))
          .slice(0, 50),
      };
    },
  },
  {
    name: 'calendar_add',
    group: 'time',
    description: 'Add an event to the phone’s calendar.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601.' },
        end: { type: 'string', description: 'ISO 8601. Defaults to one hour after start.' },
        location: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['title', 'start'],
    },
    label: (a: { title: string }) => `Adding ${quote(a.title)} to your calendar`,
    run: async (a: { title: string; start: string; end?: string; location?: string; notes?: string }) => {
      await ensurePermission(() => Calendar.requestCalendarPermissions(), 'Calendar');
      const start = parseDate(a.start, 'start');
      const end = a.end ? parseDate(a.end, 'end') : new Date(start.getTime() + 3_600_000);
      const writable = (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).filter((c) => c.allowsModifications);
      const calendar = writable.find((c) => c.isPrimary) ?? writable[0];
      if (!calendar) throw new ToolError('No calendar on this phone can be written to.', 'not_supported');
      const event = await calendar.createEvent({
        title: requireString(a.title, 'title'),
        startDate: start,
        endDate: end,
        location: a.location,
        notes: a.notes,
      });
      return { id: event.id, calendar: calendar.title };
    },
  },
];

// -------------------------------------------------------------------------------------------------
// Files & clipboard
// -------------------------------------------------------------------------------------------------

const files: ToolDef[] = [
  {
    name: 'files_find',
    group: 'files',
    native: true,
    description:
      'Find files anywhere in the phone’s storage (Downloads, Documents, WhatsApp media…) whose names contain the query words. Use short distinctive words ("7th sem", "syllabus"). Returns name, folder, date and a uri to share.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 } },
      required: ['query'],
    },
    label: (a: { query: string }) => `Searching files for ${quote(a.query)}`,
    run: (a: { query: string; limit?: number }) => agent().findFiles(requireString(a.query, 'query'), a.limit ?? 8),
  },
  {
    name: 'photos_recent',
    group: 'files',
    native: true,
    description: 'The most recent photos, videos or screenshots, newest first.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['photo', 'video', 'screenshot'], default: 'photo' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 5 },
      },
    },
    label: (a: { kind?: string }) => `Finding recent ${a.kind ?? 'photo'}s`,
    run: async (a: { kind?: 'photo' | 'video' | 'screenshot'; limit?: number }) => ({
      items: await agent().recentMedia(a.kind ?? 'photo', a.limit ?? 5),
    }),
  },
  {
    name: 'clipboard_read',
    group: 'files',
    description: 'Read the text on the clipboard (only works while Baymon is on screen).',
    parameters: { type: 'object', properties: {} },
    label: () => 'Reading the clipboard',
    run: async () => ({ text: await Clipboard.getStringAsync() }),
  },
  {
    name: 'clipboard_write',
    group: 'files',
    description: 'Copy text to the clipboard.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    label: () => 'Copying to the clipboard',
    run: async (a: { text: string }) => ({ copied: await Clipboard.setStringAsync(requireString(a.text, 'text')) }),
  },
];

// -------------------------------------------------------------------------------------------------
// Web & places
// -------------------------------------------------------------------------------------------------

const web: ToolDef[] = [
  {
    name: 'open_url',
    group: 'web',
    description: 'Open a link. App links (YouTube, Instagram, Maps…) open in their app; others in the browser.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    label: (a: { url: string }) => `Opening ${a.url.replace(/^https?:\/\//, '').slice(0, 40)}`,
    run: async (a: { url: string }) => {
      const url = requireString(a.url, 'url');
      await openUrl(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
      return { opened: true };
    },
  },
  {
    name: 'web_search',
    group: 'web',
    description: 'Search the web in the phone’s browser.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    label: (a: { query: string }) => `Searching for ${quote(a.query)}`,
    run: async (a: { query: string }) => {
      await openUrl(`https://www.google.com/search?q=${encodeURIComponent(requireString(a.query, 'query'))}`);
      return { opened: true };
    },
  },
  {
    name: 'maps_directions',
    group: 'web',
    description: 'Start directions to a place in Google Maps.',
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string' },
        mode: { type: 'string', enum: ['driving', 'walking', 'bicycling', 'transit'], default: 'driving' },
      },
      required: ['destination'],
    },
    label: (a: { destination: string }) => `Getting directions to ${a.destination}`,
    run: async (a: { destination: string; mode?: string }) => {
      const params = new URLSearchParams({ api: '1', destination: requireString(a.destination, 'destination'), travelmode: a.mode ?? 'driving' });
      await openUrl(`https://www.google.com/maps/dir/?${params}`);
      return { opened: 'maps' };
    },
  },
  {
    name: 'maps_search',
    group: 'web',
    description: 'Search for places in Google Maps (e.g. "coffee near me").',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    label: (a: { query: string }) => `Searching Maps for ${quote(a.query)}`,
    run: async (a: { query: string }) => {
      await openUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(requireString(a.query, 'query'))}`);
      return { opened: 'maps' };
    },
  },
  {
    name: 'location_current',
    group: 'web',
    description: 'The phone’s current location with a street address.',
    parameters: { type: 'object', properties: {} },
    label: () => 'Checking your location',
    run: async () => {
      await ensurePermission(Location.requestForegroundPermissionsAsync, 'Location');
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync(coords).catch(() => []);
      return {
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: place?.formattedAddress ?? [place?.name, place?.city, place?.region].filter(Boolean).join(', '),
      };
    },
  },
];

// -------------------------------------------------------------------------------------------------
// Device
// -------------------------------------------------------------------------------------------------

const SETTINGS_PAGES = [
  'wifi', 'internet', 'bluetooth', 'volume', 'sound', 'display', 'battery', 'location', 'nfc', 'airplane',
  'dnd', 'notifications', 'date', 'storage', 'apps', 'security', 'accessibility',
] as const;

const device: ToolDef[] = [
  {
    name: 'device_status',
    group: 'device',
    description: 'Battery level and charging state, and network connection.',
    parameters: { type: 'object', properties: {} },
    label: () => 'Checking the phone',
    run: async () => {
      const [level, state, network] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
        Network.getNetworkStateAsync(),
      ]);
      return {
        battery_percent: level >= 0 ? Math.round(level * 100) : null,
        charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
        network: network.type,
        online: network.isInternetReachable ?? network.isConnected,
      };
    },
  },
  {
    name: 'flashlight',
    group: 'device',
    native: true,
    description: 'Turn the flashlight on or off.',
    parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    label: (a: { on: boolean }) => `Turning the flashlight ${a.on ? 'on' : 'off'}`,
    run: async (a: { on: boolean }) => {
      agent().setTorch(!!a.on);
      return { on: !!a.on };
    },
  },
  {
    name: 'media_control',
    group: 'device',
    native: true,
    description: 'Control whatever is playing (music, YouTube, podcasts) and the media volume.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down', 'mute'] },
      },
      required: ['action'],
    },
    label: (a: { action: string }) => a.action.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()),
    run: async (a: { action: 'play_pause' | 'next' | 'previous' | 'stop' | 'volume_up' | 'volume_down' | 'mute' }) => {
      agent().mediaControl(a.action);
      return { done: true };
    },
  },
  {
    name: 'brightness_set',
    group: 'device',
    description: 'Set the screen brightness (0–100).',
    parameters: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['level'] },
    label: (a: { level: number }) => `Setting brightness to ${a.level}%`,
    run: async (a: { level: number }) => {
      const { granted } = await Brightness.requestPermissionsAsync();
      if (!granted) {
        if (hasNativeAgent) agent().openSystemSettings('write_settings');
        throw new ToolError('Baymon needs permission to change system settings. Allow it on the screen that just opened.', 'permission_missing');
      }
      await Brightness.setSystemBrightnessAsync(Math.min(100, Math.max(0, a.level)) / 100);
      return { level: a.level };
    },
  },
  {
    name: 'settings_open',
    group: 'device',
    native: true,
    description:
      'Open a settings page or quick panel (Wi-Fi, Bluetooth, volume, Do Not Disturb, …). Then read the screen to toggle things.',
    parameters: { type: 'object', properties: { page: { type: 'string', enum: [...SETTINGS_PAGES] } }, required: ['page'] },
    label: (a: { page: string }) => `Opening ${a.page} settings`,
    run: async (a: { page: (typeof SETTINGS_PAGES)[number] }) => {
      agent().openSystemSettings(a.page);
      return { opened: a.page };
    },
  },
];

// -------------------------------------------------------------------------------------------------
// Notifications
// -------------------------------------------------------------------------------------------------

const notifications: ToolDef[] = [
  {
    name: 'notifications_list',
    group: 'notifications',
    native: true,
    description:
      'List the phone’s current notifications (app, title, text, time), newest first. can_reply means notification_reply works without opening the app.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 } } },
    label: () => 'Checking notifications',
    run: async (a: { limit?: number }) => ({ notifications: await agent().listNotifications(a.limit ?? 15) }),
  },
  {
    name: 'notification_reply',
    group: 'notifications',
    native: true,
    description: 'Reply to a message notification (key from notifications_list) without opening the app.',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string' }, text: { type: 'string' } },
      required: ['key', 'text'],
    },
    label: () => 'Replying to a notification',
    run: (a: { key: string; text: string }) => agent().replyToNotification(requireString(a.key, 'key'), requireString(a.text, 'text')),
  },
];

export const TOOLS: ToolDef[] = [...screen, ...apps, ...communication, ...time, ...files, ...web, ...device, ...notifications];
