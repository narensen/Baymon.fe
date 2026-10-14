import { ScrollView, StyleSheet, Text as RNText, View } from 'react-native';

import { renderInline } from '@/components/chat/rich/inline';
import { Table } from '@/components/chat/rich/table';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'rule' }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'paragraph'; text: string };

const LIST_ITEM = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|?.*\|.*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Line-based block parser covering what the agent actually emits. */
function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    // GitHub-style pipe table: header row, then a |---|---| rule.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const columns = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', columns, rows });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ kind: 'quote', text: body.join('\n') });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const next = lines[i].match(LIST_ITEM);
        if (next) items.push(next[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !(TABLE_ROW.test(lines[i]) && TABLE_RULE.test(lines[i + 1] ?? ''))
    ) {
      body.push(lines[i++].trim());
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

/** Renders the agent's Markdown in the app's type system. Text is selectable for copying. */
export function Markdown({ children }: { children: string }) {
  const blocks = parseBlocks(children);
  return (
    <View style={styles.root}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'code':
            return (
              <View key={i} style={styles.codeBlock}>
                {block.lang ? <RNText style={styles.codeLang}>{block.lang}</RNText> : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <RNText selectable style={styles.code}>
                    {block.text}
                  </RNText>
                </ScrollView>
              </View>
            );
          case 'heading':
            return (
              <RNText key={i} selectable style={[styles.text, block.level <= 2 ? styles.h1 : styles.h3]}>
                {renderInline(block.text, `h${i}`)}
              </RNText>
            );
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <RNText selectable style={[styles.text, styles.quoteText]}>
                  {renderInline(block.text, `q${i}`)}
                </RNText>
              </View>
            );
          case 'list':
            return (
              <View key={i} style={styles.list}>
                {block.items.map((item, j) => (
                  <View key={j} style={styles.listItem}>
                    <RNText style={[styles.text, styles.bullet]}>{block.ordered ? `${j + 1}.` : '•'}</RNText>
                    <RNText selectable style={[styles.text, styles.listText]}>
                      {renderInline(item, `l${i}-${j}`)}
                    </RNText>
                  </View>
                ))}
              </View>
            );
          case 'rule':
            return <View key={i} style={styles.rule} />;
          case 'table':
            return <Table key={i} data={{ columns: block.columns, rows: block.rows }} />;
          default:
            return (
              <RNText key={i} selectable style={styles.text}>
                {renderInline(block.text, `p${i}`)}
              </RNText>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  text: { color: Colors.text, fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24, letterSpacing: -0.1 },
  h1: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  codeBlock: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  codeLang: {
    color: Colors.textFaint,
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  code: { color: Colors.text, fontFamily: Fonts.mono, fontSize: 13.5, lineHeight: 20 },
  quote: { borderLeftWidth: 2, borderLeftColor: Colors.borderStrong, paddingLeft: Spacing.four },
  quoteText: { color: Colors.textMuted },
  list: { gap: Spacing.two },
  listItem: { flexDirection: 'row', gap: Spacing.three },
  bullet: { minWidth: 14, color: Colors.textMuted },
  listText: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.borderStrong },
});
