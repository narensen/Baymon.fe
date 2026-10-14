import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { RichText } from '@/components/chat/rich/rich-text';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing, Springs } from '@/constants/theme';
import type { ChatMessage } from '@/lib/conversation';

const enter = FadeInDown.springify().damping(Springs.snappy.damping).stiffness(Springs.snappy.stiffness);

type Props = {
  message: ChatMessage;
  /** This message's audio is playing / being generated. */
  audio: 'idle' | 'loading' | 'playing';
  onToggleAudio: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  /** Present only on the latest reply: tapping a suggested follow-up sends it. */
  onSuggest?: (text: string) => void;
};

export function MessageRow({ message, audio, onToggleAudio, onRetry, onSuggest }: Props) {
  const fresh = !!message.isNew;
  if (message.role === 'user') {
    const failed = message.status === 'error';
    return (
      <Animated.View entering={fresh ? enter : undefined} style={styles.userRow}>
        <View style={[styles.bubble, failed && styles.bubbleFailed]}>
          <Text selectable tone="inverse" style={styles.userText}>
            {message.content}
          </Text>
        </View>
        {message.viaVoice && !failed ? (
          <View style={styles.meta}>
            <Icon name="mic" size={11} color={Colors.textFaint} />
            <Text variant="caption" tone="faint">
              Spoken
            </Text>
          </View>
        ) : null}
        {failed ? (
          <Animated.View entering={FadeIn}>
            <Pressable hitSlop={8} onPress={() => onRetry(message)} style={styles.meta}>
              <Text variant="caption" tone="danger">
                {message.error ?? 'Not sent'} ·
              </Text>
              <Icon name="retry" size={12} color={Colors.text} />
              <Text variant="caption" style={styles.retry}>
                Retry
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={fresh ? enter : undefined} style={styles.assistantRow}>
      <RichText text={message.content} onSuggest={onSuggest} animate={fresh} />
      {message.warnings?.map((w) => (
        <Text key={w} variant="caption" tone="faint">
          {w}
        </Text>
      ))}
      <View style={styles.actions}>
        <PressableScale
          scaleTo={0.9}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={audio === 'playing' ? 'Stop reading aloud' : 'Read aloud'}
          onPress={() => onToggleAudio(message)}
          style={[styles.action, audio !== 'idle' && styles.actionActive]}>
          {audio === 'loading' ? (
            <ActivityIndicator size="small" color={Colors.textMuted} style={styles.spinner} />
          ) : (
            <Icon name={audio === 'playing' ? 'stop' : 'speaker'} size={14} color={Colors.textMuted} />
          )}
        </PressableScale>
      </View>
    </Animated.View>
  );
}

/** Three dots breathing in sequence while the agent works. */
export function TypingIndicator() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withSequence(withTiming(1, { duration: 900 }), withDelay(100, withTiming(0, { duration: 0 }))), -1));
  }, [t]);

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.typing} accessibilityLabel="Baymon is thinking">
      {[0, 1, 2].map((i) => (
        <Dot key={i} t={t} index={i} />
      ))}
    </Animated.View>
  );
}

function Dot({ t, index }: { t: SharedValue<number>; index: number }) {
  const style = useAnimatedStyle(() => {
    // Each dot peaks a third of a cycle after the previous one.
    const phase = (t.get() + 1 - index / 3) % 1;
    const wave = Math.sin(phase * Math.PI);
    return {
      opacity: interpolate(wave, [0, 1], [0.25, 1]),
      transform: [{ translateY: interpolate(wave, [0, 1], [0, -3]) }],
    };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', gap: Spacing.one, paddingLeft: Spacing.seven },
  bubble: {
    backgroundColor: Colors.text,
    borderRadius: Radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  bubbleFailed: { opacity: 0.55 },
  userText: { fontSize: 16, lineHeight: 22 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.one },
  retry: { fontWeight: '600' },
  assistantRow: { gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionActive: { backgroundColor: Colors.surfaceRaised },
  spinner: { transform: [{ scale: 0.7 }] },
  typing: { flexDirection: 'row', gap: 6, paddingVertical: Spacing.three },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.textMuted },
});
