import { useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { BaymonAgent } from '@/modules/baymon-agent';
import { haptics } from '@/lib/haptics';
import { preferences, usePreferences } from '@/lib/preferences';
import { applyWakeWord, useWakeWord, WAKE_WORDS, wakeWord, wakeWordAvailable } from '@/lib/quick-access';
import { hasNativeAgent } from '@/lib/tools/native';

const BUBBLE_VOICE = ['off', 'headphones', 'always'] as const;

/** Reaching Baymon without opening it first, and answering bubbles by voice. */
export function QuickAccessSettings() {
  const { bubbleVoice } = usePreferences();
  const [notice, setNotice] = useState<string | null>(null);

  async function addTile() {
    haptics.selection();
    const result = await BaymonAgent?.requestAddTile().catch(() => 'failed' as const);
    setNotice(
      result === 'added' || result === 'already_added'
        ? 'The Baymon tile is in Quick Settings.'
        : result === 'not_added'
          ? null
          : 'Pull down Quick Settings, tap the pencil (edit), and drag the Baymon tile in.'
    );
  }

  function addWidget() {
    haptics.selection();
    const asked = BaymonAgent?.requestAddWidget() ?? false;
    if (!asked) setNotice('Long-press an empty spot on your home screen → Widgets → Baymon.');
  }

  return (
    <View style={styles.container}>
      {hasNativeAgent ? (
        <View style={styles.card}>
          <Row
            title="Quick Settings tile"
            detail="Pull down from the top, tap Baymon, talk."
            right={<Action label="Add" onPress={addTile} />}
          />
          <View style={styles.divider} />
          <Row
            title="Home screen widget"
            detail="One tap on your home screen starts talking."
            right={<Action label="Add" onPress={addWidget} />}
          />
          <View style={styles.divider} />
          <Row
            title="Assistant gesture"
            detail="Set Baymon as the digital assistant app, then hold the power button or swipe up from a bottom corner (depends on your phone)."
            right={
              <Action
                label="Set up"
                onPress={() => {
                  haptics.selection();
                  BaymonAgent?.openSystemSettings('assistant');
                }}
              />
            }
          />
        </View>
      ) : (
        <Text variant="caption" tone="faint" style={styles.note}>
          The tile, widget, assistant gesture and wake word need the Baymon build on Android.
        </Text>
      )}

      <View style={styles.block}>
        <Text style={styles.label}>Answer bubbles by voice</Text>
        <Text variant="caption" tone="faint" style={styles.note}>
          Tapping a bubble reads it out and listens for your answer. “Headphones” means only when earbuds or car audio
          are connected.
        </Text>
        <SegmentedControl
          options={BUBBLE_VOICE}
          value={bubbleVoice}
          onChange={(next) => preferences.set({ bubbleVoice: next })}
        />
      </View>

      {wakeWordAvailable ? <WakeWord onNotice={setNotice} /> : null}

      {notice ? <Notice key={notice} text={notice} error={false} /> : null}
    </View>
  );
}

function WakeWord({ onNotice }: { onNotice: (text: string | null) => void }) {
  const settings = useWakeWord();
  const [key, setKey] = useState(settings.accessKey);
  const [status, setStatus] = useState(wakeWord.status());

  useEffect(() => {
    const refresh = () => setStatus(wakeWord.status());
    const timer = setInterval(refresh, 3_000);
    const sub = AppState.addEventListener('change', refresh);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  async function apply(patch: Partial<typeof settings>) {
    wakeWord.set(patch);
    const problem = await applyWakeWord();
    onNotice(problem);
    setStatus(wakeWord.status());
  }

  const keywords = settings.customPath ? ([...WAKE_WORDS, 'custom'] as const) : WAKE_WORDS;
  const shown = settings.keyword === 'custom' && !settings.customPath ? 'jarvis' : settings.keyword;

  return (
    <View style={styles.card}>
      <Row
        title="Wake word"
        detail="Say it while Baymon is in the background and it opens, listening. Runs on the phone (Picovoice); audio never leaves it."
        right={
          <Switch
            value={settings.enabled}
            onValueChange={(enabled) => void apply({ enabled, accessKey: key.trim() })}
            accessibilityLabel="Wake word"
          />
        }
      />
      {settings.enabled ? (
        <Animated.View entering={FadeIn} style={styles.wakeBody}>
          <SegmentedControl options={keywords} value={shown} onChange={(keyword) => void apply({ keyword })} />
          <TextField
            label="Picovoice AccessKey"
            value={key}
            onChangeText={setKey}
            onBlur={() => key.trim() !== settings.accessKey && void apply({ accessKey: key.trim() })}
            secure
            autoCapitalize="none"
            autoCorrect={false}
            hint="Free for personal use at console.picovoice.ai. To use “Hey Baymon”, train it there, download the Android .ppn file and share it to Baymon."
          />
          <Text variant="caption" tone={status?.error ? 'danger' : 'faint'}>
            {status?.error
              ? status.error
              : status?.listening
                ? 'Listening.'
                : status?.running
                  ? 'Ready. Listens while Baymon is in the background.'
                  : 'Starts when you open Baymon (after a restart, open it once).'}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Row({ title, detail, right }: { title: string; detail: string; right: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text>{title}</Text>
        <Text variant="caption" tone="faint">
          {detail}
        </Text>
      </View>
      {right}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableScale scaleTo={0.92} accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Text variant="caption" tone="inverse" style={styles.bold}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  card: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.four,
  },
  block: { gap: Spacing.two },
  label: { paddingHorizontal: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, paddingVertical: Spacing.three + 2 },
  rowText: { flex: 1, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  note: { paddingHorizontal: Spacing.one },
  wakeBody: { gap: Spacing.three, paddingBottom: Spacing.four },
  action: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.text,
  },
  bold: { fontWeight: '600' },
});
