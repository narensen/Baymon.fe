import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { Colors, Radius, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const PADDING = 4;
const BORDER = StyleSheet.hairlineWidth * 2;

type Props<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const [width, setWidth] = useState(0);
  // onLayout reports the border-box width; the thumb travels inside border + padding.
  const segment = options.length ? (width - (PADDING + BORDER) * 2) / options.length : 0;
  const index = Math.max(0, options.indexOf(value));

  const x = useSharedValue(0);
  useEffect(() => {
    x.set(withSpring(index * segment, Springs.snappy));
  }, [index, segment, x]);

  const thumbStyle = useAnimatedStyle(() => ({ width: segment, transform: [{ translateX: x.get() }] }));

  return (
    <View
      accessibilityRole="radiogroup"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={styles.track}>
      {width > 0 && <Animated.View style={[styles.thumb, thumbStyle]} />}
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(option);
            }}
            style={styles.segment}>
            <Text variant="label" tone={selected ? 'default' : 'muted'} style={styles.label}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 48,
    padding: PADDING,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: BORDER,
    borderColor: Colors.border,
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfacePressed,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { textTransform: 'capitalize' },
});
