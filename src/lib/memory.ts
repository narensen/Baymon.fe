import { useSyncExternalStore } from 'react';

import { api, ApiError } from '@/lib/api';

/** Matches `Category` in the API. */
export const MEMORY_CATEGORIES = ['preference', 'fact', 'task', 'decision', 'other'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** Matches `MEMORY_MAX_CHARS` in the API. */
export const MEMORY_MAX_CHARS = 500;

/** Mirrors the API's `Memory` model (stored in the `memory` table, keyed to `public.users`). */
export type Memory = {
  id: string;
  content: string;
  category: string;
  created_at: string;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type MemoryInput = { content: string; category: MemoryCategory };

const backend = {
  list: () => api<{ items: Memory[] }>('/v1/memory').then((r) => r.items),
  create: (input: MemoryInput) => api<Memory>('/v1/memory', { method: 'POST', body: input }),
  update: (id: string, patch: Partial<MemoryInput>) =>
    api<Memory>(`/v1/memory/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  remove: (id: string) => api<void>(`/v1/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const lastTouched = (m: Memory) => m.updated_at ?? m.created_at;

/**
 * Something you said you'd do ("I'll send it tomorrow"), which Baymon extracted from a chat or a
 * message and follows up on. Stored as a `task` memory with this metadata.
 */
export type CommitmentMeta = {
  kind: 'commitment';
  status?: 'open' | 'done';
  /** ISO time it's due, if known. */
  due_at?: string | null;
  /** Who it's for, e.g. "Arjun". */
  person?: string | null;
  source?: 'chat' | 'screen' | 'notification';
};

export const isOpenCommitment = (m: Memory) =>
  (m.metadata as Partial<CommitmentMeta> | null | undefined)?.kind === 'commitment' &&
  (m.metadata as Partial<CommitmentMeta>).status !== 'done';

/** The API returns oldest first; show the most recently touched first. */
const newestFirst = (items: Memory[]) =>
  [...items].sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)));

type State = {
  items: Memory[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  loadedAt?: number;
};

let state: State = { items: [], status: 'idle' };
/** Bumped on every local mutation so an in-flight list fetch can't overwrite newer edits. */
let version = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Optimistic updates: the UI changes instantly and rolls back if the API rejects. */
export const memoryStore = {
  /** Fetch from the server. Concurrent calls share one request. */
  load() {
    if (inflight) return inflight;
    const startedAt = version;
    setState({ status: state.items.length ? state.status : 'loading', error: undefined });
    const request: Promise<void> = backend
      .list()
      .then((items) => {
        if (version !== startedAt) return;
        setState({ items: newestFirst(items), status: 'ready', loadedAt: Date.now() });
      })
      .catch((e) => {
        // Keep showing what we have; only surface the error when there's nothing to show.
        setState({ status: state.items.length ? 'ready' : 'error', error: message(e, 'Couldn’t load memories') });
        throw e;
      })
      .finally(() => {
        if (inflight === request) inflight = null;
      });
    inflight = request;
    return request;
  },
  /** Refetch only if the cached list is older than `maxAgeMs`. */
  refresh(maxAgeMs = 15_000) {
    if (state.loadedAt && Date.now() - state.loadedAt < maxAgeMs) return;
    memoryStore.load().catch(() => {});
  },
  async create(input: MemoryInput) {
    version++;
    const created = await backend.create(input);
    setState({ items: [created, ...state.items] });
    return created;
  },
  async update(id: string, patch: Partial<MemoryInput>) {
    version++;
    const previous = state.items;
    setState({ items: previous.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    try {
      const saved = await backend.update(id, patch);
      setState({ items: newestFirst(state.items.map((m) => (m.id === id ? saved : m))) });
    } catch (e) {
      setState({ items: previous });
      throw e;
    }
  },
  /**
   * `optimistic: false` waits for the server before removing, for callers (like the editor sheet)
   * that are showing the memory and need to stay on screen to report a failure.
   */
  async remove(id: string, { optimistic = true } = {}) {
    version++;
    if (!optimistic) {
      await backend.remove(id);
      setState({ items: state.items.filter((m) => m.id !== id) });
      return;
    }
    const previous = state.items;
    setState({ items: previous.filter((m) => m.id !== id) });
    try {
      await backend.remove(id);
    } catch (e) {
      setState({ items: previous });
      throw e;
    }
  },
  /**
   * Marks a commitment done (`metadata.status`). A server without metadata updates rejects the
   * request; the commitment is then deleted instead, so it still leaves the open list.
   */
  async complete(id: string) {
    version++;
    const previous = state.items;
    setState({
      items: previous.map((m) => (m.id === id ? { ...m, metadata: { ...m.metadata, status: 'done' } } : m)),
    });
    try {
      const saved = await api<Memory>(`/v1/memory/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { metadata: { status: 'done' } },
      });
      setState({ items: state.items.map((m) => (m.id === id ? saved : m)) });
    } catch (e) {
      const unsupported = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 404;
      if (!unsupported) {
        setState({ items: previous });
        throw e;
      }
      await backend.remove(id);
      setState({ items: state.items.filter((m) => m.id !== id) });
    }
  },
  /** Drop cached memories, e.g. on sign-out. */
  reset() {
    version++;
    inflight = null;
    setState({ items: [], status: 'idle', error: undefined, loadedAt: undefined });
  },
};

export function useMemoryState() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useMemory(id: string | undefined) {
  const { items } = useMemoryState();
  return id ? items.find((m) => m.id === id) : undefined;
}
