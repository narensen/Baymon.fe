import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';

type Props = { size?: number };

/** A slowly breathing orb: the agent's presence. Runs entirely on the UI thread and honours reduced motion. */
export function BrandMark({ size = 56 }: Props) {
  const breath = useSharedValue(0);

  useEffect(() => {
    breath.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [breath]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(breath.get(), [0, 1], [0.08, 0.22]),
    transform: [{ scale: interpolate(breath.get(), [0, 1], [0.92, 1.12]) }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(breath.get(), [0, 1], [0.94, 1]) }],
  }));

  const ring = { width: size, height: size, borderRadius: size / 2 };
  const core = { width: size * 0.36, height: size * 0.36, borderRadius: size };

  return (
    <View style={[styles.center, ring]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.halo, ring, haloStyle]} />
      <View style={[StyleSheet.absoluteFill, styles.ring, ring]} />
      <Animated.View style={[styles.core, core, coreStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  halo: { backgroundColor: Colors.text },
  ring: { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: Colors.borderStrong },
  core: { backgroundColor: Colors.text },
});
