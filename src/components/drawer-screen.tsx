import { useDrawerProgress } from 'expo-router/drawer';
import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuButton } from '@/components/menu-button';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type Props = PropsWithChildren<{
  /** Compact title that fades into the bar once the large title scrolls away. */
  title?: string;
  right?: ReactNode;
  /** Scroll offset of the screen's scroll view, if any. */
  scrollY?: SharedValue<number>;
}>;

/**
 * Frame for every drawer screen. As the drawer opens, the page recedes (scale + rounded corners),
 * tracking the gesture 1:1.
 */
export function DrawerScreen({ title, right, scrollY, children }: Props) {
  const insets = useSafeAreaInsets();
  const progress = useDrawerProgress();
  const fallbackScroll = useSharedValue(0);
  const scroll = scrollY ?? fallbackScroll;

  const sceneStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(progress.get(), [0, 1], [0, Radius.xl]),
    borderColor: `rgba(244, 243, 239, ${interpolate(progress.get(), [0, 1], [0, 0.1])})`,
    transform: [{ scale: interpolate(progress.get(), [0, 1], [1, 0.9]) }],
  }));
  const compactTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.get(), [24, 56], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(scroll.get(), [24, 56], [6, 0], 'clamp') }],
  }));
  const barBorderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.get(), [0, 24], [0, 1], 'clamp'),
  }));

  return (
    <Animated.View style={[styles.scene, sceneStyle]}>
      <View style={[styles.bar, { paddingTop: insets.top + Spacing.two }]}>
        <MenuButton />
        {title ? (
          <Animated.View pointerEvents="none" style={[styles.compactTitle, compactTitleStyle]}>
            <Text variant="heading" numberOfLines={1}>
              {title}
            </Text>
          </Animated.View>
        ) : null}
        <View style={styles.right}>{right}</View>
        <Animated.View style={[styles.barBorder, barBorderStyle]} />
      </View>
      {children}
    </Animated.View>
  );
}

/** Large title placed at the top of a screen's content. */
export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text variant="title">{title}</Text>
      {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.background,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    backgroundColor: Colors.background,
    zIndex: 1,
  },
  compactTitle: {
    position: 'absolute',
    left: 72,
    right: 72,
    bottom: Spacing.two + 11,
    alignItems: 'center',
  },
  right: { minWidth: 44, alignItems: 'flex-end' },
  barBorder: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  titleBlock: { gap: Spacing.one, paddingTop: Spacing.two, paddingBottom: Spacing.five },
});
