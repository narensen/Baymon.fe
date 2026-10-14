import * as WebBrowser from 'expo-web-browser';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Inline Markdown (`code`, **bold**, *italic*, ~~strike~~, [links](url)) as nested Text. */
export function renderInline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const [token] = match;
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (match[1]) {
      out.push(
        <Text key={k} style={styles.code}>
          {token.slice(1, -1)}
        </Text>
      );
    } else if (match[2]) {
      out.push(
        <Text key={k} style={styles.bold}>
          {renderInline(token.slice(2, -2), k)}
        </Text>
      );
    } else if (match[3]) {
      out.push(
        <Text key={k} style={styles.italic}>
          {renderInline(token.slice(1, -1), k)}
        </Text>
      );
    } else if (match[4]) {
      out.push(
        <Text key={k} style={styles.strike}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (match[5]) {
      const [, label, url] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? [];
      out.push(
        <Text key={k} style={styles.link} onPress={() => WebBrowser.openBrowserAsync(url)} accessibilityRole="link">
          {label}
        </Text>
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through', color: Colors.textMuted },
  link: { textDecorationLine: 'underline', textDecorationColor: Colors.textFaint },
  code: { fontFamily: Fonts.mono, fontSize: 14, backgroundColor: Colors.surfaceRaised, color: Colors.text },
});
