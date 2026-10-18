import { api } from '@/lib/api';

/** Matches `Nudge.kind` in the API. */
export const NUDGE_KINDS = ['reminder', 'event', 'checkin', 'followup', 'inconsistency', 'insight'] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** Shown above the bubble's text. */
export const KIND_LABELS: Record<NudgeKind, string> = {
  reminder: 'Reminder',
  event: 'Coming up',
  checkin: 'Check-in',
  followup: 'Follow-up',
  inconsistency: 'Heads-up',
  insight: 'Noticed',
};

export const kindLabel = (kind: string) => KIND_LABELS[kind as NudgeKind] ?? 'Baymon';

/** Mirrors `Nudge`: something Baymon wants to say without being asked. */
export type Nudge = {
  id: string;
  kind: NudgeKind;
  urgency: 'low' | 'normal' | 'high';
  /** The bubble: one sentence. */
  text: string;
  /** Baymon's opening chat message when the bubble is tapped (Markdown). */
  detail: string;
  /** Quick replies shown as chips in the chat. */
  suggestions: string[];
  created_at: string;
  expires_at: string;
  /** A reply Baymon drafted (e.g. to the message that prompted this). Never sent without a tap. */
  draft?: NudgeDraft | null;
};

export type NudgeDraft = {
  text: string;
  /** Who it's for, e.g. "Priya". */
  to?: string | null;
  /** Where, e.g. "WhatsApp". */
  app?: string | null;
  /** The notification's key: Send replies inline through it (notification_reply). */
  reply_key?: string | null;
};

/** Something the phone noticed. Any `type` is accepted; `data` is free-form. */
export type Signal = { type: string; at?: string; data?: Record<string, unknown> };

export type NudgeAction = 'opened' | 'dismissed' | 'snoozed' | 'done';

/** Why, when it helps Baymon learn: dismissed as not useful or badly timed, or done by sending the draft. */
export type NudgeReason = 'not_useful' | 'wrong_time' | 'draft_sent';

/** Mirrors `NudgeSettings`. Times are local "HH:MM"; `null` turns that part off. */
export type NudgeSettings = {
  enabled: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  morning_brief: string | null;
  evening_wrap: string | null;
  /** Hold low-urgency things for the evening wrap-up instead of a bubble each. */
  digest?: boolean;
  /** Weekly review time ("HH:MM") or null for off, on `weekly_review_day` (ISO: 1 = Monday … 7 = Sunday). */
  weekly_review?: string | null;
  weekly_review_day?: number;
};

/** The API's limit per check. */
export const MAX_SIGNALS_PER_CHECK = 50;

export const nudgeApi = {
  /** Send new signals; returns bubbles to show now (usually none). */
  check: (body: { device_id: string; timezone: string; signals: Signal[] }) =>
    api<{ nudges: Nudge[] }>('/v1/nudges/check', { method: 'POST', body, timeoutMs: 60_000 }).then((r) => r.nudges),
  /** Bubbles shown but not yet handled, to restore after a restart. */
  active: () => api<{ nudges: Nudge[] }>('/v1/nudges').then((r) => r.nudges),
  feedback: (id: string, action: NudgeAction, snoozeMinutes?: number, reason?: NudgeReason) =>
    api<void>(`/v1/nudges/${encodeURIComponent(id)}/feedback`, {
      method: 'POST',
      body: { action, ...(action === 'snoozed' && { snooze_minutes: snoozeMinutes ?? 60 }), ...(reason && { reason }) },
    }),
  settings: () => api<{ nudges: NudgeSettings }>('/v1/settings').then((r) => r.nudges),
  /** Only the fields sent change. */
  updateSettings: (patch: Partial<NudgeSettings>) =>
    api<{ nudges: NudgeSettings }>('/v1/settings', { method: 'PATCH', body: { nudges: patch } }).then((r) => r.nudges),
};
