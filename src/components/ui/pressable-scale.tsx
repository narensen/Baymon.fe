import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Scale reached while pressed. */
  scaleTo?: number;
  haptic?: boolean;
};

/** Pressable that compresses on a spring; interruptible mid-animation for a physical feel. */
export function PressableScale({
  scaleTo = 0.97,
  haptic = false,
  style,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Props) {
  const pressed = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, scaleTo]) }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        pressed.set(withSpring(1, Springs.press));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, Springs.press));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) haptics.light();
        onPress?.(e);
      }}
      style={[style, animatedStyle]}
    />
  );
}
