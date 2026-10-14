import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const FOREGROUND: Record<Variant, string> = {
  primary: Colors.inverse,
  secondary: Colors.text,
  ghost: Colors.textMuted,
  danger: Colors.danger,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: Props) {
  const inactive = disabled || loading;
  const color = FOREGROUND[variant];

  return (
    <PressableScale
      haptic
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, styles[variant], style]}>
      <Animated.View
        style={[
          styles.content,
          { opacity: loading ? 0 : disabled ? 0.4 : 1 },
          fade,
        ]}>
        {icon && <Icon name={icon} size={17} color={color} />}
        <Text variant="label" style={{ color }}>
          {label}
        </Text>
      </Animated.View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <Animated.View style={[{ opacity: loading ? 1 : 0 }, fade]}>
          <ActivityIndicator color={color} />
        </Animated.View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
  },
  primary: { backgroundColor: Colors.text },
  secondary: {
    backgroundColor: Colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: {
    backgroundColor: 'rgba(242, 85, 90, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242, 85, 90, 0.28)',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  center: { alignItems: 'center', justifyContent: 'center' },
});

// Reanimated CSS transition: opacity changes animate on the UI thread.
const fade = { transitionProperty: 'opacity', transitionDuration: 180 } as const;
