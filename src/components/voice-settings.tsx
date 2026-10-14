import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { speak, VOICES, type Voice } from '@/lib/agent';
import { haptics } from '@/lib/haptics';
import { preferences, usePreferences } from '@/lib/preferences';

/** Voice choice (previewed through /v1/speak) and auto-read toggle. Saved on device instantly. */
export function VoiceSettings() {
  const { voice, speakReplies } = usePreferences();
  const player = useAudioPlayer(null);
  const [previewing, setPreviewing] = useState<Voice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Voice) {
    haptics.selection();
    preferences.set({ voice: next });
    setError(null);
    setPreviewing(next);
    try {
      const name = next.charAt(0).toUpperCase() + next.slice(1);
      const uri = await speak(`Hi, I'm ${name}. This is how I'll sound.`, next);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      player.replace(uri);
      player.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t play a preview');
    } finally {
      setPreviewing((current) => (current === next ? null : current));
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {VOICES.map((option) => {
          const selected = option === voice;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityHint="Selects this voice and plays a preview"
              onPress={() => choose(option)}
              style={styles.cell}>
              <Animated.View
                style={[
                  styles.voice,
                  {
                    backgroundColor: selected ? Colors.text : Colors.surface,
                    borderColor: selected ? Colors.text : Colors.border,
                    transitionProperty: ['backgroundColor', 'borderColor'],
                    transitionDuration: 180,
                  },
                ]}>
                <Text variant="label" tone={selected ? 'inverse' : 'default'} style={styles.voiceName}>
                  {option}
                </Text>
                {previewing === option ? (
                  <ActivityIndicator size="small" color={selected ? Colors.inverse : Colors.textMuted} />
                ) : (
                  <Icon name="speaker" size={14} color={selected ? Colors.inverse : Colors.textFaint} />
                )}
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <Animated.View entering={FadeIn}>
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        </Animated.View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text>Read replies aloud</Text>
          <Text variant="caption" tone="faint">
            Speak every reply while typing, not just in voice mode.
          </Text>
        </View>
        <Switch
          value={speakReplies}
          onValueChange={(next) => preferences.set({ speakReplies: next })}
          accessibilityLabel="Read replies aloud"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -Spacing.one },
  cell: { width: '33.333%', padding: Spacing.one },
  voice: {
    height: 50,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  voiceName: { textTransform: 'capitalize' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
  },
  rowText: { flex: 1, gap: 2 },
});
