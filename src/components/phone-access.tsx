import * as Calendar from 'expo-calendar';
import { getPermissionsAsync as getContactsPermission, requestPermissionsAsync as requestContactsPermission } from 'expo-contacts';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { BaymonAgent, type SettingsPage } from '@/modules/baymon-agent';
import { registerDevice } from '@/lib/device';
import { haptics } from '@/lib/haptics';
import { notifications } from '@/lib/notifications';
import { hasNativeAgent } from '@/lib/tools/native';

type Permission = { granted: boolean; canAskAgain?: boolean };

type Row = {
  key: string;
  title: string;
  detail: string;
  /** Shown while off, e.g. how to get past a greyed-out switch. */
  hint?: string;
  native?: boolean;
  get: () => Promise<boolean>;
  /** Opens a system page or asks for a runtime permission. */
  enable: () => Promise<void>;
};

const systemPage = (page: SettingsPage) => async () => BaymonAgent?.openSystemSettings(page);

/** Ask; if Android won't ask again, send the user to the app's settings page instead. */
const runtime = (request: () => Promise<Permission>) => async () => {
  const result = await request();
  if (!result.granted && result.canAskAgain === false) await Linking.openSettings();
};

const ROWS: Row[] = [
  {
    key: 'screen',
    title: 'Screen control',
    detail: 'Read the screen and tap, type and scroll in other apps.',
    hint: 'Settings → Accessibility → Baymon. Greyed out? App info → ⋮ → Allow restricted settings, then try again.',
    native: true,
    get: async () => BaymonAgent?.getStatus().screenAccess ?? false,
    enable: systemPage('accessibility'),
  },
  {
    key: 'notification_access',
    title: 'Notification access',
    detail: 'Read notifications and reply to messages without opening apps.',
    native: true,
    get: async () => BaymonAgent?.getStatus().notificationAccess ?? false,
    enable: systemPage('notification_access'),
  },
  {
    key: 'files',
    title: 'All files',
    detail: 'Find documents anywhere on the phone to send or open.',
    native: true,
    get: async () => BaymonAgent?.getStatus().allFilesAccess ?? false,
    enable: systemPage('all_files'),
  },
  {
    key: 'notifications',
    title: 'Notifications',
    detail: 'Reminders, and Baymon letting you know things.',
    get: async () => (await notifications()?.getPermissionsAsync())?.granted ?? false,
    enable: runtime(async () => (await notifications()?.requestPermissionsAsync()) ?? { granted: false }),
  },
  {
    key: 'contacts',
    title: 'Contacts',
    detail: 'Call, text or email people by name.',
    get: async () => (await getContactsPermission()).granted,
    enable: runtime(requestContactsPermission),
  },
  {
    key: 'calendar',
    title: 'Calendar',
    detail: 'Check your schedule and add events.',
    get: async () => (await Calendar.getCalendarPermissions()).granted,
    enable: runtime(() => Calendar.requestCalendarPermissions()),
  },
  {
    key: 'location',
    title: 'Location',
    detail: 'Directions and places near you.',
    get: async () => (await Location.getForegroundPermissionsAsync()).granted,
    enable: runtime(Location.requestForegroundPermissionsAsync),
  },
];

/** What Baymon is allowed to do on this phone, with one tap to turn each thing on. */
export function PhoneAccess() {
  const rows = ROWS.filter((r) => !r.native || hasNativeAgent);
  const [granted, setGranted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const entries = await Promise.all(rows.map(async (r) => [r.key, await r.get().catch(() => false)] as const));
      if (cancelled) return;
      setGranted(Object.fromEntries(entries));
      // Tell the backend what changed (e.g. screen control was just switched on).
      void registerDevice();
    }
    void refresh();
    // System settings pages return here: re-check when the app comes back.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => {
      cancelled = true;
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      {!hasNativeAgent ? (
        <Text variant="caption" tone="faint" style={styles.note}>
          Screen control, file search and notification access need the Baymon development build on Android.
        </Text>
      ) : null}
      <View style={styles.card}>
        {rows.map((row, i) => {
          const on = granted[row.key];
          return (
            <View key={row.key}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text>{row.title}</Text>
                  <Text variant="caption" tone="faint">
                    {row.detail}
                  </Text>
                  {on === false && row.hint ? (
                    <Animated.View entering={FadeIn}>
                      <Text variant="caption" tone="muted" style={styles.hint}>
                        {row.hint}
                      </Text>
                    </Animated.View>
                  ) : null}
                </View>
                {on ? (
                  <View style={styles.on}>
                    <Text variant="caption" tone="success" style={styles.bold}>
                      On
                    </Text>
                  </View>
                ) : (
                  <PressableScale
                    scaleTo={0.92}
                    accessibilityRole="button"
                    accessibilityLabel={`Turn on ${row.title}`}
                    onPress={() => {
                      haptics.selection();
                      void row.enable();
                    }}
                    style={styles.enable}>
                    <Text variant="caption" tone="inverse" style={styles.bold}>
                      Turn on
                    </Text>
                  </PressableScale>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  note: { paddingHorizontal: Spacing.one },
  card: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.three + 2 },
  rowText: { flex: 1, gap: 2 },
  hint: { marginTop: Spacing.one },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  on: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(91, 185, 139, 0.12)',
  },
  enable: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.text,
  },
  bold: { fontWeight: '600' },
});
