import { useSyncExternalStore } from 'react';

import { chat, talkTurn, type ChatMode, type ChatTurn } from '@/lib/agent';
import { audioUriFromBase64 } from '@/lib/audio-files';
import { preferences } from '@/lib/preferences';
import { readJSON, writeJSON } from '@/lib/storage';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** User messages only: in flight or failed. */
  status?: 'pending' | 'error';
  error?: string;
  /** Spoken in talk mode rather than typed. */
  viaVoice?: boolean;
  /** Assistant only: what was spoken, and a playable URI for it (not persisted). */
  speech?: string | null;
  /** Assistant only, voice turns: short plain text shown under the orb (= what was spoken). */
  caption?: string;
  audioUri?: string;
  /** Non-fatal issues reported by the API (e.g. audio failed). */
  warnings?: string[];
  /** Created in this session (plays its entrance animation). Not persisted. */
  isNew?: boolean;
};

type State = {
  messages: ChatMessage[];
  mode: ChatMode;
  /** Waiting on the agent. */
  thinking: boolean;
};

/** Persist only the tail; the API never looks further back than 20 turns anyway. */
const PERSIST_LIMIT = 80;

let state: State = { messages: [], mode: 'type', thinking: false };
let storageKey: string | null = null;
/** Bumped on clear/reset so late replies from an old conversation are dropped. */
let generation = 0;
const listeners = new Set<() => void>();

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function setState(next: Partial<State>, persist = true) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (persist && storageKey) {
    writeJSON(storageKey, {
      mode: state.mode,
      messages: state.messages
        .filter((m) => m.status !== 'pending')
        .slice(-PERSIST_LIMIT)
        .map(({ audioUri: _audio, isNew: _new, ...m }) => m),
    });
  }
}

function update(id: string, patch: Partial<ChatMessage>) {
  setState({ messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

/** Completed turns, formatted for the API's `history`. */
function history(): ChatTurn[] {
  return state.messages
    .filter((m) => !m.status && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

export const conversation = {
  /** Load the signed-in user's saved conversation. */
  hydrate(userId: string) {
    const key = `baymon.chat.${userId}`;
    if (storageKey === key) return;
    storageKey = key;
    generation++;
    const saved = readJSON<{ mode?: ChatMode; messages?: ChatMessage[] }>(key);
    setState(
      {
        messages: (saved?.messages ?? []).map((m) => (m.status === 'pending' ? { ...m, status: 'error' as const } : m)),
        mode: saved?.mode === 'talk' ? 'talk' : 'type',
        thinking: false,
      },
      false
    );
  },

  getMode: () => state.mode,

  setMode(mode: ChatMode) {
    if (state.mode !== mode) setState({ mode });
  },

  /**
   * Send a message. Resolves with the agent's reply message, or `null` if it failed or the
   * conversation was cleared meanwhile. A mode switch requested by the agent is applied here.
   */
  async send(text: string, { viaVoice = false } = {}): Promise<ChatMessage | null> {
    const content = text.trim();
    if (!content) return null;
    const startedIn = generation;
    const prior = history();
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content,
      createdAt: Date.now(),
      status: 'pending',
      viaVoice,
      isNew: true,
    };
    setState({ messages: [...state.messages, userMessage], thinking: true });

    const { voice: ttsVoice, speakReplies } = preferences.get();
    const wantsAudio = viaVoice || state.mode === 'talk' || speakReplies;
    try {
      const reply = await chat({ message: content, history: prior, voice: wantsAudio, mode: state.mode, ttsVoice });
      if (startedIn !== generation) return null;
      const assistant: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply.text,
        createdAt: Date.now(),
        isNew: true,
        speech: reply.speech_text,
        audioUri: reply.audio_base64 ? audioUriFromBase64(reply.audio_base64) : undefined,
        warnings: reply.warnings.length ? reply.warnings.map((w) => w.message) : undefined,
      };
      setState({
        messages: [...state.messages.map((m) => (m.id === userMessage.id ? { ...m, status: undefined } : m)), assistant],
        thinking: false,
        ...(reply.mode && { mode: reply.mode }),
      });
      return assistant;
    } catch (e) {
      if (startedIn !== generation) return null;
      update(userMessage.id, { status: 'error', error: e instanceof Error ? e.message : 'Couldn’t send' });
      setState({ thinking: false });
      throw e;
    }
  },

  /**
   * One hands-free voice turn from a recording. Both messages are added once the reply arrives
   * (the transcript isn't known before then on the single-request path).
   */
  async sendVoice(recordingUri: string, { onTranscript }: { onTranscript?: (text: string) => void } = {}) {
    const startedIn = generation;
    setState({ thinking: true });
    try {
      const reply = await talkTurn({
        recordingUri,
        history: history(),
        ttsVoice: preferences.get().voice,
        onTranscript,
      });
      if (startedIn !== generation) return null;
      const now = Date.now();
      const user: ChatMessage = { id: newId(), role: 'user', content: reply.transcript, createdAt: now, viaVoice: true, isNew: true };
      const assistant: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: reply.text,
        createdAt: now + 1,
        isNew: true,
        speech: reply.caption,
        caption: reply.caption,
        audioUri: reply.audio_base64 ? audioUriFromBase64(reply.audio_base64) : undefined,
        warnings: reply.warnings.length ? reply.warnings.map((w) => w.message) : undefined,
      };
      setState({
        messages: [...state.messages, user, assistant],
        thinking: false,
        ...(reply.mode && { mode: reply.mode }),
      });
      return assistant;
    } catch (e) {
      if (startedIn === generation) setState({ thinking: false });
      throw e;
    }
  },

  /** Resend a failed message. */
  retry(id: string) {
    const failed = state.messages.find((m) => m.id === id);
    if (!failed || failed.status !== 'error') return;
    setState({ messages: state.messages.filter((m) => m.id !== id) });
    return conversation.send(failed.content, { viaVoice: failed.viaVoice }).catch(() => null);
  },

  attachAudio(id: string, audioUri: string) {
    update(id, { audioUri });
  },

  /** Start a fresh conversation. */
  clear() {
    generation++;
    setState({ messages: [], thinking: false });
  },

  /** Forget everything in memory (on sign-out). Saved history stays on device for the same user. */
  reset() {
    generation++;
    storageKey = null;
    state = { messages: [], mode: 'type', thinking: false };
    listeners.forEach((l) => l());
  },
};

export function useConversation() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}
