import { useSyncExternalStore } from 'react';

import { VOICES, type Voice } from '@/lib/agent';
import { readJSON, writeJSON } from '@/lib/storage';

export type Preferences = {
  /** TTS voice used for spoken replies. */
  voice: Voice;
  /** In type mode, also speak each reply aloud. */
  speakReplies: boolean;
};

const KEY = 'baymon.preferences';
const DEFAULTS: Preferences = { voice: 'troy', speakReplies: false };

function load(): Preferences {
  const saved = readJSON<Partial<Preferences>>(KEY) ?? {};
  return {
    voice: VOICES.includes(saved.voice as Voice) ? (saved.voice as Voice) : DEFAULTS.voice,
    speakReplies: saved.speakReplies ?? DEFAULTS.speakReplies,
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
