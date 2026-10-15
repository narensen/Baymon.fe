import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing, Springs } from '@/constants/theme';
import type { Step } from '@/lib/conversation';

const glide = LinearTransition.springify().damping(Springs.snappy.damping).stiffness(Springs.snappy.stiffness);

function StepRow({ step, animate }: { step: Step; animate: boolean }) {
  return (
    <Animated.View entering={animate ? FadeInDown.springify().damping(18) : undefined} layout={glide} style={styles.row}>
      <View style={styles.icon}>
        {step.status === 'running' ? (
          <ActivityIndicator size="small" color={Colors.textMuted} style={styles.spinner} />
        ) : step.status === 'done' ? (
          <Icon name="check" size={14} color={Colors.success} />
        ) : (
          <Icon name="close" size={13} color={Colors.danger} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text variant="caption" tone={step.status === 'running' ? 'default' : 'muted'} numberOfLines={2}>
          {step.label}
        </Text>
        {step.error ? (
          <Text variant="caption" tone="danger" numberOfLines={3}>
            {step.error}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** What Baymon is doing right now on the phone, step by step, with a way to stop it. */
export function LiveSteps({ steps, onStop }: { steps: Step[]; onStop: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} layout={glide} style={styles.panel}>
      {steps.slice(-6).map((step) => (
        <StepRow key={step.id} step={step} animate />
      ))}
      <PressableScale haptic scaleTo={0.94} onPress={onStop} accessibilityRole="button" style={styles.stop}>
        <Icon name="stop" size={12} color={Colors.text} />
        <Text variant="caption" style={styles.stopText}>
          Stop
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

/** Collapsed record of what Baymon did for a reply; tap to see each step. */
export function StepsSummary({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((s) => s.status === 'failed').length;
  return (
    <Animated.View layout={glide} style={styles.summary}>
      <Pressable
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.summaryHead}>
        <Icon name={failed ? 'warning' : 'check'} size={13} color={failed ? Colors.danger : Colors.textFaint} />
        <Text variant="caption" tone="faint">
          {`Did ${steps.length} thing${steps.length === 1 ? '' : 's'} on your phone${failed ? ` · ${failed} failed` : ''}`}
        </Text>
        <Text variant="caption" tone="faint">
          {open ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
      {open ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.summaryList}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} animate={false} />
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    marginVertical: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  icon: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  spinner: { transform: [{ scale: 0.7 }] },
  rowText: { flex: 1, gap: 2 },
  stop: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  stopText: { fontWeight: '600' },
  summary: { gap: Spacing.two },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summaryList: { gap: Spacing.two, paddingLeft: Spacing.one },
});
