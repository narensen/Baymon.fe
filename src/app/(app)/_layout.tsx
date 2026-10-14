import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { Colors, Radius } from '@/constants/theme';
import { conversation } from '@/lib/conversation';
import { memoryStore } from '@/lib/memory';

export default function AppLayout() {
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
