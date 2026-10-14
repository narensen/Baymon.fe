import { useLayoutEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';

import { TalkView } from '@/components/chat/talk-view';
import { TypeView } from '@/components/chat/type-view';
import { DrawerScreen } from '@/components/drawer-screen';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Colors, Spacing } from '@/constants/theme';
import { conversation, useConversation } from '@/lib/conversation';
import { useAuth } from '@/providers/auth-provider';

export default function HomeScreen() {
  const { session } = useAuth();
  const { mode, messages } = useConversation();
  const userId = session?.user.id;

  // Before paint, so the saved conversation appears on the first frame.
  useLayoutEffect(() => {
    if (userId) conversation.hydrate(userId);
  }, [userId]);

  return (
    <DrawerScreen
      right={
        <View style={styles.actions}>
          {messages.length > 0 && (
            <Animated.View entering={ZoomIn.springify().damping(16)} exiting={ZoomOut.duration(120)}>
              <HeaderButton icon="compose" label="New conversation" onPress={() => conversation.clear()} />
            </Animated.View>
          )}
          <HeaderButton
            icon={mode === 'talk' ? 'keyboard' : 'waveform'}
            label={mode === 'talk' ? 'Switch to typing' : 'Switch to voice'}
            active={mode === 'talk'}
            onPress={() => conversation.setMode(mode === 'talk' ? 'type' : 'talk')}
          />
        </View>
      }>
      <Animated.View key={mode} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={styles.flex}>
        {mode === 'talk' ? <TalkView /> : <TypeView />}
      </Animated.View>
    </DrawerScreen>
  );
}

type HeaderButtonProps = {
  icon: 'compose' | 'keyboard' | 'waveform';
  label: string;
  active?: boolean;
  onPress: () => void;
};

function HeaderButton({ icon, label, active = false, onPress }: HeaderButtonProps) {
  return (
    <PressableScale
      haptic
      scaleTo={0.88}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, active && styles.buttonActive]}>
      <Icon name={icon} size={18} color={active ? Colors.inverse : Colors.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  buttonActive: { backgroundColor: Colors.text, borderColor: Colors.text },
});
