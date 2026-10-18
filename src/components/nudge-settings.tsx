import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { BaymonAgent } from '@/modules/baymon-agent';
import { haptics } from '@/lib/haptics';
import { historyApi } from '@/lib/history';
import type { NudgeSettings as Settings } from '@/lib/nudges/api';
import {
  NUDGE_DEFAULTS,
  nudgeSettings,
  signalSources,
  useNudgeSettings,
  useSignalSources,
  type SignalSource,
} from '@/lib/nudges/settings';
import { syncGeofences } from '@/lib/places';
import { readJSON, writeJSON } from '@/lib/storage';
import { dateFromHHMM, formatClock, toHHMM } from '@/lib/time';
import { hasNativeAgent } from '@/lib/tools/native';

type TimeKey = 'quiet_start' | 'quiet_end' | 'morning_brief' | 'evening_wrap' | 'weekly_review';

/** Times from before a part was switched off, so switching it back on restores them. */
const LAST_TIMES_KEY = 'baymon.nudges.last-times';

/** When Baymon may speak up on its own, and what the phone shares to decide. */
export function NudgeSettings() {
  const { value, status, error } = useNudgeSettings();
  const settings = value ?? NUDGE_DEFAULTS;

  useEffect(() => {
    void nudgeSettings.load();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Row
          title="Baymon can speak up"
          detail="A short bubble when something needs you: a reminder, a heads-up, something that doesn’t add up."
          right={
            <Switch
              value={settings.enabled}
              onValueChange={(enabled) => nudgeSettings.update({ enabled })}
              accessibilityLabel="Baymon can speak up"
            />
          }
        />
      </View>

      {!value && status === 'loading' ? (
        <Text variant="caption" tone="faint" style={styles.note}>
          Loading…
        </Text>
      ) : settings.enabled ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.container}>
          <View style={styles.card}>
            <TimeRow title="Quiet hours" detail="Only urgent things get through." keys={['quiet_start', 'quiet_end']} settings={settings} />
            <View style={styles.divider} />
            <TimeRow title="Morning brief" detail="An overview of your day." keys={['morning_brief']} settings={settings} />
            <View style={styles.divider} />
            <TimeRow
              title="Evening wrap-up"
              detail="What got done, and what’s tomorrow."
              keys={['evening_wrap']}
              settings={settings}
            />
            <View style={styles.divider} />
            <Row
              title="Save small things for the wrap-up"
              detail="Low-priority things wait for the evening instead of a bubble each."
              right={
                <Switch
                  value={settings.digest ?? NUDGE_DEFAULTS.digest!}
                  onValueChange={(digest) => nudgeSettings.update({ digest })}
                  accessibilityLabel="Save small things for the wrap-up"
                />
              }
            />
            <View style={styles.divider} />
            <WeeklyReview settings={settings} />
          </View>

          <Text variant="overline" tone="faint" style={styles.subhead}>
            What Baymon notices
          </Text>
          <Sources />
          <Text variant="caption" tone="faint" style={styles.note}>
            Only what’s switched on leaves this phone. It goes to your Baymon server and its AI provider to decide whether
            to speak up, and into your history if that’s on. One-time codes in notifications are hidden; on screen,
            sign-in pages and what you type are skipped.
          </Text>

          <Text variant="overline" tone="faint" style={styles.subhead}>
            History
          </Text>
          <History />
        </Animated.View>
      ) : null}

      {error ? <Notice key={error} text={error} /> : null}
    </View>
  );
}

function Row({ title, detail, right, children }: { title: string; detail: string; right: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text>{title}</Text>
        <Text variant="caption" tone="faint">
          {detail}
        </Text>
        {children}
      </View>
      {right}
    </View>
  );
}

// -------------------------------------------------------------------------------------------------
// Times
// -------------------------------------------------------------------------------------------------

function TimeRow({
  title,
  detail,
  keys,
  settings,
  children,
}: {
  title: string;
  detail: string;
  keys: TimeKey[];
  settings: Settings;
  /** Extra controls shown while it's on (e.g. the weekly review's day). */
  children?: ReactNode;
}) {
  // A setting the server doesn't send yet counts as its default.
  const time = (k: TimeKey) => (k in settings ? settings[k] : NUDGE_DEFAULTS[k]) ?? null;
  const on = keys.every((k) => time(k) !== null);

  function toggle(next: boolean) {
    const last = readJSON<Partial<Record<TimeKey, string>>>(LAST_TIMES_KEY) ?? {};
    if (!next) writeJSON(LAST_TIMES_KEY, { ...last, ...Object.fromEntries(keys.map((k) => [k, time(k)])) });
    // `null` turns it off on the server.
    nudgeSettings.update(Object.fromEntries(keys.map((k) => [k, next ? (last[k] ?? NUDGE_DEFAULTS[k]) : null])));
  }

  return (
    <Row title={title} detail={detail} right={<Switch value={on} onValueChange={toggle} accessibilityLabel={title} />}>
      {on ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.times}>
          {keys.map((k, i) => (
            <Fragment key={k}>
              {i > 0 ? (
                <Text variant="caption" tone="faint">
                  to
                </Text>
              ) : null}
              <TimeButton
                value={time(k) ?? NUDGE_DEFAULTS[k]!}
                label={keys.length > 1 ? `${title} ${i === 0 ? 'start' : 'end'}` : title}
                onChange={(time) => nudgeSettings.update({ [k]: time })}
              />
            </Fragment>
          ))}
        </Animated.View>
      ) : null}
      {on ? children : null}
    </Row>
  );
}

/** A time pill. Android opens the system time dialog; iOS shows its compact picker in place. */
function TimeButton({ value, label, onChange }: { value: string; label: string; onChange: (time: string) => void }) {
  const [picking, setPicking] = useState(false);

  if (process.env.EXPO_OS === 'ios') {
    return (
      <DateTimePicker
        value={dateFromHHMM(value)}
        mode="time"
        display="compact"
        themeVariant="dark"
        accentColor={Colors.text}
        onValueChange={(_e, date) => onChange(toHHMM(date))}
      />
    );
  }

  return (
    <>
      <PressableScale
        scaleTo={0.94}
        disabled={process.env.EXPO_OS !== 'android'}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatClock(value)}`}
        accessibilityHint="Changes the time"
        onPress={() => {
          haptics.selection();
          setPicking(true);
        }}
        style={styles.time}>
        <Text variant="label">{formatClock(value)}</Text>
      </PressableScale>
      {picking ? (
        <DateTimePicker
          value={dateFromHHMM(value)}
          mode="time"
          presentation="dialog"
          onValueChange={(_e, date) => {
            setPicking(false);
            onChange(toHHMM(date));
          }}
          onDismiss={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** A weekly look back: what got done, what's open, anything recurring. Day is ISO (1 = Monday). */
function WeeklyReview({ settings }: { settings: Settings }) {
  const day = settings.weekly_review_day ?? NUDGE_DEFAULTS.weekly_review_day!;
  return (
    <TimeRow title="Weekly review" detail="What got done, what’s still open, and anything that keeps coming up." keys={['weekly_review']} settings={settings}>
      <View style={styles.days}>
        {DAYS.map((d, i) => {
          const selected = day === i + 1;
          return (
            <PressableScale
              key={i}
              scaleTo={0.9}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={DAY_NAMES[i]}
              onPress={() => {
                haptics.selection();
                nudgeSettings.update({ weekly_review_day: i + 1 });
              }}
              style={[styles.day, selected && styles.daySelected]}>
              <Text variant="caption" tone={selected ? 'inverse' : 'muted'} style={styles.dayText}>
                {d}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </TimeRow>
  );
}

// -------------------------------------------------------------------------------------------------
// History (searchable on the server)
// -------------------------------------------------------------------------------------------------

const RETENTION = ['off', '30 days', '90 days', '1 year'] as const;
const RETENTION_DAYS: Record<(typeof RETENTION)[number], number> = { off: 0, '30 days': 30, '90 days': 90, '1 year': 365 };

function History() {
  /** undefined while loading; null when the server doesn't keep a history yet. */
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyApi
      .retention()
      .then(setDays)
      .catch(() => setDays(null));
  }, []);

  const option = RETENTION.find((o) => RETENTION_DAYS[o] === days) ?? (days ? '90 days' : 'off');

  async function choose(next: (typeof RETENTION)[number]) {
    const previous = days;
    setDays(RETENTION_DAYS[next]);
    setError(null);
    try {
      setDays(await historyApi.setRetention(RETENTION_DAYS[next]));
    } catch (e) {
      setDays(previous);
      setError(e instanceof Error ? e.message : 'Couldn’t change that');
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your history?',
      'Everything Baymon noticed (notifications, screen excerpts, places) is deleted from your server. Your memories stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void historyApi
              .clear()
              .then(() => haptics.success())
              .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t delete it')),
        },
      ]
    );
  }

  if (days === undefined) return null;
  if (days === null) {
    return (
      <Text variant="caption" tone="faint" style={styles.note}>
        Searchable history (“what did Arjun say about the report last week?”) needs the backend update.
      </Text>
    );
  }
  return (
    <View style={styles.container}>
      <Text variant="caption" tone="faint" style={styles.note}>
        Keep what Baymon noticed so you can ask about it later.
      </Text>
      <SegmentedControl options={RETENTION} value={option} onChange={choose} />
      {days > 0 ? (
        <PressableScale scaleTo={0.97} accessibilityRole="button" onPress={confirmDelete} style={styles.deleteHistory}>
          <Text variant="caption" tone="danger" style={styles.bold}>
            Delete history
          </Text>
        </PressableScale>
      ) : null}
      {error ? <Notice key={error} text={error} /> : null}
    </View>
  );
}

// -------------------------------------------------------------------------------------------------
// What the phone shares
// -------------------------------------------------------------------------------------------------

type Permission = { granted: boolean; canAskAgain?: boolean };

/** Ask; if Android won't ask again, open the app's settings page instead. */
const runtime = (request: () => Promise<Permission>) => async () => {
  const result = await request();
  if (!result.granted && result.canAskAgain === false) await Linking.openSettings();
};

type SourceRow = {
  key: SignalSource;
  title: string;
  detail: string;
  native?: boolean;
  allowed: () => Promise<boolean>;
  allow: () => Promise<void>;
  /** Shown when the switch is on but the permission is off. */
  missing?: string;
};

const SOURCE_ROWS: SourceRow[] = [
  {
    key: 'notifications',
    title: 'Notifications',
    detail: 'New notifications: the app, title and text.',
    native: true,
    allowed: async () => BaymonAgent?.getStatus().notificationAccess ?? false,
    allow: async () => BaymonAgent?.openSystemSettings('notification_access'),
    missing: 'Needs notification access. Tap to allow.',
  },
  {
    key: 'calendar',
    title: 'Calendar',
    detail: 'Upcoming events, and when they move or get cancelled.',
    allowed: async () => (await Calendar.getCalendarPermissions()).granted,
    allow: runtime(() => Calendar.requestCalendarPermissions()),
    missing: 'Needs calendar access. Tap to allow.',
  },
  {
    key: 'battery',
    title: 'Battery',
    detail: 'When it’s running low.',
    allowed: async () => true,
    allow: async () => {},
  },
  {
    key: 'location',
    title: 'Location',
    detail: 'The name of the place you’re at, when it changes. Never coordinates, and only while Baymon is open.',
    allowed: async () => (await Location.getForegroundPermissionsAsync()).granted,
    allow: runtime(Location.requestForegroundPermissionsAsync),
    missing: 'Needs location access. Tap to allow.',
  },
  {
    key: 'places',
    title: 'Saved places',
    detail: 'Arriving at and leaving places you’ve saved (by name, never coordinates), for “when I get to the office” reminders.',
    allowed: async () => (await Location.getBackgroundPermissionsAsync()).granted,
    allow: async () => {
      await runtime(Location.requestBackgroundPermissionsAsync)();
      await syncGeofences();
    },
    missing: 'Needs location “Allow all the time”. Tap to allow.',
  },
  {
    key: 'screen',
    title: 'Screen',
    detail: 'The app you switch to and a short excerpt of its text.',
    native: true,
    allowed: async () => BaymonAgent?.getStatus().screenAccess ?? false,
    allow: async () => BaymonAgent?.openSystemSettings('accessibility'),
    missing: 'Needs screen control. Tap to allow.',
  },
];

const ROWS = SOURCE_ROWS.filter((r) => !r.native || hasNativeAgent);

function Sources() {
  const sources = useSignalSources();
  const [allowed, setAllowed] = useState<Partial<Record<SignalSource, boolean>>>({});
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const entries = await Promise.all(ROWS.map(async (r) => [r.key, await r.allowed().catch(() => false)] as const));
      if (!cancelled) setAllowed(Object.fromEntries(entries));
    }
    void refresh();
    // System settings pages return here: re-check when the app comes back.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [checks]);

  async function allow(row: SourceRow) {
    await row.allow().catch(() => {});
    setChecks((n) => n + 1);
  }

  return (
    <View style={styles.card}>
      {ROWS.map((row, i) => {
        const on = sources[row.key];
        return (
          <View key={row.key}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <Row
              title={row.title}
              detail={row.detail}
              right={
                <Switch
                  value={on}
                  accessibilityLabel={`Baymon notices ${row.title.toLowerCase()}`}
                  onValueChange={(next) => {
                    signalSources.set({ [row.key]: next });
                    if (row.key === 'places') void syncGeofences();
                    if (next && allowed[row.key] === false) void allow(row);
                  }}
                />
              }>
              {on && allowed[row.key] === false && row.missing ? (
                <PressableScale scaleTo={0.97} accessibilityRole="button" onPress={() => void allow(row)} style={styles.missing}>
                  <Text variant="caption" tone="danger">
                    {row.missing}
                  </Text>
                </PressableScale>
              ) : null}
            </Row>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  card: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.three + 2 },
  rowText: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  times: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  time: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfacePressed,
  },
  missing: { marginTop: Spacing.one, alignSelf: 'flex-start' },
  days: { flexDirection: 'row', gap: Spacing.one + 2, marginTop: Spacing.two },
  day: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfacePressed,
  },
  daySelected: { backgroundColor: Colors.text },
  dayText: { fontWeight: '600' },
  deleteHistory: { alignSelf: 'flex-start', paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
  bold: { fontWeight: '600' },
  subhead: { paddingHorizontal: Spacing.one, marginTop: Spacing.two },
  note: { paddingHorizontal: Spacing.one },
});
