import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { Draft, DraftStatus } from '@/lib/ui-format';

type Props = {
  draft: Draft;
  status?: DraftStatus;
  /** Sends the (possibly edited) text; resolves how it went. */
  onSend?: (text: string) => Promise<'sent' | 'opened' | 'asked'>;
  /** Open in edit mode (a bubble's Edit). */
  autoEdit?: boolean;
  onAutoEdited?: () => void;
};

const DONE_LABEL: Record<DraftStatus | 'asked', string> = {
  sent: 'Sent',
  opened: 'Opened to send',
  asked: 'Asked Baymon to send it',
};

/** "Draft, don't send": a message Baymon wrote for you, sent only when you tap Send. */
export function DraftCard({ draft, status, onSend, autoEdit = false, onAutoEdited }: Props) {
  const [text, setText] = useState(draft.text);
  const [editing, setEditing] = useState(autoEdit && !status);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftStatus | 'asked' | null>(null);
  // Sent from elsewhere (e.g. the bubble) shows as sent here too.
  const done = status ?? result;

  useEffect(() => {
    if (autoEdit) onAutoEdited?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    if (!onSend || sending) return;
    setSending(true);
    setError(null);
    try {
      const outcome = await onSend(text);
      haptics.success();
      setEditing(false);
      setResult(outcome);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Couldn’t send it');
    } finally {
      setSending(false);
    }
  }

  const heading = ['Reply', draft.to && `to ${draft.to}`, draft.app && `· ${draft.app}`].filter(Boolean).join(' ');

  return (
    <View style={styles.card}>
      <Text variant="overline" tone="faint">
        {heading}
      </Text>
      {editing ? (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          selectionColor={Colors.text}
          placeholderTextColor={Colors.textFaint}
          placeholder="Your reply"
          accessibilityLabel="Edit the reply"
          style={styles.input}
        />
      ) : (
        <Text selectable style={styles.text}>
          {`“${text}”`}
        </Text>
      )}
      {done ? (
        <Animated.View entering={FadeIn} style={styles.doneRow}>
          <Icon name="check" size={14} color={Colors.success} />
          <Text variant="caption" tone="success">
            {DONE_LABEL[done]}
          </Text>
        </Animated.View>
      ) : (
        <View style={styles.actions}>
          <PressableScale
            haptic
            scaleTo={0.94}
            disabled={!onSend || sending || !text.trim()}
            accessibilityRole="button"
            accessibilityLabel={draft.to ? `Send to ${draft.to}` : 'Send'}
            onPress={send}
            style={[styles.button, styles.primary]}>
            {sending ? (
              <ActivityIndicator size="small" color={Colors.inverse} />
            ) : (
              <Text variant="caption" tone="inverse" style={styles.bold}>
                Send
              </Text>
            )}
          </PressableScale>
          <PressableScale
            haptic
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Done editing' : 'Edit the reply'}
            onPress={() => setEditing((e) => !e)}
            style={styles.button}>
            <Text variant="caption" style={styles.bold}>
              {editing ? 'Done' : 'Edit'}
            </Text>
          </PressableScale>
        </View>
      )}
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  text: { color: Colors.text, fontFamily: Fonts.sans, fontSize: 16, lineHeight: 23 },
  input: {
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 23,
    minHeight: 46,
    padding: Spacing.three,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  button: {
    minWidth: 72,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
  },
  primary: { backgroundColor: Colors.text, borderColor: Colors.text },
  bold: { fontWeight: '600' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
