import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { conversation } from '@/lib/conversation';
import { registerDevice } from '@/lib/device';
import { memoryStore } from '@/lib/memory';

export default function AppLayout() {
  // Tell the backend which tools this phone has; re-check on return (permissions may have changed).
  useEffect(() => {
    void registerDevice();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void registerDevice());
    return () => sub.remove();
  }, []);

  // This group unmounts on sign-out; drop the previous user's in-memory data with it.
  useEffect(
    () => () => {
      memoryStore.reset();
      conversation.reset();
    },
    []
  );

  return (
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
    </Stack>
  );
}
