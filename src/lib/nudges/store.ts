import { useSyncExternalStore } from 'react';

import { ApiError } from '@/lib/api';
import { nudgeApi, type Nudge, type NudgeAction, type NudgeReason } from '@/lib/nudges/api';
import { nudgeSettings } from '@/lib/nudges/settings';
import { readJSON, writeJSON } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

export type StoredNudge = Nudge & {
  /** `active` until the user does something with it. */
  status: 'active' | NudgeAction;
  /** Shown as a system notification (the fallback without the floating bubble). */
  notified?: boolean;
  notificationId?: string;
};

/** Feedback waiting to reach the server; kept across restarts so none is lost. */
type Outgoing = { id: string; action: NudgeAction; snooze_minutes?: number; reason?: NudgeReason };

type State = { nudges: StoredNudge[]; outbox: Outgoing[] };

/** Handled nudges are kept a while so a late tap (or deep link) can still open them. */
const KEEP_MS = 3 * 86_400_000;
const MAX_KEPT = 60;
/** At most this many bubbles are on screen at once. */
export const MAX_VISIBLE = 3;

let state: State = { nudges: [], outbox: [] };
let storageKey: string | null = null;
/** Newest first, unexpired; cached so `useSyncExternalStore` sees a stable value. */
let active: StoredNudge[] = [];
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const isLive = (n: StoredNudge, now = Date.now()) => n.status === 'active' && Date.parse(n.expires_at) > now;

function recompute() {
  const now = Date.now();
  active = state.nudges.filter((n) => isLive(n, now)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  // Wake up when the next one expires, so it leaves the screen on time.
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const next = Math.min(...active.map((n) => Date.parse(n.expires_at)));
  if (Number.isFinite(next)) {
    expiryTimer = setTimeout(() => {
      recompute();
      listeners.forEach((l) => l());
    }, Math.min(next - now + 50, 2 ** 31 - 1));
  }
}

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  recompute();
  if (storageKey) writeJSON(storageKey, state);
  listeners.forEach((l) => l());
}

function prune(nudges: StoredNudge[]) {
  const cutoff = Date.now() - KEEP_MS;
  return nudges.filter((n) => isLive(n) || Date.parse(n.created_at) > cutoff).slice(-MAX_KEPT);
}

/**
 * Loads the signed-in user's nudges and settings, from anywhere (a screen, a deep link, or a
 * background check with no UI). Returns the user id, or null when signed out.
 */
export async function ensureNudgeUser(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return null;
  nudgeStore.hydrate(userId);
  nudgeSettings.hydrate(userId);
  return userId;
}

export const nudgeStore = {
  hydrate(userId: string) {
    const key = `baymon.nudges.${userId}`;
    if (storageKey === key) return;
    storageKey = key;
    const saved = readJSON<Partial<State>>(key);
    state = { nudges: prune(saved?.nudges ?? []), outbox: saved?.outbox ?? [] };
    recompute();
    listeners.forEach((l) => l());
  },

  isHydrated: () => storageKey !== null,

  /** Unexpired and not yet handled, newest first. */
  active: () => active,

  all: () => state.nudges,

  get: (id: string) => state.nudges.find((n) => n.id === id),

  /**
   * New bubbles from a check. A snoozed nudge comes back with the same id: it becomes active
   * again and may be announced again.
   */
  receive(incoming: Nudge[]) {
    if (!incoming.length) return;
    const byId = new Map(state.nudges.map((n) => [n.id, n]));
    for (const n of incoming) {
      byId.set(n.id, { ...n, status: 'active', notified: false, notificationId: byId.get(n.id)?.notificationId });
    }
    setState({ nudges: prune([...byId.values()]) });
  },

  /**
   * Reconcile with `GET /v1/nudges` (what the server still considers shown and unhandled). Local
   * actions not yet sent win, so a dismissal made offline doesn't bring the bubble back.
   */
  restore(server: Nudge[]) {
    const unsent = new Set(state.outbox.map((o) => o.id));
    const live = new Set(server.map((n) => n.id));
    const byId = new Map(state.nudges.map((n) => [n.id, n]));
    for (const n of server) {
      const local = byId.get(n.id);
      if (unsent.has(n.id) || (local && local.status !== 'active')) continue;
      byId.set(n.id, { ...n, status: 'active', notified: local?.notified, notificationId: local?.notificationId });
    }
    // Handled or expired elsewhere.
    for (const n of byId.values()) {
      if (n.status === 'active' && !live.has(n.id)) byId.set(n.id, { ...n, status: 'dismissed' });
    }
    setState({ nudges: prune([...byId.values()]) });
  },

  patch(id: string, patch: Partial<StoredNudge>) {
    if (!state.nudges.some((n) => n.id === id)) return;
    setState({ nudges: state.nudges.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  },

  /** What the user did with a bubble. Applied now, sent to the server as soon as it can be. */
  act(id: string, action: NudgeAction, snoozeMinutes?: number, reason?: NudgeReason) {
    const current = state.nudges.find((n) => n.id === id);
    // The same action can arrive twice (e.g. a bubble tap and its deep link).
    if (current?.status === action) return;
    setState({
      nudges: state.nudges.map((n) => (n.id === id ? { ...n, status: action } : n)),
      outbox: [
        ...state.outbox.filter((o) => o.id !== id),
        { id, action, ...(action === 'snoozed' && { snooze_minutes: snoozeMinutes ?? 60 }), ...(reason && { reason }) },
      ],
    });
    void nudgeStore.flush();
  },

  /** Sends pending feedback. Safe to call often; concurrent calls share one run. */
  flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      for (const item of [...state.outbox]) {
        try {
          await nudgeApi.feedback(item.id, item.action, item.snooze_minutes, item.reason);
        } catch (e) {
          // Unknown nudge (expired, or another account's): nothing to retry. Otherwise try later.
          if (!(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429)) break;
        }
        setState({ outbox: state.outbox.filter((o) => o !== item) });
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  },

  /** Forget everything in memory (on sign-out); saved state stays on device for the same user. */
  reset() {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    storageKey = null;
    state = { nudges: [], outbox: [] };
    active = [];
    listeners.forEach((l) => l());
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Bubbles to show now, newest first. */
export function useActiveNudges() {
  return useSyncExternalStore(subscribe, nudgeStore.active, nudgeStore.active);
}
