import { useSyncExternalStore } from 'react';

import { BaymonAgent } from '@/modules/baymon-agent';
import { api, ApiError } from '@/lib/api';
import type { Signal } from '@/lib/nudges/api';
import { readJSON, writeJSON } from '@/lib/storage';
import { hasNativeAgent } from '@/lib/tools/native';

/**
 * Things Baymon is waiting to do for you, made by talking to it:
 * - reminders tied to context ("remind me to ask Priya about the invoice when she messages");
 * - routines ("Leaving work": text home, open Maps home, turn on Do Not Disturb).
 * Both are stored on the server; this mirrors them for the Automations screen and so the phone can
 * check right away when something a reminder is waiting for happens.
 */

/** Mirrors `Trigger` in the API. */
export type Trigger = {
  id: string;
  when:
    | { type: 'place'; place: string; on: 'arrive' | 'leave' }
    | { type: 'message'; from: string; app?: string | null }
    | { type: 'app'; app: string }
    | { type: 'notification'; app?: string | null; contains?: string | null };
  /** What Baymon reminds you of. */
  say: string;
  /** false: fires once, then it's gone. */
  repeat: boolean;
  /** Offer to run this routine when it fires. */
  routine_id?: string | null;
  created_at: string;
  last_fired_at?: string | null;
};

/** Mirrors `Routine` in the API. */
export type Routine = {
  id: string;
  name: string;
  /** Plain-language steps Baymon carries out with its phone tools. */
  steps: string[];
  created_at: string;
  last_run_at?: string | null;
};

type State = {
  triggers: Trigger[];
  routines: Routine[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  /** The server doesn't have these endpoints yet. */
  unsupported: boolean;
  loadedAt?: number;
};

const CACHE_KEY = 'baymon.automations';

let state: State = { triggers: [], routines: [], status: 'idle', unsupported: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (next.triggers || next.routines) {
    writeJSON(CACHE_KEY, { triggers: state.triggers, routines: state.routines });
    if (next.triggers) syncWatchedApps();
  }
}

/** The native side reports opening these apps right away (name only), even with screen context off. */
function syncWatchedApps() {
  if (!hasNativeAgent || !BaymonAgent) return;
  const apps = state.triggers.flatMap((t) => (t.when.type === 'app' ? [t.when.app] : []));
  try {
    BaymonAgent.setWatchedApps(apps);
  } catch {}
}

const isMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);

export const automations = {
  /** Cached copy first (instant, and works offline), then the server. */
  hydrate() {
    if (state.status !== 'idle') return;
    const cached = readJSON<Pick<State, 'triggers' | 'routines'>>(CACHE_KEY);
    if (cached) setState({ triggers: cached.triggers ?? [], routines: cached.routines ?? [] });
  },

  load() {
    if (inflight) return inflight;
    automations.hydrate();
    setState({ status: state.loadedAt ? state.status : 'loading', error: undefined });
    const request = Promise.all([
      api<{ items: Trigger[] }>('/v1/triggers').then((r) => r.items),
      api<{ items: Routine[] }>('/v1/routines').then((r) => r.items),
    ])
      .then(([triggers, routines]) => setState({ triggers, routines, status: 'ready', unsupported: false, loadedAt: Date.now() }))
      .catch((e) => {
        if (isMissing(e)) setState({ status: 'ready', unsupported: true, loadedAt: Date.now() });
        else setState({ status: 'error', error: e instanceof Error ? e.message : 'Couldn’t load automations' });
      })
      .finally(() => {
        inflight = null;
      });
    inflight = request;
    return request;
  },

  /** Refetch if older than `maxAgeMs` (e.g. after a chat turn that may have made one). */
  refresh(maxAgeMs = 30_000) {
    if (state.loadedAt && Date.now() - state.loadedAt < maxAgeMs) return;
    void automations.load();
  },

  async removeTrigger(id: string) {
    const previous = state.triggers;
    setState({ triggers: previous.filter((t) => t.id !== id) });
    try {
      await api(`/v1/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      setState({ triggers: previous });
      throw e;
    }
  },

  async removeRoutine(id: string) {
    const previous = state.routines;
    setState({ routines: previous.filter((r) => r.id !== id) });
    try {
      await api(`/v1/routines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      setState({ routines: previous });
      throw e;
    }
  },

  /**
   * Whether a signal is something a reminder waits for. Only decides how fast the phone checks
   * (now instead of paced); the server decides whether the reminder fires.
   */
  matches(signal: Signal) {
    const data = (signal.data ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string).toLowerCase() : '');
    const has = (haystack: string, needle?: string | null) => !needle || haystack.includes(needle.trim().toLowerCase());
    return state.triggers.some((t) => {
      const w = t.when;
      switch (w.type) {
        case 'app':
          return signal.type === 'app_open' && has(text('app'), w.app);
        case 'message':
          return signal.type === 'notification' && has(`${text('title')} ${text('text')}`, w.from) && has(text('app'), w.app);
        case 'notification':
          return signal.type === 'notification' && has(text('app'), w.app) && has(`${text('title')} ${text('text')}`, w.contains);
        case 'place':
          return signal.type === 'location' && has(text('label'), w.place) && text('event') === (w.on === 'leave' ? 'exit' : 'enter');
      }
      return false;
    });
  },

  reset() {
    inflight = null;
    state = { triggers: [], routines: [], status: 'idle', unsupported: false };
    listeners.forEach((l) => l());
  },
};

export function useAutomations() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

/** "When Priya messages you on WhatsApp". */
export function describeTrigger(t: Trigger): string {
  const w = t.when;
  switch (w.type) {
    case 'place':
      return w.on === 'leave' ? `When you leave ${w.place}` : `When you get to ${w.place}`;
    case 'message':
      return `When ${w.from} messages you${w.app ? ` on ${w.app}` : ''}`;
    case 'app':
      return `${t.repeat ? 'When' : 'Next time'} you open ${w.app}`;
    case 'notification':
      return `When ${w.app ?? 'a notification'}${w.contains ? ` mentions “${w.contains}”` : ' notifies you'}`;
  }
  return 'When something happens';
}
