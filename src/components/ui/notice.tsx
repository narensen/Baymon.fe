import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Props = {
  text: string;
  /** Failures are tinted red; informational notices are muted. */
  error?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A status line that is always shown in full: it wraps instead of truncating, and can be
 * long-pressed to copy (useful when reporting an error). Give it `key={text}` so a new message
 * animates in.
 */
export function Notice({ text, error = true, style }: Props) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOut.duration(150)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.notice, error && styles.error, style]}>
      <Icon name={error ? 'warning' : 'info'} size={15} color={error ? Colors.danger : Colors.textMuted} />
      <Text variant="caption" tone={error ? 'danger' : 'muted'} selectable style={styles.text}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    alignSelf: 'center',
    maxWidth: 520,
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
  },
  error: {
    backgroundColor: 'rgba(242, 85, 90, 0.06)',
    borderColor: 'rgba(242, 85, 90, 0.28)',
  },
  // Lets long messages wrap within the row instead of overflowing past the icon.
  text: { flexShrink: 1, paddingTop: 1 },
});
