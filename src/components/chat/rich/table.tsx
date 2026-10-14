import { StyleSheet, Text as RNText, View } from 'react-native';

import { renderInline } from '@/components/chat/rich/inline';
import type { TableData } from '@/lib/ui-format';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

/** Up to this many columns fit a phone as a grid; wider tables become one card per row. */
const GRID_MAX_COLUMNS = 3;

export function Table({ data }: { data: TableData }) {
  const { title, columns, rows } = data;
  return (
    <View style={styles.wrap}>
      {title ? (
        <Text variant="overline" tone="faint">
          {title}
        </Text>
      ) : null}
      {columns.length <= GRID_MAX_COLUMNS ? <Grid columns={columns} rows={rows} /> : <Records columns={columns} rows={rows} />}
    </View>
  );
}

function Grid({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <View style={styles.grid}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map((c, i) => (
          <Text key={i} variant="overline" tone="muted" style={[styles.cell, i > 0 && styles.cellRight]}>
            {c}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, r > 0 && styles.divider]}>
          {columns.map((_, c) => (
            <RNText key={c} selectable style={[styles.cellText, styles.cell, c === 0 ? styles.firstCell : styles.cellRight]}>
              {renderInline(row[c] ?? '', `t${r}-${c}`)}
            </RNText>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Wide tables: the first column titles each card; the rest become label/value pairs. */
function Records({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <View style={styles.records}>
      {rows.map((row, r) => (
        <View key={r} style={styles.record}>
          <RNText selectable style={[styles.cellText, styles.recordTitle]}>
            {renderInline(row[0] ?? '', `r${r}`)}
          </RNText>
          {columns.slice(1).map((label, c) => (
            <View key={c} style={styles.pair}>
              <Text variant="caption" tone="muted" style={styles.pairLabel}>
                {label}
              </Text>
              <RNText selectable style={[styles.cellText, styles.pairValue]}>
                {renderInline(row[c + 1] ?? '—', `r${r}-${c}`)}
              </RNText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  grid: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  row: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.three },
  headerRow: { paddingBottom: Spacing.two },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  cell: { flex: 1 },
  cellRight: { textAlign: 'right' },
  firstCell: { fontWeight: '600' },
  cellText: { color: Colors.text, fontFamily: Fonts.sans, fontSize: 15, lineHeight: 21 },
  records: { gap: Spacing.two },
  record: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  recordTitle: { fontWeight: '600', fontSize: 16 },
  pair: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.four },
  pairLabel: { flexShrink: 0 },
  pairValue: { flexShrink: 1, textAlign: 'right' },
});
