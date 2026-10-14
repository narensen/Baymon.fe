import { useNavigation } from 'expo-router';
import { useDrawerProgress, type DrawerNavigationProp } from 'expo-router/drawer';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Colors } from '@/constants/theme';

const BAR_GAP = 6;

/**
 * Three-bar menu icon bound to the drawer's live progress: it morphs into a close mark
 * frame-by-frame as the drawer is dragged, rather than playing a canned animation.
 */
export function MenuButton() {
  const navigation = useNavigation<DrawerNavigationProp<Record<string, object | undefined>>>();
  const progress = useDrawerProgress();

  const top = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.get(), [0, 1], [0, BAR_GAP]) },
      { rotate: `${interpolate(progress.get(), [0, 1], [0, 45])}deg` },
    ],
  }));
  const middle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.5], [1, 0], 'clamp'),
    transform: [{ scaleX: interpolate(progress.get(), [0, 1], [1, 0.2]) }],
  }));
  const bottom = useAnimatedStyle(() => ({
    width: interpolate(progress.get(), [0, 1], [12, 20]),
    transform: [
      { translateY: interpolate(progress.get(), [0, 1], [0, -BAR_GAP]) },
      { rotate: `${interpolate(progress.get(), [0, 1], [0, -45])}deg` },
    ],
  }));

  return (
    <PressableScale
      haptic
      scaleTo={0.88}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      onPress={() => navigation.toggleDrawer()}
      style={styles.button}>
      <View style={styles.bars}>
        <Animated.View style={[styles.bar, top]} />
        <Animated.View style={[styles.bar, styles.middle, middle]} />
        <Animated.View style={[styles.bar, bottom]} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  bars: { width: 20, gap: BAR_GAP - 2, alignItems: 'flex-start' },
  bar: { width: 20, height: 2, borderRadius: 1, backgroundColor: Colors.text },
  middle: { width: 16, transformOrigin: 'left' },
});
