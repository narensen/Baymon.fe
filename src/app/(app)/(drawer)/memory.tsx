import { router, useFocusEffect } from 'expo-router';
import { useCallback, useDeferredValue, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerScreen, ScreenTitle } from '@/components/drawer-screen';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { lastTouched, memoryStore, useMemoryState, type Memory } from '@/lib/memory';
import { formatRelative } from '@/lib/time';

const ACTION_WIDTH = 88;
const listLayout = LinearTransition.springify().damping(Springs.snappy.damping).stiffness(Springs.snappy.stiffness);

export default function MemoryScreen() {
  const { items, status, error } = useMemoryState();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => scrollY.set(e.contentOffset.y));

  const [refreshing, setRefreshing] = useState(false);

  // Memories are also written by the agent during chat, so re-pull whenever this screen is shown.
  useFocusEffect(useCallback(() => memoryStore.refresh(), []));

  async function onRefresh() {
    setRefreshing(true);
    await memoryStore.load().catch(() => haptics.error());
    setRefreshing(false);
  }

  const visible = deferredQuery
    ? items.filter(
        (m) =>
          m.content.toLowerCase().includes(deferredQuery) ||
          m.category?.toLowerCase().includes(deferredQuery)
      )
    : items;

  return (
    <DrawerScreen
      title="Memory"
      scrollY={scrollY}
      right={
        <PressableScale
          haptic
          scaleTo={0.88}
          accessibilityRole="button"
          accessibilityLabel="Add memory"
          onPress={() => router.push({ pathname: '/memory/[id]', params: { id: 'new' } })}
          style={styles.iconButton}>
          <Icon name="plus" size={18} />
        </PressableScale>
      }>
      <Animated.FlatList
        data={visible}
        keyExtractor={(m) => m.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        itemLayoutAnimation={listLayout}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.textMuted}
            colors={[Colors.inverse]}
            progressBackgroundColor={Colors.text}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.seven }]}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenTitle title="Memory" subtitle="What your agent remembers about you." />
            <SearchField value={query} onChangeText={setQuery} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            status={status}
            error={error}
            searching={!!deferredQuery}
            hasItems={items.length > 0}
          />
        }
        renderItem={({ item, index }) => <MemoryRow memory={item} index={index} />}
      />
    </DrawerScreen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function SearchField({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Animated.View
      style={[
        styles.search,
        {
          borderColor: focused ? Colors.borderStrong : Colors.border,
          transitionProperty: 'borderColor',
          transitionDuration: 200,
        },
      ]}>
      <Icon name="search" size={16} color={Colors.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search memories"
        placeholderTextColor={Colors.textFaint}
        selectionColor={Colors.text}
        cursorColor={Colors.text}
        keyboardAppearance="dark"
        returnKeyType="search"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.searchInput}
      />
      {value.length > 0 && (
        <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)}>
          <Pressable hitSlop={10} accessibilityLabel="Clear search" onPress={() => onChangeText('')}>
            <Icon name="close" size={14} color={Colors.textMuted} />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function MemoryRow({ memory, index }: { memory: Memory; index: number }) {
  return (
    <Animated.View
      entering={index < 10 ? FadeInDown.delay(index * 45).springify().damping(Springs.snappy.damping) : undefined}
      exiting={FadeOut.duration(160)}>
      <ReanimatedSwipeable
        friction={1.6}
        rightThreshold={ACTION_WIDTH / 2}
        overshootRight={false}
        onSwipeableWillOpen={() => haptics.light()}
        renderRightActions={(progress, _translation, methods) => (
          <DeleteAction progress={progress} methods={methods} id={memory.id} />
        )}
        containerStyle={styles.swipeContainer}>
        <PressableScale
          scaleTo={0.985}
          onPress={() => router.push({ pathname: '/memory/[id]', params: { id: memory.id } })}
          style={styles.card}>
          <Text numberOfLines={3}>{memory.content}</Text>
          <View style={styles.meta}>
            <View style={styles.tag}>
              <Text variant="overline" tone="muted">
                {memory.category}
              </Text>
            </View>
            <Text variant="caption" tone="faint">
              {formatRelative(lastTouched(memory))}
            </Text>
          </View>
        </PressableScale>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

type DeleteActionProps = {
  progress: SharedValue<number>;
  methods: SwipeableMethods;
  id: string;
};

function DeleteAction({ progress, methods, id }: DeleteActionProps) {
  // The action grows into place as the row is dragged, tracking the finger.
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.6], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(progress.get(), [0, 1], [0.6, 1], 'clamp') }],
  }));

  return (
    <View style={styles.actionSlot}>
      <Animated.View style={[styles.actionInner, style]}>
        <PressableScale
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel="Delete memory"
          onPress={() => {
            haptics.medium();
            methods.close();
            memoryStore.remove(id).catch(() => haptics.error());
          }}
          style={styles.action}>
          <Icon name="trash" size={18} color={Colors.danger} />
          <Text variant="caption" tone="danger">
            Delete
          </Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

type EmptyProps = {
  status: ReturnType<typeof useMemoryState>['status'];
  error?: string;
  searching: boolean;
  hasItems: boolean;
};

function EmptyState({ status, error, searching, hasItems }: EmptyProps) {
  if (status === 'idle' || status === 'loading') {
    return (
      <View style={styles.skeletons}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.card, styles.skeleton]} />
        ))}
      </View>
    );
  }
  if (status === 'error') {
    return (
      <Animated.View entering={FadeIn} style={styles.empty}>
        <Text variant="heading">Couldn’t load memories</Text>
        <Text tone="muted" style={styles.centerText}>
          {error}
        </Text>
        <Button label="Try again" variant="secondary" onPress={() => memoryStore.load().catch(() => {})} />
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.empty}>
      <Icon name="memory" size={28} color={Colors.textFaint} />
      <Text variant="heading">{searching && hasItems ? 'No matches' : 'Nothing remembered yet'}</Text>
      <Text tone="muted" style={styles.centerText}>
        {searching && hasItems
          ? 'Try a different search.'
          : 'Memories your agent saves will appear here. You can edit or remove any of them.'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { paddingBottom: Spacing.four },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  search: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: 15,
  },
  separator: { height: Spacing.three },
  swipeContainer: { borderRadius: Radius.lg },
  card: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tag: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceRaised,
  },
  actionSlot: { width: ACTION_WIDTH, paddingLeft: Spacing.three },
  actionInner: { flex: 1 },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderRadius: Radius.lg,
    backgroundColor: 'rgba(242, 85, 90, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242, 85, 90, 0.24)',
  },
  skeletons: { gap: Spacing.three },
  skeleton: { height: 92 },
  empty: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.seven, paddingHorizontal: Spacing.four },
  centerText: { textAlign: 'center' },
});
