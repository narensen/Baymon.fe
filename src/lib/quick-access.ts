import { requestRecordingPermissionsAsync } from 'expo-audio';
import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { BaymonAgent, type IncomingIntent, type WakeWordConfig } from '@/modules/baymon-agent';
import { conversation } from '@/lib/conversation';
import { readJSON, writeJSON } from '@/lib/storage';
import { hasNativeAgent } from '@/lib/tools/native';

/**
 * Ways to reach Baymon without opening it first: the share sheet, the assistant gesture, and the
 * wake word. (The Quick Settings tile and the widget are plain links: baymon://talk.)
 */

// -------------------------------------------------------------------------------------------------
// Shared content waiting for the share sheet screen
// -------------------------------------------------------------------------------------------------

export type IncomingShare = Extract<IncomingIntent, { kind: 'share' }>;

let share: IncomingShare | null = null;
const shareListeners = new Set<() => void>();

export const incomingShare = {
  get: () => share,
  clear() {
    share = null;
    shareListeners.forEach((l) => l());
  },
};

export function useIncomingShare() {
  return useSyncExternalStore(
    (l) => {
      shareListeners.add(l);
      return () => shareListeners.delete(l);
    },
    () => share,
    () => share
  );
}

async function takeIncoming() {
  if (!hasNativeAgent || !BaymonAgent) return;
  const incoming = await BaymonAgent.takeIntent().catch(() => null);
  if (!incoming) return;
  if (incoming.kind === 'assist') {
    conversation.startTalk();
    try {
      router.navigate('/');
    } catch {}
    return;
  }
  if (!incoming.items.length) return;
  share = incoming;
  shareListeners.forEach((l) => l());
  try {
    router.navigate('/share');
  } catch {}
}

// -------------------------------------------------------------------------------------------------
// Wake word (Picovoice Porcupine, on the device)
// -------------------------------------------------------------------------------------------------

/** Porcupine's built-in keywords that make good names to call out. */
export const WAKE_WORDS = ['jarvis', 'computer', 'bumblebee', 'porcupine', 'terminator'] as const;

export type WakeWordSettings = {
  enabled: boolean;
  /** A built-in keyword, or "custom" for a trained .ppn file ("Hey Baymon"). */
  keyword: (typeof WAKE_WORDS)[number] | 'custom';
  accessKey: string;
  /** Absolute path of a custom keyword file, saved from the share sheet. */
  customPath: string | null;
  sensitivity: number;
};

const WAKE_KEY = 'baymon.wake-word';
const WAKE_DEFAULTS: WakeWordSettings = { enabled: false, keyword: 'jarvis', accessKey: '', customPath: null, sensitivity: 0.6 };

let wake: WakeWordSettings | null = null;
const wakeListeners = new Set<() => void>();
const getWake = () => (wake ??= { ...WAKE_DEFAULTS, ...readJSON<Partial<WakeWordSettings>>(WAKE_KEY) });

export const wakeWordAvailable = hasNativeAgent;

function config(s: WakeWordSettings): WakeWordConfig {
  const custom = s.keyword === 'custom' && s.customPath;
  return {
    accessKey: s.accessKey.trim(),
    // "custom" without a file falls back to a built-in word.
    keyword: s.keyword === 'custom' ? 'jarvis' : s.keyword,
    keywordPath: custom ? s.customPath : null,
    sensitivity: s.sensitivity,
  };
}

/** Starts or stops the service to match the settings. Must run while Baymon is open (Android rule). */
export async function applyWakeWord(): Promise<string | null> {
  if (!wakeWordAvailable || !BaymonAgent) return null;
  const s = getWake();
  try {
    if (!s.enabled || !s.accessKey.trim()) {
      BaymonAgent.stopWakeWord();
      return s.enabled ? 'Add your Picovoice AccessKey to turn it on.' : null;
    }
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return 'Microphone access is off. Allow it to use a wake word.';
    BaymonAgent.startWakeWord(config(s));
    // Baymon is open right now: it uses the microphone itself until it goes to the background.
    if (AppState.currentState === 'active') BaymonAgent.pauseWakeWord();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'The wake word couldn’t start.';
  }
}

export const wakeWord = {
  get: getWake,
  set(patch: Partial<WakeWordSettings>) {
    wake = { ...getWake(), ...patch };
    writeJSON(WAKE_KEY, wake);
    wakeListeners.forEach((l) => l());
  },
  status() {
    try {
      return BaymonAgent?.wakeWordStatus() ?? null;
    } catch {
      return null;
    }
  },
};

export function useWakeWord() {
  return useSyncExternalStore(
    (l) => {
      wakeListeners.add(l);
      return () => wakeListeners.delete(l);
    },
    getWake,
    getWake
  );
}

// -------------------------------------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------------------------------------

/** Listens for shares and the assistant gesture, and keeps the wake word out of Baymon's way. */
export function startQuickAccess(): () => void {
  if (!hasNativeAgent || !BaymonAgent) return () => {};
  void takeIncoming();
  if (getWake().enabled) void applyWakeWord();

  const intents = BaymonAgent.addListener('onIntent', () => void takeIncoming());
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      void takeIncoming();
      if (getWake().enabled) BaymonAgent?.pauseWakeWord();
    } else if (s === 'background' && getWake().enabled) {
      BaymonAgent?.resumeWakeWord();
    }
  });
  return () => {
    intents.remove();
    appState.remove();
    // Signed out: stop listening (it starts again on the next sign-in, while Baymon is open).
    try {
      BaymonAgent?.stopWakeWord();
    } catch {}
  };
}
