import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Fonts, Radius, Spacing, Springs } from '@/constants/theme';
import { MESSAGE_MAX_CHARS } from '@/lib/agent';
import { attachmentKind, uploadAttachment, type AttachmentRef } from '@/lib/attachments';
import { conversation } from '@/lib/conversation';
import { haptics } from '@/lib/haptics';
import { applyWakeWord, incomingShare, useIncomingShare, wakeWord } from '@/lib/quick-access';
import type { SharedItem } from '@/modules/baymon-agent';

const ACTIONS = [
  { label: 'What’s this?', prompt: 'What’s this?' },
  { label: 'Summarise', prompt: 'Summarise this.' },
  { label: 'Save to memory', prompt: 'Save the important details from this to memory.' },
  { label: 'Remind me', prompt: 'Remind me about this. Ask me when if it isn’t clear.' },
] as const;

const URL_ONLY = /^https?:\/\/\S+$/i;

function formatSize(bytes?: number) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const isWakeWordFile = (item: SharedItem) => item.type === 'file' && item.name.toLowerCase().endsWith('.ppn');

/** "Share → Baymon" from any app: ask about it, summarise it, save it, or get reminded. */
export default function ShareScreen() {
  const insets = useSafeAreaInsets();
  const share = useIncomingShare();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!share) {
    return (
      <View style={[styles.empty, { paddingBottom: insets.bottom + Spacing.five }]}>
        <Text tone="muted">Nothing was shared.</Text>
        <Button label="Close" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const files = share.items.filter((i): i is Extract<SharedItem, { type: 'file' }> => i.type === 'file');
  const texts = share.items.filter((i): i is Extract<SharedItem, { type: 'text' }> => i.type === 'text');
  const readable = files.filter((f) => f.uri && !f.error && !isWakeWordFile(f));

  async function send(prompt: string) {
    const ask = prompt.trim();
    if (!ask || busy) return;
    setError(null);
    try {
      const attachments: AttachmentRef[] = [];
      for (const [i, file] of readable.entries()) {
        setBusy(readable.length > 1 ? `Uploading ${i + 1} of ${readable.length}…` : 'Uploading…');
        const uploaded = await uploadAttachment({ uri: file.uri!, name: file.name, mime: file.mime });
        attachments.push({
          id: uploaded.id,
          kind: uploaded.kind ?? attachmentKind(file.mime, file.name),
          name: file.name,
          mime: uploaded.mime ?? file.mime ?? '',
          uri: file.uri,
        });
      }
      const shared = texts
        .map((t) => [t.subject && t.subject !== t.text ? t.subject : null, t.text].filter(Boolean).join('\n'))
        .join('\n\n');
      const source = share?.from ? `Shared from ${share.from}` : 'Shared';
      const body = shared ? `${ask}\n\n${source}:\n${shared}` : share?.from ? `${ask} (${source.toLowerCase()})` : ask;
      haptics.success();
      incomingShare.clear();
      conversation.setMode('type');
      router.back();
      void conversation.send(body.slice(0, MESSAGE_MAX_CHARS), { attachments }).catch(() => {});
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : 'Couldn’t send that to Baymon');
    } finally {
      setBusy(null);
    }
  }

  /** A trained keyword file ("Hey Baymon" from the Picovoice Console) becomes the wake word. */
  async function setWakeWordFile(item: Extract<SharedItem, { type: 'file' }>) {
    if (!item.uri) return;
    setError(null);
    try {
      const target = new File(Paths.document, 'wake-word.ppn');
      if (target.exists) target.delete();
      new File(item.uri).copy(target);
      wakeWord.set({ keyword: 'custom', customPath: decodeURIComponent(target.uri.replace(/^file:\/\//, '')), enabled: true });
      const problem = await applyWakeWord();
      haptics.success();
      setNote(problem ?? 'Saved as your wake word. Baymon listens for it while it’s in the background.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t use that file');
    }
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + Spacing.four }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text variant="title">Shared with Baymon</Text>
          {share.from ? <Text tone="muted">From {share.from}</Text> : null}
        </View>

        <View style={styles.items}>
          {share.items.map((item, i) => (
            <Animated.View key={i} entering={FadeInDown.delay(i * 50).springify().damping(Springs.snappy.damping)}>
              {item.type === 'text' ? (
                <TextPreview text={item.text} subject={item.subject} />
              ) : isWakeWordFile(item) ? (
                <View style={styles.card}>
                  <View style={styles.fileRow}>
                    <Icon name="mic" size={18} color={Colors.text} />
                    <View style={styles.flex}>
                      <Text numberOfLines={1}>{item.name}</Text>
                      <Text variant="caption" tone="faint">
                        A wake word file from the Picovoice Console.
                      </Text>
                    </View>
                  </View>
                  <Button label="Use as wake word" onPress={() => setWakeWordFile(item)} />
                </View>
              ) : (
                <FilePreview item={item} />
              )}
            </Animated.View>
          ))}
        </View>

        <View style={styles.actions}>
          {ACTIONS.map((a) => (
            <PressableScale
              key={a.label}
              haptic
              scaleTo={0.95}
              disabled={!!busy}
              accessibilityRole="button"
              onPress={() => send(a.prompt)}
              style={styles.action}>
              <Text variant="caption" style={styles.actionText}>
                {a.label}
              </Text>
            </PressableScale>
          ))}
        </View>

        {note ? <Notice key={note} text={note} error={false} /> : null}
        {error ? <Notice key={error} text={error} /> : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask Baymon about this…"
          placeholderTextColor={Colors.textFaint}
          selectionColor={Colors.text}
          multiline
          style={styles.input}
          accessibilityLabel="Ask Baymon about this"
        />
        <Button label={busy ?? 'Send'} loading={!!busy} disabled={!question.trim()} onPress={() => send(question)} />
      </View>
    </View>
  );
}

function TextPreview({ text, subject }: { text: string; subject?: string | null }) {
  if (URL_ONLY.test(text.trim())) {
    let host = text;
    try {
      host = new URL(text.trim()).host.replace(/^www\./, '');
    } catch {}
    return (
      <View style={[styles.card, styles.fileRow]}>
        <Icon name="link" size={18} color={Colors.text} />
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {subject || host}
          </Text>
          <Text variant="caption" tone="faint" numberOfLines={1}>
            {text.trim()}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      {subject ? <Text variant="label">{subject}</Text> : null}
      <Text tone="muted" numberOfLines={8} style={styles.quote}>
        {text}
      </Text>
    </View>
  );
}

function FilePreview({ item }: { item: Extract<SharedItem, { type: 'file' }> }) {
  const kind = attachmentKind(item.mime, item.name);
  if (kind === 'image' && item.uri && !item.error) {
    return (
      <Animated.View entering={FadeIn} style={styles.card}>
        <Image source={{ uri: item.uri }} style={styles.image} contentFit="contain" accessibilityLabel={item.name} />
        <Text variant="caption" tone="faint" numberOfLines={1}>
          {item.name}
        </Text>
      </Animated.View>
    );
  }
  return (
    <View style={[styles.card, styles.fileRow]}>
      <Icon name={kind === 'image' ? 'image' : 'doc'} size={18} color={item.error ? Colors.danger : Colors.text} />
      <View style={styles.flex}>
        <Text numberOfLines={1}>{item.name}</Text>
        <Text variant="caption" tone={item.error ? 'danger' : 'faint'}>
          {item.error === 'too_large'
            ? 'Too big to send (max 25 MB)'
            : item.error
              ? 'Couldn’t read this file'
              : [kind === 'pdf' ? 'PDF' : item.mime, formatSize(item.size)].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1, gap: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, backgroundColor: Colors.surface },
  content: { padding: Spacing.five, gap: Spacing.four },
  header: { gap: Spacing.one },
  items: { gap: Spacing.three },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  quote: { fontFamily: Fonts.sans },
  image: { width: '100%', height: 220, borderRadius: Radius.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  action: {
    paddingHorizontal: Spacing.three + 2,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.background,
  },
  actionText: { color: Colors.text, fontWeight: '600' },
  composer: { gap: Spacing.three, paddingHorizontal: Spacing.five, paddingTop: Spacing.three },
  input: {
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
});
