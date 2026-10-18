import * as BackgroundTask from 'expo-background-task';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { BaymonAgent, type BubbleAction, type BubbleSpec } from '@/modules/baymon-agent';
import { automations } from '@/lib/automations';
import { deviceId } from '@/lib/device';
import { haptics } from '@/lib/haptics';
import { notifications } from '@/lib/notifications';
import { kindLabel, nudgeApi, type NudgeAction, type NudgeReason } from '@/lib/nudges/api';
import { openNudge } from '@/lib/nudges/open';
import { nudgeSettings, syncNativeSources } from '@/lib/nudges/settings';
import { absorbSignals, collectSignals } from '@/lib/nudges/signals';
import { GEOFENCE_TASK, syncGeofences } from '@/lib/places';
import { localIso } from '@/lib/time';
import { ensureNudgeUser, MAX_VISIBLE, nudgeStore, type StoredNudge } from '@/lib/nudges/store';
import { hasNativeAgent } from '@/lib/tools/native';

/**
 * Baymon speaking up. The phone asks the server "anything to say?" (`/v1/nudges/check`) with what
 * it noticed: when the app opens, when a notification or screen change arrives, after a snooze
 * ends, and from a background task about every 15 minutes. Answers are shown as:
 * - the in-app bubble while Baymon is open (components/nudge-bubbles.tsx);
 * - the floating bubble over other apps, with "display over other apps" (Android);
 * - otherwise a notification.
 */

const isWeb = process.env.EXPO_OS === 'web';
const isForeground = () => AppState.currentState === 'active';

// -------------------------------------------------------------------------------------------------
// When to check
// -------------------------------------------------------------------------------------------------

export type Trigger = 'foreground' | 'background' | 'notification' | 'screen' | 'snooze' | 'reminder' | 'place';

/** `debounce` lets bursts (a group chat) become one check; `gap` is the least time between checks. */
const PACING: Record<Trigger, { debounce: number; gap: number }> = {
  foreground: { debounce: 0, gap: 20_000 },
  background: { debounce: 0, gap: 0 },
  notification: { debounce: 4_000, gap: 60_000 },
  // Every app switch would be a lot; screen changes wait for the next check unless it's been a while.
  screen: { debounce: 4_000, gap: 10 * 60_000 },
  snooze: { debounce: 0, gap: 0 },
  // Something a "remind me when…" reminder waits for: it should land while it's still relevant.
  reminder: { debounce: 1_500, gap: 0 },
  place: { debounce: 0, gap: 0 },
};

const lastRequested: Partial<Record<Trigger, number>> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Infinity;
let inflight: Promise<void> | null = null;
let rerun: Trigger | null = null;

/** Check soon, paced per trigger. A check always sends everything collected so far. */
export function requestCheck(trigger: Trigger) {
  const { debounce, gap } = PACING[trigger];
  const at = Math.max(Date.now() + debounce, (lastRequested[trigger] ?? 0) + gap);
  if (timer && timerAt <= at) return;
  if (timer) clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    timerAt = Infinity;
    lastRequested[trigger] = Date.now();
    void checkNow(trigger);
  }, at - Date.now());
}

/** Check now; overlapping calls share the running check and queue one more after it. */
export function checkNow(trigger: Trigger): Promise<void> {
  if (inflight) {
    rerun = trigger;
    return inflight;
  }
  inflight = runCheck(trigger)
    .catch(() => {})
    .finally(() => {
      inflight = null;
      const next = rerun;
      rerun = null;
      if (next) void checkNow(next);
    });
  return inflight;
}

async function runCheck(trigger: Trigger) {
  const userId = await ensureNudgeUser();
  if (!userId) return;
  try {
    drainBubbleActions();
    void nudgeStore.flush();
    // Off means off: nothing the phone notices is sent.
    if (!nudgeSettings.enabled()) return;
    const foreground = isForeground();
    const batch = await collectSignals(userId, { foreground, opened: trigger === 'foreground' });
    const nudges = await nudgeApi.check({
      device_id: deviceId(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      signals: batch.signals,
    });
    batch.commit();
    nudgeStore.receive(nudges);
    // A bubble appearing in the app gets a light tap, so it doesn't arrive unnoticed.
    if (nudges.length && isForeground()) haptics.light();
  } finally {
    present();
  }
}

// -------------------------------------------------------------------------------------------------
// What the user does with a bubble
// -------------------------------------------------------------------------------------------------

const snoozeTimers = new Set<ReturnType<typeof setTimeout>>();

/** Dismiss, snooze or mark done (opening goes through `openNudge`). */
export function respond(id: string, action: NudgeAction, snoozeMinutes?: number, reason?: NudgeReason) {
  nudgeStore.act(id, action, snoozeMinutes, reason);
  if (action === 'snoozed') {
    // The server brings it back on the first check after the snooze; make sure there is one.
    const t = setTimeout(() => {
      snoozeTimers.delete(t);
      requestCheck('snooze');
    }, (snoozeMinutes ?? 60) * 60_000 + 5_000);
    snoozeTimers.add(t);
  }
  present();
}

/** Actions taken on the floating bubble, possibly while JS wasn't running. */
function drainBubbleActions() {
  if (!hasNativeAgent || !BaymonAgent || !nudgeStore.isHydrated()) return;
  let actions: BubbleAction[];
  try {
    actions = JSON.parse(BaymonAgent.takeBubbleActions());
  } catch {
    return;
  }
  for (const a of actions) {
    if (a.action === 'opened') nudgeStore.act(a.id, 'opened');
    else respond(a.id, a.action, a.snooze_minutes, a.reason);
  }
}

/**
 * New native signals (a notification, an app opened). They're parked right away; if one is
 * something a reminder waits for, the check happens now rather than at the usual pace.
 */
async function onNativeSignal(type: string) {
  const userId = await ensureNudgeUser();
  if (!userId) return;
  const added = absorbSignals(userId);
  if (added.some((s) => automations.matches(s))) requestCheck('reminder');
  else requestCheck(type === 'screen' ? 'screen' : 'notification');
}

// -------------------------------------------------------------------------------------------------
// Showing bubbles
// -------------------------------------------------------------------------------------------------

const NOTIFICATION_KIND = 'baymon-nudge';
const CHANNEL = 'nudges';
/** No ":" or "-" allowed in category ids. */
const CATEGORY = 'baymon_nudge';

const overlayAllowed = () => {
  try {
    return hasNativeAgent && !!BaymonAgent?.getStatus().overlayAccess;
  } catch {
    return false;
  }
};

function hideOverlay() {
  try {
    if (hasNativeAgent) BaymonAgent?.hideBubbles();
  } catch {}
}

const toBubble = (n: StoredNudge): BubbleSpec => {
  const url = Linking.createURL(`nudge/${encodeURIComponent(n.id)}`);
  return {
    id: n.id,
    label: kindLabel(n.kind),
    urgent: n.urgency === 'high',
    text: n.text,
    expiresAt: Date.parse(n.expires_at),
    url,
    talkUrl: Linking.createURL(`nudge/${encodeURIComponent(n.id)}`, { queryParams: { voice: '1' } }),
    editUrl: Linking.createURL(`nudge/${encodeURIComponent(n.id)}`, { queryParams: { edit: '1' } }),
    draft: n.draft?.text ?? null,
    draftTo: n.draft?.to ?? null,
    // Inline reply needs notification access; the overlay checks the service is there before using it.
    replyKey: n.draft?.reply_key ?? null,
  };
};

/** Puts the current bubbles wherever they belong right now. Cheap; call after any change. */
export function present() {
  if (isWeb) return;
  const live = nudgeSettings.enabled() ? nudgeStore.active() : [];
  const foreground = isForeground();
  // In the app, the in-app bubble takes over from notifications; handled ones are cleared anywhere.
  clearNotifications(nudgeStore.all().filter((n) => n.notificationId && (foreground || !live.includes(n))));
  if (foreground) {
    hideOverlay();
  } else if (overlayAllowed()) {
    try {
      BaymonAgent?.showBubbles(live.slice(0, MAX_VISIBLE).map(toBubble));
    } catch {}
  } else {
    void notify(live);
  }
}

let notificationsSetUp: Promise<void> | null = null;

function setUpNotifications(N: NonNullable<ReturnType<typeof notifications>>) {
  notificationsSetUp ??= Promise.all([
    process.env.EXPO_OS === 'android'
      ? N.setNotificationChannelAsync(CHANNEL, {
          name: 'Baymon speaking up',
          description: 'When Baymon has something to tell you and can’t show its floating bubble.',
          importance: N.AndroidImportance.HIGH,
        })
      : null,
    N.setNotificationCategoryAsync(CATEGORY, [
      { identifier: 'snooze', buttonTitle: 'Snooze 1 hour', options: { opensAppToForeground: false } },
      { identifier: 'dismiss', buttonTitle: 'Dismiss', options: { opensAppToForeground: false } },
    ]),
  ])
    .then(() => undefined)
    .catch(() => {
      notificationsSetUp = null;
    });
  return notificationsSetUp;
}

/** The fallback without the floating bubble: one notification per new bubble. */
async function notify(live: StoredNudge[]) {
  const N = notifications();
  const fresh = live.filter((n) => !n.notified);
  if (!N || !fresh.length) return;
  // Never ask for permission from the background; Settings → Phone access does that.
  if (!(await N.getPermissionsAsync()).granted) return;
  await setUpNotifications(N);
  for (const n of fresh) {
    try {
      const notificationId = await N.scheduleNotificationAsync({
        content: {
          title: kindLabel(n.kind),
          body: n.text,
          data: { kind: NOTIFICATION_KIND, id: n.id },
          categoryIdentifier: CATEGORY,
        },
        trigger: process.env.EXPO_OS === 'android' ? { channelId: CHANNEL } : null,
      });
      nudgeStore.patch(n.id, { notified: true, notificationId });
    } catch {}
  }
}

function clearNotifications(list: StoredNudge[]) {
  const N = notifications();
  if (!N) return;
  for (const n of list) {
    if (!n.notificationId) continue;
    void N.dismissNotificationAsync(n.notificationId).catch(() => {});
    nudgeStore.patch(n.id, { notificationId: undefined });
  }
}

function handleNotificationResponse(response: NotificationResponse) {
  const data = response.notification.request.content.data as { kind?: string; id?: unknown } | undefined;
  if (data?.kind !== NOTIFICATION_KIND || typeof data.id !== 'string') return;
  const N = notifications();
  void N?.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
  void N?.clearLastNotificationResponseAsync().catch(() => {});
  if (response.actionIdentifier === 'snooze') respond(data.id, 'snoozed', 60);
  else if (response.actionIdentifier === 'dismiss') respond(data.id, 'dismissed');
  else void openNudge(data.id).then((opened) => opened && goHome());
}

/** The chat is on the home screen. */
export function goHome() {
  try {
    router.navigate('/');
  } catch {}
}

// -------------------------------------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------------------------------------

/**
 * Starts speaking up for the signed-in user: restores bubbles, checks, and listens for app
 * foreground, native signals, bubble actions and notification taps. Returns a stop function
 * (for sign-out).
 */
export function startNudges(): () => void {
  if (isWeb) return () => {};
  let stopped = false;

  void (async () => {
    const userId = await ensureNudgeUser();
    if (!userId || stopped) return;
    syncNativeSources();
    void nudgeSettings.load();
    setBackgroundCheck(true);
    automations.hydrate();
    void automations.load();
    void syncGeofences();
    drainBubbleActions();
    // Restore before checking, so a bubble the check returns isn't mistaken for a stale one.
    const server = await nudgeApi.active().catch(() => null);
    if (stopped) return;
    if (server) nudgeStore.restore(server);
    present();
    const launch = notifications()?.getLastNotificationResponse();
    if (launch) handleNotificationResponse(launch);
    void checkNow('foreground');
  })();

  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      drainBubbleActions();
      present();
      requestCheck('foreground');
      automations.refresh(5 * 60_000);
      // Permissions may have changed in Settings (e.g. location "Allow all the time").
      void syncGeofences();
    } else if (s === 'background') {
      present();
    }
  });
  const nativeSubs =
    hasNativeAgent && BaymonAgent
      ? [
          BaymonAgent.addListener('onSignal', ({ type }) => void onNativeSignal(type)),
          BaymonAgent.addListener('onBubbleAction', () => drainBubbleActions()),
        ]
      : [];
  const responses = notifications()?.addNotificationResponseReceivedListener(handleNotificationResponse);

  return () => {
    stopped = true;
    appState.remove();
    nativeSubs.forEach((s) => s.remove());
    responses?.remove();
    if (timer) clearTimeout(timer);
    timer = null;
    timerAt = Infinity;
    snoozeTimers.forEach(clearTimeout);
    snoozeTimers.clear();
    hideOverlay();
    setBackgroundCheck(false);
    nudgeStore.reset();
    nudgeSettings.reset();
    automations.reset();
  };
}

// -------------------------------------------------------------------------------------------------
// Background refresh (~15 minutes, when the OS allows)
// -------------------------------------------------------------------------------------------------

const BACKGROUND_TASK = 'baymon-nudges-check';

// Defined at import time: the OS can start the app without any UI just to run this.
if (!isWeb) {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    try {
      await checkNow('background');
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

// Arriving at or leaving a saved place: report it now (reminders like "when I get to the office").
if (!isWeb) {
  TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
    GEOFENCE_TASK,
    async ({ data, error }) => {
      if (error || !data?.region?.identifier) return;
      const userId = await ensureNudgeUser();
      if (!userId) return;
      absorbSignals(userId, [
        {
          type: 'location',
          at: localIso(),
          data: {
            label: data.region.identifier,
            event: data.eventType === Location.GeofencingEventType.Exit ? 'exit' : 'enter',
            saved: true,
          },
        },
      ]);
      await checkNow('place');
    }
  );
}

/** Registration changes run in order, so a quick stop-then-start can't end up unregistered. */
let registration = Promise.resolve();

function setBackgroundCheck(on: boolean) {
  registration = registration.then(async () => {
    try {
      const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
      if (on && !registered) {
        if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
        await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
      } else if (!on && registered) {
        await BackgroundTask.unregisterTaskAsync(BACKGROUND_TASK);
      }
    } catch {}
  });
}
