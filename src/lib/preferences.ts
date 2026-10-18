import { useSyncExternalStore } from 'react';

import { VOICES, type Voice } from '@/lib/agent';
import { readJSON, writeJSON } from '@/lib/storage';

export type Preferences = {
  /** TTS voice used for spoken replies. */
  voice: Voice;
  /** In type mode, also speak each reply aloud. */
  speakReplies: boolean;
  /** Tapping a bubble: open it in talk mode (read out, then listen) never, with headphones/car audio, or always. */
  bubbleVoice: 'off' | 'headphones' | 'always';
};

const KEY = 'baymon.preferences';
const DEFAULTS: Preferences = { voice: 'troy', speakReplies: false, bubbleVoice: 'headphones' };

function load(): Preferences {
  const saved = readJSON<Partial<Preferences>>(KEY) ?? {};
  return {
    voice: VOICES.includes(saved.voice as Voice) ? (saved.voice as Voice) : DEFAULTS.voice,
    speakReplies: saved.speakReplies ?? DEFAULTS.speakReplies,
    bubbleVoice: (['off', 'headphones', 'always'] as const).includes(saved.bubbleVoice as Preferences['bubbleVoice'])
      ? (saved.bubbleVoice as Preferences['bubbleVoice'])
      : DEFAULTS.bubbleVoice,
  };
}

let state: Preferences | null = null;
const listeners = new Set<() => void>();
const get = () => (state ??= load());

export const preferences = {
  get,
  set(patch: Partial<Preferences>) {
    state = { ...get(), ...patch };
    writeJSON(KEY, state);
    listeners.forEach((l) => l());
  },
};

export function usePreferences() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get,
    get
  );
}
