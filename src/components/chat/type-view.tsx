import { useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LayoutAnimationConfig, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Composer, type Dictation } from '@/components/chat/composer';
import { MessageRow, TypingIndicator } from '@/components/chat/message';
import { LiveSteps } from '@/components/chat/steps';
import { VoiceOrb, type TalkPhase } from '@/components/chat/voice-orb';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, MaxContentWidth, Radius, Spacing, Springs } from '@/constants/theme';
import { useVoice } from '@/hooks/use-voice';
import { speak, transcribe } from '@/lib/agent';
import { conversation, useConversation, type ChatMessage } from '@/lib/conversation';
import { haptics } from '@/lib/haptics';
import { preferences } from '@/lib/preferences';
import { useAuth } from '@/providers/auth-provider';

/** Vertical padding of the list content; part of the scroll math in `onRowLayout`. */
const LIST_PADDING = Spacing.four;

const SUGGESTIONS = ['Plan my day', 'What do you remember about me?', 'Help me think something through'];

export function TypeView() {
  const { messages, thinking, working, editNext } = useConversation();
  const insets = useSafeAreaInsets();
  const voice = useVoice();
  const [draft, setDraft] = useState('');
  const [dictation, setDictation] = useState<Dictation>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ id: string; state: 'loading' | 'playing' } | null>(null);

  async function playMessage(message: ChatMessage) {
    setAudio({ id: message.id, state: 'loading' });
    try {
      let uri = message.audioUri;
      if (!uri) {
        uri = await speak(message.speech || message.content, preferences.get().voice);
        conversation.attachAudio(message.id, uri);
      }
      setAudio({ id: message.id, state: 'playing' });
      await voice.play(uri);
    } catch (e) {
      haptics.error();
      setNotice(e instanceof Error ? e.message : 'Couldn’t play audio');
    } finally {
      setAudio((current) => (current?.id === message.id ? null : current));
    }
  }

  function toggleAudio(message: ChatMessage) {
    if (audio?.id === message.id) {
      voice.stopPlayback();
      setAudio(null);
    } else {
      void playMessage(message);
    }
  }

  const list = useRef<FlatList<ChatMessage>>(null);

  /** The list is inverted, so offset 0 is the newest message at the bottom. */
  function scrollToLatest() {
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }));
  }

  /** A reply waiting to be brought into view once it has been laid out (and so has a height). */
  const focusId = useRef<string | null>(null);
  const viewportHeight = useRef(0);

  /**
   * Scroll so a new reply starts at the top of the screen. The list is inverted (offset 0 = bottom),
   * so its first line is `LIST_PADDING + height` above the bottom. Short replies need no scroll.
   */
  function onRowLayout(id: string, height: number) {
    if (focusId.current !== id) return;
    focusId.current = null;
    const offset = Math.max(0, LIST_PADDING + height - viewportHeight.current);
    list.current?.scrollToOffset({ offset, animated: true });
  }

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    setDraft('');
    setNotice(null);
    // Get out of the way: drop the keyboard and show the message being answered.
    Keyboard.dismiss();
    scrollToLatest();
    try {
      const reply = await conversation.send(text);
      haptics.light();
      if (reply) focusId.current = reply.id;
      // Spoken replies in type mode come back with audio when "Read replies aloud" is on.
      if (reply?.audioUri && preferences.get().speakReplies) void playMessage(reply);
    } catch {
      haptics.error();
    }
  }

  async function finishDictation() {
    setDictation('transcribing');
    try {
      const uri = await voice.stopListening();
      if (!uri) return;
      const text = await transcribe(uri);
      setDraft((current) => (current ? `${current.trimEnd()} ${text}` : text));
      haptics.selection();
    } catch (e) {
      haptics.error();
      setNotice(e instanceof Error ? e.message : 'Couldn’t transcribe that');
    } finally {
      setDictation('idle');
    }
  }

  async function onMic() {
    if (dictation === 'listening') return finishDictation();
    setNotice(null);
    const started = await voice.listen({ autoStop: true, onUtteranceEnd: finishDictation, onNoSpeech: finishDictation });
    if (started === 'ok') {
      haptics.medium();
      setDictation('listening');
    } else {
      setNotice(
        started === 'denied'
          ? 'Microphone access is off. Enable it in your device settings to dictate.'
          : 'Couldn’t start the microphone. Try again.'
      );
    }
  }

  // Newest first for the inverted list (keeps the conversation anchored to the composer).
  const data = [...messages].reverse();

  // The orb is the agent's face: it mirrors what the agent is doing right now.
  const phase: TalkPhase =
    dictation === 'listening'
      ? 'listening'
      : thinking || dictation === 'transcribing' || audio?.state === 'loading'
        ? 'thinking'
        : audio?.state === 'playing'
          ? 'speaking'
          : 'idle';

  return (
    <View style={styles.flex}>
      {messages.length === 0 ? (
        <AgentHero phase={phase} level={voice.level} onPick={send} />
      ) : (
        <>
          <AgentBar phase={phase} level={voice.level} />
          <LayoutAnimationConfig skipEntering>
          <FlatList
            ref={list}
            inverted
            onLayout={(e) => (viewportHeight.current = e.nativeEvent.layout.height)}
            data={data}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              !thinking ? null : working?.length ? (
                <LiveSteps steps={working} onStop={() => conversation.cancel()} />
              ) : (
                <TypingIndicator />
              )
            }
            renderItem={({ item, index }) => (
              <View style={styles.item} onLayout={(e) => onRowLayout(item.id, e.nativeEvent.layout.height)}>
                <MessageRow
                  message={item}
                  audio={audio?.id === item.id ? audio.state : 'idle'}
                  onToggleAudio={toggleAudio}
                  onRetry={(m) => conversation.retry(m.id)}
                  // The list is newest-first: suggestions only on the latest reply, and not mid-request.
                  onSuggest={index === 0 && item.role === 'assistant' && !thinking ? send : undefined}
                  editDraft={editNext === item.id}
                />
              </View>
            )}
          />
          </LayoutAnimationConfig>
        </>
      )}
      {notice ? <Notice key={notice} text={notice} style={styles.notice} /> : null}
      <Composer
        value={draft}
        onChangeText={setDraft}
        onSend={() => send(draft)}
        onMic={onMic}
        dictation={dictation}
        level={voice.level}
        busy={thinking}
      />
      {/* Safe-area padding when closed; rides on top of the keyboard, with a small gap, when open. */}
      <KeyboardSpacer min={Math.max(insets.bottom, Spacing.three)} subtract={-Spacing.two} />
    </View>
  );
}

const STATUS: Record<TalkPhase, string> = {
  idle: 'Tap me to talk, or type below',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

type AgentProps = { phase: TalkPhase; level: SharedValue<number> };

const talk = () => conversation.setMode('talk');

/** Empty conversation: the agent, center stage. */
function AgentHero({ phase, level, onPick }: AgentProps & { onPick: (text: string) => void }) {
  const { profile } = useAuth();
  const firstName = profile?.display_name.split(' ')[0];
  return (
    <View style={styles.hero}>
      <Animated.View entering={FadeIn.duration(700)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Talk to Baymon" onPress={talk} style={styles.heroOrb}>
          <VoiceOrb phase={phase} level={level} size={150} />
        </Pressable>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(100).springify().damping(Springs.gentle.damping)} style={styles.heroCopy}>
        <Text variant="title" style={styles.center}>
          {firstName ? `Hi ${firstName}, I’m Baymon.` : 'Hi, I’m Baymon.'}
        </Text>
        <Animated.View key={phase} entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)}>
          <Text tone="muted" style={styles.center}>
            {STATUS[phase]}
          </Text>
        </Animated.View>
      </Animated.View>
      <View style={styles.suggestions}>
        {SUGGESTIONS.map((s, i) => (
          <Animated.View key={s} entering={FadeInDown.delay(180 + i * 60).springify().damping(Springs.snappy.damping)}>
            <PressableScale haptic onPress={() => onPick(s)} style={styles.suggestion}>
              <Text tone="muted">{s}</Text>
            </PressableScale>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** During a conversation the agent stays present as a compact live orb. */
function AgentBar({ phase, level }: AgentProps) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Talk to Baymon" onPress={talk} style={styles.barInner}>
        <VoiceOrb phase={phase} level={level} size={30} />
        <View>
          <Text variant="label">Baymon</Text>
          <Animated.View key={phase} entering={FadeIn.duration(200)}>
            <Text variant="caption" tone="faint">
              {phase === 'idle' ? 'Tap to talk' : STATUS[phase]}
            </Text>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: {
    paddingHorizontal: Spacing.five,
    paddingVertical: LIST_PADDING,
    width: '100%',
    maxWidth: MaxContentWidth + Spacing.five * 2,
    alignSelf: 'center',
  },
  item: { paddingVertical: Spacing.three },
  notice: { marginHorizontal: Spacing.four, marginBottom: Spacing.one },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four, padding: Spacing.five },
  // The orb reserves room for its glow; pull the text up into that space.
  heroOrb: { marginVertical: -Spacing.six },
  heroCopy: { gap: Spacing.two, alignItems: 'center' },
  bar: {
    alignItems: 'center',
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  barInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingRight: Spacing.four },
  center: { textAlign: 'center' },
  suggestions: { gap: Spacing.two, alignItems: 'center' },
  suggestion: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
});
