import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DrawerScreen, ScreenTitle } from '@/components/drawer-screen';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Colors, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';
import { automations, describeTrigger, useAutomations, type Trigger } from '@/lib/automations';
import { conversation } from '@/lib/conversation';
import { haptics } from '@/lib/haptics';
import { isOpenCommitment, memoryStore, useMemoryState, type CommitmentMeta, type Memory } from '@/lib/memory';
import { signalSources } from '@/lib/nudges/settings';
import { geofencingReady, placesStore, syncGeofences, usePlaces } from '@/lib/places';

const TRIGGER_ICON: Record<Trigger['when']['type'], IconName> = {
  place: 'pin',
  message: 'bolt',
  app: 'bolt',
  notification: 'bolt',
};

/** What Baymon is waiting to do for you: context reminders, routines, commitments and places. */
export default function AutomationsScreen() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => scrollY.set(e.contentOffset.y));
  const { triggers, routines, status, unsupported, error } = useAutomations();
  const memory = useMemoryState();
  const places = usePlaces();
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      automations.refresh(10_000);
      memoryStore.refresh();
    }, [])
  );

  async function refresh() {
    setRefreshing(true);
    await Promise.all([automations.load(), memoryStore.load().catch(() => {})]);
    setRefreshing(false);
  }

  async function attempt(work: () => Promise<unknown>, done?: string) {
    setNotice(null);
    try {
      await work();
      haptics.success();
      if (done) setNotice(done);
    } catch (e) {
      haptics.error();
      setNotice(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  const commitments = memory.items.filter(isOpenCommitment);

  return (
    <DrawerScreen title="Automations" scrollY={scrollY}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.textMuted} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.seven }]}>
        <ScreenTitle title="Automations" subtitle="What Baymon is waiting to do for you. Make more by asking." />

        {unsupported ? (
          <Notice error={false} text="Reminders and routines need the backend update. Places and commitments work already." />
        ) : status === 'error' && error ? (
          <Notice text={error} />
        ) : null}
        {notice ? <Notice key={notice} text={notice} error={false} /> : null}

        <Section title="When…" index={0}>
          {triggers.length ? (
            <Card>
              {triggers.map((t, i) => (
                <Row
                  key={t.id}
                  first={i === 0}
                  icon={TRIGGER_ICON[t.when.type]}
                  title={describeTrigger(t)}
                  detail={t.say}
                  meta={t.repeat ? 'Every time' : 'Once'}
                  action={<IconButton icon="trash" label="Delete" onPress={() => attempt(() => automations.removeTrigger(t.id))} />}
                />
              ))}
            </Card>
          ) : (
            <Empty text="Try “remind me to ask Priya about the invoice when she messages”, or “when I get to the office, remind me to call the bank”." />
          )}
        </Section>

        <Section title="Routines" index={1}>
          {routines.length ? (
            <Card>
              {routines.map((r, i) => (
                <Row
                  key={r.id}
                  first={i === 0}
                  icon="play"
                  title={r.name}
                  detail={r.steps.slice(0, 3).join(' · ') + (r.steps.length > 3 ? ' …' : '')}
                  action={
                    <View style={styles.rowActions}>
                      <PressableScale
                        haptic
                        scaleTo={0.92}
                        accessibilityRole="button"
                        accessibilityLabel={`Run ${r.name}`}
                        onPress={() => {
                          void conversation.runRoutine(r.name).catch(() => {});
                          router.navigate('/');
                        }}
                        style={styles.run}>
                        <Text variant="caption" tone="inverse" style={styles.bold}>
                          Run
                        </Text>
                      </PressableScale>
                      <IconButton icon="trash" label="Delete" onPress={() => attempt(() => automations.removeRoutine(r.id))} />
                    </View>
                  }
                />
              ))}
            </Card>
          ) : (
            <Empty text="Try “save a routine called Leaving work: text home I’m on my way, open Maps home, turn on Do Not Disturb”." />
          )}
        </Section>

        <Section title="Commitments" index={2}>
          {commitments.length ? (
            <Card>
              {commitments.map((m, i) => (
                <Row
                  key={m.id}
                  first={i === 0}
                  icon="clock"
                  title={m.content}
                  meta={dueLabel(m)}
                  action={
                    <PressableScale
                      haptic
                      scaleTo={0.92}
                      accessibilityRole="button"
                      accessibilityLabel="Mark as done"
                      onPress={() => attempt(() => memoryStore.complete(m.id))}
                      style={styles.done}>
                      <Text variant="caption" style={styles.bold}>
                        Done
                      </Text>
                    </PressableScale>
                  }
                />
              ))}
            </Card>
          ) : (
            <Empty text="When you say you’ll do something (“I’ll send it to Arjun tomorrow”), Baymon keeps track here and follows up." />
          )}
        </Section>

        <Section title="Places" index={3}>
          <Places
            count={places.length}
            onSaved={(name) => setNotice(`Saved “${name}”. Baymon notices when you arrive and leave.`)}
            onError={setNotice}>
            {places.length ? (
              <Card>
                {places.map((p, i) => (
                  <Row
                    key={p.id}
                    first={i === 0}
                    icon="pin"
                    title={p.name}
                    meta={`Within ${p.radius} m`}
                    action={
                      <IconButton
                        icon="trash"
                        label={`Forget ${p.name}`}
                        onPress={() => {
                          haptics.light();
                          placesStore.remove(p.id);
                        }}
                      />
                    }
                  />
                ))}
              </Card>
            ) : null}
          </Places>
        </Section>
      </Animated.ScrollView>
    </DrawerScreen>
  );
}

/** "Due today 18:00", "Overdue", or nothing. */
function dueLabel(m: Memory) {
  const due = (m.metadata as Partial<CommitmentMeta> | null)?.due_at;
  if (!due) return undefined;
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getTime() < Date.now()) return 'Overdue';
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Due today ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Due tomorrow ${time}`;
  return `Due ${date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

/** Saved places, plus saving where you are and turning on arrive/leave alerts. */
function Places({
  count,
  children,
  onSaved,
  onError,
}: {
  count: number;
  children: ReactNode;
  onSaved: (name: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => void geofencingReady().then((r) => !cancelled && setReady(r));
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [count]);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const place = await placesStore.save(name);
      haptics.success();
      setName('');
      onSaved(place.name);
    } catch (e) {
      haptics.error();
      onError(e instanceof Error ? e.message : 'Couldn’t save the place');
    } finally {
      setSaving(false);
    }
  }

  async function allowAlways() {
    signalSources.set({ places: true });
    const result = await Location.requestBackgroundPermissionsAsync().catch(() => null);
    if (!result?.granted) onError('Choose “Allow all the time” for Baymon’s location so it can notice arrivals.');
    await syncGeofences();
    setReady(await geofencingReady());
  }

  return (
    <View style={styles.places}>
      {children}
      <View style={styles.saveRow}>
        <View style={styles.flex}>
          <TextField label="Name this place (you’re here now)" value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={save} />
        </View>
        <Button label="Save" loading={saving} disabled={!name.trim()} onPress={save} style={styles.saveButton} />
      </View>
      {count > 0 && ready === false ? (
        <PressableScale scaleTo={0.98} accessibilityRole="button" onPress={allowAlways} style={styles.allow}>
          <Icon name="warning" size={15} color={Colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            Arrive and leave alerts need location “Allow all the time”. Tap to allow.
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Section({ title, index, children }: { title: string; index: number; children: ReactNode }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(60 + index * 60).springify().damping(Springs.snappy.damping)}
      layout={LinearTransition.springify().damping(Springs.snappy.damping)}
      style={styles.section}>
      <Text variant="overline" tone="faint" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </Animated.View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

type RowProps = { first: boolean; icon: IconName; title: string; detail?: string; meta?: string; action?: ReactNode };

function Row({ first, icon, title, detail, meta, action }: RowProps) {
  return (
    <View>
      {first ? null : <View style={styles.divider} />}
      <View style={styles.row}>
        <Icon name={icon} size={17} color={Colors.textMuted} style={styles.rowIcon} />
        <View style={styles.flex}>
          <Text>{title}</Text>
          {detail ? (
            <Text variant="caption" tone="muted">
              {detail}
            </Text>
          ) : null}
          {meta ? (
            <Text variant="caption" tone="faint">
              {meta}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
    </View>
  );
}

function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <PressableScale scaleTo={0.88} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <Icon name={icon} size={16} color={Colors.textMuted} />
    </PressableScale>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={[styles.card, styles.empty]}>
      <Text variant="caption" tone="faint">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.five,
  },
  flex: { flex: 1, gap: 2 },
  section: { gap: Spacing.three },
  sectionTitle: { paddingHorizontal: Spacing.one },
  card: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  empty: { paddingVertical: Spacing.four },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three + 2 },
  rowIcon: { alignSelf: 'flex-start', marginTop: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  run: {
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.text,
  },
  done: {
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  bold: { fontWeight: '600' },
  places: { gap: Spacing.three },
  saveRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  saveButton: { marginTop: Spacing.one, minWidth: 84 },
  allow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
});
