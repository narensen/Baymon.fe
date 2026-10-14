import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VoiceOrb, type TalkPhase } from '@/components/chat/voice-orb';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Spacing } from '@/constants/theme';
import { useVoice } from '@/hooks/use-voice';
import { ApiError } from '@/lib/api';
import { toSpeakable } from '@/lib/agent';
import { conversation, useConversation } from '@/lib/conversation';
import { haptics } from '@/lib/haptics';

const STATUS: Record<TalkPhase, string> = {
  idle: 'Tap to talk',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking · tap to interrupt',
};

/**
 * Hands-free voice conversation: listen → detect end of speech → transcribe → reply with audio → listen again.
 * Every async step checks `session` so a tap, a mode switch or unmount cancels cleanly.
 */
export function TalkView() {
  const insets = useSafeAreaInsets();
  const voice = useVoice();
  const { messages } = useConversation();
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const [heard, setHeard] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = useRef(0);

  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant');

  async function listen() {
    const id = ++session.current;
    const started = await voice.listen({
      autoStop: true,
      onUtteranceEnd: () => respond(id),
      onNoSpeech: () => {
        if (session.current !== id) return;
        void voice.stopListening();
        setPhase('idle');
      },
    });
    if (session.current !== id) return;
    setNotice(null);
    if (started !== 'ok') {
      setPhase('idle');
      setNotice(
        started === 'denied'
          ? 'Microphone access is off. Enable it in your device settings to talk.'
          : 'Couldn’t start the microphone. Tap to try again.'
      );
      return;
    }
    haptics.light();
    setPhase('listening');
  }

  async function respond(id: number) {
    if (session.current !== id) return;
    // A new turn: never show the previous turn's words while this one is processed.
    setHeard(null);
    setPhase('thinking');
    haptics.selection();
    try {
      const uri = await voice.stopListening();
      if (!uri || session.current !== id) return;
      const reply = await conversation.sendVoice(uri, {
        onTranscript: (text) => session.current === id && setHeard(text),
      });
      // Once the agent has answered, its words replace the user's.
      setHeard(null);
      if (!reply || session.current !== id) return;
      // The agent may have switched to typing via its switch_mode tool; the parent swaps views.
      if (conversation.getMode() !== 'talk') return;
      if (reply.warnings) setNotice(reply.warnings.join(' '));

      if (reply.audioUri) {
        setPhase('speaking');
        await voice.play(reply.audioUri);
        if (session.current !== id) return;
      }
      void listen();
    } catch (e) {
      if (session.current !== id) return;
      if (e instanceof ApiError && e.code === 'transcription_empty') {
        setNotice('Didn’t catch that. Go ahead.');
        void listen();
        return;
      }
      haptics.error();
      setNotice(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('idle');
    }
  }

  function stop() {
    session.current++;
    voice.stopPlayback();
    void voice.stopListening();
    setPhase('idle');
  }

  function onOrbPress() {
    if (phase === 'listening') {
      // Done talking: don't wait for the silence timeout.
      void respond(session.current);
    } else if (phase === 'speaking' || phase === 'idle') {
      voice.stopPlayback();
      void listen();
    }
  }

  // Start listening as soon as talk mode opens; stop everything when leaving it.
  useEffect(() => {
    void listen();
    const sessions = session;
    return () => {
      sessions.current++;
      voice.stopPlayback();
      void voice.stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While thinking, echo this turn's words if known; otherwise keep the agent's last words on screen.
  const caption =
    phase === 'thinking' ? heard : lastReply && (lastReply.caption ?? lastReply.speech ?? toSpeakable(lastReply.content));

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing.five }]}>
      <View style={styles.stage}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STATUS[phase]}
          onPress={onOrbPress}
          disabled={phase === 'thinking'}>
          <VoiceOrb phase={phase} level={voice.level} />
        </Pressable>

        <Animated.View key={phase} entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(120)}>
          <Text variant="overline" tone="muted" style={styles.center}>
            {STATUS[phase]}
          </Text>
        </Animated.View>

        <View style={styles.captionBox}>
          {caption ? (
            <Animated.View key={caption} entering={FadeIn.duration(320)} exiting={FadeOut.duration(160)}>
              {/* Never truncated: a long caption scrolls inside a fixed area. */}
              <ScrollView style={styles.captionScroll} showsVerticalScrollIndicator={false}>
                <Text tone={phase === 'thinking' ? 'default' : 'muted'} style={[styles.center, styles.caption]}>
                  {phase === 'thinking' ? `“${caption}”` : caption}
                </Text>
              </ScrollView>
            </Animated.View>
          ) : null}
          {notice ? (
            <Animated.View key={notice} entering={FadeIn}>
              <Text variant="caption" tone="danger" style={styles.center}>
                {notice}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>

      <View style={styles.controls}>
        <PressableScale
          haptic
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel="Switch to typing"
          onPress={() => conversation.setMode('type')}
          style={styles.control}>
          <Icon name="keyboard" size={20} color={Colors.textMuted} />
        </PressableScale>
        <PressableScale
          haptic
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel={phase === 'idle' ? 'Start talking' : 'Pause'}
          onPress={phase === 'idle' ? listen : stop}
          style={[styles.control, styles.primary]}>
          <Icon name={phase === 'idle' ? 'mic' : 'pause'} size={22} color={Colors.inverse} />
        </PressableScale>
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.five },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  center: { textAlign: 'center' },
  captionBox: { minHeight: 120, maxWidth: 520, gap: Spacing.two, paddingHorizontal: Spacing.two },
  captionScroll: { maxHeight: 150 },
  caption: { fontSize: 17, lineHeight: 25 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.six },
  control: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
  },
  spacer: { width: 56, height: 56 },
  primary: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.text, borderColor: Colors.text },
});
