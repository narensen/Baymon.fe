import * as Battery from 'expo-battery';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';

import { BaymonAgent, type NativeSignal } from '@/modules/baymon-agent';
import { MAX_SIGNALS_PER_CHECK, type Signal } from '@/lib/nudges/api';
import { signalSources } from '@/lib/nudges/settings';
import { distance, placesStore } from '@/lib/places';
import { readJSON, writeJSON } from '@/lib/storage';
import { localIso } from '@/lib/time';
import { hasNativeAgent } from '@/lib/tools/native';

/**
 * Turns what the phone knows into signals for `/v1/nudges/check`. Each source only reports what
 * changed since the last successful check, so repeat checks stay cheap and the server only
 * consults the model when something is new.
 */

type CalendarSeen = { fingerprint: string; title: string; start: string };

type SignalState = {
  /** Collected but not yet accepted by the server (e.g. the request failed). */
  pending: Signal[];
  /** Upcoming events as last reported, by event and day. */
  calendar: Record<string, CalendarSeen>;
  battery: { level: number; low: boolean } | null;
  place: { latitude: number; longitude: number } | null;
};

const CALENDAR_WINDOW_MS = 36 * 3_600_000;
const MAX_CALENDAR_SIGNALS = 15;
const LOW_BATTERY = 20;
/** Report a new place only after moving this far. */
const PLACE_DISTANCE_M = 1_000;

const key = (userId: string) => `baymon.nudges.signals.${userId}`;

function load(userId: string): SignalState {
  const saved = readJSON<Partial<SignalState>>(key(userId));
  return { pending: saved?.pending ?? [], calendar: saved?.calendar ?? {}, battery: saved?.battery ?? null, place: saved?.place ?? null };
}

/**
 * Signals that arrive outside a check (native events, geofence events) are parked here first, so
 * they survive the app being closed before the next check. Returns what was added.
 */
export function absorbSignals(userId: string, signals: Signal[] = []): Signal[] {
  const native = takeNativeSignals(signalSources.get().notifications, signalSources.get().screen);
  const added = [...native, ...signals];
  if (!added.length) return [];
  const state = load(userId);
  state.pending = [...state.pending, ...added].slice(-MAX_SIGNALS_PER_CHECK);
  writeJSON(key(userId), state);
  return added;
}

export type SignalBatch = {
  signals: Signal[];
  /** Call once the server has accepted `signals`, so they aren't sent again. */
  commit: () => void;
};

/**
 * Everything new since the last check. `opened` adds the app-open signal; `foreground` allows
 * sources that shouldn't run in the background (location).
 */
export async function collectSignals(
  userId: string,
  { foreground, opened }: { foreground: boolean; opened: boolean }
): Promise<SignalBatch> {
  const state = load(userId);
  const sources = signalSources.get();

  // Native signals are handed over once, so park them in `pending` before anything can fail.
  const native = takeNativeSignals(sources.notifications, sources.screen);
  if (native.length) {
    state.pending = [...state.pending, ...native].slice(-MAX_SIGNALS_PER_CHECK);
    writeJSON(key(userId), state);
  }

  const [calendar, battery, place] = await Promise.all([
    sources.calendar ? calendarSignals(state.calendar).catch(() => null) : null,
    sources.battery ? batterySignal(state.battery).catch(() => null) : null,
    sources.location && foreground ? placeSignal(state.place).catch(() => null) : null,
  ]);

  const signals = [
    ...state.pending,
    ...(calendar?.signals ?? []),
    ...(battery?.signal ? [battery.signal] : []),
    ...(place?.signal ? [place.signal] : []),
    ...(opened ? [{ type: 'foreground', at: localIso() }] : []),
  ].slice(-MAX_SIGNALS_PER_CHECK);

  return {
    signals,
    commit() {
      const latest = load(userId);
      writeJSON(key(userId), {
        // Anything that arrived while the request was in flight stays for next time.
        pending: latest.pending.filter((s) => !signals.some((x) => sameSignal(x, s))),
        calendar: calendar ? calendar.seen : latest.calendar,
        battery: battery ? battery.next : latest.battery,
        place: place?.next ?? latest.place,
      } satisfies SignalState);
    },
  };
}

const sameSignal = (a: Signal, b: Signal) => a.type === b.type && a.at === b.at && JSON.stringify(a.data) === JSON.stringify(b.data);

function takeNativeSignals(notifications: boolean, screen: boolean): Signal[] {
  if (!hasNativeAgent || !BaymonAgent) return [];
  try {
    const taken = JSON.parse(BaymonAgent.takeSignals()) as NativeSignal[];
    // `app_open` (an app a reminder waits for) is always kept: the user asked for it.
    return taken
      .filter((s) => (s.type === 'notification' ? notifications : s.type === 'screen' ? screen : true))
      .map((s) => ({ type: s.type, at: localIso(s.at), data: s.data }));
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------------------------------------
// Calendar: new, moved and cancelled events in the next 36 hours
// -------------------------------------------------------------------------------------------------

async function calendarSignals(previous: Record<string, CalendarSeen>) {
  if (!(await Calendar.getCalendarPermissions()).granted) return null;
  const now = Date.now();
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const events = await Calendar.listEvents(calendars, new Date(now), new Date(now + CALENDAR_WINDOW_MS));

  const seen: Record<string, CalendarSeen> = {};
  const signals: Signal[] = [];
  for (const e of events) {
    if (!e.startDate) continue;
    const start = new Date(e.startDate);
    const end = e.endDate ? new Date(e.endDate) : null;
    // Recurring events share an id; one entry per day keeps a moved meeting a "change".
    const id = `${e.id}@${start.toDateString()}`;
    const fingerprint = JSON.stringify([e.title, start.getTime(), end?.getTime(), e.location ?? '', !!e.allDay]);
    seen[id] = { fingerprint, title: e.title, start: start.toISOString() };
    const before = previous[id];
    if (before?.fingerprint === fingerprint) continue;
    signals.push({
      type: 'calendar',
      at: localIso(now),
      data: {
        change: before ? 'changed' : 'new',
        title: e.title,
        start: localIso(start),
        ...(end && { end: localIso(end) }),
        ...(e.location && { location: e.location }),
        ...(e.allDay && { all_day: true }),
      },
    });
  }
  for (const [id, before] of Object.entries(previous)) {
    if (!(id in seen) && Date.parse(before.start) > now) {
      signals.push({ type: 'calendar', at: localIso(now), data: { change: 'removed', title: before.title, start: localIso(before.start) } });
    }
  }
  return { signals: signals.slice(0, MAX_CALENDAR_SIGNALS), seen };
}

// -------------------------------------------------------------------------------------------------
// Battery: only when it gets low (and again for every further 5%)
// -------------------------------------------------------------------------------------------------

async function batterySignal(previous: SignalState['battery']) {
  const [fraction, batteryState] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
  if (fraction < 0) return null;
  const level = Math.round(fraction * 100);
  const charging = batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL;
  const low = !charging && level <= LOW_BATTERY;
  const next = { level, low };
  const worse = low && (!previous?.low || previous.level - level >= 5);
  return { signal: worse ? { type: 'battery', at: localIso(), data: { level, charging } } : null, next };
}

// -------------------------------------------------------------------------------------------------
// Location: the name of the place, when it changes. Never coordinates.
// -------------------------------------------------------------------------------------------------

async function placeSignal(previous: SignalState['place']) {
  if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
  // A cached fix is enough and costs no battery.
  const position = await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000 });
  if (!position) return null;
  const { latitude, longitude } = position.coords;
  if (previous && distance(previous, { latitude, longitude }) < PLACE_DISTANCE_M) return null;
  // A place you saved beats the street name.
  const saved = placesStore.at({ latitude, longitude });
  if (saved) {
    return { signal: { type: 'location', at: localIso(), data: { label: saved.name, saved: true } }, next: { latitude, longitude } };
  }
  const [place] = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
  const label = place?.name || place?.street || place?.district || place?.city;
  if (!label) return null;
  const area = [place.district, place.city].filter((p) => p && p !== label).join(', ');
  return {
    signal: { type: 'location', at: localIso(), data: { label, ...(area && { area }) } },
    next: { latitude, longitude },
  };
}
