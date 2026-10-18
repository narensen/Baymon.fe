import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { checkForAppUpdate } from '@/lib/updates';

const restart = () => {
  haptics.medium();
  void Updates.reloadAsync().catch(() => {});
};

/** Settings → App: what's running, and checking for an over-the-air update. */
export function AppUpdates() {
  const { currentlyRunning, isUpdatePending, isChecking, isDownloading, checkError, downloadError } = Updates.useUpdates();
  const [result, setResult] = useState<string | null>(null);
  const busy = isChecking || isDownloading;

  async function check() {
    haptics.selection();
    setResult(null);
    try {
      const outcome = await checkForAppUpdate({ force: true });
      setResult(outcome === 'none' ? 'You’re up to date.' : null);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Couldn’t check for updates');
    }
  }

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'Built in'
    : currentlyRunning.createdAt
      ? `Update from ${currentlyRunning.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${currentlyRunning.createdAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Update';
  const error = checkError?.message ?? downloadError?.message;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Info label="Version" value={Constants.expoConfig?.version ?? '—'} />
        <View style={styles.divider} />
        <Info label="Running" value={Updates.isEnabled ? running : 'Development build'} />
        {currentlyRunning.channel ? (
          <>
            <View style={styles.divider} />
            <Info label="Channel" value={currentlyRunning.channel} />
          </>
        ) : null}
        {currentlyRunning.updateId ? (
          <>
            <View style={styles.divider} />
            <Info label="Update" value={currentlyRunning.updateId.slice(0, 8)} mono />
          </>
        ) : null}
      </View>

      {!Updates.isEnabled ? (
        <Text variant="caption" tone="faint" style={styles.note}>
          Updates are off in development builds. A preview build gets them automatically.
        </Text>
      ) : isUpdatePending ? (
        <Animated.View entering={FadeIn}>
          <PressableScale accessibilityRole="button" onPress={restart} style={[styles.button, styles.primary]}>
            <Icon name="download" size={16} color={Colors.inverse} />
            <Text variant="label" tone="inverse">
              Restart to update
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <PressableScale accessibilityRole="button" disabled={busy} onPress={check} style={styles.button}>
          {busy ? <ActivityIndicator size="small" color={Colors.textMuted} /> : <Icon name="retry" size={16} color={Colors.text} />}
          <Text variant="label">{isDownloading ? 'Downloading…' : isChecking ? 'Checking…' : 'Check for updates'}</Text>
        </PressableScale>
      )}
      {result || error ? (
        <Text variant="caption" tone={error ? 'danger' : 'faint'} style={styles.note}>
          {error ?? result}
        </Text>
      ) : null}
    </View>
  );
}

/** A small "Update ready" row for the drawer, shown only when one is downloaded. */
export function UpdateReady() {
  const { isUpdatePending } = Updates.useUpdates();
  if (!Updates.isEnabled || !isUpdatePending) return null;
  return (
    <Animated.View entering={FadeIn}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Restart to update" onPress={restart} style={styles.ready}>
        <Icon name="download" size={17} color={Colors.text} />
        <Text variant="label">Update ready · Restart</Text>
      </PressableScale>
    </Animated.View>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text tone="muted">{label}</Text>
      <Text numberOfLines={1} style={[styles.value, mono && styles.mono]}>
        {value}
      </Text>
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
  row: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.four },
  value: { flexShrink: 1, textAlign: 'right' },
  mono: { fontVariant: ['tabular-nums'], letterSpacing: 0.5 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  note: { paddingHorizontal: Spacing.one },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  primary: { backgroundColor: Colors.text, borderColor: Colors.text },
  ready: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    height: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    marginBottom: Spacing.two,
  },
});
