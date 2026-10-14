import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing, Springs } from '@/constants/theme';

type Props = Omit<TextInputProps, 'placeholder' | 'style'> & {
  label: string;
  error?: string | null;
  /** Shown under the field when there's no error. */
  hint?: ReactNode;
  /** Adds a Show/Hide toggle and masks input. */
  secure?: boolean;
  ref?: Ref<TextInput>;
};

export function TextField({
  label,
  error,
  hint,
  secure = false,
  value = '',
  onFocus,
  onBlur,
  multiline,
  ref,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Label floats up when focused or filled; driven by a spring so rapid focus changes stay smooth.
  const raised = useSharedValue(value ? 1 : 0);
  const isRaised = focused || value.length > 0;
  useEffect(() => {
    raised.set(withSpring(isRaised ? 1 : 0, Springs.snappy));
  }, [isRaised, raised]);

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(raised.get(), [0, 1], [0, -11]) },
      { scale: interpolate(raised.get(), [0, 1], [1, 0.8]) },
    ],
  }));

  const borderColor = error ? Colors.danger : focused ? Colors.borderStrong : Colors.border;

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.field,
          multiline && styles.multiline,
          {
            borderColor,
            backgroundColor: focused ? Colors.surfaceRaised : Colors.surface,
            transitionProperty: ['borderColor', 'backgroundColor'],
            transitionDuration: 200,
          },
        ]}>
        <Animated.Text
          pointerEvents="none"
          numberOfLines={1}
          style={[styles.label, multiline && styles.multilineLabel, labelStyle]}>
          {label}
        </Animated.Text>
        <TextInput
          {...rest}
          ref={ref}
          value={value}
          multiline={multiline}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={Colors.textFaint}
          selectionColor={Colors.text}
          cursorColor={Colors.text}
          keyboardAppearance="dark"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.multilineInput]}
        />
        {secure && (
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((r) => !r)}
            style={styles.trailing}>
            <Text variant="caption" tone="muted" style={styles.toggle}>
              {revealed ? 'Hide' : 'Show'}
            </Text>
          </Pressable>
        )}
      </Animated.View>
      {error ? (
        <Animated.View key={error} entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(120)}>
          <Text variant="caption" tone="danger" style={styles.below}>
            {error}
          </Text>
        </Animated.View>
      ) : hint ? (
        <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(120)}>
          {typeof hint === 'string' ? (
            <Text variant="caption" tone="faint" style={styles.below}>
              {hint}
            </Text>
          ) : (
            <View style={styles.below}>{hint}</View>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: Spacing.one },
  field: {
    height: 60,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
  },
  multiline: { height: undefined, minHeight: 140, alignItems: 'flex-start' },
  label: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    top: 20,
    color: Colors.textMuted,
    fontFamily: Fonts.sans,
    fontSize: 15,
    lineHeight: 20,
    transformOrigin: 'left',
  },
  multilineLabel: { top: 20 },
  input: {
    flex: 1,
    height: '100%',
    paddingTop: 18,
    paddingBottom: 0,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
  multilineInput: {
    height: undefined,
    minHeight: 140,
    paddingTop: 30,
    paddingBottom: Spacing.four,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  trailing: { paddingLeft: Spacing.three, height: '100%', justifyContent: 'center' },
  toggle: { fontWeight: '600', letterSpacing: 0.2 },
  below: { paddingHorizontal: Spacing.one, paddingTop: Spacing.one },
});
