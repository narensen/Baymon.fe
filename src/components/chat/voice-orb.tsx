import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';

export type TalkPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

const PHASE_ID: Record<TalkPhase, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };

type Props = {
  phase: TalkPhase;
  /** Live microphone level (0..1). */
  level: SharedValue<number>;
  size?: number;
};

export function VoiceOrb({ phase, level, size = 210 }: Props) {
  const phaseId = useSharedValue(PHASE_ID[phase]);
  const thinking = useSharedValue(phase === 'thinking' ? 1 : 0);
  useEffect(() => {
    phaseId.set(PHASE_ID[phase]);
    thinking.set(withTiming(phase === 'thinking' ? 1 : 0, { duration: 300 }));
  }, [phase, phaseId, thinking]);

  // One UI-thread loop produces the orb's "energy" for every phase.
  const energy = useSharedValue(0);
  const spin = useSharedValue(0);
  // Absolute frame time, not time since this callback started: re-renders can re-register the
  // callback, and a relative clock would restart the spin and breathing mid-animation.
  useFrameCallback(({ timestamp }) => {
    const t = timestamp / 1000;
    const id = phaseId.get();
    let target: number;
    if (id === 1) target = level.get();
    else if (id === 3) target = 0.3 + 0.32 * Math.abs(Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 1.9));
    else if (id === 2) target = 0.16 + 0.05 * Math.sin(t * 3);
    else target = 0.08 + 0.06 * Math.sin(t * 1.4);
    energy.set(target);
    spin.set((t * 220) % 360);
  });

  const core = useDerivedValue(() => withSpring(energy.get(), { damping: 12, stiffness: 220 }));
  const ringA = useDerivedValue(() => withSpring(energy.get(), { damping: 16, stiffness: 120 }));
  const ringB = useDerivedValue(() => withSpring(energy.get(), { damping: 20, stiffness: 70 }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ringB.get(), [0, 1], [0.05, 0.2]),
    transform: [{ scale: interpolate(ringB.get(), [0, 1], [0.95, 1.4]) }],
  }));
  const ringAStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ringA.get(), [0, 1], [0.25, 0.6]),
    transform: [{ scale: interpolate(ringA.get(), [0, 1], [0.86, 1.18]) }],
  }));
  const ringBStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ringB.get(), [0, 1], [0.12, 0.35]),
    transform: [{ scale: interpolate(ringB.get(), [0, 1], [0.96, 1.3]) }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(core.get(), [0, 1], [0.88, 1.06]) }],
  }));
  const arcStyle = useAnimatedStyle(() => ({
    opacity: thinking.get(),
    transform: [{ rotate: `${spin.get()}deg` }, { scale: interpolate(thinking.get(), [0, 1], [0.9, 1]) }],
  }));

  const circle = (scale: number) => ({ width: size * scale, height: size * scale, borderRadius: (size * scale) / 2 });

  return (
    <View style={[styles.center, { width: size * 1.5, height: size * 1.5 }]} pointerEvents="none">
      <Animated.View style={[styles.abs, styles.glow, circle(1), glowStyle]} />
      <Animated.View style={[styles.abs, styles.ring, circle(1.08), ringBStyle]} />
      <Animated.View style={[styles.abs, styles.ring, circle(0.92), ringAStyle]} />
      <Animated.View style={[styles.abs, styles.arc, circle(0.86), arcStyle]} />
      <Animated.View style={[styles.core, circle(0.62), coreStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  glow: { backgroundColor: Colors.text },
  ring: { borderWidth: 1, borderColor: Colors.text },
  arc: {
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: Colors.text,
    borderRightColor: 'rgba(244, 243, 239, 0.35)',
  },
  core: { backgroundColor: Colors.text },
});
