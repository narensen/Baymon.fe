import { useSyncExternalStore } from 'react';

import { BaymonAgent } from '@/modules/baymon-agent';
import { nudgeApi, type NudgeSettings } from '@/lib/nudges/api';
import { readJSON, writeJSON } from '@/lib/storage';
import { hasNativeAgent } from '@/lib/tools/native';

// -------------------------------------------------------------------------------------------------
// When Baymon may speak up (stored on the server, cached here so background checks know)
// -------------------------------------------------------------------------------------------------

/** The server's defaults, also used to turn a part back on. */
export const NUDGE_DEFAULTS: NudgeSettings = {
  enabled: true,
  quiet_start: '22:00',
  quiet_end: '08:00',
  morning_brief: '08:00',
  evening_wrap: '21:00',
  digest: true,
  weekly_review: '18:00',
  weekly_review_day: 7,
};

type State = {
  /** null until loaded once (then cached per user). */
  value: NudgeSettings | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
};

const SAVE_DELAY_MS = 500;

let state: State = { value: null, status: 'idle' };
let storageKey: string | null = null;
/** Last value the server confirmed, to roll back to. */
let confirmed: NudgeSettings | null = null;
/** Changes not yet sent; merged so quick edits (e.g. scrolling a time wheel) become one request. */
let pending: Partial<NudgeSettings> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  if (storageKey && next.value !== undefined) writeJSON(storageKey, state.value);
  listeners.forEach((l) => l());
}

async function save() {
  saveTimer = null;
  const patch = pending;
  pending = {};
  if (!Object.keys(patch).length) return;
  try {
    confirmed = await nudgeApi.updateSettings(patch);
    // An older server ignores settings it doesn't know; say so instead of silently reverting.
    const ignored = Object.keys(patch).filter((k) => !(k in (confirmed ?? {})));
    // Keep anything changed while this request was in flight.
    setState({
      value: { ...confirmed, ...pending },
      status: 'ready',
      error: ignored.length ? 'Your Baymon server doesn’t support this setting yet. It needs the backend update.' : undefined,
    });
  } catch (e) {
    pending = {};
    setState({ value: confirmed ?? state.value, error: e instanceof Error ? e.message : 'Couldn’t save that' });
  }
}

export const nudgeSettings = {
  hydrate(userId: string) {
    const key = `baymon.nudges.settings.${userId}`;
    if (storageKey === key) return;
    storageKey = key;
    confirmed = readJSON<NudgeSettings>(key);
    pending = {};
    state = { value: confirmed, status: 'idle' };
    listeners.forEach((l) => l());
    syncNativeSources();
  },

  get: () => state,

  /** Whether Baymon may speak up; on until the server says otherwise. */
  enabled: () => state.value?.enabled !== false,

  async load() {
    if (state.status === 'loading') return;
    setState({ status: 'loading', error: undefined });
    try {
      confirmed = await nudgeApi.settings();
      setState({ value: { ...confirmed, ...pending }, status: 'ready' });
      syncNativeSources();
    } catch (e) {
      setState({ status: state.value ? 'ready' : 'error', error: e instanceof Error ? e.message : 'Couldn’t load settings' });
    }
  },

  /** Optimistic: the UI changes now; the server hears about it shortly after. */
  update(patch: Partial<NudgeSettings>) {
    const base = state.value ?? NUDGE_DEFAULTS;
    pending = { ...pending, ...patch };
    setState({ value: { ...base, ...patch }, error: undefined });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
    if ('enabled' in patch) syncNativeSources();
  },

  reset() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    storageKey = null;
    confirmed = null;
    pending = {};
    state = { value: null, status: 'idle' };
    listeners.forEach((l) => l());
    // Signed out: the phone stops noticing things for Baymon.
    syncNativeSources();
  },
};

export function useNudgeSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

// -------------------------------------------------------------------------------------------------
// What the phone shares (a device preference: it decides what leaves this phone)
// -------------------------------------------------------------------------------------------------

export type SignalSource = 'notifications' | 'calendar' | 'battery' | 'location' | 'places' | 'screen';
export type SignalSources = Record<SignalSource, boolean>;

const SOURCES_KEY = 'baymon.nudges.sources';
/**
 * Location and screen text are the most personal, so they start off. Saved places only report the
 * names of places you saved yourself, so they're on (they still need "Allow all the time").
 */
const SOURCE_DEFAULTS: SignalSources = {
  notifications: true,
  calendar: true,
  battery: true,
  location: false,
  places: true,
  screen: false,
};

let sources: SignalSources | null = null;
const sourceListeners = new Set<() => void>();
const getSources = () => (sources ??= { ...SOURCE_DEFAULTS, ...readJSON<Partial<SignalSources>>(SOURCES_KEY) });

/** The native side records notifications and screen changes on its own, so it needs to know. */
export function syncNativeSources() {
  if (!hasNativeAgent || !BaymonAgent) return;
  const on = nudgeSettings.enabled() && storageKey !== null;
  const s = getSources();
  try {
    BaymonAgent.setSignalSources({ notifications: on && s.notifications, screen: on && s.screen });
  } catch {}
}

export const signalSources = {
  get: getSources,
  set(patch: Partial<SignalSources>) {
    sources = { ...getSources(), ...patch };
    writeJSON(SOURCES_KEY, sources);
    syncNativeSources();
    sourceListeners.forEach((l) => l());
  },
};

export function useSignalSources() {
  return useSyncExternalStore(
    (l) => {
      sourceListeners.add(l);
      return () => sourceListeners.delete(l);
    },
    getSources,
    getSources
  );
}
