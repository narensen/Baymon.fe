import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormError } from '@/components/auth-scaffold';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Colors, Radius, Spacing, Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import {
  lastTouched,
  MEMORY_CATEGORIES,
  MEMORY_MAX_CHARS,
  memoryStore,
  useMemory,
  useMemoryState,
  type Memory,
  type MemoryCategory,
  type MemoryInput,
} from '@/lib/memory';
import { formatRelative } from '@/lib/time';

const asCategory = (value: string | undefined): MemoryCategory =>
  MEMORY_CATEGORIES.includes(value as MemoryCategory) ? (value as MemoryCategory) : 'other';

export default function MemoryEditorSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const live = useMemory(isNew ? undefined : id);
  // Keep showing the memory while the sheet dismisses after a delete.
  const [opened] = useState(live);
  const memory = live ?? opened;
  const { status } = useMemoryState();

  // Covers opening this sheet from a deep link before the list has loaded.
  useEffect(() => {
    memoryStore.refresh();
  }, []);

  if (!isNew && !memory) {
    return (
      <Sheet title="Memory">
        <Text tone="muted">{status === 'loading' ? 'Loading…' : 'This memory no longer exists.'}</Text>
      </Sheet>
    );
  }

  return (
    <Sheet title={isNew ? 'New memory' : 'Edit memory'}>
      <Editor memory={memory} />
    </Sheet>
  );
}

function Editor({ memory }: { memory?: Memory }) {
  const initialCategory = asCategory(memory?.category);
  const [content, setContent] = useState(memory?.content ?? '');
  const [category, setCategory] = useState<MemoryCategory>(initialCategory);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = content.trim();
  const patch: Partial<MemoryInput> = {
    ...(trimmed !== memory?.content.trim() && { content: trimmed }),
    ...(category !== initialCategory && { category }),
  };
  const canSave = trimmed.length > 0 && Object.keys(patch).length > 0;

  async function run(kind: 'save' | 'delete', action: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      haptics.success();
      router.back();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(null);
    }
  }

  return (
    <View style={styles.editor}>
      <Animated.View entering={FadeInDown.springify().damping(Springs.snappy.damping)}>
        <TextField
          label="What should your agent remember?"
          value={content}
          onChangeText={setContent}
          multiline
          autoFocus={!memory}
          maxLength={MEMORY_MAX_CHARS}
          hint={
            <View style={styles.hintRow}>
              <Text variant="caption" tone="faint">
                {memory ? `Updated ${formatRelative(lastTouched(memory)).toLowerCase()}` : ' '}
              </Text>
              <Text variant="caption" tone={content.length > MEMORY_MAX_CHARS * 0.9 ? 'danger' : 'faint'}>
                {content.length}/{MEMORY_MAX_CHARS}
              </Text>
            </View>
          }
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).springify().damping(Springs.snappy.damping)} style={styles.categories}>
        <Text variant="overline" tone="faint">
          Category
        </Text>
        <View accessibilityRole="radiogroup" style={styles.chips}>
          {MEMORY_CATEGORIES.map((option) => (
            <Chip
              key={option}
              label={option}
              selected={option === category}
              onPress={() => {
                haptics.selection();
                setCategory(option);
              }}
            />
          ))}
        </View>
      </Animated.View>

      <FormError message={error} />
      <Animated.View entering={FadeIn.delay(120)} style={styles.actions}>
        <Button
          label={memory ? 'Save changes' : 'Add memory'}
          disabled={!canSave || busy === 'delete'}
          loading={busy === 'save'}
          onPress={() =>
            run('save', () =>
              memory ? memoryStore.update(memory.id, patch) : memoryStore.create({ content: trimmed, category })
            )
          }
        />
        {memory && (
          <Button
            label="Delete memory"
            variant="danger"
            icon="trash"
            disabled={busy === 'save'}
            loading={busy === 'delete'}
            onPress={() => run('delete', () => memoryStore.remove(memory.id, { optimistic: false }))}
          />
        )}
      </Animated.View>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Animated.View
        style={[
          styles.chip,
          {
            backgroundColor: selected ? Colors.text : Colors.surfaceRaised,
            borderColor: selected ? Colors.text : Colors.border,
            transitionProperty: ['backgroundColor', 'borderColor'],
            transitionDuration: 180,
          },
        ]}>
        <Text variant="caption" tone={selected ? 'inverse' : 'muted'} style={styles.chipLabel}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.sheet}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + Spacing.five }]}>
      <View style={styles.sheetHeader}>
        <Text variant="heading">{title}</Text>
        <PressableScale
          scaleTo={0.88}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          style={styles.close}>
          <Icon name="close" size={14} color={Colors.textMuted} />
        </PressableScale>
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  sheetContent: { padding: Spacing.five, paddingTop: Spacing.six, gap: Spacing.five },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
  },
  editor: { gap: Spacing.five },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between' },
  categories: { gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  chipLabel: { fontWeight: '600', textTransform: 'capitalize' },
  actions: { gap: Spacing.three },
});
