import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Markdown } from '@/components/chat/markdown';
import { Callout, Card, Checklist, Compare, Schedule, Stats, Steps, Suggestions } from '@/components/chat/rich/blocks';
import { parseRich, type Segment } from '@/lib/ui-format';
import { Table } from '@/components/chat/rich/table';
import { Spacing, Springs } from '@/constants/theme';

type Props = {
  text: string;
  /** Tapping a suggestion sends it. Omit to hide suggestions (e.g. on older messages). */
  onSuggest?: (text: string) => void;
  /** Play the block-by-block entrance (new replies only). */
  animate?: boolean;
};

/** An agent reply: Markdown plus the UI tags described in docs/agent-ui-format.md. */
export function RichText({ text, onSuggest, animate = false }: Props) {
  const segments = parseRich(text).filter((s) => s.kind !== 'suggestions' || onSuggest);
  return (
    <View style={styles.root}>
      {segments.map((segment, i) => (
        <Animated.View
          key={i}
          entering={animate ? FadeInDown.delay(i * 70).springify().damping(Springs.snappy.damping) : undefined}>
          <Block segment={segment} onSuggest={onSuggest} />
        </Animated.View>
      ))}
    </View>
  );
}

function Block({ segment, onSuggest }: { segment: Segment; onSuggest?: (text: string) => void }) {
  switch (segment.kind) {
    case 'markdown':
      return <Markdown>{segment.text}</Markdown>;
    case 'callout':
      return <Callout tone={segment.tone} title={segment.title} body={segment.body} />;
    case 'card':
      return <Card title={segment.title} subtitle={segment.subtitle} meta={segment.meta} body={segment.body} />;
    case 'table':
      return <Table data={segment.data} />;
    case 'stats':
      return <Stats items={segment.items} />;
    case 'schedule':
      return <Schedule title={segment.title} items={segment.items} />;
    case 'steps':
      return <Steps items={segment.items} />;
    case 'checklist':
      return <Checklist title={segment.title} items={segment.items} />;
    case 'compare':
      return <Compare options={segment.options} />;
    case 'suggestions':
      return <Suggestions items={segment.items} onPick={onSuggest} />;
  }
}

const styles = StyleSheet.create({
  root: { gap: Spacing.four },
});
