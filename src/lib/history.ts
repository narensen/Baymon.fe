import { api } from '@/lib/api';

/**
 * Baymon's searchable history of what the phone noticed (notifications, screen excerpts, places),
 * so it can answer "what did Arjun say about the report last week?". Kept on the server for
 * `retention_days`; 0 turns it off.
 */
type HistorySettings = { retention_days: number };

export const historyApi = {
  /** Days kept, or null when the server doesn't keep a history yet. */
  async retention(): Promise<number | null> {
    const r = await api<{ history?: HistorySettings }>('/v1/settings');
    return r.history ? r.history.retention_days : null;
  },
  async setRetention(days: number): Promise<number | null> {
    const r = await api<{ history?: HistorySettings }>('/v1/settings', {
      method: 'PATCH',
      body: { history: { retention_days: days } },
    });
    return r.history ? r.history.retention_days : null;
  },
  clear: () => api<void>('/v1/history', { method: 'DELETE' }),
};
