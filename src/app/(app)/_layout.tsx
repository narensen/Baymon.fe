import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { NudgeBubbles } from '@/components/nudge-bubbles';
import { Colors, Radius } from '@/constants/theme';
import { conversation } from '@/lib/conversation';
import { registerDevice } from '@/lib/device';
import { memoryStore } from '@/lib/memory';
import { startNudges } from '@/lib/nudges/engine';
import { startQuickAccess } from '@/lib/quick-access';
import { startUpdateChecks } from '@/lib/updates';

export default function AppLayout() {
  // Tell the backend which tools this phone has; re-check on return (permissions may have changed).
  useEffect(() => {
    void registerDevice();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void registerDevice());
    return () => sub.remove();
  }, []);

  // Baymon speaking up on its own; stops (and forgets) on sign-out.
  useEffect(() => startNudges(), []);

  // Share sheet, assistant gesture and wake word.
  useEffect(() => startQuickAccess(), []);

  // Over-the-air updates: also check when coming back to the app.
  useEffect(() => startUpdateChecks(), []);

  // This group unmounts on sign-out; drop the previous user's in-memory data with it.
  useEffect(
    () => () => {
      memoryStore.reset();
      conversation.reset();
    },
    []
  );

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen
          name="memory/[id]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.65, 0.95],
            sheetGrabberVisible: true,
            sheetCornerRadius: Radius.xl,
            contentStyle: { backgroundColor: Colors.surface },
          }}
        />
        <Stack.Screen
          name="share"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.75, 0.95],
            sheetGrabberVisible: true,
            sheetCornerRadius: Radius.xl,
            contentStyle: { backgroundColor: Colors.surface },
          }}
        />
      </Stack>
      <NudgeBubbles />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
