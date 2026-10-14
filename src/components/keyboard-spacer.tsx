import { View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

type Props = {
  /** Height while the keyboard is closed. */
  min?: number;
  /** Subtracted from the keyboard height, e.g. bottom padding the layout already has. Negative adds a gap. */
  subtract?: number;
  /** `android`: iOS screens that handle the keyboard natively (ScrollView insets) skip the spacer. */
  platforms?: 'all' | 'android';
};

/**
 * Grows with the on-screen keyboard, frame by frame, pushing the content above it up. Place it at
 * the bottom of a screen that extends to the bottom edge of the display.
 *
 * Measured from the bottom of the screen on both platforms: with edge-to-edge (always on in this
 * SDK) the app draws behind the Android navigation bar, so its height must not be subtracted.
 */
export function KeyboardSpacer({ min = 0, subtract = 0, platforms = 'all' }: Props) {
  if (platforms === 'android' && process.env.EXPO_OS !== 'android') return null;
  // Browsers resize the viewport for the keyboard themselves.
  if (process.env.EXPO_OS === 'web') return min ? <View style={{ height: min }} /> : null;
  return <Spacer min={min} subtract={subtract} />;
}

function Spacer({ min, subtract }: { min: number; subtract: number }) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const style = useAnimatedStyle(() => ({
    height: Math.max(keyboard.height.get() - subtract, min),
  }));
  return <Animated.View pointerEvents="none" style={style} />;
}
