import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VoiceOrb, type TalkPhase } from '@/components/chat/voice-orb';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Colors, Spacing, Springs } from '@/constants/theme';
import { useVoice } from '@/hooks/use-voice';
import { ApiError } from '@/lib/api';
import { speak, toSpeakable } from '@/lib/agent';
import { conversation, useConversation } from '@/lib/conversation';
import { haptics } from '@/lib/haptics';
import { preferences } from '@/lib/preferences';

/**
 * Height the rest of the screen needs besides the orb: header, status line, caption, a notice of a
 * few lines, controls and gaps. The orb gets what's left, so small screens shrink the orb rather
 * than pushing text off the bottom.
 */
const RESERVED_HEIGHT = 440;
const ORB_MAX = 210;
const ORB_MIN = 120;

/** Things above the notice glide out of its way instead of jumping. */
const glide = LinearTransition.springify().damping(Springs.snappy.damping).stiffness(Springs.snappy.stiffness);

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
  const { height } = useWindowDimensions();
  const available = height - insets.top - insets.bottom - RESERVED_HEIGHT;
  // The orb's canvas is 1.5× its size (room for the glow).
  const orbSize = Math.round(Math.min(ORB_MAX, Math.max(ORB_MIN, available / 1.5)));
  const captionHeight = Math.round(Math.min(150, height * 0.18));
  const voice = useVoice();
  const { messages, working, speakNext, listenRequest } = useConversation();
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const isWorking = phase === 'thinking' && !!working?.length;
  const [heard, setHeard] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Informational notices (e.g. "didn't catch that") are muted; failures are red. */
  const [noticeIsError, setNoticeIsError] = useState(true);
  const session = useRef(0);
  // Mic and speaker toggles: state drives the UI, refs let an in-flight turn see the latest choice.
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const micOnRef = useRef(true);
  const speakerOnRef = useRef(true);

  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant');

  async function listen() {
    if (!micOnRef.current) {
      setPhase('idle');
      return;
    }
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
      setNoticeIsError(true);
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
      if (reply.warnings) {
        setNoticeIsError(true);
        setNotice(reply.warnings.join(' '));
      }

      // Speaker off: the reply is shown as a caption only.
      if (reply.audioUri && speakerOnRef.current) {
        setPhase('speaking');
        await voice.play(reply.audioUri);
        if (session.current !== id) return;
      }
      // Mic off: finish this turn, then wait instead of listening again.
      void listen();
    } catch (e) {
      if (session.current !== id) return;
      if (e instanceof ApiError && (e.code === 'transcription_empty' || e.code === 'audio_empty')) {
        setNoticeIsError(false);
        // With the mic off there's no "go ahead": just settle back to idle.
        setNotice(micOnRef.current ? 'Didn’t catch that. Go ahead.' : null);
        void listen();
        return;
      }
      // Shows up in the Expo terminal, with the code and status needed to tell client and server failures apart.
      console.warn(
        '[talk] turn failed:',
        e instanceof ApiError ? `${e.code} (HTTP ${e.status || 'n/a'}): ${e.message}` : e
      );
      haptics.error();
      setNoticeIsError(true);
      setNotice(e instanceof Error ? e.message : 'Something went wrong');
      setPhase('idle');
    }
  }

  /** Baymon speaks first (a bubble answered by voice): read the message out, then listen. */
  async function speakFirst() {
    const message = conversation.consumeSpeakNext();
    if (!message) return false;
    const id = ++session.current;
    void voice.stopListening();
    voice.stopPlayback();
    setHeard(null);
    setPhase('thinking');
    try {
      let uri = message.audioUri;
      if (!uri) {
        uri = await speak(message.content, preferences.get().voice);
        conversation.attachAudio(message.id, uri);
      }
      if (session.current !== id) return true;
      if (speakerOnRef.current) {
        setPhase('speaking');
        await voice.play(uri);
        if (session.current !== id) return true;
      }
    } catch (e) {
      if (session.current !== id) return true;
      setNoticeIsError(true);
      setNotice(e instanceof Error ? e.message : 'Couldn’t read that out');
    }
    void listen();
    return true;
  }

  function toggleMic() {
    const next = !micOnRef.current;
    micOnRef.current = next;
    setMicOn(next);
    if (next) {
      if (phase === 'idle') void listen();
    } else if (phase === 'listening') {
      // Mic off mid-sentence = "I'm done talking": answer what was said, then stay quiet.
      // If nothing was said yet, just stop listening.
      if (voice.hasHeardSpeech()) {
        void respond(session.current);
      } else {
        session.current++;
        void voice.stopListening();
        setPhase('idle');
      }
    }
  }

  function toggleSpeaker() {
    const next = !speakerOnRef.current;
    speakerOnRef.current = next;
    setSpeakerOn(next);
    // Silence the current reply; the conversation carries on.
    if (!next && phase === 'speaking') voice.stopPlayback();
  }

  function onOrbPress() {
    if (isWorking) {
      // Stop the task; the steps taken so far stay in the conversation.
      session.current++;
      conversation.cancel();
      setPhase('idle');
      return;
    }
    if (!micOnRef.current) {
      toggleMic();
      return;
    }
    if (phase === 'listening') {
      // Done talking: don't wait for the silence timeout.
      void respond(session.current);
    } else if (phase === 'speaking' || phase === 'idle') {
      voice.stopPlayback();
      void listen();
    }
  }

  // Start listening as soon as talk mode opens (or speak first); stop everything when leaving it.
  useEffect(() => {
    const start = setTimeout(() => {
      void speakFirst().then((spoke) => {
        if (!spoke) void listen();
      });
    }, 0);
    const sessions = session;
    return () => {
      clearTimeout(start);
      sessions.current++;
      voice.stopPlayback();
      void voice.stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A bubble answered by voice while talk mode is already open.
  useEffect(() => {
    if (!speakNext) return;
    const timer = setTimeout(() => void speakFirst(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakNext]);

  // The tile, widget or wake word while talk mode is open: listen now unless already busy.
  const firstRequest = useRef(listenRequest);
  useEffect(() => {
    if (listenRequest === firstRequest.current) return;
    firstRequest.current = listenRequest;
    if (phase === 'idle' || phase === 'speaking') {
      voice.stopPlayback();
      void listen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenRequest]);

  const status = isWorking
    ? 'Working · tap to stop'
    : !micOn && phase === 'idle'
      ? 'Mic off · tap to turn on'
      : STATUS[phase];

  // While thinking, echo this turn's words if known; otherwise keep the agent's last words on screen.
  // While Baymon is operating the phone, show what it's doing right now.
  const currentStep = isWorking ? working?.[working.length - 1]?.label : null;
  const caption = currentStep
    ? `${currentStep}…`
    : phase === 'thinking'
      ? heard
      : lastReply && (lastReply.caption ?? lastReply.speech ?? toSpeakable(lastReply.content));

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing.four }]}>
      <View style={styles.stage}>
        <Animated.View layout={glide}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={status}
            onPress={onOrbPress}
            disabled={phase === 'thinking' && !isWorking}>
            <VoiceOrb phase={phase} level={voice.level} size={orbSize} />
          </Pressable>
        </Animated.View>

        <Animated.View
          key={status}
          layout={glide}
          entering={FadeInDown.springify().damping(18)}
          exiting={FadeOut.duration(120)}>
          <Text variant="overline" tone="muted" style={styles.center}>
            {status}
          </Text>
        </Animated.View>
      </View>

      {/* Fixed height whether or not there's a caption, so the orb doesn't jump when one appears. */}
      <Animated.View layout={glide} style={[styles.captionArea, { height: captionHeight }]}>
        {caption ? (
          <Animated.View key={caption} entering={FadeIn.duration(320)} exiting={FadeOut.duration(160)} style={styles.flex}>
            {/* Never truncated: a long caption scrolls inside its area. */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.captionContent}>
              <Text tone={phase === 'thinking' && !currentStep ? 'default' : 'muted'} style={[styles.center, styles.caption]}>
                {phase === 'thinking' && !currentStep ? `“${caption}”` : caption}
              </Text>
            </ScrollView>
          </Animated.View>
        ) : null}
      </Animated.View>

      {/* Its own row above the controls: nothing can push it off screen or cover it. */}
      {notice ? <Notice key={notice} text={notice} error={noticeIsError} style={styles.notice} /> : null}

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
          accessibilityRole="switch"
          accessibilityLabel="Microphone"
          accessibilityState={{ checked: micOn }}
          onPress={toggleMic}
          style={[styles.control, styles.primary, !micOn && styles.primaryOff]}>
          <Icon name={micOn ? 'mic' : 'micOff'} size={22} color={micOn ? Colors.inverse : Colors.text} />
        </PressableScale>
        <PressableScale
          haptic
          scaleTo={0.9}
          accessibilityRole="switch"
          accessibilityLabel="Speaker"
          accessibilityState={{ checked: speakerOn }}
          onPress={toggleSpeaker}
          style={[styles.control, !speakerOn && styles.controlOff]}>
          <Icon name={speakerOn ? 'speaker' : 'speakerOff'} size={20} color={speakerOn ? Colors.textMuted : Colors.danger} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.five },
  stage: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  captionArea: { alignSelf: 'center', width: '100%', maxWidth: 520, marginBottom: Spacing.three },
  captionContent: { paddingHorizontal: Spacing.two },
  caption: { fontSize: 17, lineHeight: 25 },
  notice: { marginBottom: Spacing.four },
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
  controlOff: { borderColor: 'rgba(242, 85, 90, 0.35)' },
  primaryOff: { backgroundColor: Colors.surfaceRaised, borderColor: 'rgba(242, 85, 90, 0.45)' },
  primary: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.text, borderColor: Colors.text },
});
