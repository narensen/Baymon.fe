import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Colors, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const WIDTH = 50;
const HEIGHT = 30;
const KNOB = 24;
const INSET = (HEIGHT - KNOB) / 2;

type Props = { value: boolean; onValueChange: (value: boolean) => void; accessibilityLabel: string };

export function Switch({ value, onValueChange, accessibilityLabel }: Props) {
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(withSpring(value ? 1 : 0, Springs.snappy));
  }, [value, on]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [Colors.surfacePressed, Colors.text]),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [Colors.textMuted, Colors.inverse]),
    transform: [{ translateX: interpolate(on.get(), [0, 1], [0, WIDTH - KNOB - INSET * 2]) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: WIDTH, height: HEIGHT, borderRadius: HEIGHT / 2, padding: INSET },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
});
