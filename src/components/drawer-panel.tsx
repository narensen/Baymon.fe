import { useDrawerProgress, type DrawerContentComponentProps } from 'expo-router/drawer';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/providers/auth-provider';

const ITEM_HEIGHT = 52;
const ITEM_GAP = 4;

const ITEMS: { route: string; label: string; icon: IconName }[] = [
  { route: 'index', label: 'Home', icon: 'home' },
  { route: 'memory', label: 'Memory', icon: 'memory' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

export function DrawerPanel({ state, navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const progress = useDrawerProgress();
  const { profile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const activeRoute = state.routes[state.index]?.name;
  const activeIndex = Math.max(0, ITEMS.findIndex((i) => i.route === activeRoute));

  // The highlight glides between items on a spring.
  const indicatorY = useSharedValue(activeIndex * (ITEM_HEIGHT + ITEM_GAP));
  useEffect(() => {
    indicatorY.set(withSpring(activeIndex * (ITEM_HEIGHT + ITEM_GAP), Springs.snappy));
  }, [activeIndex, indicatorY]);
  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateY: indicatorY.get() }] }));

  const headerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.2, 1], [0, 1], 'clamp'),
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [-28, 0]) }],
  }));

  const initial = (profile?.display_name || profile?.username || '·').charAt(0).toUpperCase();

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + Spacing.four }]}>
      <Animated.View style={[styles.profile, headerStyle]}>
        <View style={styles.avatar}>
          <Text variant="heading">{initial}</Text>
        </View>
        <View style={styles.profileText}>
          <Text variant="heading" numberOfLines={1}>
            {profile?.display_name ?? ' '}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {profile ? `@${profile.username}` : ' '}
          </Text>
        </View>
        {profile?.role ? (
          <View style={styles.badge}>
            <Text variant="overline" tone="muted">
              {profile.role}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <View style={styles.nav}>
        <Animated.View style={[styles.indicator, indicatorStyle]} />
        {ITEMS.map((item, index) => (
          <NavItem
            key={item.route}
            index={index}
            label={item.label}
            icon={item.icon}
            active={index === activeIndex}
            onPress={() => {
              haptics.selection();
              navigation.navigate(item.route);
            }}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <PressableScale
          disabled={signingOut}
          onPress={async () => {
            haptics.medium();
            setSigningOut(true);
            try {
              await signOut();
            } catch {
              setSigningOut(false);
            }
          }}
          style={[styles.item, { opacity: signingOut ? 0.5 : 1 }]}>
          <Icon name="logout" size={19} color={Colors.textMuted} />
          <Text variant="label" tone="muted">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

type NavItemProps = {
  index: number;
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
};

function NavItem({ index, label, icon, active, onPress }: NavItemProps) {
  const progress = useDrawerProgress();
  // Each row trails the one above it slightly, so the list unfurls with the drag.
  const style = useAnimatedStyle(() => {
    const start = 0.15 + index * 0.08;
    return {
      opacity: interpolate(progress.get(), [start, 1], [0, 1], 'clamp'),
      transform: [{ translateX: interpolate(progress.get(), [start, 1], [-20 - index * 6, 0], 'clamp') }],
    };
  });

  return (
    <Animated.View style={style}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={styles.item}>
        <Icon name={icon} size={19} color={active ? Colors.text : Colors.textMuted} />
        <Text variant="label" tone={active ? 'default' : 'muted'}>
          {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.six,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
  },
  profileText: { flex: 1, gap: 1 },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
  },
  nav: { gap: ITEM_GAP },
  indicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  item: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
  },
  footer: { marginTop: 'auto' },
});
