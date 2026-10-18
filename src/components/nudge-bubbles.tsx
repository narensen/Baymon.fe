import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { VoiceOrb } from '@/components/chat/voice-orb';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';
import { BaymonAgent } from '@/modules/baymon-agent';
import { haptics } from '@/lib/haptics';
import { kindLabel, type NudgeReason } from '@/lib/nudges/api';
import { goHome, respond } from '@/lib/nudges/engine';
import { openNudge } from '@/lib/nudges/open';
import { useNudgeSettings } from '@/lib/nudges/settings';
import { MAX_VISIBLE, useActiveNudges, type StoredNudge } from '@/lib/nudges/store';
import { hasNativeAgent } from '@/lib/tools/native';

const SNOOZES = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '3 hours', minutes: 180 },
];

/** Below the screen header, so the menu and header buttons stay reachable. */
const HEADER_HEIGHT = 60;

/**
 * Baymon speaking up while the app is open: the same bubble that floats over other apps.
 * Tap opens the chat, the mic answers by voice, swipe sideways dismisses, long-press offers
 * snooze, done and "not useful". A drafted reply can be sent from the bubble.
 */
export function NudgeBubbles() {
  const nudges = useActiveNudges();
  const { value } = useNudgeSettings();
  const insets = useSafeAreaInsets();
  const visible = value?.enabled === false ? [] : nudges.slice(0, MAX_VISIBLE);

  // Always mounted, so the last bubble can animate out.
  return (
    <View pointerEvents="box-none" style={[styles.stack, { top: insets.top + HEADER_HEIGHT }]}>
      {visible.map((n) => (
        <Bubble key={n.id} nudge={n} />
      ))}
    </View>
  );
}

function Bubble({ nudge }: { nudge: StoredNudge }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const pressed = useSharedValue(0);
  const level = useSharedValue(0);
  const [menu, setMenu] = useState(false);
  const label = kindLabel(nudge.kind);
  const urgent = nudge.urgency === 'high';

  const [sending, setSending] = useState(false);

  function open(options?: { voice?: boolean; edit?: boolean }) {
    haptics.light();
    void openNudge(nudge.id, options);
    goHome();
  }
  function dismiss() {
    haptics.light();
    respond(nudge.id, 'dismissed');
  }
  function toggleMenu() {
    haptics.medium();
    setMenu((m) => !m);
  }
  function act(action: 'snoozed' | 'done' | 'dismissed', minutes?: number, reason?: NudgeReason) {
    haptics.selection();
    respond(nudge.id, action, minutes, reason);
  }
  /** Inline reply through the notification; anything else is finished in the chat. */
  async function sendDraft() {
    const draft = nudge.draft;
    if (!draft?.reply_key || !hasNativeAgent || !BaymonAgent) return open({ edit: true });
    setSending(true);
    try {
      await BaymonAgent.replyToNotification(draft.reply_key, draft.text);
      haptics.success();
      respond(nudge.id, 'done', undefined, 'draft_sent');
    } catch {
      // The notification is gone or has no reply action: send it from the chat instead.
      open({ edit: true });
    } finally {
      setSending(false);
    }
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onChange((e) => x.set(e.translationX))
    .onEnd((e) => {
      const flung = Math.abs(e.velocityX) > 900 && Math.sign(e.velocityX) === Math.sign(e.translationX);
      if (Math.abs(e.translationX) > width * 0.3 || flung) {
        const direction = Math.sign(e.translationX) || 1;
        x.set(
          withTiming(direction * width, { duration: 180 }, (done) => {
            if (done) scheduleOnRN(dismiss);
          })
        );
      } else {
        x.set(withSpring(0, Springs.snappy));
      }
    });
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .onStart(() => scheduleOnRN(toggleMenu));
  const tap = Gesture.Tap()
    .maxDistance(10)
    .onBegin(() => pressed.set(withSpring(1, Springs.press)))
    .onFinalize(() => pressed.set(withSpring(0, Springs.press)))
    .onEnd((_e, success) => {
      if (success) scheduleOnRN(open, undefined);
    });

  const swipeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(x.get()), [0, width * 0.6], [1, 0.15], 'clamp'),
    transform: [{ translateX: x.get() }],
  }));
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pressed.get(), [0, 1], [1, 0.98]) }],
  }));

  return (
    // Layout animations on the outer view, gesture transforms on the inner one: they'd fight otherwise.
    <Animated.View
      entering={FadeInUp.springify().damping(Springs.snappy.damping)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.springify().damping(Springs.snappy.damping)}
      style={styles.slot}>
      <Animated.View style={[styles.card, urgent && styles.cardUrgent, swipeStyle]}>
        <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
          <Animated.View
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${label} from Baymon: ${nudge.text}`}
            accessibilityHint="Opens the chat. Swipe sideways to dismiss, or long-press to snooze."
            accessibilityActions={[
              { name: 'activate' },
              { name: 'dismiss', label: 'Dismiss' },
              { name: 'longpress', label: 'Snooze or mark done' },
            ]}
            onAccessibilityAction={(e) => {
              const name = e.nativeEvent.actionName;
              if (name === 'activate') open();
              else if (name === 'dismiss') dismiss();
              else if (name === 'longpress') toggleMenu();
            }}
            style={[styles.row, pressStyle]}>
            <VoiceOrb phase="idle" level={level} size={22} />
            <View style={styles.texts}>
              <Text variant="overline" tone={urgent ? 'danger' : 'faint'}>
                {urgent ? `Urgent · ${label}` : label}
              </Text>
              <Text numberOfLines={3}>{nudge.text}</Text>
            </View>
          </Animated.View>
        </GestureDetector>
        {/* Outside the gesture area, so tapping it doesn't also open the bubble. */}
        <PressableScale
          scaleTo={0.88}
          accessibilityRole="button"
          accessibilityLabel="Answer by voice"
          onPress={() => open({ voice: true })}
          style={styles.mic}>
          <Icon name="mic" size={16} color={Colors.text} />
        </PressableScale>
        {nudge.draft?.text ? (
          <View style={styles.draft}>
            <Text variant="overline" tone="faint">
              {nudge.draft.to ? `Reply to ${nudge.draft.to}` : 'Suggested reply'}
            </Text>
            <Text tone="muted" numberOfLines={3}>
              {`“${nudge.draft.text}”`}
            </Text>
            <View style={styles.menu}>
              {nudge.draft.reply_key ? (
                <Chip label={sending ? 'Sending…' : 'Send'} accessibilityLabel="Send this reply" strong onPress={sendDraft} />
              ) : null}
              <Chip
                label={nudge.draft.reply_key ? 'Edit' : 'Edit & send'}
                accessibilityLabel="Edit the reply"
                onPress={() => open({ edit: true })}
              />
            </View>
          </View>
        ) : null}
        {menu ? (
          <Animated.View entering={FadeIn.duration(180)} style={[styles.menu, styles.menuPad]}>
            {SNOOZES.map((s) => (
              <Chip
                key={s.minutes}
                label={s.label}
                accessibilityLabel={`Snooze for ${s.label}`}
                onPress={() => act('snoozed', s.minutes)}
              />
            ))}
            <Chip label="Done" accessibilityLabel="Mark as done" strong onPress={() => act('done')} />
            <Chip label="Not useful" accessibilityLabel="Not useful" onPress={() => act('dismissed', undefined, 'not_useful')} />
            <Chip label="Wrong time" accessibilityLabel="Wrong time" onPress={() => act('dismissed', undefined, 'wrong_time')} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

type ChipProps = { label: string; accessibilityLabel: string; strong?: boolean; onPress: () => void };

function Chip({ label, accessibilityLabel, strong = false, onPress }: ChipProps) {
  return (
    <PressableScale
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.chip}>
      <Text variant="caption" tone={strong ? 'default' : 'muted'} style={styles.chipText}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  slot: { width: '100%', maxWidth: MaxContentWidth },
  card: {
    borderRadius: Radius.lg + 2,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
  },
  cardUrgent: { borderColor: 'rgba(242, 85, 90, 0.4)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingLeft: Spacing.two,
    // Room for the mic button.
    paddingRight: Spacing.four + 40,
  },
  mic: {
    position: 'absolute',
    top: Spacing.three + 2,
    right: Spacing.three,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfacePressed,
  },
  draft: { gap: 2, paddingLeft: Spacing.two + 33 + Spacing.two, paddingRight: Spacing.four, paddingBottom: Spacing.three },
  menuPad: { paddingHorizontal: Spacing.four },
  texts: { flex: 1, gap: 2 },
  menu: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfacePressed,
  },
  chipText: { fontWeight: '600' },
});
