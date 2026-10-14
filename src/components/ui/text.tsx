import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'overline';
type Tone = 'default' | 'muted' | 'faint' | 'inverse' | 'danger' | 'success';

type Props = TextProps & { variant?: Variant; tone?: Tone };

const TONES: Record<Tone, string> = {
  default: Colors.text,
  muted: Colors.textMuted,
  faint: Colors.textFaint,
  inverse: Colors.inverse,
  danger: Colors.danger,
  success: Colors.success,
};

export function Text({ variant = 'body', tone = 'default', style, ...rest }: Props) {
  return <RNText {...rest} style={[styles.base, styles[variant], { color: TONES[tone] }, style]} />;
}

const styles = StyleSheet.create({
  base: { fontFamily: Fonts.sans },
  display: { fontSize: 38, lineHeight: 42, fontWeight: '700', letterSpacing: -1.2 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.7 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: -0.1 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
});
