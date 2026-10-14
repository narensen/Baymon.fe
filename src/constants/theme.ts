import '@/global.css';

import { Platform } from 'react-native';
import type { WithSpringConfig } from 'react-native-reanimated';

/** Matte black + light white. The app ships a single dark-first palette. */
export const Colors = {
  background: '#0B0B0C',
  surface: '#131314',
  surfaceRaised: '#1A1A1C',
  surfacePressed: '#222225',
  border: 'rgba(244, 243, 239, 0.07)',
  borderStrong: 'rgba(244, 243, 239, 0.16)',
  text: '#F4F3EF',
  textMuted: 'rgba(244, 243, 239, 0.58)',
  textFaint: 'rgba(244, 243, 239, 0.32)',
  inverse: '#0B0B0C',
  danger: '#F2555A',
  success: '#5BB98B',
  scrim: 'rgba(0, 0, 0, 0.55)',
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  web: { sans: 'var(--font-display)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Physics-based motion. Every interactive animation uses one of these so motion feels consistent and interruptible. */
export const Springs = {
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  snappy: { damping: 22, stiffness: 260, mass: 0.8 },
  gentle: { damping: 20, stiffness: 140, mass: 1 },
} satisfies Record<string, WithSpringConfig>;

export const MaxContentWidth = 560;
