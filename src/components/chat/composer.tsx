import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  ZoomIn,
  ZoomOut,
  type SharedValue,
} from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { MESSAGE_MAX_CHARS } from '@/lib/agent';

export type Dictation = 'idle' | 'listening' | 'transcribing';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onMic: () => void;
  dictation: Dictation;
  level: SharedValue<number>;
  busy: boolean;
};

export function Composer({ value, onChangeText, onSend, onMic, dictation, level, busy }: Props) {
  const hasText = value.trim().length > 0;
  const listening = dictation === 'listening';

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, listening && styles.fieldActive]}>
        {listening ? (
          <Animated.View key="wave" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.listening}>
            <Waveform level={level} />
            <Text variant="caption" tone="muted">
              Listening… tap to finish
            </Text>
          </Animated.View>
        ) : (
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={dictation === 'transcribing' ? 'Transcribing…' : 'Message Baymon'}
            placeholderTextColor={Colors.textFaint}
            selectionColor={Colors.text}
            cursorColor={Colors.text}
            keyboardAppearance="dark"
            multiline
            maxLength={MESSAGE_MAX_CHARS}
            editable={dictation === 'idle'}
            submitBehavior="newline"
            style={styles.input}
          />
        )}

        <View style={styles.trailing}>
          {hasText && !listening ? (
            <Animated.View key="send" entering={ZoomIn.springify().damping(16)} exiting={ZoomOut.duration(120)}>
              <PressableScale
                haptic
                scaleTo={0.88}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Send"
                onPress={onSend}
                style={[styles.send, busy && styles.sendBusy]}>
                <Icon name="send" size={17} color={Colors.inverse} />
              </PressableScale>
            </Animated.View>
          ) : (
            <Animated.View key="mic" entering={ZoomIn.springify().damping(16)} exiting={ZoomOut.duration(120)}>
              <PressableScale
                haptic
                scaleTo={0.88}
                disabled={dictation === 'transcribing'}
                accessibilityRole="button"
                accessibilityLabel={listening ? 'Finish dictation' : 'Dictate'}
                onPress={onMic}
                style={[styles.mic, listening && styles.micActive]}>
                {dictation === 'transcribing' ? (
                  <ActivityIndicator size="small" color={Colors.textMuted} />
                ) : (
                  <Icon name={listening ? 'stop' : 'mic'} size={17} color={listening ? Colors.inverse : Colors.textMuted} />
                )}
              </PressableScale>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

const BARS = [0.55, 0.85, 1, 0.7, 0.95, 0.6, 0.8, 0.5, 0.9, 0.65, 0.75, 0.45];

/** Bars follow the mic level; each has its own spring so the motion feels organic, not mechanical. */
function Waveform({ level }: { level: SharedValue<number> }) {
  return (
    <View style={styles.wave}>
      {BARS.map((weight, i) => (
        <Bar key={i} level={level} weight={weight} stiffness={180 + i * 23} />
      ))}
    </View>
  );
}

function Bar({ level, weight, stiffness }: { level: SharedValue<number>; weight: number; stiffness: number }) {
  const smooth = useDerivedValue(() => withSpring(level.get() * weight, { damping: 14, stiffness }));
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(smooth.get(), [0, 1], [0.15, 1], 'clamp') }],
  }));
  return <Animated.View style={[styles.bar, style]} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 54,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.one + 2,
    paddingVertical: Spacing.one + 2,
  },
  fieldActive: { borderColor: Colors.borderStrong, backgroundColor: Colors.surfaceRaised },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 40,
    paddingTop: 10,
    paddingBottom: 10,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 21,
  },
  listening: { flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  trailing: { marginLeft: Spacing.two },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.text,
  },
  sendBusy: { opacity: 0.4 },
  mic: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  micActive: { backgroundColor: Colors.text },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  bar: { width: 3, height: 28, borderRadius: 2, backgroundColor: Colors.text },
});
