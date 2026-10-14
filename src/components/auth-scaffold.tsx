import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Text } from '@/components/ui/text';
import { Colors, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';

/** Staggered spring entrance for stacked form elements. */
export const enter = (index: number) =>
  FadeInDown.delay(80 + index * 55)
    .springify()
    .damping(Springs.snappy.damping)
    .stiffness(Springs.snappy.stiffness);

type Props = PropsWithChildren<{
  title: string;
  subtitle: string;
  footer?: ReactNode;
}>;

export function AuthScaffold({ title, subtitle, footer, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.flex}>
        <ScrollView
          // iOS insets the scroll view natively and scrolls the focused field into view.
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          <View style={styles.inner}>
            <Animated.View entering={FadeIn.duration(500)} style={styles.mark}>
              <BrandMark />
            </Animated.View>
            <Animated.View entering={enter(0)} style={styles.header}>
              <Text variant="display">{title}</Text>
              <Text tone="muted">{subtitle}</Text>
            </Animated.View>
            <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.form}>
              {children}
            </Animated.View>
          </View>
          {footer && (
            <Animated.View entering={FadeIn.delay(400).duration(400)} style={styles.footer}>
              {footer}
            </Animated.View>
          )}
        </ScrollView>
      </View>
      {/* Android: shrink the scroll view above the keyboard; it keeps the focused field visible. */}
      <KeyboardSpacer platforms="android" subtract={insets.bottom} />
    </SafeAreaView>
  );
}

/** Form-level error with an animated entrance/exit. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Animated.View
      key={message}
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOut.duration(140)}
      style={styles.error}>
      <Text variant="caption" tone="danger">
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.seven,
    paddingBottom: Spacing.five,
  },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.six },
  mark: { alignSelf: 'flex-start' },
  header: { gap: Spacing.two },
  form: { gap: Spacing.three },
  footer: { alignItems: 'center', paddingTop: Spacing.six },
  error: {
    borderRadius: Radius.sm,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(242, 85, 90, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242, 85, 90, 0.24)',
  },
});
