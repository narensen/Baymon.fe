import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useRef } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { createSpeechDetector } from '@/lib/speech-detector';

/** Mono AAC at 16 kHz: what Whisper uses internally, and a small fast upload. */
const RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
};

const POLL_MS = 60;
/** Native audio objects throw once released (e.g. during unmount); those calls are best-effort. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

type ListenOptions = {
  /** Detect the end of speech automatically (hands-free). */
  autoStop?: boolean;
  /** Called once speech has started and then gone quiet (autoStop only). */
  onUtteranceEnd?: () => void;
  /** Called when nothing was said before the timeout (autoStop only). */
  onNoSpeech?: () => void;
};

/**
 * Microphone + speaker for one screen. `level` (0..1) is a shared value updated off the React
 * render path, so visuals can follow the voice every frame without re-rendering.
 */
export function useVoice() {
  const recorder = useAudioRecorder(RECORDING);
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const level = useSharedValue(0);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Whether the current recording contains speech (so far). */
  const heardSpeech = useRef(false);
  const playbackDone = useRef<(() => void) | null>(null);

  function stopPolling() {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    level.set(0);
  }

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        playbackDone.current?.();
        playbackDone.current = null;
      }
    });
    return () => {
      safely(() => sub.remove());
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  async function ensurePermission() {
    const { granted } = await requestRecordingPermissionsAsync();
    return granted;
  }

  async function startRecorder() {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  /** Start recording. Never throws: resolves why it couldn't start, or 'ok'. */
  async function listen({ autoStop = false, onUtteranceEnd, onNoSpeech }: ListenOptions = {}) {
    if (!(await ensurePermission().catch(() => false))) return 'denied' as const;
    stopPlayback();
    try {
      await startRecorder();
    } catch {
      // Usually a previous recording that wasn't closed; stop it and try once more.
      try {
        await recorder.stop();
      } catch {}
      try {
        await startRecorder();
      } catch {
        return 'failed' as const;
      }
    }

    const detector = createSpeechDetector(Date.now());
    heardSpeech.current = false;
    stopPolling();
    poll.current = setInterval(() => {
      const status = safely(() => recorder.getStatus());
      if (!status?.isRecording) return;
      const event = detector.push(status.metering, Date.now());
      if (event === 'speaking' || event === 'ended') heardSpeech.current = true;
      level.set(detector.level);
      if (!autoStop) return;
      if (event === 'ended') {
        stopPolling();
        onUtteranceEnd?.();
      } else if (event === 'no-speech') {
        stopPolling();
        onNoSpeech?.();
      }
    }, POLL_MS);
    return 'ok' as const;
  }

  /** Stop recording; resolves with the recording's URI (null if nothing was recorded). */
  async function stopListening() {
    stopPolling();
    if (!safely(() => recorder.getStatus().isRecording)) return null;
    try {
      await recorder.stop();
      return recorder.uri;
    } catch {
      return null;
    }
  }

  /** Play a clip; resolves when it finishes or is stopped. */
  async function play(uri: string) {
    stopPlayback();
    // Leave record mode so iOS plays through the main speaker at full volume.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    return new Promise<void>((resolve) => {
      playbackDone.current = resolve;
      if (safely(() => (player.replace(uri), player.play(), true)) === undefined) resolve();
    });
  }

  function stopPlayback() {
    safely(() => player.playing && player.pause());
    playbackDone.current?.();
    playbackDone.current = null;
  }

  return { level, listen, stopListening, play, stopPlayback, player, hasHeardSpeech: () => heardSpeech.current };
}
