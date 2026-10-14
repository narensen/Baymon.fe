import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';

import { Markdown } from '@/components/chat/markdown';
import { renderInline } from '@/components/chat/rich/inline';
import type { CheckItem, CompareOption, ScheduleItem, Stat, Step, Tone } from '@/lib/ui-format';
import { Icon, type IconName } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

const TONE: Record<Tone, { icon: IconName; color: string; tint: string }> = {
  info: { icon: 'info', color: Colors.text, tint: Colors.borderStrong },
  tip: { icon: 'tip', color: Colors.text, tint: Colors.borderStrong },
  warning: { icon: 'warning', color: Colors.danger, tint: 'rgba(242, 85, 90, 0.35)' },
  success: { icon: 'success', color: Colors.success, tint: 'rgba(91, 185, 139, 0.35)' },
};

export function Callout({ tone, title, body }: { tone: Tone; title?: string; body: string }) {
  const t = TONE[tone];
  return (
    <View style={[styles.callout, { borderLeftColor: t.tint }]}>
      <View style={styles.calloutHead}>
        <Icon name={t.icon} size={16} color={t.color} />
        {title ? (
          <Text variant="label" style={{ color: t.color }}>
            {title}
          </Text>
        ) : null}
      </View>
      {body ? <Markdown>{body}</Markdown> : null}
    </View>
  );
}

export function Card({ title, subtitle, meta, body }: { title: string; subtitle?: string; meta?: string; body: string }) {
  return (
    <View style={styles.card}>
      {meta ? (
        <Text variant="overline" tone="faint">
          {meta}
        </Text>
      ) : null}
      <View style={styles.cardHead}>
        <Text variant="heading">{title}</Text>
        {subtitle ? <Text tone="muted">{subtitle}</Text> : null}
      </View>
      {body ? <Markdown>{body}</Markdown> : null}
    </View>
  );
}

export function Stats({ items }: { items: Stat[] }) {
  return (
    <View style={styles.statsGrid}>
      {items.map((s, i) => (
        <View key={i} style={styles.statCell}>
          <View style={styles.stat}>
            <Text variant="overline" tone="faint" numberOfLines={1}>
              {s.label}
            </Text>
            <Text variant="title" numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
            {s.note ? (
              <Text variant="caption" tone="muted">
                {s.note}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Schedule({ title, items }: { title?: string; items: ScheduleItem[] }) {
  return (
    <View style={styles.block}>
      {title ? (
        <Text variant="overline" tone="faint">
          {title}
        </Text>
      ) : null}
      <View>
        {items.map((item, i) => (
          <View key={i} style={styles.timelineRow}>
            <View style={styles.timeCol}>
              <Text style={styles.time}>{item.time ?? ''}</Text>
              {item.end ? <Text style={[styles.time, styles.timeEnd]}>{item.end}</Text> : null}
            </View>
            <View style={styles.rail}>
              <View style={styles.dot} />
              {i < items.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.timelineBody}>
              <RNText selectable style={styles.itemTitle}>
                {renderInline(item.title, `s${i}`)}
              </RNText>
              {item.note ? (
                <RNText selectable style={styles.itemNote}>
                  {renderInline(item.note, `sn${i}`)}
                </RNText>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Steps({ items }: { items: Step[] }) {
  return (
    <View>
      {items.map((step, i) => (
        <View key={i} style={styles.timelineRow}>
          <View style={styles.rail}>
            <View style={styles.stepNumber}>
              <Text variant="caption" style={styles.stepNumberText}>
                {i + 1}
              </Text>
            </View>
            {i < items.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={[styles.timelineBody, styles.stepBody]}>
            <RNText selectable style={styles.itemTitle}>
              {renderInline(step.title, `st${i}`)}
            </RNText>
            {step.detail ? (
              <RNText selectable style={styles.itemNote}>
                {renderInline(step.detail, `sd${i}`)}
              </RNText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Checklist({ title, items }: { title?: string; items: CheckItem[] }) {
  // Ticking is local to this view; the agent's reply itself doesn't change.
  const [done, setDone] = useState(() => items.map((i) => !!i.done));
  return (
    <View style={styles.card}>
      {title ? <Text variant="label">{title}</Text> : null}
      {items.map((item, i) => (
        <Pressable
          key={i}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done[i] }}
          onPress={() => {
            haptics.selection();
            setDone((d) => d.map((v, j) => (j === i ? !v : v)));
          }}
          style={styles.checkRow}>
          <Icon name={done[i] ? 'checked' : 'unchecked'} size={20} color={done[i] ? Colors.text : Colors.textFaint} />
          <RNText style={[styles.checkText, done[i] && styles.checkDone]}>{renderInline(item.text, `c${i}`)}</RNText>
        </Pressable>
      ))}
    </View>
  );
}

export function Compare({ options }: { options: CompareOption[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Let the cards run to the screen edge while staying aligned with the text column.
      style={styles.compareScroll}
      contentContainerStyle={styles.compareRow}>
      {options.map((o, i) => (
        <View key={i} style={[styles.compareCard, o.best && styles.compareBest]}>
          <View style={styles.cardHead}>
            {o.best ? (
              <Text variant="overline" tone="muted">
                Recommended
              </Text>
            ) : null}
            <Text variant="heading">{o.name}</Text>
            {o.summary ? (
              <Text variant="caption" tone="muted">
                {o.summary}
              </Text>
            ) : null}
          </View>
          {o.pros?.map((p, j) => (
            <View key={`p${j}`} style={styles.pc}>
              <Text tone="success" style={styles.pcMark}>
                +
              </Text>
              <RNText style={styles.pcText}>{renderInline(p, `p${i}-${j}`)}</RNText>
            </View>
          ))}
          {o.cons?.map((c, j) => (
            <View key={`c${j}`} style={styles.pc}>
              <Text tone="faint" style={styles.pcMark}>
                −
              </Text>
              <RNText style={[styles.pcText, styles.pcCon]}>{renderInline(c, `c${i}-${j}`)}</RNText>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export function Suggestions({ items, onPick }: { items: string[]; onPick?: (text: string) => void }) {
  if (!onPick) return null;
  return (
    <View style={styles.suggestions}>
      {items.map((s) => (
        <PressableScale key={s} haptic onPress={() => onPick(s)} style={styles.suggestion}>
          <Text variant="caption" style={styles.suggestionText}>
            {s}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const surface = {
  borderRadius: Radius.md,
  backgroundColor: Colors.surface,
  borderWidth: StyleSheet.hairlineWidth * 2,
  borderColor: Colors.border,
} as const;

const styles = StyleSheet.create({
  block: { gap: Spacing.three },
  callout: { ...surface, borderLeftWidth: 3, padding: Spacing.four, gap: Spacing.two },
  calloutHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { ...surface, padding: Spacing.four, gap: Spacing.three },
  cardHead: { gap: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', margin: -Spacing.one },
  statCell: { width: '50%', padding: Spacing.one },
  stat: { ...surface, padding: Spacing.four, gap: Spacing.one, flex: 1 },
  timelineRow: { flexDirection: 'row', gap: Spacing.three },
  timeCol: { width: 52, paddingTop: 1 },
  time: { color: Colors.textMuted, fontFamily: Fonts.mono, fontSize: 13, lineHeight: 20 },
  timeEnd: { color: Colors.textFaint },
  rail: { alignItems: 'center', width: 24 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 6,
    backgroundColor: Colors.text,
  },
  line: { flex: 1, width: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.borderStrong, marginVertical: 4 },
  timelineBody: { flex: 1, paddingBottom: Spacing.four, gap: 2 },
  stepBody: { paddingTop: 2 },
  itemTitle: { color: Colors.text, fontFamily: Fonts.sans, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  itemNote: { color: Colors.textMuted, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surfaceRaised,
  },
  stepNumberText: { fontWeight: '700', color: Colors.text },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: 2 },
  checkText: { flex: 1, color: Colors.text, fontFamily: Fonts.sans, fontSize: 15, lineHeight: 21 },
  checkDone: { color: Colors.textFaint, textDecorationLine: 'line-through' },
  compareScroll: { marginHorizontal: -Spacing.five },
  compareRow: { gap: Spacing.three, paddingHorizontal: Spacing.five },
  compareCard: { ...surface, width: 248, padding: Spacing.four, gap: Spacing.two },
  compareBest: { borderColor: Colors.text },
  pc: { flexDirection: 'row', gap: Spacing.two },
  pcMark: { width: 12, fontWeight: '700' },
  pcText: { flex: 1, color: Colors.text, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  pcCon: { color: Colors.textMuted },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  suggestion: {
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  suggestionText: { color: Colors.text, fontWeight: '600' },
});
